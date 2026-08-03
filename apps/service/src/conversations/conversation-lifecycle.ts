import { randomUUID } from "node:crypto";
import type {
  Artifact,
  Conversation,
  ConversationListItem,
  ConversationMessage,
  ConversationResource,
  ConversationWorkingMemory,
  CreateConversationTurnRequest,
  CreateConversationTurnResponse,
  CreationRun,
  CreationRunContext,
  CreationRunJob,
  DeleteConversationResponse,
  GetConversationResponse,
  ListConversationsResponse,
  RenameConversationRequest,
  ResourceSummary
} from "@mediaforge/contracts";
import {
  conversationWorkingMemorySchema,
  creationRunContextSchema
} from "@mediaforge/contracts";
import type { GenerateWechatArticleResponse } from "@mediaforge/contracts";
import { Pool, type PoolClient } from "pg";
import type { UserSkillService } from "../user-skills/user-skill-service";

interface ConversationRow {
  id: string;
  workspace_id: string;
  title: string;
  status: Conversation["status"];
  context_version: number;
  created_at: Date;
  updated_at: Date;
  last_interaction_at: Date;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: ConversationMessage["role"];
  content: string;
  resource_ids_json: string[];
  created_at: Date;
}

interface ResourceRow {
  id: string;
  upload_session_id: string | null;
  conversation_id: string | null;
  status: ResourceSummary["status"];
  source: ResourceSummary["source"];
  original_name: string;
  content_type: string;
  size_bytes: string | number;
  created_at: Date;
}

interface RunRow {
  id: string;
  conversation_id: string;
  type: CreationRun["type"];
  status: CreationRun["status"];
  current_step: string;
  lock_version: number;
  plan_json: CreationRun["plan"];
  steps_json: CreationRun["steps"];
  waiting_for_json: CreationRun["waitingFor"] | null;
  created_at: Date;
  updated_at: Date;
}

interface ArtifactRow {
  id: string;
  conversation_id: string;
  run_id: string;
  type: Artifact["type"];
  title: string;
  payload_json: GenerateWechatArticleResponse;
  article_id: string | null;
  article_version_id: string | null;
  created_at: Date;
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    contextVersion: row.context_version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lastInteractionAt: row.last_interaction_at.toISOString()
  };
}

function toResource(row: ResourceRow): ResourceSummary {
  return {
    id: row.id,
    uploadSessionId: row.upload_session_id,
    conversationId: row.conversation_id,
    status: row.status,
    source: row.source,
    originalName: row.original_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    previewUrl: `/resources/${row.id}/preview`,
    contentUrl: `/resources/${row.id}/content`,
    createdAt: row.created_at.toISOString()
  };
}

function toRun(row: RunRow, artifact?: Artifact): CreationRun {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    type: row.type,
    status: row.status,
    currentStep: row.current_step,
    lockVersion: row.lock_version,
    plan: row.plan_json,
    steps: row.steps_json,
    ...(row.waiting_for_json ? { waitingFor: row.waiting_for_json } : {}),
    ...(artifact ? { resultArtifact: artifact } : {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    type: row.type,
    title: row.title,
    payload: row.payload_json,
    ...(row.article_id ? { articleId: row.article_id } : {}),
    ...(row.article_version_id ? { articleVersionId: row.article_version_id } : {}),
    createdAt: row.created_at.toISOString()
  };
}

function createQueuedRun(conversationId: string, createdAt: string): CreationRun {
  return {
    id: randomUUID(),
    conversationId,
    type: "wechat_article_generation",
    status: "queued",
    currentStep: "brief",
    lockVersion: 1,
    plan: {
      strategy: "多 Agent 公众号创作流程",
      rationale: "由需求、标题、结构、写作、配图、审校和排版角色协作完成。",
      tasks: []
    },
    steps: [],
    createdAt,
    updatedAt: createdAt
  };
}

function clip(value: string, maxLength: number): string {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function createEmptyMemory(conversationId: string, contextVersion: number): ConversationWorkingMemory {
  return {
    conversationId,
    contextVersion,
    materialSummary: [],
    userConstraints: [],
    updatedAt: new Date().toISOString()
  };
}

function normalizeMemory(
  conversationId: string,
  contextVersion: number,
  memory: unknown
): ConversationWorkingMemory {
  if (!memory) return createEmptyMemory(conversationId, contextVersion);
  return conversationWorkingMemorySchema.parse({
    conversationId,
    contextVersion,
    materialSummary: [],
    userConstraints: [],
    updatedAt: new Date().toISOString(),
    ...(typeof memory === "object" ? memory : {})
  });
}

function isNewCreationIntent(input: string): boolean {
  return /重新生成一篇|新主题|换一个主题|另写一篇|从头写/u.test(input);
}

function revisionTarget(input: string): NonNullable<ConversationWorkingMemory["revisionIntent"]>["target"] {
  if (/标题|题目/u.test(input)) return "title";
  if (/结构|提纲|章节|段落顺序/u.test(input)) return "outline";
  if (/图片|配图|封面|素材/u.test(input)) return "image";
  if (/语气|风格|口吻|温暖|正式|自然/u.test(input)) return "style";
  if (/第三段|正文|内容|加上|删掉|补充/u.test(input)) return "body";
  return "all";
}

function isRevisionIntent(input: string, memory: ConversationWorkingMemory): boolean {
  if (!memory.lastArtifactId || isNewCreationIntent(input)) return false;
  return /改|调整|换|优化|加|删|重写|更|补充|第三段|标题|语气|风格/u.test(input) || input.trim().length <= 40;
}

function createRunContext(
  conversationId: string,
  contextVersion: number,
  input: {
    userInput: string;
    resourceIds: string[];
    skillId: string;
    selectedSkills: CreationRunContext["selectedSkills"];
    maxSteps: number;
  },
  memory: ConversationWorkingMemory
): CreationRunContext {
  const revisionIntent = isRevisionIntent(input.userInput, memory)
    ? {
        target: revisionTarget(input.userInput),
        instruction: clip(input.userInput, 1000),
        createdAt: new Date().toISOString()
      }
    : undefined;
  const memorySnapshot = isNewCreationIntent(input.userInput)
    ? createEmptyMemory(conversationId, contextVersion)
    : memory;
  return creationRunContextSchema.parse({
    ...input,
    contextVersion,
    memory: {
      brief: memorySnapshot.brief,
      selectedTitle: memorySnapshot.selectedTitle,
      outline: memorySnapshot.outline,
      draftSummary: memorySnapshot.draftSummary,
      materialSummary: memorySnapshot.materialSummary,
      userConstraints: memorySnapshot.userConstraints,
      lastArtifactId: revisionIntent ? memorySnapshot.lastArtifactId : undefined,
      revisionIntent
    }
  });
}

export function createConversationLifecycleService(
  databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/mediaforge",
  userSkills?: Pick<UserSkillService, "resolveMentions">
) {
  const pool = new Pool({ connectionString: databaseUrl });

  async function withTransaction<T>(execute: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const value = await execute(client);
      await client.query("commit");
      return value;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function appendRunCreated(client: PoolClient, run: CreationRun): Promise<void> {
    await client.query(
      `insert into run_events (id, run_id, event_no, type, payload_json, created_at)
       values ($1, $2, 1, 'run.created', $3, $4)`,
      [
        randomUUID(),
        run.id,
        JSON.stringify({
          runId: run.id,
          conversationId: run.conversationId,
          status: "queued",
          currentStep: "brief"
        }),
        run.createdAt
      ]
    );
  }

  async function getConversationMemory(
    client: PoolClient,
    conversationId: string,
    contextVersion: number
  ): Promise<ConversationWorkingMemory> {
    const result = await client.query<{ memory_json: unknown; context_version: number }>(
      "select memory_json, context_version from conversation_memories where conversation_id = $1",
      [conversationId]
    );
    const row = result.rows[0];
    return normalizeMemory(conversationId, row?.context_version ?? contextVersion, row?.memory_json);
  }

  async function insertRun(
    client: PoolClient,
    ownerId: string,
    conversationId: string,
    contextVersion: number,
    userInput: string,
    resourceIds: string[],
    input: CreateConversationTurnRequest,
    createdAt: string
  ): Promise<CreationRun> {
    const run = createQueuedRun(conversationId, createdAt);
    const memory = await getConversationMemory(client, conversationId, contextVersion);
    const selectedSkills = userSkills
      ? await userSkills.resolveMentions(ownerId, input.skillMentions)
      : [];
    const runContext = createRunContext(
      conversationId,
      contextVersion,
      {
        userInput,
        resourceIds,
        skillId: selectedSkills[0]?.skillId ?? input.layoutSkillId,
        selectedSkills,
        maxSteps: input.maxSteps
      },
      memory
    );
    const job: CreationRunJob = {
      runId: run.id,
      conversationId,
      workspaceId: ownerId,
      contextVersion,
      graphName: "wechat_article_creation",
      graphVersion: "2026-07-27"
    };
    await client.query(
      `insert into runs
        (id, conversation_id, type, status, current_step, lock_version, plan_json, steps_json, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
      [
        run.id,
        conversationId,
        run.type,
        run.status,
        run.currentStep,
        run.lockVersion,
        JSON.stringify(run.plan),
        JSON.stringify(run.steps),
        createdAt
      ]
    );
    await client.query(
      `insert into graph_runs
        (id, run_id, graph_name, graph_version, context_version, context_json, status, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, 'queued', $7, $7)`,
      [
        randomUUID(),
        run.id,
        job.graphName,
        job.graphVersion,
        contextVersion,
        JSON.stringify(runContext),
        createdAt
      ]
    );
    await client.query(
      `insert into run_dispatch_outbox
        (id, run_id, queue_name, payload_json, status, next_attempt_at, created_at, updated_at)
       values ($1, $2, 'creation-run', $3, 'pending', $4, $4, $4)`,
      [randomUUID(), run.id, JSON.stringify(job), createdAt]
    );
    await client.query(
      `insert into generation_usage_events
        (id, user_id, generation_id, run_id, idempotency_key, generation_type, status,
         accepted_at, started_at, created_at, updated_at)
       values ($1, $2, $1, $3, $4, 'wechat_article_generation', 'running', $5, $5, $5, $5)
       on conflict (run_id) do nothing`,
      [`generation_${randomUUID()}`, ownerId, run.id, input.idempotencyKey, createdAt]
    );
    await appendRunCreated(client, run);
    return run;
  }

  async function attachResources(
    client: PoolClient,
    ownerId: string,
    conversationId: string,
    messageId: string,
    uploadSessionId: string | undefined,
    resourceIds: string[],
    createdAt: string
  ): Promise<ResourceSummary[]> {
    if (resourceIds.length === 0) return [];
    const result = await client.query<ResourceRow>(
      `select * from resources
       where owner_id = $1 and id = any($2::text[]) and status = 'staged'
         and ($3::text is null or upload_session_id = $3)
       for update`,
      [ownerId, resourceIds, uploadSessionId ?? null]
    );
    if (result.rows.length !== resourceIds.length) throw new Error("RESOURCE_NOT_STAGED");
    const byId = new Map(result.rows.map((row) => [row.id, row]));
    for (const [index, resourceId] of resourceIds.entries()) {
      const row = byId.get(resourceId);
      if (!row) throw new Error("RESOURCE_NOT_STAGED");
      await client.query(
        `update resources
         set conversation_id = $2, status = 'attached', updated_at = $3
         where id = $1`,
        [resourceId, conversationId, createdAt]
      );
      await client.query(
        `insert into message_resources (message_id, resource_id, display_order, created_at)
         values ($1, $2, $3, $4)`,
        [messageId, resourceId, index, createdAt]
      );
    }
    if (uploadSessionId) {
      await client.query(
        `update upload_sessions set status = 'consumed', consumed_at = $2
         where id = $1 and owner_id = $3 and status = 'active'`,
        [uploadSessionId, createdAt, ownerId]
      );
    }
    return resourceIds.map((id) => toResource({
      ...byId.get(id)!,
      conversation_id: conversationId,
      status: "attached"
    }));
  }

  async function getIdempotentResponse(
    ownerId: string,
    idempotencyKey: string
  ): Promise<CreateConversationTurnResponse | undefined> {
    const result = await pool.query<{ conversation_id: string; message_id: string; run_id: string }>(
      `select conversation_id, message_id, run_id from conversation_turn_requests
       where owner_id = $1 and idempotency_key = $2`,
      [ownerId, idempotencyKey]
    );
    const request = result.rows[0];
    if (!request) return undefined;
    const snapshot = await getConversation(ownerId, request.conversation_id);
    const message = snapshot.messages.find((item) => item.id === request.message_id);
    if (!message) throw new Error("TURN_MESSAGE_NOT_FOUND");
    const runResult = await pool.query<RunRow>("select * from runs where id = $1", [request.run_id]);
    if (!runResult.rows[0]) throw new Error("RUN_NOT_FOUND");
    return {
      conversation: snapshot.conversation,
      message,
      resources: message.resources ?? [],
      run: toRun(runResult.rows[0])
    };
  }

  async function getConversation(ownerId: string, conversationId: string): Promise<GetConversationResponse> {
    const conversationResult = await pool.query<ConversationRow>(
      `select * from conversations
       where id = $1 and owner_id = $2 and status = 'active'`,
      [conversationId, ownerId]
    );
    const row = conversationResult.rows[0];
    if (!row) throw new Error("CONVERSATION_NOT_FOUND");
    const [messagesResult, resourcesResult, relationsResult, runResult, artifactsResult] = await Promise.all([
      pool.query<MessageRow>(
        "select * from conversation_messages where conversation_id = $1 order by created_at, id",
        [conversationId]
      ),
      pool.query<ResourceRow>(
        "select * from resources where conversation_id = $1 and status = 'attached' order by created_at, id",
        [conversationId]
      ),
      pool.query<{ message_id: string; resource_id: string }>(
        `select message_id, resource_id from message_resources
         where message_id in (select id from conversation_messages where conversation_id = $1)
         order by display_order`,
        [conversationId]
      ),
      pool.query<RunRow>(
        "select * from runs where conversation_id = $1 order by created_at desc limit 1",
        [conversationId]
      ),
      pool.query<ArtifactRow>(
        "select * from artifacts where conversation_id = $1 order by created_at",
        [conversationId]
      )
    ]);
    const resources = resourcesResult.rows.map(toResource);
    const resourceById = new Map(resources.map((resource) => [resource.id, resource]));
    const idsByMessage = new Map<string, string[]>();
    for (const relation of relationsResult.rows) {
      idsByMessage.set(relation.message_id, [...(idsByMessage.get(relation.message_id) ?? []), relation.resource_id]);
    }
    const messages: ConversationMessage[] = messagesResult.rows.map((message) => {
      const resourceIds = idsByMessage.get(message.id) ?? message.resource_ids_json ?? [];
      return {
        id: message.id,
        conversationId: message.conversation_id,
        role: message.role,
        content: message.content,
        resourceIds,
        resources: resourceIds.flatMap((id) => resourceById.get(id) ?? []),
        createdAt: message.created_at.toISOString()
      };
    });
    const artifacts = artifactsResult.rows.map(toArtifact);
    const latestRunRow = runResult.rows[0];
    const runArtifact = latestRunRow
      ? artifacts.find((artifact) => artifact.runId === latestRunRow.id)
      : undefined;
    const legacyResources: ConversationResource[] = resources.map((resource) => ({
      id: resource.id,
      conversationId,
      assetId: resource.id,
      source: resource.source,
      createdAt: resource.createdAt
    }));
    return {
      conversation: toConversation(row),
      messages,
      resources: legacyResources,
      activeRun: latestRunRow ? toRun(latestRunRow, runArtifact) : null,
      latestArtifacts: artifacts
    };
  }

  return {
    async close(): Promise<void> {
      await pool.end();
    },

    async createFirstTurn(
      ownerId: string,
      input: CreateConversationTurnRequest
    ): Promise<CreateConversationTurnResponse> {
      const existing = await getIdempotentResponse(ownerId, input.idempotencyKey);
      if (existing) return existing;
      await withTransaction(async (client) => {
        await client.query("select pg_advisory_xact_lock(hashtext($1))", [`${ownerId}:${input.idempotencyKey}`]);
        const duplicate = await client.query(
          `select 1 from conversation_turn_requests
           where owner_id = $1 and idempotency_key = $2`,
          [ownerId, input.idempotencyKey]
        );
        if (duplicate.rowCount) return;
        const createdAt = new Date().toISOString();
        const conversationId = randomUUID();
        const messageId = randomUUID();
        await client.query(
          `insert into conversations
            (id, workspace_id, owner_id, title, status, context_version, created_at, updated_at, last_interaction_at)
           values ($1, $2, $2, $3, 'active', 1, $4, $4, $4)`,
          [conversationId, ownerId, input.content, createdAt]
        );
        await client.query(
          `insert into conversation_messages
            (id, conversation_id, role, content, resource_ids_json, created_at)
           values ($1, $2, 'user', $3, $4, $5)`,
          [messageId, conversationId, input.content, JSON.stringify(input.resourceIds), createdAt]
        );
        await attachResources(
          client,
          ownerId,
          conversationId,
          messageId,
          input.uploadSessionId,
          input.resourceIds,
          createdAt
        );
        const run = await insertRun(
          client,
          ownerId,
          conversationId,
          1,
          input.content,
          input.resourceIds,
          input,
          createdAt
        );
        await client.query(
          `insert into conversation_turn_requests
            (id, owner_id, idempotency_key, conversation_id, message_id, run_id, created_at)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [randomUUID(), ownerId, input.idempotencyKey, conversationId, messageId, run.id, createdAt]
        );
      });
      const response = await getIdempotentResponse(ownerId, input.idempotencyKey);
      if (!response) throw new Error("TURN_NOT_CREATED");
      return response;
    },

    async appendTurn(
      ownerId: string,
      conversationId: string,
      input: CreateConversationTurnRequest
    ): Promise<CreateConversationTurnResponse> {
      const existing = await getIdempotentResponse(ownerId, input.idempotencyKey);
      if (existing) return existing;
      await withTransaction(async (client) => {
        await client.query("select pg_advisory_xact_lock(hashtext($1))", [`${ownerId}:${input.idempotencyKey}`]);
        const conversationResult = await client.query<ConversationRow>(
          `select * from conversations
           where id = $1 and owner_id = $2 for update`,
          [conversationId, ownerId]
        );
        const conversation = conversationResult.rows[0];
        if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");
        if (conversation.status !== "active") throw new Error("CONVERSATION_DELETING");
        const createdAt = new Date().toISOString();
        const messageId = randomUUID();
        const contextVersion = conversation.context_version + 1;
        await client.query(
          `insert into conversation_messages
            (id, conversation_id, role, content, resource_ids_json, created_at)
           values ($1, $2, 'user', $3, $4, $5)`,
          [messageId, conversationId, input.content, JSON.stringify(input.resourceIds), createdAt]
        );
        await attachResources(
          client,
          ownerId,
          conversationId,
          messageId,
          input.uploadSessionId,
          input.resourceIds,
          createdAt
        );
        await client.query(
          `update conversations
           set context_version = $2, updated_at = $3, last_interaction_at = $3
           where id = $1`,
          [conversationId, contextVersion, createdAt]
        );
        const contextMessages = await client.query<{ content: string }>(
          `select content from conversation_messages
           where conversation_id = $1 and role = 'user'
           order by created_at desc limit 20`,
          [conversationId]
        );
        const allResources = await client.query<{ id: string }>(
          `select id from resources
           where conversation_id = $1 and status = 'attached' order by created_at`,
          [conversationId]
        );
        const run = await insertRun(
          client,
          ownerId,
          conversationId,
          contextVersion,
          contextMessages.rows.reverse().map((message) => message.content).join("\n\n"),
          allResources.rows.map((resource) => resource.id),
          input,
          createdAt
        );
        await client.query(
          `insert into conversation_turn_requests
            (id, owner_id, idempotency_key, conversation_id, message_id, run_id, created_at)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [randomUUID(), ownerId, input.idempotencyKey, conversationId, messageId, run.id, createdAt]
        );
      });
      const response = await getIdempotentResponse(ownerId, input.idempotencyKey);
      if (!response) throw new Error("TURN_NOT_CREATED");
      return response;
    },

    getConversation,

    async list(ownerId: string, limit = 30): Promise<ListConversationsResponse> {
      const result = await pool.query<ConversationRow>(
        `select * from conversations c
         where c.owner_id = $1 and c.status = 'active'
           and exists (
             select 1 from conversation_messages m
             where m.conversation_id = c.id and m.role = 'user'
           )
         order by c.last_interaction_at desc, c.id desc
         limit $2`,
        [ownerId, Math.min(Math.max(limit, 1), 100)]
      );
      const items: ConversationListItem[] = result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        createdAt: row.created_at.toISOString(),
        lastInteractionAt: row.last_interaction_at.toISOString()
      }));
      return { items, nextCursor: null };
    },

    async rename(
      ownerId: string,
      conversationId: string,
      input: RenameConversationRequest
    ): Promise<Conversation> {
      const result = await pool.query<ConversationRow>(
        `update conversations set title = $3, updated_at = now()
         where id = $1 and owner_id = $2 and status = 'active'
         returning *`,
        [conversationId, ownerId, input.title]
      );
      if (!result.rows[0]) throw new Error("CONVERSATION_NOT_FOUND");
      return toConversation(result.rows[0]);
    },

    async remove(ownerId: string, conversationId: string): Promise<DeleteConversationResponse> {
      await withTransaction(async (client) => {
        const result = await client.query<ConversationRow>(
          "select * from conversations where id = $1 and owner_id = $2 for update",
          [conversationId, ownerId]
        );
        const conversation = result.rows[0];
        if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");
        if (conversation.status === "deleting") return;
        const keys = await client.query<{ original_object_key: string; preview_object_key: string | null }>(
          `select original_object_key, preview_object_key
           from resources where conversation_id = $1`,
          [conversationId]
        );
        const objectKeys = [...new Set(keys.rows.flatMap((row) =>
          [row.original_object_key, row.preview_object_key].filter((value): value is string => Boolean(value))))];
        await client.query(
          "update conversations set status = 'deleting', updated_at = now() where id = $1",
          [conversationId]
        );
        await client.query(
          `insert into conversation_deletion_outbox
            (id, conversation_id, owner_id, object_keys_json, status, next_attempt_at, created_at, updated_at)
           values ($1, $2, $3, $4, 'pending', now(), now(), now())
           on conflict (conversation_id) do nothing`,
          [randomUUID(), conversationId, ownerId, JSON.stringify(objectKeys)]
        );
      });
      return { conversationId, status: "deleting" };
    }
  };
}

export type ConversationLifecycleService = ReturnType<typeof createConversationLifecycleService>;

import { randomUUID } from "node:crypto";
import type {
  AgentOutputType,
  Artifact,
  Conversation,
  ConversationMessage,
  ConversationResource,
  ConversationWorkingMemory,
  CreationGraphState,
  CreationRun,
  CreationRunContext,
  CreationRunJob,
  CreationRunStatus,
  GenerateWechatArticleResponse,
  RunEvent,
  RunEventType,
  SubmitRunClarificationRequest
} from "@mediaforge/contracts";
import {
  conversationWorkingMemorySchema,
  creationRunContextSchema
} from "@mediaforge/contracts";
import { Pool, type PoolClient } from "pg";

interface RunRow {
  id: string;
  conversation_id: string;
  type: CreationRun["type"];
  status: CreationRunStatus;
  current_step: string;
  lock_version: number;
  plan_json: CreationRun["plan"];
  steps_json: CreationRun["steps"];
  waiting_for_json: CreationRun["waitingFor"] | null;
  created_at: Date;
  updated_at: Date;
}

type CreationRunContextInput = Omit<CreationRunContext, "memory"> & Partial<Pick<CreationRunContext, "memory">>;

interface EventRow {
  id: string;
  run_id: string;
  event_no: number;
  type: RunEventType;
  payload_json: Record<string, unknown>;
  created_at: Date;
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

interface OutboxRow {
  id: string;
  run_id: string;
  payload_json: CreationRunJob;
}

interface ConversationRow {
  id: string;
  workspace_id: string;
  owner_id?: string;
  title: string;
  status: Conversation["status"];
  context_version?: number;
  created_at: Date;
  updated_at: Date;
  last_interaction_at?: Date;
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
  conversation_id: string;
  asset_id: string;
  source: ConversationResource["source"];
  created_at: Date;
}

function now(): string {
  return new Date().toISOString();
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
    updatedAt: now()
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
    updatedAt: now(),
    ...(typeof memory === "object" ? memory : {})
  });
}

function inferRevisionTarget(input: string): NonNullable<ConversationWorkingMemory["revisionIntent"]>["target"] {
  if (/标题|题目/u.test(input)) return "title";
  if (/结构|提纲|章节|段落顺序/u.test(input)) return "outline";
  if (/图片|配图|封面|素材/u.test(input)) return "image";
  if (/语气|风格|口吻|温暖|正式|自然/u.test(input)) return "style";
  if (/第三段|正文|内容|加上|删掉|补充/u.test(input)) return "body";
  return "all";
}

function isNewCreationIntent(input: string): boolean {
  return /重新生成一篇|新主题|换一个主题|另写一篇|从头写/u.test(input);
}

function isRevisionIntent(input: string, memory: ConversationWorkingMemory): boolean {
  if (!memory.lastArtifactId) return false;
  if (isNewCreationIntent(input)) return false;
  return /改|调整|换|优化|加|删|重写|更|补充|第三段|标题|语气|风格/u.test(input) || input.trim().length <= 40;
}

function createRunContext(
  conversationId: string,
  contextVersion: number,
  input: CreationRunContextInput,
  memory: ConversationWorkingMemory
): CreationRunContext {
  const currentInstruction = input.currentInstruction ?? input.userInput;
  const creationMode = input.creationMode ?? (
    isNewCreationIntent(currentInstruction) || !memory.lastArtifactId
      ? "new"
      : isRevisionIntent(currentInstruction, memory)
        ? "revise"
        : "continue"
  );
  const revisionIntent = creationMode === "revise"
    ? {
        target: inferRevisionTarget(currentInstruction),
        instruction: clip(currentInstruction, 1000),
        createdAt: now()
      }
    : undefined;
  const memorySnapshot = creationMode === "new"
    ? createEmptyMemory(conversationId, contextVersion)
    : memory;

  return creationRunContextSchema.parse({
    ...input,
    currentInstruction,
    creationMode,
    contextVersion,
    memory: {
      brief: memorySnapshot.brief,
      selectedTitle: memorySnapshot.selectedTitle,
      outline: memorySnapshot.outline,
      layoutPlan: memorySnapshot.layoutPlan,
      draftSummary: memorySnapshot.draftSummary,
      materialSummary: memorySnapshot.materialSummary,
      userConstraints: memorySnapshot.userConstraints,
      lastArtifactId: revisionIntent ? memorySnapshot.lastArtifactId : undefined,
      revisionIntent
    }
  });
}

function selectedTitleFromState(state: CreationGraphState): ConversationWorkingMemory["selectedTitle"] {
  const selected = state.titles?.items.find((item) => item.id === state.titles?.selectedId);
  if (!selected) return undefined;
  return {
    id: selected.id,
    title: selected.title,
    subtitle: selected.subtitle,
    angle: selected.angle
  };
}

function memoryFromGraphResult(
  conversationId: string,
  contextVersion: number,
  previous: ConversationWorkingMemory,
  state: CreationGraphState,
  artifact: Artifact
): ConversationWorkingMemory {
  const sectionTitles = state.outline?.sections.map((section) => section.title) ?? previous.outline?.sectionTitles ?? [];
  return conversationWorkingMemorySchema.parse({
    conversationId,
    contextVersion,
    brief: state.brief ?? previous.brief,
    selectedTitle: selectedTitleFromState(state) ?? previous.selectedTitle,
    outline: state.outline
      ? {
          title: state.outline.title,
          subtitle: state.outline.subtitle,
          sectionTitles,
          openingHook: state.outline.openingHook,
          callToAction: state.outline.callToAction
        }
      : previous.outline,
    layoutPlan: state.layoutPlan ?? previous.layoutPlan,
    draftSummary: state.draft
      ? {
          artifactId: artifact.id,
          title: state.draft.title,
          paragraphCount: 2 + state.draft.sections.reduce((count, section) => count + section.paragraphs.length, 0),
          sectionTitles,
          keyPoints: state.draft.sections.flatMap((section) => section.paragraphs).slice(0, 6).map((paragraph) => clip(paragraph, 120)),
          tone: state.brief?.tone ?? previous.draftSummary?.tone,
          audience: state.brief?.audience ?? previous.draftSummary?.audience
        }
      : previous.draftSummary,
    materialSummary: state.materials
      ? [
          ...previous.materialSummary.filter((previousItem) =>
            !state.materials!.items.some((currentItem) => currentItem.resourceId === previousItem.resourceId)
          ),
          ...state.materials.items
        ].slice(-50)
      : previous.materialSummary,
    userConstraints: previous.userConstraints,
    revisionIntent: undefined,
    lastArtifactId: artifact.id,
    updatedAt: now()
  });
}

function toRun(row: RunRow, artifact?: Artifact): CreationRun {
  const run: CreationRun = {
    id: row.id,
    conversationId: row.conversation_id,
    type: row.type,
    status: row.status,
    currentStep: row.current_step,
    lockVersion: row.lock_version,
    plan: row.plan_json,
    steps: row.steps_json,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
  if (row.waiting_for_json) run.waitingFor = row.waiting_for_json;
  if (artifact) run.resultArtifact = artifact;
  return run;
}

function toEvent(row: EventRow): RunEvent {
  return {
    id: row.id,
    runId: row.run_id,
    eventNo: row.event_no,
    type: row.type,
    payload: row.payload_json,
    createdAt: row.created_at.toISOString()
  };
}

function toArtifact(row: ArtifactRow): Artifact {
  const artifact: Artifact = {
    id: row.id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    type: row.type,
    title: row.title,
    payload: row.payload_json,
    createdAt: row.created_at.toISOString()
  };
  if (row.article_id) artifact.articleId = row.article_id;
  if (row.article_version_id) artifact.articleVersionId = row.article_version_id;
  return artifact;
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    status: row.status,
    contextVersion: row.context_version ?? 0,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lastInteractionAt: (row.last_interaction_at ?? row.updated_at).toISOString()
  };
}

function toMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    resourceIds: row.resource_ids_json,
    createdAt: row.created_at.toISOString()
  };
}

function toResource(row: ResourceRow): ConversationResource {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    assetId: row.asset_id,
    source: row.source,
    createdAt: row.created_at.toISOString()
  };
}

export function createCreationPersistence(databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/mediaforge") {
  const pool = new Pool({ connectionString: databaseUrl });

  async function withTransaction<T>(execute: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await execute(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function appendEventWithClient(
    client: PoolClient,
    runId: string,
    type: RunEventType,
    payload: Record<string, unknown>
  ): Promise<RunEvent> {
    await client.query("select id from runs where id = $1 for update", [runId]);
    const numberResult = await client.query<{ event_no: number }>(
      "select coalesce(max(event_no), 0) + 1 as event_no from run_events where run_id = $1",
      [runId]
    );
    const eventNo = Number(numberResult.rows[0]?.event_no ?? 1);
    const createdAt = now();
    const event = {
      id: randomUUID(),
      runId,
      eventNo,
      type,
      payload: { runId, ...payload },
      createdAt
    };
    await client.query(
      `insert into run_events (id, run_id, event_no, type, payload_json, created_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [event.id, runId, eventNo, type, JSON.stringify(event.payload), createdAt]
    );
    return event;
  }

  async function getConversationMemoryWithClient(
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

  async function upsertConversationMemoryWithClient(
    client: PoolClient,
    memory: ConversationWorkingMemory
  ): Promise<void> {
    await client.query(
      `insert into conversation_memories
        (conversation_id, context_version, memory_json, created_at, updated_at)
       values ($1, $2, $3, now(), now())
       on conflict (conversation_id) do update set
         context_version = excluded.context_version,
         memory_json = excluded.memory_json,
         updated_at = now()`,
      [memory.conversationId, memory.contextVersion, JSON.stringify(memory)]
    );
  }

  return {
    async close(): Promise<void> {
      await pool.end();
    },

    async healthcheck(): Promise<void> {
      await pool.query("select 1");
    },

    async saveConversation(
      conversation: Conversation,
      conversationMessages: ConversationMessage[],
      conversationResources: ConversationResource[]
    ): Promise<void> {
      await withTransaction(async (client) => {
        await client.query(
          `insert into conversations
            (id, workspace_id, owner_id, title, status, context_version, created_at, updated_at, last_interaction_at)
           values ($1, $2, $2, $3, $4, $5, $6, $7, $8)
           on conflict (id) do update set
             title = excluded.title,
             status = excluded.status,
             context_version = excluded.context_version,
             updated_at = excluded.updated_at,
             last_interaction_at = excluded.last_interaction_at`,
          [
            conversation.id,
            conversation.workspaceId ?? "local-user",
            conversation.title,
            conversation.status,
            conversation.contextVersion,
            conversation.createdAt,
            conversation.updatedAt,
            conversation.lastInteractionAt
          ]
        );
        for (const message of conversationMessages) {
          await client.query(
            `insert into conversation_messages (id, conversation_id, role, content, resource_ids_json, created_at)
             values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing`,
            [message.id, message.conversationId, message.role, message.content, JSON.stringify(message.resourceIds), message.createdAt]
          );
        }
        for (const resource of conversationResources) {
          await client.query(
            `insert into conversation_resources (id, conversation_id, asset_id, source, created_at)
             values ($1, $2, $3, $4, $5) on conflict (id) do nothing`,
            [resource.id, resource.conversationId, resource.assetId, resource.source, resource.createdAt]
          );
        }
      });
    },

    async getConversationSnapshot(conversationId: string): Promise<{
      conversation: Conversation;
      messages: ConversationMessage[];
      resources: ConversationResource[];
    } | undefined> {
      const conversationResult = await pool.query<ConversationRow>(
        "select * from conversations where id = $1",
        [conversationId]
      );
      if (!conversationResult.rows[0]) return undefined;
      const [messageResult, resourceResult] = await Promise.all([
        pool.query<MessageRow>(
          "select * from conversation_messages where conversation_id = $1 order by created_at",
          [conversationId]
        ),
        pool.query<ResourceRow>(
          "select * from conversation_resources where conversation_id = $1 order by created_at",
          [conversationId]
        )
      ]);
      return {
        conversation: toConversation(conversationResult.rows[0]),
        messages: messageResult.rows.map(toMessage),
        resources: resourceResult.rows.map(toResource)
      };
    },

    async listWorkspaceConversations(workspaceId: string): Promise<Conversation[]> {
      const result = await pool.query<ConversationRow>(
        `select * from conversations
         where workspace_id = $1 and status = 'active'
         order by last_interaction_at desc, id desc`,
        [workspaceId]
      );
      return result.rows.map(toConversation);
    },

    async appendAssistantMessage(
      conversationId: string,
      messageId: string,
      content: string,
      createdAt = now()
    ): Promise<void> {
      await withTransaction(async (client) => {
        await client.query(
          `insert into conversation_messages
            (id, conversation_id, role, content, resource_ids_json, created_at)
           values ($1, $2, 'assistant', $3, '[]'::jsonb, $4)
           on conflict (id) do nothing`,
          [messageId, conversationId, content, createdAt]
        );
        await client.query(
          "update conversations set updated_at = $2 where id = $1",
          [conversationId, createdAt]
        );
      });
    },

    async createQueuedRun(run: CreationRun, context: CreationRunContextInput, job: CreationRunJob): Promise<void> {
      await withTransaction(async (client) => {
        const memory = await getConversationMemoryWithClient(client, run.conversationId, job.contextVersion);
        const runContext = createRunContext(
          run.conversationId,
          job.contextVersion,
          context,
          memory
        );
        await client.query(
          `insert into runs
            (id, conversation_id, type, status, current_step, lock_version, plan_json, steps_json, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            run.id,
            run.conversationId,
            run.type,
            run.status,
            run.currentStep,
            run.lockVersion,
            JSON.stringify(run.plan),
            JSON.stringify(run.steps),
            run.createdAt,
            run.updatedAt
          ]
        );
        await client.query(
          `insert into graph_runs
            (id, run_id, graph_name, graph_version, context_version, context_json, status, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            randomUUID(),
            run.id,
            job.graphName,
            job.graphVersion,
            job.contextVersion,
            JSON.stringify(runContext),
            "queued",
            run.createdAt,
            run.updatedAt
          ]
        );
        await client.query(
          `insert into run_dispatch_outbox
            (id, run_id, queue_name, payload_json, status, next_attempt_at, created_at, updated_at)
           values ($1, $2, $3, $4, 'pending', $5, $5, $5)`,
          [randomUUID(), run.id, "creation-run", JSON.stringify(job), run.createdAt]
        );
        await appendEventWithClient(client, run.id, "run.created", {
          conversationId: run.conversationId,
          status: "queued",
          currentStep: "brief"
        });
      });
    },

    async getRunContext(runId: string): Promise<CreationRunContext> {
      const result = await pool.query<{ context_json: unknown }>(
        "select context_json from graph_runs where run_id = $1",
        [runId]
      );
      if (!result.rows[0]) throw new Error("RUN_CONTEXT_NOT_FOUND");
      return creationRunContextSchema.parse(result.rows[0].context_json);
    },

    async getRun(runId: string): Promise<CreationRun | undefined> {
      const result = await pool.query<RunRow>("select * from runs where id = $1", [runId]);
      if (!result.rows[0]) return undefined;
      const artifact = await this.getArtifactByRun(runId);
      return toRun(result.rows[0], artifact);
    },

    async getLatestRunForConversation(conversationId: string): Promise<CreationRun | undefined> {
      const result = await pool.query<RunRow>(
        "select * from runs where conversation_id = $1 order by created_at desc limit 1",
        [conversationId]
      );
      if (!result.rows[0]) return undefined;
      const artifact = await this.getArtifactByRun(result.rows[0].id);
      return toRun(result.rows[0], artifact);
    },

    async updateRun(runId: string, status: CreationRunStatus, currentStep: string): Promise<void> {
      const completedAt = status === "completed" || status === "failed" ? now() : null;
      await pool.query(
        `update runs set status = $2, current_step = $3, updated_at = now(), completed_at = $4 where id = $1`,
        [runId, status, currentStep, completedAt]
      );
      await pool.query(
        `update graph_runs set status = $2, updated_at = now(), completed_at = $3 where run_id = $1`,
        [runId, status, completedAt]
      );
    },

    async submitClarification(
      runId: string,
      input: SubmitRunClarificationRequest
    ): Promise<CreationRun> {
      await withTransaction(async (client) => {
        const runResult = await client.query<RunRow>(
          "select * from runs where id = $1 for update",
          [runId]
        );
        const run = runResult.rows[0];
        if (!run) throw new Error("RUN_NOT_FOUND");
        if (run.status !== "waiting_clarification") {
          const existing = await client.query(
            "select 1 from run_clarifications where run_id = $1 and idempotency_key = $2",
            [runId, input.idempotencyKey]
          );
          if (existing.rowCount) return;
          throw new Error("RUN_NOT_WAITING_CLARIFICATION");
        }

        const inserted = await client.query(
          `insert into run_clarifications
            (id, run_id, idempotency_key, answers_json, created_at)
           values ($1, $2, $3, $4, now())
           on conflict (run_id, idempotency_key) do nothing
           returning id`,
          [randomUUID(), runId, input.idempotencyKey, JSON.stringify(input.answers)]
        );
        if (!inserted.rowCount) return;

        const graphResult = await client.query<{
          graph_name: CreationRunJob["graphName"];
          graph_version: string;
          context_version: number;
          context_json: unknown;
        }>(
          "select graph_name, graph_version, context_version, context_json from graph_runs where run_id = $1 for update",
          [runId]
        );
        const graphRun = graphResult.rows[0];
        if (!graphRun) throw new Error("RUN_CONTEXT_NOT_FOUND");
        const graphContext = creationRunContextSchema.parse(graphRun.context_json);

        const clarificationText = input.answers
          .map((answer) => `${answer.questionId}: ${answer.value}`)
          .join("\n");
        const answerMessageId = randomUUID();
        await client.query(
          `insert into conversation_messages
            (id, conversation_id, role, content, resource_ids_json, created_at)
           values ($1, $2, 'user', $3, '[]'::jsonb, now())`,
          [answerMessageId, run.conversation_id, input.answers.map((answer) => answer.value).join("；")]
        );
        await client.query(
          `update conversations
           set updated_at = now(), last_interaction_at = now(), context_version = context_version + 1
           where id = $1`,
          [run.conversation_id]
        );
        const nextContext: CreationRunContext = {
          ...graphContext,
          userInput: `${graphContext.userInput}\n\n补充信息：\n${clarificationText}`,
          memory: {
            ...graphContext.memory,
            userConstraints: [
              ...graphContext.memory.userConstraints,
              clip(clarificationText, 500)
            ],
            revisionIntent: {
              target: "all",
              instruction: clip(clarificationText, 1000),
              createdAt: now()
            }
          }
        };
        const nextContextVersion = graphRun.context_version + 1;
        const nextMemory = normalizeMemory(
          run.conversation_id,
          nextContextVersion,
          {
            ...graphContext.memory,
            userConstraints: nextContext.memory.userConstraints,
            revisionIntent: nextContext.memory.revisionIntent,
            updatedAt: now()
          }
        );
        const nextJob: CreationRunJob = {
          runId,
          conversationId: run.conversation_id,
          workspaceId: (await client.query<{ workspace_id: string }>(
            "select workspace_id from conversations where id = $1",
            [run.conversation_id]
          )).rows[0]!.workspace_id,
          contextVersion: nextContextVersion,
          graphName: graphRun.graph_name,
          graphVersion: graphRun.graph_version
        };

        await client.query(
          `update graph_runs
           set context_version = $2, context_json = $3, status = 'queued',
               completed_at = null, updated_at = now()
           where run_id = $1`,
          [runId, nextContextVersion, JSON.stringify(nextContext)]
        );
        await upsertConversationMemoryWithClient(client, nextMemory);
        await client.query(
          `update runs
           set status = 'queued', current_step = 'brief', waiting_for_json = null,
               lock_version = lock_version + 1, completed_at = null, updated_at = now()
           where id = $1`,
          [runId]
        );
        await client.query(
          `update run_dispatch_outbox
           set payload_json = $2, status = 'pending', attempt_count = 0,
               next_attempt_at = now(), last_error = null, dispatched_at = null, updated_at = now()
           where run_id = $1`,
          [runId, JSON.stringify(nextJob)]
        );
        await appendEventWithClient(client, runId, "clarification.submitted", {
          answers: input.answers,
          messageId: answerMessageId,
          contextVersion: nextContextVersion
        });
      });

      const run = await this.getRun(runId);
      if (!run) throw new Error("RUN_NOT_FOUND");
      return run;
    },

    async appendEvent(runId: string, type: RunEventType, payload: Record<string, unknown>): Promise<RunEvent> {
      return withTransaction((client) => appendEventWithClient(client, runId, type, payload));
    },

    async listEvents(runId: string, afterEventNo = 0): Promise<RunEvent[]> {
      const result = await pool.query<EventRow>(
        "select * from run_events where run_id = $1 and event_no > $2 order by event_no",
        [runId, afterEventNo]
      );
      return result.rows.map(toEvent);
    },

    async startAgentTask(runId: string, agentName: string, nodeName: string): Promise<string> {
      const taskId = randomUUID();
      await pool.query(
        `insert into agent_tasks
          (id, run_id, agent_name, node_name, status, started_at, created_at)
         values ($1, $2, $3, $4, 'running', now(), now())`,
        [taskId, runId, agentName, nodeName]
      );
      return taskId;
    },

    async completeAgentTask(
      taskId: string,
      outputType: AgentOutputType | undefined,
      payload: Record<string, unknown> | undefined
    ): Promise<void> {
      await withTransaction(async (client) => {
        await client.query(
          "update agent_tasks set status = 'succeeded', completed_at = now() where id = $1",
          [taskId]
        );
        if (outputType && payload) {
          await client.query(
            `insert into agent_outputs
              (id, run_id, agent_task_id, type, schema_version, payload_json, created_at)
             select $1, run_id, id, $2, $3, $4, now() from agent_tasks where id = $5`,
            [randomUUID(), outputType, "2026-07-27", JSON.stringify(payload), taskId]
          );
        }
      });
    },

    async failAgentTask(taskId: string, error: unknown): Promise<void> {
      const message = error instanceof Error ? error.message : "AGENT_TASK_FAILED";
      await pool.query(
        `update agent_tasks
         set status = 'failed', error_code = $2, error_message = $3, completed_at = now()
         where id = $1`,
        [taskId, message.split(":")[0], message.slice(0, 500)]
      );
    },

    async saveArtifact(
      conversationId: string,
      runId: string,
      response: GenerateWechatArticleResponse
    ): Promise<Artifact> {
      const existing = await this.getArtifactByRun(runId);
      if (existing) return existing;
      const artifact: Artifact = {
        id: randomUUID(),
        conversationId,
        runId,
        type: "wechat_article",
        title: response.document.attrs.title,
        payload: response,
        articleId: response.articleId,
        articleVersionId: response.versionId,
        createdAt: now()
      };
      await pool.query(
        `insert into artifacts
          (id, conversation_id, run_id, type, title, payload_json, article_id, article_version_id, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (run_id, type) do nothing`,
        [
          artifact.id,
          conversationId,
          runId,
          artifact.type,
          artifact.title,
          JSON.stringify(response),
          artifact.articleId,
          artifact.articleVersionId,
          artifact.createdAt
        ]
      );
      return (await this.getArtifactByRun(runId)) ?? artifact;
    },

    async updateConversationMemoryFromGraphResult(
      conversationId: string,
      contextVersion: number,
      state: CreationGraphState,
      artifact: Artifact
    ): Promise<void> {
      await withTransaction(async (client) => {
        const previous = await getConversationMemoryWithClient(client, conversationId, contextVersion);
        const next = memoryFromGraphResult(conversationId, contextVersion, previous, state, artifact);
        await upsertConversationMemoryWithClient(client, next);
      });
    },

    async getConversationMemory(
      conversationId: string,
      contextVersion = 0
    ): Promise<ConversationWorkingMemory> {
      const client = await pool.connect();
      try {
        return getConversationMemoryWithClient(client, conversationId, contextVersion);
      } finally {
        client.release();
      }
    },

    async getArtifactByRun(runId: string): Promise<Artifact | undefined> {
      const result = await pool.query<ArtifactRow>(
        "select * from artifacts where run_id = $1 and type = 'wechat_article'",
        [runId]
      );
      return result.rows[0] ? toArtifact(result.rows[0]) : undefined;
    },

    async getArtifact(artifactId: string): Promise<Artifact | undefined> {
      const result = await pool.query<ArtifactRow>("select * from artifacts where id = $1", [artifactId]);
      return result.rows[0] ? toArtifact(result.rows[0]) : undefined;
    },

    async listArtifacts(conversationId: string): Promise<Artifact[]> {
      const result = await pool.query<ArtifactRow>(
        "select * from artifacts where conversation_id = $1 order by created_at",
        [conversationId]
      );
      return result.rows.map(toArtifact);
    },

    async listPendingOutbox(limit = 20): Promise<OutboxRow[]> {
      const result = await pool.query<OutboxRow>(
        `select id, run_id, payload_json from run_dispatch_outbox
         where status in ('pending', 'failed') and next_attempt_at <= now()
         order by created_at limit $1`,
        [limit]
      );
      return result.rows;
    },

    async markOutboxDispatched(id: string): Promise<void> {
      await pool.query(
        `update run_dispatch_outbox
         set status = 'dispatched', attempt_count = attempt_count + 1, dispatched_at = now(), updated_at = now()
         where id = $1`,
        [id]
      );
    },

    async markOutboxFailed(id: string, error: unknown): Promise<void> {
      const message = error instanceof Error ? error.message : "OUTBOX_DISPATCH_FAILED";
      await pool.query(
        `update run_dispatch_outbox
         set status = 'failed',
             attempt_count = attempt_count + 1,
             next_attempt_at = now() + interval '5 seconds',
             last_error = $2,
             updated_at = now()
         where id = $1`,
        [id, message.slice(0, 500)]
      );
    }
  };
}

export type CreationPersistence = ReturnType<typeof createCreationPersistence>;

import { randomUUID } from "node:crypto";
import type {
  AgentStep,
  Artifact,
  Conversation,
  ConversationMessage,
  ConversationResource,
  CreateConversationMessageRequest,
  CreateConversationRequest,
  CreateConversationResourceRequest,
  CreateConversationRunRequest,
  CreationRun,
  CreationRunStatus,
  GetConversationResponse,
  RunEvent,
  RunEventType,
  SubmitRunClarificationRequest,
  SubmitRunDecisionRequest
} from "@mediaforge/contracts";
import { createAgentRunStore } from "../agent-runs/agent-run";
import type { CreationPersistence } from "../creation-graph/persistence";
import { getCreationRuntime } from "../creation-graph/runtime";

type RunEventListener = (event: RunEvent) => void;
type TaskCardStepStatus = "waiting" | "running" | "completed" | "failed";

interface ConversationStoreOptions {
  persistence?: CreationPersistence;
  dispatchPending?: () => Promise<void>;
}

function now(): string {
  return new Date().toISOString();
}

function mapRunStatus(status: string): CreationRunStatus {
  if (status === "waiting_user") return "waiting_clarification";
  if (status === "layout" || status === "expanding") return "writing";
  if (status === "final_review") return "reviewing";
  if (status === "rendering") return "rendering";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "planning";
}

function mapTaskCardStatus(status: CreationRunStatus): "queued" | "running" | "waiting_clarification" | "completed" | "failed" {
  if (status === "waiting_clarification") return "waiting_clarification";
  if (status === "completed") return "completed";
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "queued") return "queued";
  return "running";
}

function mapStepStatus(status: AgentStep["status"]): TaskCardStepStatus {
  if (status === "succeeded" || status === "skipped") return "completed";
  if (status === "failed") return "failed";
  if (status === "running" || status === "waiting_user") return "running";
  return "waiting";
}

function splitVisibleMessage(content: string): string[] {
  return content
    .split(/(?<=[。！？])/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function createConversationStore(options: ConversationStoreOptions = {}) {
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, ConversationMessage[]>();
  const resources = new Map<string, ConversationResource[]>();
  const runs = new Map<string, CreationRun>();
  const runInputs = new Map<string, { conversationId: string; agentRunId: string }>();
  const runEvents = new Map<string, RunEvent[]>();
  const eventListeners = new Map<string, Set<RunEventListener>>();
  const artifacts = new Map<string, Artifact[]>();
  const agentRuns = createAgentRunStore();

  async function requireConversation(conversationId: string): Promise<Conversation> {
    let conversation = conversations.get(conversationId);
    if (options.persistence) {
      const snapshot = await options.persistence.getConversationSnapshot(conversationId);
      if (snapshot) {
        conversation = snapshot.conversation;
        conversations.set(conversationId, snapshot.conversation);
        messages.set(conversationId, snapshot.messages);
        resources.set(conversationId, snapshot.resources);
        artifacts.set(conversationId, await options.persistence.listArtifacts(conversationId));
      }
    }
    if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");
    if (conversation.status === "archived") throw new Error("CONVERSATION_ARCHIVED");
    return conversation;
  }

  function appendRunEvent(runId: string, type: RunEventType, payload: Record<string, unknown>): RunEvent {
    const events = runEvents.get(runId) ?? [];
    const event: RunEvent = {
      id: randomUUID(),
      runId,
      eventNo: events.length + 1,
      type,
      payload: { runId, ...payload },
      createdAt: now()
    };
    runEvents.set(runId, [...events, event]);

    for (const listener of eventListeners.get(runId) ?? []) {
      listener(event);
    }

    return event;
  }

  function addAssistantMessage(conversationId: string, content: string): ConversationMessage {
    const message: ConversationMessage = {
      id: randomUUID(),
      conversationId,
      role: "assistant",
      content,
      resourceIds: [],
      createdAt: now()
    };
    messages.set(conversationId, [...(messages.get(conversationId) ?? []), message]);
    const conversation = conversations.get(conversationId);
    if (conversation) {
      conversation.updatedAt = message.createdAt;
      conversations.set(conversationId, conversation);
    }
    return message;
  }

  function appendAssistantVisibleMessage(run: CreationRun, content: string): void {
    const message = addAssistantMessage(run.conversationId, content);
    appendRunEvent(run.id, "assistant.message.created", {
      messageId: message.id
    });
    for (const delta of splitVisibleMessage(content)) {
      appendRunEvent(run.id, "assistant.message.delta", {
        messageId: message.id,
        delta
      });
    }
    appendRunEvent(run.id, "assistant.message.completed", {
      messageId: message.id,
      content
    });
  }

  function appendTaskCardUpdated(
    run: CreationRun,
    collapsed?: boolean,
    visibleSteps = run.steps,
    status = run.status
  ): void {
    appendRunEvent(run.id, "task.card.updated", {
      title: "公众号创作任务",
      status: mapTaskCardStatus(status),
      collapsed: collapsed ?? status === "completed",
      steps: visibleSteps.map((step) => ({
        id: step.id,
        label: step.title,
        status: mapStepStatus(step.status),
        summary: step.summary
      }))
    });
  }

  function upsertRunFromAgent(conversationId: string, agentRunId: string): CreationRun {
    const agentRun = agentRuns.get(agentRunId);
    if (!agentRun) throw new Error("RUN_NOT_FOUND");

    let resultArtifact: Artifact | undefined;
    if (agentRun.result) {
      const existing = artifacts.get(conversationId)?.find((artifact) => artifact.runId === agentRun.id);
      resultArtifact = existing ?? {
        id: randomUUID(),
        conversationId,
        runId: agentRun.id,
        type: "wechat_article",
        title: agentRun.result.document.attrs.title,
        payload: agentRun.result,
        createdAt: now()
      };
      if (!existing) {
        artifacts.set(conversationId, [...(artifacts.get(conversationId) ?? []), resultArtifact]);
      }
    }

    const run: CreationRun = {
      id: agentRun.id,
      conversationId,
      type: "wechat_article_generation",
      status: mapRunStatus(agentRun.status),
      currentStep: agentRun.currentStep,
      lockVersion: agentRun.lockVersion,
      plan: agentRun.plan,
      steps: agentRun.steps,
      createdAt: agentRun.createdAt,
      updatedAt: agentRun.updatedAt
    };
    if (agentRun.waitingFor) run.waitingFor = agentRun.waitingFor;
    if (resultArtifact) run.resultArtifact = resultArtifact;
    runs.set(run.id, run);
    return run;
  }

  function appendRunSnapshotEvents(run: CreationRun): void {
    appendRunEvent(run.id, "run.created", {
      conversationId: run.conversationId,
      status: "queued",
      currentStep: run.currentStep
    });
    appendRunEvent(run.id, "run.started", {
      conversationId: run.conversationId,
      status: run.status,
      currentStep: run.currentStep
    });
    appendAssistantVisibleMessage(
      run,
      "我正在整理你的创作需求、素材和文章结构。接下来会把任务进度放在对话里，右侧只保留手机预览。"
    );
    appendTaskCardUpdated(run, false, [], run.status === "completed" ? "writing" : run.status);

    const visibleSteps: AgentStep[] = [];
    for (const step of run.steps) {
      visibleSteps.push({ ...step, status: "running" });
      appendRunEvent(run.id, "step.started", {
        stepId: step.id,
        stepType: step.type,
        title: step.title
      });
      appendTaskCardUpdated(run, false, visibleSteps, "writing");
      visibleSteps[visibleSteps.length - 1] = step;
      appendRunEvent(run.id, "step.completed", {
        stepId: step.id,
        stepType: step.type,
        status: step.status,
        summary: step.summary
      });
      appendTaskCardUpdated(run, false, visibleSteps, "writing");
    }

    if (run.waitingFor) {
      const clarificationPayload = {
        stepId: run.waitingFor.stepId,
        lockVersion: run.lockVersion,
        title: "还需要补充一点信息",
        description: run.waitingFor.prompt,
        questions: [{
          id: run.waitingFor.stepId,
          label: run.waitingFor.prompt,
          required: true,
          suggestions: run.waitingFor.options.map((option) => option.label)
        }],
        prompt: run.waitingFor.prompt,
        options: run.waitingFor.options
      };
      appendRunEvent(run.id, "clarification.required", clarificationPayload);
      appendRunEvent(run.id, "decision.required", clarificationPayload);
      return;
    }

    if (run.resultArtifact) {
      appendAssistantVisibleMessage(
        run,
        "公众号内容已经生成，我已同步刷新右侧手机预览。你可以继续在这里补充修改要求，也可以直接复制到公众号。"
      );
      appendRunEvent(run.id, "artifact.created", {
        artifactId: run.resultArtifact.id,
        artifactType: run.resultArtifact.type,
        title: run.resultArtifact.title
      });
    }

    if (run.status === "completed") {
      appendTaskCardUpdated(run, true);
      appendRunEvent(run.id, "run.completed", {
        status: run.status,
        artifactId: run.resultArtifact?.id
      });
    }
  }

  return {
    async createConversation(input: CreateConversationRequest): Promise<Conversation> {
      const createdAt = now();
      const conversation: Conversation = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        title: input.title,
        status: "active",
        contextVersion: 0,
        createdAt,
        updatedAt: createdAt,
        lastInteractionAt: createdAt
      };
      conversations.set(conversation.id, conversation);
      messages.set(conversation.id, []);
      resources.set(conversation.id, []);
      artifacts.set(conversation.id, []);
      if (options.persistence) {
        await options.persistence.saveConversation(conversation, [], []);
      }
      return conversation;
    },

    async getConversation(conversationId: string): Promise<GetConversationResponse> {
      const conversation = await requireConversation(conversationId);
      const conversationRuns = Array.from(runs.values()).filter((run) => run.conversationId === conversationId);
      const storedActiveRun = conversationRuns.find((run) => run.status !== "completed" && run.status !== "failed" && run.status !== "cancelled")
        ?? conversationRuns.at(-1)
        ?? null;
      const activeRun = options.persistence
        ? await options.persistence.getLatestRunForConversation(conversationId) ?? storedActiveRun
        : storedActiveRun;

      return {
        conversation,
        messages: messages.get(conversationId) ?? [],
        resources: resources.get(conversationId) ?? [],
        activeRun,
        latestArtifacts: options.persistence
          ? await options.persistence.listArtifacts(conversationId)
          : artifacts.get(conversationId) ?? []
      };
    },

    async listWorkspaceConversations(workspaceId: string): Promise<Conversation[]> {
      if (options.persistence) return options.persistence.listWorkspaceConversations(workspaceId);
      return Array.from(conversations.values())
        .filter((conversation) => conversation.workspaceId === workspaceId && conversation.status === "active")
        .sort((left, right) => right.lastInteractionAt.localeCompare(left.lastInteractionAt));
    },

    async addMessage(conversationId: string, input: CreateConversationMessageRequest): Promise<ConversationMessage> {
      const conversation = await requireConversation(conversationId);
      const message: ConversationMessage = {
        id: randomUUID(),
        conversationId,
        role: input.role,
        content: input.content,
        resourceIds: input.resourceIds,
        createdAt: now()
      };
      messages.set(conversationId, [...(messages.get(conversationId) ?? []), message]);
      if (conversation.title === "新的公众号创作" && input.role === "user") {
        conversation.title = input.content;
      }
      conversation.updatedAt = message.createdAt;
      if (input.role === "user") {
        conversation.contextVersion += 1;
        conversation.lastInteractionAt = message.createdAt;
      }
      conversations.set(conversationId, conversation);
      if (options.persistence) {
        await options.persistence.saveConversation(
          conversation,
          messages.get(conversationId) ?? [],
          resources.get(conversationId) ?? []
        );
      }
      return message;
    },

    async addResource(conversationId: string, input: CreateConversationResourceRequest): Promise<ConversationResource> {
      const conversation = await requireConversation(conversationId);
      const resource: ConversationResource = {
        id: randomUUID(),
        conversationId,
        assetId: input.assetId,
        source: input.source,
        createdAt: now()
      };
      resources.set(conversationId, [...(resources.get(conversationId) ?? []), resource]);
      conversation.updatedAt = resource.createdAt;
      if (options.persistence) {
        await options.persistence.saveConversation(
          conversation,
          messages.get(conversationId) ?? [],
          resources.get(conversationId) ?? []
        );
      }
      return resource;
    },

    async createRun(conversationId: string, input: CreateConversationRunRequest): Promise<CreationRun> {
      const conversation = await requireConversation(conversationId);
      const latestUserMessage = [...(messages.get(conversationId) ?? [])].reverse().find((message) => message.role === "user");
      if (!latestUserMessage) throw new Error("CONVERSATION_MESSAGE_REQUIRED");

      if (options.persistence) {
        const createdAt = now();
        const run: CreationRun = {
          id: randomUUID(),
          conversationId,
          type: input.type,
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
        const contextVersion = Math.max(1, messages.get(conversationId)?.length ?? 1);
        const job = {
          runId: run.id,
          conversationId,
          workspaceId: conversation.workspaceId ?? "local-user",
          contextVersion,
          graphName: "wechat_article_creation" as const,
          graphVersion: "2026-08-27"
        };
        await options.persistence.saveConversation(
          conversation,
          messages.get(conversationId) ?? [],
          resources.get(conversationId) ?? []
        );
        await options.persistence.createQueuedRun(run, {
          userInput: latestUserMessage.content,
          resourceIds: resources.get(conversationId)?.map((resource) => resource.assetId) ?? [],
          currentInstruction: latestUserMessage.content,
          creationMode: "new",
          currentResourceIds: resources.get(conversationId)?.map((resource) => resource.assetId) ?? [],
          inheritedResourceIds: [],
          skillId: input.layoutSkillId,
          selectedSkills: [],
          maxSteps: input.maxSteps
        }, job);
        runs.set(run.id, run);
        conversation.updatedAt = createdAt;
        await options.dispatchPending?.();
        return run;
      }

      const agentRun = await agentRuns.create({
        workspaceId: conversation.workspaceId ?? "local-user",
        topic: latestUserMessage.content,
        audience: "",
        sellingPoints: [],
        tone: "friendly",
        style: "practical",
        layoutSkillId: input.layoutSkillId,
        assetIds: resources.get(conversationId)?.map((resource) => resource.assetId) ?? [],
        extraInstructions: "",
        maxSteps: input.maxSteps
      });
      runInputs.set(agentRun.id, { conversationId, agentRunId: agentRun.id });
      conversation.updatedAt = agentRun.updatedAt;
      const run = upsertRunFromAgent(conversationId, agentRun.id);
      appendRunSnapshotEvents(run);
      return run;
    },

    async getRun(runId: string): Promise<CreationRun | undefined> {
      if (options.persistence) return options.persistence.getRun(runId);
      const runInput = runInputs.get(runId);
      if (!runInput) return undefined;
      return upsertRunFromAgent(runInput.conversationId, runInput.agentRunId);
    },

    async decide(runId: string, decision: SubmitRunDecisionRequest): Promise<CreationRun> {
      const runInput = runInputs.get(runId);
      if (!runInput) throw new Error("RUN_NOT_FOUND");
      appendRunEvent(runId, "decision.submitted", {
        stepId: decision.stepId,
        decision: decision.decision
      });

      try {
        await agentRuns.decide(runInput.agentRunId, decision);
        const run = upsertRunFromAgent(runInput.conversationId, runInput.agentRunId);
        appendRunSnapshotEvents(run);
        return run;
      } catch (error) {
        appendRunEvent(runId, "run.failed", {
          message: error instanceof Error ? error.message : "RUN_FAILED"
        });
        throw error;
      }
    },

    async submitClarification(ownerId: string, runId: string, input: SubmitRunClarificationRequest): Promise<CreationRun> {
      if (!options.persistence) throw new Error("RUN_CLARIFICATION_UNSUPPORTED");
      const run = await options.persistence.submitClarification(ownerId, runId, input);
      runs.set(run.id, run);
      await options.dispatchPending?.();
      return run;
    },

    async listRunEvents(runId: string, afterEventNo = 0): Promise<RunEvent[]> {
      if (options.persistence) return options.persistence.listEvents(runId, afterEventNo);
      return (runEvents.get(runId) ?? []).filter((event) => event.eventNo > afterEventNo);
    },

    async subscribeRunEvents(runId: string, afterEventNo: number, listener: RunEventListener): Promise<() => void> {
      if (options.persistence) {
        let closed = false;
        let reading = false;
        let lastEventNo = afterEventNo;
        const readEvents = async () => {
          if (closed || reading) return;
          reading = true;
          try {
            const events = await options.persistence!.listEvents(runId, lastEventNo);
            for (const event of events) {
              lastEventNo = Math.max(lastEventNo, event.eventNo);
              listener(event);
            }
          } finally {
            reading = false;
          }
        };
        await readEvents();
        const timer = setInterval(() => {
          void readEvents();
        }, 250);
        return () => {
          closed = true;
          clearInterval(timer);
        };
      }

      for (const event of (runEvents.get(runId) ?? []).filter((event) => event.eventNo > afterEventNo)) {
        listener(event);
      }

      const listeners = eventListeners.get(runId) ?? new Set<RunEventListener>();
      listeners.add(listener);
      eventListeners.set(runId, listeners);

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          eventListeners.delete(runId);
        }
      };
    },

    async listArtifacts(conversationId: string): Promise<Artifact[]> {
      await requireConversation(conversationId);
      if (options.persistence) return options.persistence.listArtifacts(conversationId);
      return artifacts.get(conversationId) ?? [];
    },

    async getArtifact(artifactId: string): Promise<Artifact | undefined> {
      if (options.persistence) return options.persistence.getArtifact(artifactId);
      return Array.from(artifacts.values()).flat().find((artifact) => artifact.id === artifactId);
    }
  };
}

const productionOptions = process.env.NODE_ENV === "test"
  ? {}
  : {
      persistence: getCreationRuntime().persistence,
      dispatchPending: getCreationRuntime().dispatcher.dispatchPending
    };

export const conversationStore = createConversationStore(productionOptions);

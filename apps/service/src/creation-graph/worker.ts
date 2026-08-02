import { randomUUID } from "node:crypto";
import { Worker, type Job } from "bullmq";
import type {
  AgentOutputType,
  CreationGraphState,
  CreationRunJob,
  RunEventType
} from "@mediaforge/contracts";
import { creationRunJobSchema } from "@mediaforge/contracts";
import { buildWechatArticleResponse } from "./artifact-builder";
import { createCreationAgents } from "./agents";
import { runWechatArticleGraph, type GraphExecutionObserver } from "./graph";
import type { CreationPersistence } from "./persistence";
import { createCreationPersistence } from "./persistence";
import { creationRunQueueName, getRedisUrl, parseRedisConnection } from "./queue";
import { adminConsole } from "../admin-console";

interface VisibleStep {
  id: string;
  nodeName: string;
  label: string;
  status: "waiting" | "running" | "completed" | "failed";
  summary?: string;
}

const outputTypeByNode: Partial<Record<string, AgentOutputType>> = {
  brief: "creative_brief",
  title: "title_candidates",
  outline: "article_outline",
  writer: "article_draft",
  revision: "article_draft",
  image_plan: "image_plan",
  review: "review_report",
  artifact: "artifact_validation"
};

const outputKeyByNode: Partial<Record<string, keyof CreationGraphState>> = {
  brief: "brief",
  title: "titles",
  outline: "outline",
  writer: "draft",
  revision: "draft",
  image_plan: "imagePlan",
  review: "reviewReports",
  artifact: "artifactValidation"
};

function createInitialState(job: CreationRunJob, context: {
  userInput: string;
  resourceIds: string[];
  skillId: string;
  memory?: CreationGraphState["memory"];
}): CreationGraphState {
  return {
    workspaceId: job.workspaceId,
    conversationId: job.conversationId,
    runId: job.runId,
    userInput: context.userInput,
    resourceIds: context.resourceIds,
    skillId: context.skillId,
    memory: context.memory,
    reviewReports: [],
    revisionCount: 0,
    maxRevisionCount: 2,
    status: "running"
  };
}

async function appendAssistantMessage(
  persistence: CreationPersistence,
  runId: string,
  conversationId: string,
  content: string
): Promise<void> {
  const messageId = randomUUID();
  await persistence.appendAssistantMessage(conversationId, messageId, content);
  await persistence.appendEvent(runId, "assistant.message.created", { messageId });
  for (const delta of content.split(/(?<=[。！？])/u).map((item) => item.trim()).filter(Boolean)) {
    await persistence.appendEvent(runId, "assistant.message.delta", { messageId, delta });
  }
  await persistence.appendEvent(runId, "assistant.message.completed", { messageId, content });
}

async function appendTaskCard(
  persistence: CreationPersistence,
  runId: string,
  steps: VisibleStep[],
  status: "queued" | "running" | "waiting_clarification" | "completed" | "failed",
  collapsed = false
): Promise<void> {
  await persistence.appendEvent(runId, "task.card.updated", {
    title: "多个创作角色正在协作",
    status,
    collapsed,
    steps
  });
}

function outputPayload(
  nodeName: string,
  update: Partial<CreationGraphState>
): Record<string, unknown> | undefined {
  const key = outputKeyByNode[nodeName];
  if (!key) return undefined;
  const value = update[key];
  if (value === undefined) return undefined;
  return { [key]: value };
}

export async function processCreationRunJob(
  job: Job<CreationRunJob>,
  persistence = createCreationPersistence()
): Promise<CreationGraphState> {
  const payload = creationRunJobSchema.parse(job.data);
  const context = await persistence.getRunContext(payload.runId);
  const taskIds = new Map<string, string>();
  const visibleSteps: VisibleStep[] = [];

  const observer: GraphExecutionObserver = {
    async onNodeStarted(nodeName, title) {
      await persistence.updateRun(payload.runId, "running", nodeName);
      const taskId = await persistence.startAgentTask(payload.runId, `${nodeName}_agent`, nodeName);
      taskIds.set(nodeName, taskId);
      const step: VisibleStep = {
        id: taskId,
        nodeName,
        label: title,
        status: "running"
      };
      visibleSteps.push(step);
      await persistence.appendEvent(payload.runId, "step.started", {
        stepId: taskId,
        stepType: nodeName,
        title
      });
      await appendTaskCard(persistence, payload.runId, visibleSteps, "running");
    },
    async onNodeCompleted(nodeName, title, summary, update) {
      const taskId = taskIds.get(nodeName);
      if (!taskId) throw new Error(`AGENT_TASK_NOT_STARTED:${nodeName}`);
      const outputType = outputTypeByNode[nodeName];
      await persistence.completeAgentTask(taskId, outputType, outputPayload(nodeName, update));
      const step = visibleSteps.find((item) => item.id === taskId);
      if (step) {
        step.status = "completed";
        step.summary = summary;
      }
      await persistence.appendEvent(payload.runId, "step.completed", {
        stepId: taskId,
        stepType: nodeName,
        title,
        status: "succeeded",
        summary
      });
      await appendTaskCard(persistence, payload.runId, visibleSteps, "running");
    }
  };

  await persistence.updateRun(payload.runId, "running", "brief");
  await persistence.appendEvent(payload.runId, "run.started", {
    status: "running",
    currentStep: "brief"
  });
  await appendAssistantMessage(
    persistence,
    payload.runId,
    payload.conversationId,
    "我正在把你的需求拆成主题、读者、标题、内容结构和配图任务，多个创作角色会依次完成并相互检查。"
  );
  await appendTaskCard(persistence, payload.runId, visibleSteps, "running");

  try {
    const result = await runWechatArticleGraph(createInitialState(payload, context), {
      agents: createCreationAgents({ userId: payload.workspaceId, runId: payload.runId }),
      observer
    });

    if (result.status === "waiting_clarification" && result.clarification) {
      await persistence.updateRun(payload.runId, "waiting_clarification", "clarification");
      await persistence.appendEvent(payload.runId, "clarification.required", {
        title: "还需要补充一点信息",
        description: result.clarification.reason,
        questions: result.clarification.questions
      });
      await appendTaskCard(persistence, payload.runId, visibleSteps, "waiting_clarification");
      return result;
    }

    if (result.status !== "completed" || !result.finalDocument) {
      throw new Error("CREATION_GRAPH_NOT_COMPLETED");
    }

    const response = buildWechatArticleResponse(
      result.finalDocument,
      process.env.MODEL_MODE === "demo" ? "local-demo" : "gateway"
    );
    const artifact = await persistence.saveArtifact(payload.conversationId, payload.runId, response);
    await persistence.updateConversationMemoryFromGraphResult(
      payload.conversationId,
      payload.contextVersion,
      result,
      artifact
    );
    await persistence.appendEvent(payload.runId, "artifact.created", {
      artifactId: artifact.id,
      artifactType: artifact.type,
      title: artifact.title
    });
    await appendAssistantMessage(
      persistence,
      payload.runId,
      payload.conversationId,
      `标题、正文、配图规划和质量审校都已完成。推荐标题是《${artifact.title}》，右侧手机预览已经更新。`
    );
    await persistence.updateRun(payload.runId, "completed", "artifact");
    await appendTaskCard(persistence, payload.runId, visibleSteps, "completed", true);
    await persistence.appendEvent(payload.runId, "run.completed", {
      status: "completed",
      artifactId: artifact.id
    });
    await adminConsole.finishGeneration(payload.runId, "completed");
    return result;
  } catch (error) {
    const activeTask = [...taskIds.values()].at(-1);
    if (activeTask) await persistence.failAgentTask(activeTask, error);
    await persistence.updateRun(payload.runId, "failed", "failed");
    await appendTaskCard(persistence, payload.runId, visibleSteps, "failed");
    await persistence.appendEvent(payload.runId, "run.failed", {
      message: error instanceof Error ? error.message : "CREATION_RUN_FAILED"
    });
    await adminConsole.finishGeneration(
      payload.runId,
      "failed",
      error instanceof Error ? error.message.slice(0, 128) : "CREATION_RUN_FAILED"
    );
    throw error;
  }
}

export function createCreationRunWorker(
  redisUrl = getRedisUrl(),
  persistence = createCreationPersistence()
): Worker<CreationRunJob, CreationGraphState> {
  return new Worker<CreationRunJob, CreationGraphState>(
    creationRunQueueName,
    (job) => processCreationRunJob(job, persistence),
    {
      connection: parseRedisConnection(redisUrl),
      concurrency: Number(process.env.CREATION_RUN_WORKER_CONCURRENCY ?? 2)
    }
  );
}

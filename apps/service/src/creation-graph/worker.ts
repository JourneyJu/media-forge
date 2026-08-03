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
import { createResourceService } from "../assets/resource-service";
import { analyzeAsset } from "../vision-gateway";

interface VisibleStep {
  id: string;
  nodeName: string;
  label: string;
  status: "waiting" | "running" | "completed" | "failed";
  summary?: string;
}

const outputTypeByNode: Partial<Record<string, AgentOutputType>> = {
  material: "material_summary",
  brief: "creative_brief",
  planner: "content_plan",
  title: "title_candidates",
  outline: "article_outline",
  writer: "article_draft",
  revision: "article_draft",
  image_plan: "image_plan",
  layout: "layout_plan",
  review: "review_report",
  artifact: "artifact_validation"
};

const outputKeyByNode: Partial<Record<string, keyof CreationGraphState>> = {
  material: "materials",
  brief: "brief",
  planner: "contentPlan",
  title: "titles",
  outline: "outline",
  writer: "draft",
  revision: "draft",
  image_plan: "imagePlan",
  layout: "layoutPlan",
  review: "reviewReports",
  artifact: "artifactValidation"
};

function createInitialState(job: CreationRunJob, context: {
  userInput: string;
  currentInstruction?: string;
  resourceIds: string[];
  skillId: string;
  selectedSkills?: CreationGraphState["selectedSkills"];
  memory?: CreationGraphState["memory"];
}): CreationGraphState {
  return {
    workspaceId: job.workspaceId,
    conversationId: job.conversationId,
    runId: job.runId,
    userInput: context.currentInstruction ?? context.userInput,
    resourceIds: context.resourceIds,
    skillId: context.skillId,
    selectedSkills: context.selectedSkills ?? [],
    memory: context.memory,
    reviewReports: [],
    revisionCount: 0,
    maxRevisionCount: 2,
    status: "running"
  };
}

export async function enrichImageMaterials(
  job: CreationRunJob,
  context: Awaited<ReturnType<CreationPersistence["getRunContext"]>>,
  dependencies: {
    resources?: Pick<ReturnType<typeof createResourceService>, "getContent" | "close">;
    analyze?: typeof analyzeAsset;
  } = {}
): Promise<typeof context> {
  if (
    process.env.MODEL_MODE === "demo"
    || (process.env.NODE_ENV === "test" && !dependencies.analyze)
    || context.resourceIds.length === 0
  ) {
    return context;
  }

  const resources = dependencies.resources ?? createResourceService();
  const analyze = dependencies.analyze ?? analyzeAsset;
  const summaries = new Map(
    (context.memory?.materialSummary ?? []).map((item) => [item.resourceId, item])
  );
  try {
    for (const resourceId of context.resourceIds) {
      const existing = summaries.get(resourceId);
      if (existing?.ocrText || (existing && !existing.description.startsWith("素材“"))) continue;
      try {
        const content = await resources.getContent(job.workspaceId, resourceId);
        if (!content.contentType?.startsWith("image/")) continue;
        const chunks: Buffer[] = [];
        for await (const chunk of content.body) chunks.push(Buffer.from(chunk));
        const imageUrl = `data:${content.contentType};base64,${Buffer.concat(chunks).toString("base64")}`;
        const analysis = await analyze({
          workspaceId: job.workspaceId,
          assetId: resourceId,
          imageUrl,
          purpose: "body"
        }, { userId: job.workspaceId, runId: job.runId });
        summaries.set(resourceId, {
          resourceId,
          type: "image",
          description: analysis.description,
          ...(analysis.ocrText ? { ocrText: analysis.ocrText } : {}),
          suggestedUsage: analysis.suggestedUsage,
          quality: "high"
        });
      } catch {
        summaries.set(resourceId, {
          resourceId,
          type: "image",
          description: existing?.description ?? "图片视觉分析暂不可用",
          suggestedUsage: existing?.suggestedUsage ?? "仅在内容与图片主题可以确认匹配时使用",
          quality: "low"
        });
      }
    }
  } finally {
    await resources.close();
  }

  return {
    ...context,
    memory: {
      ...context.memory,
      materialSummary: [...summaries.values()],
      userConstraints: context.memory?.userConstraints ?? []
    }
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
  const storedContext = await persistence.getRunContext(payload.runId);
  const context = await enrichImageMaterials(payload, storedContext);
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
      process.env.MODEL_MODE === "demo" ? "local-demo" : "gateway",
      result.layoutPlan
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

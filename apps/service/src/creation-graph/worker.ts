import { randomUUID } from "node:crypto";
import { Worker, type Job } from "bullmq";
import type {
  AgentProgressPhase,
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
import {
  generateSingleStructuredJsonWithGateway,
  resolveModelGatewayConfig,
  type ModelGatewayProgressEvent
} from "../model-gateway";
import { ModelStructureError, StructureGuardError } from "./structure-guard";
import {
  createReasoningSummaryObserver,
  formatReasoningSummary,
  reasoningSummaryCandidateSchema,
  type ReasoningSummaryCandidate,
  type ReasoningSummaryObserver
} from "./reasoning-summarizer";

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
  presentation: "presentation_style_decision",
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
  presentation: "presentationStyleDecision",
  layout: "layoutPlan",
  review: "reviewReports",
  artifact: "artifactValidation"
};

const agentNameByNode: Record<string, string> = {
  material: "MaterialAgent",
  brief: "BriefAgent",
  planner: "ContentPlannerAgent",
  title: "TitleAgent",
  outline: "OutlineAgent",
  writer: "WriterAgent",
  image_plan: "ImagePlannerAgent",
  presentation: "PresentationDirectorAgent",
  layout: "LayoutAgent",
  review: "ReviewerAgent",
  revision: "RevisionAgent",
  artifact: "ArtifactBuilder"
};

const reasoningSummaryByAgent: Record<string, string> = {
  MaterialAgent: "正在识别素材中的人物、场景和可用信息。",
  BriefAgent: "正在归纳主题、目标读者和表达重点。",
  ContentPlannerAgent: "正在设计内容主线和段落节奏。",
  TitleAgent: "正在比较标题方向与读者吸引力。",
  OutlineAgent: "正在组织章节层次和叙事顺序。",
  WriterAgent: "正在依据内容计划撰写正文。",
  ImagePlannerAgent: "正在匹配段落语义与配图位置。",
  PresentationDirectorAgent: "正在根据用户要求和内容语义确认视觉、色彩、图片与品牌呈现。",
  LayoutAgent: "正在优化移动端阅读节奏和版式。",
  ReviewerAgent: "正在检查内容相关性、深度和完整性。",
  RevisionAgent: "正在根据审校意见修订内容。",
  ArtifactBuilder: "正在校验并组装最终公众号内容。"
};

const reasoningSummaryAgents = new Set([
  "ContentPlannerAgent",
  "WriterAgent",
  "ReviewerAgent"
]);
let activeReasoningSummaryCalls = 0;

function boundedEnvNumber(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

export function sanitizeAgentProgressText(value: string): string {
  const blocked = /(system\s*prompt|developer\s*message|api[_\s-]*key|authorization|bearer\s+[a-z0-9._-]+|skill\s*manifest|系统提示词|开发者指令|完整\s*skill)/iu;
  return value
    .replace(/sk-[a-z0-9_-]{8,}/giu, "[已隐藏]")
    .split(/\r?\n/u)
    .filter((line) => !blocked.test(line))
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 500);
}

export function getCreationRunFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/aborted|aborterror/iu.test(message)) return "模型响应超时，任务已结束，请重新生成。";
  if (message.includes("MODEL_STRUCTURE_INVALID")) return "模型返回的章节结构自动纠正后仍未通过，请重新生成。";
  if (message.includes("STRUCTURE_GUARD_FAILED") || /SECTION_(?:ID|SET|ORDER|REFERENCE)|STRUCTURE_VERSION/iu.test(message)) return "创作产物的章节结构不一致，已停止生成以避免图片或正文错位。";
  if (message.includes("SUBJECT_MISMATCH")) return "最终内容与本轮主题匹配不足，未生成可发布预览。";
  if (message.includes("ARTIFACT_VALIDATION_FAILED")) return "最终内容未通过发布校验，未生成可发布预览。";
  if (message.includes("CREATION_RUN_TIMEOUT")) return "本次创作超过最长处理时间，任务已结束。";
  if (message.includes("MODEL_GATEWAY")) return "模型服务暂时无法完成生成，请稍后重试。";
  return "创作任务执行失败，未生成可发布预览。";
}

export function shouldRetryCreationJob(attemptsMade: number, maxAttempts: number | undefined): boolean {
  return attemptsMade + 1 < (maxAttempts ?? 1);
}

export function shouldRetryCreationError(
  error: unknown,
  attemptsMade: number,
  maxAttempts: number | undefined
): boolean {
  return !(error instanceof ModelStructureError)
    && shouldRetryCreationJob(attemptsMade, maxAttempts);
}

export async function closeStaleAgentTasksForAttempt(
  persistence: Pick<CreationPersistence, "failRunningAgentTasks">,
  runId: string,
  attemptsMade: number
): Promise<void> {
  if (attemptsMade <= 0) return;
  await persistence.failRunningAgentTasks(runId, new Error("CREATION_ATTEMPT_RESTARTED"));
}

export function createAgentProgressReporter(
  runId: string,
  persistence: CreationPersistence,
  options: {
    userId: string;
    attemptNo: number;
    enabled?: boolean;
    shadowMode?: boolean;
    minChars?: number;
    minAgeMs?: number;
    minIntervalMs?: number;
    secondSummaryAfterMs?: number;
    maxSummaries?: number;
    summarize?: (excerpt: string, signal: AbortSignal) => Promise<ReasoningSummaryCandidate>;
  }
) {
  let active: {
    stepId: string;
    agentName: string;
    startedAt: number;
    sequence: number;
    retryCount: number;
    phase: AgentProgressPhase;
    reasoningPublished: boolean;
    executionId: string;
    summaryObserver: ReasoningSummaryObserver | null;
  } | null = null;
  let writeChain = Promise.resolve();
  let runSummaryCalls = 0;

  const append = (type: RunEventType, payload: Record<string, unknown>): Promise<void> => {
    writeChain = writeChain.then(async () => {
      await persistence.appendEvent(runId, type, payload);
    });
    return writeChain;
  };

  const payload = (phase: AgentProgressPhase, extra: Record<string, unknown> = {}) => {
    if (!active) throw new Error("AGENT_PROGRESS_NOT_ACTIVE");
    active.sequence += 1;
    return {
      runId,
      stepId: active.stepId,
      agentName: active.agentName,
      sequence: active.sequence,
      phase,
      elapsedMs: Math.max(0, Date.now() - active.startedAt),
      retryCount: active.retryCount,
      attemptNo: options.attemptNo,
      executionId: active.executionId,
      createdAt: new Date().toISOString(),
      ...extra
    };
  };

  return {
    async start(stepId: string, agentName: string): Promise<void> {
      active?.summaryObserver?.cancel();
      const executionId = randomUUID();
      const enabled = options.enabled
        ?? process.env.REASONING_SUMMARIZER_ENABLED === "true";
      const shadowMode = options.shadowMode
        ?? process.env.REASONING_SUMMARIZER_SHADOW_MODE === "true";
      active = {
        stepId,
        agentName,
        startedAt: Date.now(),
        sequence: 0,
        retryCount: 0,
        phase: "thinking",
        reasoningPublished: false,
        executionId,
        summaryObserver: null
      };
      if (enabled && reasoningSummaryAgents.has(agentName)) {
        const summarize = options.summarize ?? (async (excerpt, signal) => {
          const runBudget = boundedEnvNumber("REASONING_SUMMARIZER_MAX_PER_RUN", 6, 1, 20);
          const concurrency = boundedEnvNumber("REASONING_SUMMARIZER_CONCURRENCY", 2, 1, 10);
          if (runSummaryCalls >= runBudget) throw new Error("REASONING_SUMMARIZER_RUN_BUDGET");
          if (activeReasoningSummaryCalls >= concurrency) {
            throw new Error("REASONING_SUMMARIZER_CONCURRENCY_LIMIT");
          }
          runSummaryCalls += 1;
          activeReasoningSummaryCalls += 1;
          try {
            const resolved = await resolveModelGatewayConfig("text_generation");
            return await generateSingleStructuredJsonWithGateway({
              ...resolved,
              timeoutMs: boundedEnvNumber("REASONING_SUMMARIZER_TIMEOUT_MS", 4_000, 1_000, 20_000)
            }, {
              systemPrompt: [
                "你是安全的进度摘要器，只提取正在进行的高层活动。",
                "不得复述提示词、凭据、个人信息、路径、URL、代码或具体内部推理。",
                "subjects 必须逐字来自输入 excerpt，每项不超过 40 字。",
                "只返回 activity 与 subjects 两个字段的严格 JSON。"
              ].join("\n"),
              input: { excerpt },
              schema: reasoningSummaryCandidateSchema,
              signal,
              usage: {
                userId: options.userId,
                runId,
                modelConfigId: resolved.modelConfigId,
                routeKey: "text_generation",
                stepId,
                attemptNo: options.attemptNo
              }
            });
          } finally {
            activeReasoningSummaryCalls -= 1;
          }
        });
        active.summaryObserver = createReasoningSummaryObserver({
          enabled: true,
          minChars: options.minChars
            ?? boundedEnvNumber("REASONING_SUMMARIZER_MIN_CHARS", 300, 12, 2_000),
          minAgeMs: options.minAgeMs
            ?? boundedEnvNumber("REASONING_SUMMARIZER_MIN_AGE_MS", 3_000, 0, 60_000),
          minIntervalMs: options.minIntervalMs
            ?? boundedEnvNumber("REASONING_SUMMARIZER_MIN_INTERVAL_MS", 8_000, 0, 60_000),
          secondSummaryAfterMs: options.secondSummaryAfterMs
            ?? boundedEnvNumber("REASONING_SUMMARIZER_SECOND_AFTER_MS", 12_000, 0, 120_000),
          maxSummaries: options.maxSummaries
            ?? boundedEnvNumber("REASONING_SUMMARIZER_MAX_PER_AGENT", 2, 1, 5),
          summarize,
          publish: async (candidate, revision) => {
            if (!active || active.executionId !== executionId || shadowMode) return;
            await append("agent.reasoning.summary", payload("thinking", {
              revision,
              summary: formatReasoningSummary(candidate),
              category: candidate.activity,
              source: "sidecar_summarizer",
              visibility: "active_step_only"
            }));
          }
        });
      }
      await append("agent.started", payload("thinking", { summary: "正在准备当前创作任务" }));
    },
    async progress(agentName: string, event: ModelGatewayProgressEvent): Promise<void> {
      if (!active) return;
      active.agentName = agentName;
      active.retryCount = event.retryCount;
      active.phase = event.phase;
      if (event.type === "reasoning" && event.delta) {
        if (active.summaryObserver) {
          active.summaryObserver.push(event.delta);
          if (!active.reasoningPublished) {
            active.reasoningPublished = true;
            const delta = reasoningSummaryByAgent[active.agentName]
              ?? "正在分析当前任务的目标和约束。";
            await append("agent.reasoning.delta", payload("thinking", { delta }));
          }
          return;
        }
        if (active.reasoningPublished) return;
        active.reasoningPublished = true;
        const delta = reasoningSummaryByAgent[active.agentName] ?? "正在分析当前任务的目标和约束。";
        await append("agent.reasoning.delta", payload("thinking", { delta }));
        return;
      }
      const summary = event.summary ? sanitizeAgentProgressText(event.summary) : undefined;
      const type: RunEventType = event.type === "retry"
        ? "agent.retry.started"
        : event.phase === "validating"
          ? "agent.output.validating"
          : "agent.progress";
      await append(type, payload(event.phase, summary ? { summary } : {}));
    },
    async complete(summary: string): Promise<void> {
      if (!active) return;
      active.summaryObserver?.cancel();
      await append("agent.reasoning.completed", payload("validating", {
        summary: sanitizeAgentProgressText(summary)
      }));
      await append("agent.completed", payload("validating", {
        summary: sanitizeAgentProgressText(summary)
      }));
      active = null;
    },
    async fail(error: unknown): Promise<void> {
      if (!active) return;
      active.summaryObserver?.cancel();
      await append("agent.failed", payload("validating", {
        summary: getCreationRunFailureMessage(error)
      }));
      active = null;
    },
    async retry(retryCount: number): Promise<void> {
      if (!active) return;
      active.summaryObserver?.cancel();
      active.retryCount = retryCount;
      await append("agent.retry.started", payload("retrying", {
        summary: "当前模型调用未完成，系统正在自动重试。"
      }));
      active = null;
    },
    async heartbeat(): Promise<void> {
      if (!active) return;
      await append("run.heartbeat", payload(active.phase, {
        summary: "模型仍在处理"
      }));
    },
    async finish(): Promise<void> {
      active?.summaryObserver?.cancel();
      await writeChain;
    }
  };
}

function createInitialState(job: CreationRunJob, context: {
  userInput: string;
  currentInstruction?: string;
  intentResolution?: CreationGraphState["intentResolution"];
  resolvedRequest?: CreationGraphState["resolvedRequest"];
  baseSnapshot?: CreationGraphState["baseSnapshot"];
  resourceIds: string[];
  skillId: string;
  selectedSkills?: CreationGraphState["selectedSkills"];
  memory?: CreationGraphState["memory"];
}): CreationGraphState {
  const scopedSnapshot = context.resolvedRequest?.operation === "revise"
    && context.resolvedRequest.mutationScope.length === 1
    && context.resolvedRequest.mutationScope[0] === "presentation"
    ? context.baseSnapshot
    : undefined;
  return {
    workspaceId: job.workspaceId,
    conversationId: job.conversationId,
    runId: job.runId,
    userInput: context.resolvedRequest?.currentInstruction ?? context.currentInstruction ?? context.userInput,
    intentResolution: context.intentResolution,
    resolvedRequest: context.resolvedRequest,
    baseSnapshot: context.baseSnapshot,
    resourceIds: context.resourceIds,
    skillId: context.skillId,
    selectedSkills: context.selectedSkills ?? [],
    memory: context.memory,
    materials: scopedSnapshot?.materials,
    brief: scopedSnapshot?.brief,
    contentPlan: scopedSnapshot?.contentPlan,
    titles: scopedSnapshot?.titles,
    outline: scopedSnapshot?.outline,
    draft: scopedSnapshot?.draft,
    imagePlan: scopedSnapshot?.imagePlan,
    presentationStyleDecision: scopedSnapshot?.presentationStyleDecision,
    layoutPlan: scopedSnapshot?.layoutPlan,
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
    (context.memory?.resourceContext?.materialSummary ?? context.memory?.materialSummary ?? [])
      .map((item) => [item.resourceId, item])
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
    resourceContext: {
      ...context.resourceContext,
      materialSummary: [...summaries.values()]
    },
    memory: {
      ...context.memory,
      resourceContext: {
        ...(context.memory?.resourceContext ?? {
          currentResourceIds: context.currentResourceIds,
          inheritedResourceIds: context.inheritedResourceIds,
          artifactResourceIds: [],
          materialSummary: []
        }),
        materialSummary: [...summaries.values()]
      },
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
  await closeStaleAgentTasksForAttempt(persistence, payload.runId, job.attemptsMade);
  const storedContext = await persistence.getRunContext(payload.runId);
  const context = await enrichImageMaterials(payload, storedContext);
  const taskIds = new Map<string, string>();
  const visibleSteps: VisibleStep[] = [];
  const progressReporter = createAgentProgressReporter(payload.runId, persistence, {
    userId: payload.workspaceId,
    attemptNo: job.attemptsMade + 1
  });
  const deadlineAt = Date.now() + Number(process.env.CREATION_RUN_TIMEOUT_MS ?? 600000);

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
      await progressReporter.start(taskId, agentNameByNode[nodeName] ?? `${nodeName} Agent`);
    },
    async onNodeRetry(nodeName) {
      await progressReporter.progress(agentNameByNode[nodeName] ?? `${nodeName} Agent`, {
        type: "retry",
        phase: "retrying",
        summary: "章节结构未通过校验，正在纠正当前步骤",
        retryCount: 1
      });
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
      await progressReporter.complete(summary);
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
  const heartbeat = setInterval(() => {
    void progressReporter.heartbeat().catch(() => undefined);
  }, Number(process.env.AGENT_HEARTBEAT_INTERVAL_MS ?? 5000));
  heartbeat.unref();

  try {
    const result = await runWechatArticleGraph(createInitialState(payload, context), {
      agents: createCreationAgents({
        userId: payload.workspaceId,
        runId: payload.runId,
        deadlineAt,
        onProgress: (agentName, event) => progressReporter.progress(agentName, event)
      }),
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
      result.layoutPlan,
      result.materials
      && result.brief
      && result.contentPlan
      && result.titles
      && result.outline
      && result.draft
      && result.imagePlan
      && result.presentationStyleDecision
      && result.layoutPlan
        ? {
            materials: result.materials,
            brief: result.brief,
            contentPlan: result.contentPlan,
            titles: result.titles,
            outline: result.outline,
            draft: result.draft,
            imagePlan: result.imagePlan,
            presentationStyleDecision: result.presentationStyleDecision,
            layoutPlan: result.layoutPlan
          }
        : undefined
    );
    if (result.qualityStatus && result.completionReason) {
      response.quality = {
        status: result.qualityStatus,
        completionReason: result.completionReason,
        reviewPassed: result.qualityStatus === "passed",
        unresolvedIssues: result.unresolvedIssues ?? []
      };
    }
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
      title: artifact.title,
      qualityStatus: result.qualityStatus,
      completionReason: result.completionReason,
      unresolvedIssueCount: result.unresolvedIssues?.length ?? 0
    });
    await appendAssistantMessage(
      persistence,
      payload.runId,
      payload.conversationId,
      result.qualityStatus === "warning"
        ? `已达到最大审校次数，已输出最后一版《${artifact.title}》。请根据质量提醒人工确认后再发布。`
        : `标题、正文、配图规划、内容呈现和质量审校都已完成。推荐标题是《${artifact.title}》，右侧手机预览已经更新。`
    );
    await persistence.updateRun(payload.runId, "completed", "artifact");
    await appendTaskCard(persistence, payload.runId, visibleSteps, "completed", true);
    await persistence.appendEvent(payload.runId, "run.completed", {
      status: "completed",
      artifactId: artifact.id,
      qualityStatus: result.qualityStatus,
      completionReason: result.completionReason,
      unresolvedIssues: result.unresolvedIssues ?? []
    });
    await adminConsole.finishGeneration(payload.runId, "completed");
    return result;
  } catch (error) {
    const activeTask = [...taskIds.values()].at(-1);
    if (activeTask) await persistence.failAgentTask(activeTask, error);
    if (shouldRetryCreationError(error, job.attemptsMade, job.opts.attempts)) {
      await persistence.failRunningAgentTasks(payload.runId, error);
      await progressReporter.retry(job.attemptsMade + 1);
      await appendTaskCard(persistence, payload.runId, visibleSteps, "running");
      throw error;
    }
    await persistence.failRunningAgentTasks(payload.runId, error);
    await progressReporter.fail(error);
    await persistence.updateRun(payload.runId, "failed", "failed");
    await appendTaskCard(persistence, payload.runId, visibleSteps, "failed");
    await persistence.appendEvent(payload.runId, "run.failed", {
      message: getCreationRunFailureMessage(error),
      ...(error instanceof StructureGuardError ? {
        structureGuard: { code: error.code, details: error.details }
      } : {}),
      ...(error instanceof ModelStructureError ? {
        modelStructure: { code: error.code, details: error.details }
      } : {})
    });
    await adminConsole.finishGeneration(
      payload.runId,
      "failed",
      error instanceof Error ? error.message.slice(0, 128) : "CREATION_RUN_FAILED"
    );
    throw error;
  } finally {
    clearInterval(heartbeat);
    await progressReporter.finish();
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

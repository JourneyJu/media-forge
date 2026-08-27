import { Readable } from "node:stream";
import type { CreationRunContext, CreationRunJob } from "@mediaforge/contracts";
import type { CreationPersistence } from "./persistence";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeStaleAgentTasksForAttempt,
  createAgentProgressReporter,
  enrichImageMaterials,
  getCreationTaskTitle,
  getCreationRunFailureMessage,
  sanitizeAgentProgressText,
  shouldRetryCreationError,
  shouldRetryCreationJob,
  toCreationFailureEnvelope
} from "./worker";
import { ModelStructureError } from "./structure-guard";

const job: CreationRunJob = {
  runId: "run_1",
  conversationId: "conversation_1",
  workspaceId: "user_1",
  contextVersion: 1,
  graphName: "wechat_article_creation",
  graphVersion: "2026-08-03"
};

const context: CreationRunContext = {
  userInput: "围绕舞蹈获奖重新创作",
  currentInstruction: "围绕舞蹈获奖重新创作",
  creationMode: "new",
  resourceIds: ["resource_1"],
  currentResourceIds: ["resource_1"],
  inheritedResourceIds: [],
  skillId: "auto",
  selectedSkills: [],
  maxSteps: 12,
  contextVersion: 1,
  memory: {
    instructionMemory: {
      recentValuableTurns: [{
        messageId: "message_1",
        content: "围绕舞蹈获奖重新创作",
        reason: "包含创作主题"
      }]
    },
    resourceContext: {
      currentResourceIds: ["resource_1"],
      inheritedResourceIds: [],
      artifactResourceIds: [],
      materialSummary: [{
        resourceId: "resource_1",
        type: "image",
        description: "素材“舞蹈现场.png”（image/png，来源：upload）"
      }]
    },
    materialSummary: [{
      resourceId: "resource_1",
      type: "image",
      description: "素材“舞蹈现场.png”（image/png，来源：upload）"
    }],
    userConstraints: []
  }
};

describe("creation worker image material enrichment", () => {
  afterEach(() => {
    delete process.env.MODEL_MODE;
  });

  it("stores visual description and OCR in run memory", async () => {
    process.env.MODEL_MODE = "gateway";
    const close = vi.fn(async () => undefined);
    const result = await enrichImageMaterials(job, context, {
      resources: {
        close,
        getContent: vi.fn(async () => ({
          body: Readable.from([Buffer.from("image")]),
          contentType: "image/png",
          originalName: "舞蹈现场.png"
        }))
      },
      analyze: vi.fn(async (input) => ({
        assetId: input.assetId,
        description: "舞台上多名儿童正在完成舞蹈谢幕",
        detectedType: "environment",
        ocrText: "小兰花艺术节",
        suggestedUsage: "用于获奖现场章节",
        model: { provider: "test", name: "vision", mode: "gateway" }
      }))
    });

    expect(result.memory.resourceContext.materialSummary[0]).toMatchObject({
      resourceId: "resource_1",
      description: "舞台上多名儿童正在完成舞蹈谢幕",
      ocrText: "小兰花艺术节",
      quality: "high"
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("marks the image low quality when vision analysis fails", async () => {
    process.env.MODEL_MODE = "gateway";
    const result = await enrichImageMaterials(job, context, {
      resources: {
        close: vi.fn(async () => undefined),
        getContent: vi.fn(async () => ({
          body: Readable.from([Buffer.from("image")]),
          contentType: "image/png",
          originalName: "舞蹈现场.png"
        }))
      },
      analyze: vi.fn(async () => { throw new Error("VISION_UNAVAILABLE"); })
    });

    expect(result.memory.resourceContext.materialSummary[0]).toMatchObject({
      description: "素材“舞蹈现场.png”（image/png，来源：upload）",
      quality: "low"
    });
  });
});

describe("agent progress safety", () => {
  it("projects the resolved operation into a user-visible task title", () => {
    const request: NonNullable<CreationRunContext["resolvedRequest"]> = {
      schemaVersion: 2,
      operation: "revise",
      decisionSource: "rule",
      confidence: "high",
      currentInstruction: "保留正文，只把主色改为深蓝",
      baseArtifactId: "artifact_1",
      mutationScope: ["presentation"],
      inheritance: {
        content: "preserve",
        presentation: "replace",
        resources: "artifact_used"
      },
      contentIdentity: {
        entities: [],
        facts: [],
        claims: [],
        mustIncludeVerbatim: []
      },
      provenance: []
    };

    expect(getCreationTaskTitle(request)).toContain("调整呈现");
    expect(getCreationTaskTitle({
      ...request,
      operation: "new",
      baseArtifactId: undefined,
      mutationScope: [],
      inheritance: { ...request.inheritance, content: "replace", resources: "current_only" }
    })).toContain("新创作");
  });

  it("removes sensitive lines and limits visible progress", () => {
    const result = sanitizeAgentProgressText([
      "正在比较文章结构",
      "system prompt: secret instructions",
      "API_KEY=sk-abcdefghijklmnopqrstuvwxyz",
      "准备生成标题"
    ].join("\n"));

    expect(result).toContain("正在比较文章结构");
    expect(result).toContain("准备生成标题");
    expect(result).not.toContain("secret instructions");
    expect(result).not.toContain("sk-");
    expect(result.length).toBeLessThanOrEqual(500);
  });

  it("maps internal failures to user-facing Chinese messages", () => {
    expect(getCreationRunFailureMessage(new Error("This operation was aborted"))).toContain("模型响应超时");
    expect(getCreationRunFailureMessage(new Error("ARTIFACT_VALIDATION_FAILED:SUBJECT_MISMATCH")))
      .toContain("主题匹配不足");
    expect(getCreationRunFailureMessage(new Error("MODEL_STRUCTURE_INVALID:MODEL_SECTION_COUNT_MISMATCH")))
      .toContain("自动纠正后仍未通过");
    expect(getCreationRunFailureMessage(new Error("secret provider detail"))).not.toContain("secret");
  });

  it("maps raw errors to bounded structured recovery guidance", () => {
    const failure = toCreationFailureEnvelope(
      new Error("ARTIFACT_VALIDATION_FAILED:VERBATIM_REQUIREMENT_MISSING"),
      "artifact"
    );

    expect(failure).toMatchObject({
      code: "CREATION_INTEGRITY_FAILED",
      stage: "artifact",
      category: "integrity",
      recoverability: "revise_input"
    });
    expect(failure.violations).toEqual([{
      code: "VERBATIM_REQUIREMENT_MISSING",
      target: "artifact"
    }]);
    expect(JSON.stringify(failure)).not.toContain("ARTIFACT_VALIDATION_FAILED");
  });

  it("only emits a terminal failure after the final queue attempt", () => {
    expect(shouldRetryCreationJob(0, 3)).toBe(true);
    expect(shouldRetryCreationJob(1, 3)).toBe(true);
    expect(shouldRetryCreationJob(2, 3)).toBe(false);
    expect(shouldRetryCreationError(
      new ModelStructureError("MODEL_SECTION_COUNT_MISMATCH", {}),
      0,
      3
    )).toBe(false);
    expect(shouldRetryCreationError(new Error("MODEL_GATEWAY_ERROR:503"), 0, 3)).toBe(true);
  });

  it("closes stale running agent tasks when a queue attempt restarts", async () => {
    const failRunningAgentTasks = vi.fn(async () => undefined);

    await closeStaleAgentTasksForAttempt({ failRunningAgentTasks }, "run_1", 1);

    expect(failRunningAgentTasks).toHaveBeenCalledWith(
      "run_1",
      expect.objectContaining({ message: "CREATION_ATTEMPT_RESTARTED" })
    );
  });

  it("keeps a fresh first attempt untouched", async () => {
    const failRunningAgentTasks = vi.fn(async () => undefined);

    await closeStaleAgentTasksForAttempt({ failRunningAgentTasks }, "run_1", 0);

    expect(failRunningAgentTasks).not.toHaveBeenCalled();
  });

  it("publishes a grounded summary without persisting raw reasoning", async () => {
    const appendEvent = vi.fn(async () => undefined);
    const reporter = createAgentProgressReporter(
      "run_1",
      { appendEvent } as unknown as CreationPersistence,
      {
        userId: "user_1",
        attemptNo: 2,
        enabled: true,
        minChars: 12,
        minAgeMs: 0,
        minIntervalMs: 0,
        secondSummaryAfterMs: 0,
        maxSummaries: 1,
        summarize: vi.fn(async () => ({
          activity: "compare" as const,
          subjects: ["文章结构"]
        }))
      }
    );

    await reporter.start("step_1", "ContentPlannerAgent");
    await reporter.progress("ContentPlannerAgent", {
      type: "reasoning",
      phase: "thinking",
      delta: "正在比较文章结构与读者阅读节奏，这段原始内容不应进入事件。",
      retryCount: 0
    });
    await vi.waitFor(() => {
      expect(appendEvent).toHaveBeenCalledWith(
        "run_1",
        "agent.reasoning.summary",
        expect.objectContaining({
          attemptNo: 2,
          revision: 1,
          summary: "正在比较文章结构。",
          visibility: "active_step_only"
        })
      );
    });
    expect(JSON.stringify(appendEvent.mock.calls)).not.toContain("这段原始内容不应进入事件");
    await reporter.complete("内容结构已完成");
    await reporter.finish();
  });
});

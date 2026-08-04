import { Readable } from "node:stream";
import type { CreationRunContext, CreationRunJob } from "@mediaforge/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeStaleAgentTasksForAttempt,
  enrichImageMaterials,
  getCreationRunFailureMessage,
  sanitizeAgentProgressText,
  shouldRetryCreationJob
} from "./worker";

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
    expect(getCreationRunFailureMessage(new Error("secret provider detail"))).not.toContain("secret");
  });

  it("only emits a terminal failure after the final queue attempt", () => {
    expect(shouldRetryCreationJob(0, 3)).toBe(true);
    expect(shouldRetryCreationJob(1, 3)).toBe(true);
    expect(shouldRetryCreationJob(2, 3)).toBe(false);
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
});

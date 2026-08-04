import { describe, expect, it } from "vitest";
import {
  agentProgressPayloadSchema,
  createConversationTurnRequestSchema,
  runEventTypeSchema,
  submitRunClarificationRequestSchema
} from "./conversations";

describe("conversation lifecycle contracts", () => {
  it("treats the first interaction as a complete turn instead of an empty conversation", () => {
    const result = createConversationTurnRequestSchema.parse({
      idempotencyKey: "turn-request-001",
      content: "帮我写一篇面向儿童家长的摄影团队介绍",
      uploadSessionId: "upload-session-001",
      resourceIds: ["resource-001"]
    });

    expect(result.content).toBe("帮我写一篇面向儿童家长的摄影团队介绍");
    expect(result.resourceIds).toEqual(["resource-001"]);
    expect(result.inheritedResourceIds).toEqual([]);
    expect(result.creationMode).toBe("auto");
    expect(result.layoutSkillId).toBe("auto");
    expect(result.maxSteps).toBe(12);
  });

  it("accepts an explicit new creation with selected inherited resources", () => {
    const result = createConversationTurnRequestSchema.parse({
      idempotencyKey: "turn-request-003",
      content: "换一个主题，写舞蹈获奖活动",
      creationMode: "new",
      inheritedResourceIds: ["brand-logo"]
    });

    expect(result.creationMode).toBe("new");
    expect(result.inheritedResourceIds).toEqual(["brand-logo"]);
  });

  it("does not accept an empty first prompt", () => {
    expect(() =>
      createConversationTurnRequestSchema.parse({
        idempotencyKey: "turn-request-002",
        content: "   "
      })
    ).toThrow();
  });

  it("accepts clarification answers with newly uploaded resources", () => {
    const result = submitRunClarificationRequestSchema.parse({
      idempotencyKey: "clarification-001",
      uploadSessionId: "upload-session-001",
      resourceIds: ["image-001"],
      answers: [{ questionId: "audience", value: "家长" }]
    });

    expect(result.resourceIds).toEqual(["image-001"]);
    expect(result.uploadSessionId).toBe("upload-session-001");
  });

  it("validates agent progress and heartbeat event contracts", () => {
    expect(runEventTypeSchema.parse("agent.reasoning.delta")).toBe("agent.reasoning.delta");
    expect(runEventTypeSchema.parse("run.heartbeat")).toBe("run.heartbeat");
    const progress = agentProgressPayloadSchema.parse({
      runId: "run_1",
      stepId: "task_1",
      agentName: "WriterAgent",
      sequence: 2,
      phase: "generating",
      delta: "正在组织正文结构",
      elapsedMs: 3200,
      retryCount: 0,
      createdAt: new Date("2026-08-03T00:00:03.200Z").toISOString()
    });

    expect(progress.sequence).toBe(2);
    expect(progress.delta).toBe("正在组织正文结构");
  });
});

import { describe, expect, it } from "vitest";
import { createConversationTurnRequestSchema } from "./conversations";

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
    expect(result.layoutSkillId).toBe("auto");
    expect(result.maxSteps).toBe(12);
  });

  it("does not accept an empty first prompt", () => {
    expect(() =>
      createConversationTurnRequestSchema.parse({
        idempotencyKey: "turn-request-002",
        content: "   "
      })
    ).toThrow();
  });
});

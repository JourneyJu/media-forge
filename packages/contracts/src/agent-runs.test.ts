import { describe, expect, it } from "vitest";
import { createAgentRunRequestSchema, submitAgentDecisionRequestSchema } from "./agent-runs";

describe("agent run contracts", () => {
  it("fills safe loop limits", () => {
    const result = createAgentRunRequestSchema.parse({
      workspaceId: "workspace_1",
      topic: "儿童摄影"
    });

    expect(result.maxSteps).toBe(12);
    expect(result.assetIds).toEqual([]);
    expect(result.sellingPoints).toEqual([]);
  });

  it("requires optimistic locking and idempotency for decisions", () => {
    expect(() =>
      submitAgentDecisionRequestSchema.parse({
        stepId: "step_1",
        decision: "approve"
      })
    ).toThrow();
  });
});

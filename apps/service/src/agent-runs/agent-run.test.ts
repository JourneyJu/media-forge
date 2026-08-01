import { describe, expect, it } from "vitest";
import { createAgentRunStore } from "./agent-run";

describe("agent run orchestrator", () => {
  it("creates a plan and writes the article without plan approval", async () => {
    const store = createAgentRunStore();
    const run = await store.create({
      workspaceId: "workspace_1",
      topic: "儿童摄影",
      audience: "家长",
      sellingPoints: ["记录成长"],
      tone: "warm",
      style: "story",
      assetIds: ["asset_1"],
      extraInstructions: "",
      maxSteps: 12
    });

    expect(run.status).toBe("completed");
    expect(run.plan.tasks.map((task) => task.type)).toEqual([
      "layout",
      "expanding",
      "reviewing",
      "final_review"
    ]);
    expect(run.result?.document.content.length).toBeGreaterThan(4);
  });

  it("keeps the bounded workflow steps after automatic execution", async () => {
    const store = createAgentRunStore();
    const run = await store.create({
      workspaceId: "workspace_1",
      topic: "儿童摄影",
      audience: "家长",
      sellingPoints: ["记录成长"],
      tone: "warm",
      style: "story",
      assetIds: [],
      extraInstructions: "",
      maxSteps: 12
    });

    expect(run.status).toBe("completed");
    expect(run.steps.some((step) => step.type === "reviewing")).toBe(true);
    expect(run.steps.at(-1)?.type).toBe("final_review");
  });
});

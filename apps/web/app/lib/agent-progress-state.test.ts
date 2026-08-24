import { describe, expect, it } from "vitest";
import type { TaskStepView } from "@mediaforge/contracts";
import { applyAgentProgressUpdate } from "./agent-progress-state";

const runningStep: TaskStepView = {
  id: "step_1",
  label: "内容策划",
  status: "running",
  reasoningExecutionId: "execution_1"
};

describe("agent progress state", () => {
  it("replaces summaries by revision and ignores stale revisions", () => {
    const first = applyAgentProgressUpdate(runningStep, {
      eventType: "agent.reasoning.summary",
      executionId: "execution_1",
      revision: 2,
      summary: "正在比较文章结构。",
      createdAt: "2026-08-24T08:00:00.000Z"
    });
    const stale = applyAgentProgressUpdate(first, {
      eventType: "agent.reasoning.summary",
      executionId: "execution_1",
      revision: 1,
      summary: "过期摘要",
      createdAt: "2026-08-24T08:00:01.000Z"
    });

    expect(first.reasoningSummary).toBe("正在比较文章结构。");
    expect(stale).toBe(first);
  });

  it("ignores a late result from another execution", () => {
    const result = applyAgentProgressUpdate(runningStep, {
      eventType: "agent.reasoning.summary",
      executionId: "old_execution",
      revision: 9,
      summary: "迟到摘要",
      createdAt: "2026-08-24T08:00:00.000Z"
    });
    expect(result).toBe(runningStep);
  });

  it("clears transient content when the agent completes", () => {
    const result = applyAgentProgressUpdate({
      ...runningStep,
      reasoningSummary: "正在分析文章结构。",
      reasoningRevision: 1,
      progressText: "正在生成"
    }, {
      eventType: "agent.completed",
      executionId: "execution_1",
      createdAt: "2026-08-24T08:00:02.000Z"
    });

    expect(result.status).toBe("completed");
    expect(result.reasoningSummary).toBeUndefined();
    expect(result.progressText).toBeUndefined();
  });
});

import type { RunEventType, TaskStepView } from "@mediaforge/contracts";

export interface AgentProgressUpdate {
  eventType: RunEventType;
  phase?: TaskStepView["phase"];
  delta?: string;
  summary?: string;
  executionId?: string;
  revision?: number;
  elapsedMs?: number;
  retryCount?: number;
  createdAt: string;
}

export function applyAgentProgressUpdate(
  step: TaskStepView,
  update: AgentProgressUpdate
): TaskStepView {
  if (update.eventType === "agent.started") {
    return {
      ...step,
      status: "running",
      reasoningSummary: undefined,
      reasoningRevision: undefined,
      reasoningExecutionId: update.executionId,
      progressText: update.summary,
      phase: update.phase,
      elapsedMs: update.elapsedMs,
      retryCount: update.retryCount,
      lastActivityAt: update.createdAt
    };
  }

  const sameExecution = !update.executionId
    || !step.reasoningExecutionId
    || update.executionId === step.reasoningExecutionId;
  if (!sameExecution) return step;

  const terminal = update.eventType === "agent.completed"
    || update.eventType === "agent.reasoning.completed";
  if (terminal) {
    return {
      ...step,
      status: update.eventType === "agent.completed" ? "completed" : step.status,
      phase: update.phase,
      progressText: undefined,
      reasoningSummary: undefined,
      reasoningRevision: undefined,
      elapsedMs: update.elapsedMs,
      retryCount: update.retryCount,
      lastActivityAt: update.createdAt
    };
  }

  if (
    update.eventType === "agent.reasoning.summary"
    && update.revision !== undefined
    && (step.reasoningRevision ?? 0) >= update.revision
  ) {
    return step;
  }

  const isReasoningSummary = update.eventType === "agent.reasoning.summary";
  const nextReasoning = isReasoningSummary
    ? update.summary
    : update.delta
      ? `${step.reasoningSummary ?? ""}${update.delta}`.slice(-4_000)
      : step.reasoningSummary;

  return {
    ...step,
    status: update.eventType === "agent.failed" ? "failed" : step.status,
    ...(update.phase ? { phase: update.phase } : {}),
    ...(!isReasoningSummary && update.summary ? { progressText: update.summary } : {}),
    ...(nextReasoning ? { reasoningSummary: nextReasoning } : {}),
    ...(isReasoningSummary && update.revision !== undefined
      ? { reasoningRevision: update.revision }
      : {}),
    ...(update.executionId ? { reasoningExecutionId: update.executionId } : {}),
    ...(update.elapsedMs !== undefined ? { elapsedMs: update.elapsedMs } : {}),
    ...(update.retryCount !== undefined ? { retryCount: update.retryCount } : {}),
    lastActivityAt: update.createdAt
  };
}

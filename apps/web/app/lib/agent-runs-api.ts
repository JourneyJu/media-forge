import type {
  AgentRun,
  CreateAgentRunRequest,
  SubmitAgentDecisionRequest
} from "@mediaforge/contracts";
import { serviceFetch } from "./api-client";

async function readResponse(response: Response): Promise<AgentRun> {
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(error?.message ?? "Agent 执行失败，请稍后重试");
  }
  return response.json() as Promise<AgentRun>;
}

export async function createAgentRun(input: CreateAgentRunRequest): Promise<AgentRun> {
  return readResponse(await serviceFetch("/agent-runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  }));
}

export async function submitAgentDecision(
  runId: string,
  input: SubmitAgentDecisionRequest
): Promise<AgentRun> {
  return readResponse(await serviceFetch(`/agent-runs/${runId}/decisions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  }));
}

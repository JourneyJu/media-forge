import { z } from "zod";
import { articleStyleSchema, articleToneSchema, type GenerateWechatArticleResponse } from "./ai-generation";
import { builtInLayoutSkillIds } from "./layout-skills";

export const agentRunStatusSchema = z.enum([
  "queued",
  "analyzing_assets",
  "planning",
  "waiting_user",
  "layout",
  "expanding",
  "reviewing",
  "revising",
  "restructuring",
  "final_review",
  "rendering",
  "completed",
  "failed",
  "cancelled"
]);

export const agentStepTypeSchema = z.enum([
  "analyzing_assets",
  "planning",
  "layout",
  "expanding",
  "reviewing",
  "revising",
  "restructuring",
  "final_review",
  "rendering"
]);

export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export type AgentStepType = z.infer<typeof agentStepTypeSchema>;

export const createAgentRunRequestSchema = z.object({
  workspaceId: z.string().trim().min(1),
  articleId: z.string().trim().min(1).optional(),
  topic: z.string().trim().min(1).max(200),
  audience: z.string().trim().max(500).default(""),
  sellingPoints: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
  tone: articleToneSchema.default("friendly"),
  style: articleStyleSchema.default("practical"),
  layoutSkillId: z.enum(builtInLayoutSkillIds).default("auto"),
  assetIds: z.array(z.string().trim().min(1)).max(30).default([]),
  extraInstructions: z.string().trim().max(2000).default(""),
  maxSteps: z.number().int().min(4).max(12).default(12)
});

export const submitAgentDecisionRequestSchema = z.object({
  stepId: z.string().trim().min(1),
  lockVersion: z.number().int().min(1),
  idempotencyKey: z.string().trim().min(8).max(100),
  decision: z.enum(["approve", "revise_plan", "cancel"]),
  selectedOptionId: z.string().trim().min(1).max(80).optional(),
  instruction: z.string().trim().max(2000).default("")
});

export type CreateAgentRunRequest = z.infer<typeof createAgentRunRequestSchema>;
export type SubmitAgentDecisionRequest = z.infer<typeof submitAgentDecisionRequestSchema>;

export interface AgentPlanTask {
  id: string;
  type: "layout" | "expanding" | "reviewing" | "final_review";
  title: string;
  objective: string;
  status: "pending" | "running" | "completed";
}

export interface AgentPlan {
  strategy: string;
  rationale: string;
  tasks: AgentPlanTask[];
}

export interface AgentStep {
  id: string;
  stepNo: number;
  type: AgentStepType;
  status: "running" | "waiting_user" | "succeeded" | "failed" | "skipped";
  title: string;
  summary: string;
  score?: number;
  createdAt: string;
}

export interface AgentWaitingFor {
  stepId: string;
  prompt: string;
  options: Array<{ id: string; label: string; description: string }>;
}

export interface AgentRun {
  id: string;
  workspaceId: string;
  articleId?: string;
  status: AgentRunStatus;
  currentStep: AgentStepType;
  lockVersion: number;
  revisionCount: number;
  restructureCount: number;
  plan: AgentPlan;
  steps: AgentStep[];
  waitingFor?: AgentWaitingFor;
  result?: GenerateWechatArticleResponse;
  createdAt: string;
  updatedAt: string;
}

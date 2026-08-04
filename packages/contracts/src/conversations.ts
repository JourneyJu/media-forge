import { z } from "zod";
import type { AgentPlan, AgentStep, AgentWaitingFor, SubmitAgentDecisionRequest } from "./agent-runs";
import type { GenerateWechatArticleResponse } from "./ai-generation";
import { builtInLayoutSkillIds } from "./layout-skills";
import type { ResourceSummary } from "./assets";
import { userSkillMentionSchema } from "./user-skills";
import type { UserSkillMention } from "./user-skills";

export const conversationStatusSchema = z.enum(["active", "deleting", "archived"]);
export const conversationMessageRoleSchema = z.enum(["user", "assistant", "system"]);
export const conversationResourceSourceSchema = z.enum(["upload", "paste", "link", "library"]);
export const creationRunStatusSchema = z.enum([
  "queued",
  "running",
  "building_brief",
  "waiting_clarification",
  "planning",
  "waiting_plan_approval",
  "writing",
  "planning_images",
  "reviewing",
  "rendering",
  "completed",
  "failed",
  "cancelled"
]);
export const creationRunTypeSchema = z.enum(["wechat_article_generation"]);
export const creationModeSchema = z.enum(["auto", "new", "revise", "continue"]);
export const artifactTypeSchema = z.enum(["wechat_article", "title_candidates", "image_plan"]);
export const runEventTypeSchema = z.enum([
  "run.created",
  "run.started",
  "assistant.message.created",
  "assistant.message.delta",
  "assistant.message.completed",
  "task.card.updated",
  "step.started",
  "step.completed",
  "agent.started",
  "agent.progress",
  "agent.reasoning.delta",
  "agent.reasoning.completed",
  "agent.output.validating",
  "agent.retry.started",
  "agent.completed",
  "agent.failed",
  "run.heartbeat",
  "clarification.required",
  "clarification.submitted",
  "decision.required",
  "decision.submitted",
  "artifact.created",
  "run.completed",
  "run.failed"
]);

export type ConversationStatus = z.infer<typeof conversationStatusSchema>;
export type ConversationMessageRole = z.infer<typeof conversationMessageRoleSchema>;
export type ConversationResourceSource = z.infer<typeof conversationResourceSourceSchema>;
export type CreationRunStatus = z.infer<typeof creationRunStatusSchema>;
export type CreationRunType = z.infer<typeof creationRunTypeSchema>;
export type CreationMode = z.infer<typeof creationModeSchema>;
export type ArtifactType = z.infer<typeof artifactTypeSchema>;
export type RunEventType = z.infer<typeof runEventTypeSchema>;

export const agentProgressPhaseSchema = z.enum(["thinking", "generating", "validating", "retrying"]);
export const agentProgressPayloadSchema = z.object({
  runId: z.string().trim().min(1),
  stepId: z.string().trim().min(1),
  agentName: z.string().trim().min(1).max(80),
  sequence: z.number().int().positive(),
  phase: agentProgressPhaseSchema,
  delta: z.string().max(500).optional(),
  summary: z.string().max(500).optional(),
  elapsedMs: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime()
});
export type AgentProgressPhase = z.infer<typeof agentProgressPhaseSchema>;
export type AgentProgressPayload = z.infer<typeof agentProgressPayloadSchema>;

export const createConversationRequestSchema = z.object({
  workspaceId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(120).default("新的公众号创作")
});

export const createConversationTurnRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(100),
  content: z.string().trim().min(1).max(4000),
  uploadSessionId: z.string().trim().min(1).optional(),
  resourceIds: z.array(z.string().trim().min(1)).max(30).default([]),
  inheritedResourceIds: z.array(z.string().trim().min(1)).max(30).default([]),
  creationMode: creationModeSchema.default("auto"),
  layoutSkillId: z.enum(builtInLayoutSkillIds).default("auto"),
  skillMentions: z.array(userSkillMentionSchema).max(1).default([]),
  maxSteps: z.number().int().min(4).max(12).default(12)
});

export const renameConversationRequestSchema = z.object({
  title: z.string().trim().min(1).max(4000)
});

export const createConversationMessageRequestSchema = z.object({
  role: conversationMessageRoleSchema.default("user"),
  content: z.string().trim().min(1).max(4000),
  resourceIds: z.array(z.string().trim().min(1)).max(30).default([])
});

export const createConversationResourceRequestSchema = z.object({
  assetId: z.string().trim().min(1),
  source: conversationResourceSourceSchema.default("upload")
});

export const createConversationRunRequestSchema = z.object({
  type: creationRunTypeSchema.default("wechat_article_generation"),
  layoutSkillId: z.enum(builtInLayoutSkillIds).default("auto"),
  skillMentions: z.array(userSkillMentionSchema).max(1).default([]),
  maxSteps: z.number().int().min(4).max(12).default(12)
});

export const submitRunClarificationRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(100),
  uploadSessionId: z.string().trim().min(1).optional(),
  resourceIds: z.array(z.string().trim().min(1)).max(30).default([]),
  answers: z.array(z.object({
    questionId: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(1000)
  })).min(1).max(10)
});

export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>;
export type CreateConversationTurnRequest = z.infer<typeof createConversationTurnRequestSchema>;
export type CreateConversationFirstTurnRequest = CreateConversationTurnRequest;
export type RenameConversationRequest = z.infer<typeof renameConversationRequestSchema>;
export type CreateConversationMessageRequest = z.infer<typeof createConversationMessageRequestSchema>;
export type CreateConversationResourceRequest = z.infer<typeof createConversationResourceRequestSchema>;
export type CreateConversationRunRequest = z.infer<typeof createConversationRunRequestSchema>;
export type SubmitRunClarificationRequest = z.infer<typeof submitRunClarificationRequestSchema>;
export type SubmitRunDecisionRequest = SubmitAgentDecisionRequest;
export type ConversationSkillMention = UserSkillMention;

export interface Conversation {
  id: string;
  workspaceId?: string;
  title: string;
  status: ConversationStatus;
  contextVersion: number;
  createdAt: string;
  updatedAt: string;
  lastInteractionAt: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: ConversationMessageRole;
  content: string;
  resourceIds: string[];
  resources?: ResourceSummary[];
  createdAt: string;
}

export interface ConversationResource {
  id: string;
  conversationId: string;
  assetId: string;
  source: ConversationResourceSource;
  createdAt: string;
}

export interface Artifact {
  id: string;
  conversationId: string;
  runId: string;
  type: ArtifactType;
  title: string;
  payload: GenerateWechatArticleResponse;
  articleId?: string;
  articleVersionId?: string;
  createdAt: string;
}

export interface CreationRun {
  id: string;
  conversationId: string;
  type: CreationRunType;
  status: CreationRunStatus;
  currentStep: string;
  lockVersion: number;
  plan: AgentPlan;
  steps: AgentStep[];
  waitingFor?: AgentWaitingFor;
  resultArtifact?: Artifact;
  createdAt: string;
  updatedAt: string;
}

export interface RunEvent {
  id: string;
  runId: string;
  eventNo: number;
  type: RunEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type ChatMessageType = "user" | "assistant" | "task" | "clarification" | "result_notice";
export type TaskCardStatus = "queued" | "running" | "waiting_clarification" | "completed" | "failed";
export type TaskStepViewStatus = "waiting" | "running" | "completed" | "failed";

export interface UserChatMessage {
  id: string;
  type: "user";
  content: string;
  resourceIds: string[];
  createdAt: string;
}

export interface AssistantChatMessage {
  id: string;
  type: "assistant";
  content: string;
  streaming: boolean;
  runId?: string;
  createdAt: string;
}

export interface TaskStepView {
  id: string;
  label: string;
  status: TaskStepViewStatus;
  summary?: string;
  phase?: AgentProgressPhase;
  progressText?: string;
  reasoningSummary?: string;
  elapsedMs?: number;
  retryCount?: number;
  lastActivityAt?: string;
}

export interface TaskCardChatMessage {
  id: string;
  type: "task";
  runId: string;
  title: string;
  status: TaskCardStatus;
  steps: TaskStepView[];
  collapsed: boolean;
  createdAt: string;
}

export interface ClarificationChatMessage {
  id: string;
  type: "clarification";
  runId: string;
  title: string;
  description: string;
  questions: Array<{
    id: string;
    label: string;
    required: boolean;
    suggestions: string[];
  }>;
  createdAt: string;
}

export interface ResultNoticeChatMessage {
  id: string;
  type: "result_notice";
  runId: string;
  artifactId: string;
  content: string;
  createdAt: string;
}

export type ChatMessage =
  | UserChatMessage
  | AssistantChatMessage
  | TaskCardChatMessage
  | ClarificationChatMessage
  | ResultNoticeChatMessage;

export interface GetConversationResponse {
  conversation: Conversation;
  messages: ConversationMessage[];
  resources: ConversationResource[];
  activeRun: CreationRun | null;
  latestArtifacts: Artifact[];
}

export interface CreateConversationTurnResponse {
  conversation: Conversation;
  message: ConversationMessage;
  resources: ResourceSummary[];
  run: CreationRun;
}

export interface ConversationListItem {
  id: string;
  title: string;
  createdAt: string;
  lastInteractionAt: string;
}

export interface ListConversationsResponse {
  items: ConversationListItem[];
  nextCursor: string | null;
}

export interface DeleteConversationResponse {
  conversationId: string;
  status: "deleting";
}

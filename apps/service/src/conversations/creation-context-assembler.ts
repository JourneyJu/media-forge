import { createHash } from "node:crypto";
import type {
  ConversationWorkingMemory,
  CreateConversationTurnRequest,
  CreationSnapshot,
  CreationRunContext
} from "@mediaforge/contracts";
import {
  conversationWorkingMemorySchema,
  creationSnapshotSchema,
  creationRunContextSchema
} from "@mediaforge/contracts";
import {
  buildResourceContext,
  rebuildInstructionMemory,
  type RebuildUserMessage
} from "../creation-graph/context-rebuild";
import {
  resolveCanonicalCreationRequest,
  resolveConversationIntent
} from "../creation-graph/intent-resolution";

export type CreationContextV2Mode = "off" | "shadow" | "explicit" | "all";

export function creationContextV2ModeFromEnv(value = process.env.CREATION_CONTEXT_V2_MODE): CreationContextV2Mode {
  return value === "off" || value === "shadow" || value === "explicit" ? value : "all";
}

export function creationContextV2ModeForConversation(
  conversationId: string,
  mode = creationContextV2ModeFromEnv(),
  percentageValue = process.env.CREATION_CONTEXT_V2_PERCENT
): CreationContextV2Mode {
  if (mode !== "all") return mode;
  const parsed = Number(percentageValue ?? 100);
  const percentage = Number.isFinite(parsed) ? Math.min(100, Math.max(0, Math.floor(parsed))) : 100;
  if (percentage >= 100) return "all";
  if (percentage <= 0) return "shadow";
  const bucket = Number.parseInt(createHash("sha256").update(conversationId).digest("hex").slice(0, 8), 16) % 100;
  return bucket < percentage ? "all" : "shadow";
}

export interface AssembleCreationRunContextInput {
  conversationId: string;
  contextVersion: number;
  userInput: string;
  resourceIds: string[];
  skillId: string;
  selectedSkills: CreationRunContext["selectedSkills"];
  maxSteps: number;
  requestedCreationMode: CreateConversationTurnRequest["creationMode"];
  currentResourceIds: string[];
  inheritedResourceIds: string[];
  currentMaterialSummary: ConversationWorkingMemory["resourceContext"]["materialSummary"];
  userMessages: RebuildUserMessage[];
  artifactResourceIds: string[];
  baseSnapshot?: CreationSnapshot;
  memory: ConversationWorkingMemory;
  v2Mode?: CreationContextV2Mode;
  now?: string;
}

export function parseCreationSnapshot(value: unknown): CreationSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const parsed = creationSnapshotSchema.safeParse((value as { creationSnapshot?: unknown }).creationSnapshot);
  return parsed.success ? parsed.data : undefined;
}

function emptyMemory(conversationId: string, contextVersion: number, now: string): ConversationWorkingMemory {
  return conversationWorkingMemorySchema.parse({
    conversationId,
    contextVersion,
    instructionMemory: { recentValuableTurns: [] },
    resourceContext: {
      currentResourceIds: [],
      inheritedResourceIds: [],
      artifactResourceIds: [],
      materialSummary: []
    },
    materialSummary: [],
    userConstraints: [],
    updatedAt: now
  });
}

export function effectiveRunResourceIds(input: {
  creationMode: CreationRunContext["creationMode"];
  currentResourceIds: string[];
  inheritedResourceIds: string[];
  artifactResourceIds: string[];
}): string[] {
  if (input.creationMode === "new") return [...new Set(input.currentResourceIds)];
  return [...new Set([
    ...input.currentResourceIds,
    ...input.inheritedResourceIds,
    ...(input.creationMode === "revise" ? input.artifactResourceIds : [])
  ])];
}

function revisionTarget(
  mutationScope: NonNullable<CreationRunContext["resolvedRequest"]>["mutationScope"]
): NonNullable<ConversationWorkingMemory["revisionIntent"]>["target"] {
  if (mutationScope.length !== 1) return "all";
  switch (mutationScope[0]) {
    case "title": return "title";
    case "structure": return "outline";
    case "images": return "image";
    case "presentation": return "style";
    case "content": return "body";
  }
}

function shouldExecuteV2(
  mode: CreationContextV2Mode,
  requestedCreationMode: CreateConversationTurnRequest["creationMode"]
): boolean {
  return mode === "all" || (mode === "explicit" && requestedCreationMode !== "auto");
}

export function assembleCreationRunContext(input: AssembleCreationRunContextInput): CreationRunContext {
  const now = input.now ?? new Date().toISOString();
  const v2Mode = input.v2Mode ?? "shadow";
  const resolvedRequest = v2Mode === "off"
    ? undefined
    : resolveCanonicalCreationRequest({
        requestedCreationMode: input.requestedCreationMode,
        currentInstruction: input.userInput,
        currentResourceIds: input.currentResourceIds,
        memory: input.memory,
        userMessages: input.userMessages
      });
  const scopedRevisionNeedsSnapshot = resolvedRequest?.operation === "revise"
    && resolvedRequest.mutationScope.length === 1
    && resolvedRequest.mutationScope[0] === "presentation";
  const executeV2 = Boolean(resolvedRequest)
    && shouldExecuteV2(v2Mode, input.requestedCreationMode)
    && (!scopedRevisionNeedsSnapshot || Boolean(input.baseSnapshot));
  const legacyIntent = resolveConversationIntent({
    requestedCreationMode: input.requestedCreationMode,
    currentInstruction: input.userInput,
    currentResourceIds: input.currentResourceIds,
    memory: input.memory,
    userMessages: input.userMessages
  });
  const resolvedMode = executeV2 ? resolvedRequest?.operation : legacyIntent.mode;
  const creationMode: CreationRunContext["creationMode"] = resolvedMode === "clarify"
    ? "continue"
    : resolvedMode ?? "new";
  const memorySnapshot = creationMode === "new"
    ? emptyMemory(input.conversationId, input.contextVersion, now)
    : input.memory;
  const historyMessages = executeV2
    ? creationMode === "new" ? [] : input.userMessages.slice(0, -1)
    : input.userMessages;
  const instructionMemory = rebuildInstructionMemory(historyMessages, creationMode);
  const resourceContext = buildResourceContext({
    currentResourceIds: input.currentResourceIds,
    inheritedResourceIds: input.inheritedResourceIds,
    artifactResourceIds: input.artifactResourceIds,
    currentMaterialSummary: input.currentMaterialSummary,
    previousMemory: memorySnapshot,
    creationMode
  });
  const resourceIds = effectiveRunResourceIds({
    creationMode,
    currentResourceIds: input.currentResourceIds,
    inheritedResourceIds: resourceContext.inheritedResourceIds,
    artifactResourceIds: resourceContext.artifactResourceIds
  });
  const selectedResources = new Set(resourceIds);
  const materialSummary = new Map(
    resourceContext.materialSummary
      .filter((item) => selectedResources.has(item.resourceId))
      .map((item) => [item.resourceId, item])
  );
  for (const item of input.currentMaterialSummary) {
    if (selectedResources.has(item.resourceId)) materialSummary.set(item.resourceId, item);
  }
  const revisionIntent = creationMode === "revise"
    ? {
        target: resolvedRequest ? revisionTarget(resolvedRequest.mutationScope) : "all" as const,
        instruction: input.userInput.slice(0, 1000),
        createdAt: now
      }
    : undefined;

  return creationRunContextSchema.parse({
    ...(executeV2 ? { schemaVersion: 2 } : {}),
    userInput: input.userInput,
    resourceIds,
    currentInstruction: executeV2 ? resolvedRequest?.currentInstruction : input.userInput,
    intentResolution: legacyIntent,
    ...(resolvedRequest ? { resolvedRequest } : {}),
    ...(executeV2 && creationMode === "revise" && input.baseSnapshot
      ? { baseSnapshot: input.baseSnapshot }
      : {}),
    creationMode,
    currentResourceIds: input.currentResourceIds,
    inheritedResourceIds: resourceContext.inheritedResourceIds,
    resourceContext,
    skillId: input.skillId,
    selectedSkills: input.selectedSkills,
    maxSteps: input.maxSteps,
    contextVersion: input.contextVersion,
    memory: {
      instructionMemory,
      brief: memorySnapshot.brief,
      selectedTitle: memorySnapshot.selectedTitle,
      outline: memorySnapshot.outline,
      presentationStyleDecision: memorySnapshot.presentationStyleDecision,
      layoutPlan: memorySnapshot.layoutPlan,
      draftSummary: memorySnapshot.draftSummary,
      resourceContext,
      materialSummary: [...materialSummary.values()],
      userConstraints: memorySnapshot.userConstraints,
      successfulBaseline: memorySnapshot.successfulBaseline,
      lastAttempt: memorySnapshot.lastAttempt,
      lastArtifactId: revisionIntent ? memorySnapshot.lastArtifactId : undefined,
      revisionIntent
    }
  });
}

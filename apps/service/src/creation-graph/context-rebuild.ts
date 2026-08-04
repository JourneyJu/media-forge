import type {
  ConversationInstructionMemory,
  ConversationMaterialSummary,
  ConversationResourceContext,
  ConversationWorkingMemory,
  CreationMode
} from "@mediaforge/contracts";
import {
  conversationInstructionMemorySchema,
  conversationResourceContextSchema
} from "@mediaforge/contracts";
import { isValuableUserInstruction } from "./intent-resolution";

export interface RebuildUserMessage {
  id: string;
  content: string;
}

function clip(value: string, maxLength: number): string {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function isValuableInstruction(value: string): boolean {
  const normalized = clip(value, 80);
  if (!normalized) return false;
  return !/^(继续|继续任务|继续写|继续生成|接着写|接着来|往下写|下一步|开始|好的|好)$/u.test(normalized);
}

function meaningfulLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*\d+[.、]\s*/u, "").trim())
    .filter((line) => line.length >= 2);
}

function inferTaskGoal(value: string): string | undefined {
  const topicMatch = value.match(/主题(?:是|为|：|:)\s*([^，。；;\n]+)/u);
  if (topicMatch?.[1]) return clip(topicMatch[1], 120);
  const firstMeaningful = meaningfulLines(value)
    .find((line) => !/^(帮我|请|要求如下)$/u.test(line));
  return firstMeaningful ? clip(firstMeaningful, 120) : undefined;
}

function inferAudience(value: string): string | undefined {
  const match = value.match(/面向(?:的是)?\s*([^，。；;\n]+)/u);
  return match?.[1] ? clip(match[1], 120) : undefined;
}

function collectMatchingLines(value: string, pattern: RegExp, maxItems: number): string[] {
  return meaningfulLines(value)
    .filter((line) => pattern.test(line))
    .map((line) => clip(line, 300))
    .slice(0, maxItems);
}

export function rebuildInstructionMemory(
  userMessages: RebuildUserMessage[],
  creationMode: Exclude<CreationMode, "auto">
): ConversationInstructionMemory {
  const sourceMessages = creationMode === "new"
    ? userMessages.slice(-1)
    : userMessages;
  const valuableMessages = sourceMessages
    .map((message) => ({
      ...message,
      content: message.content.trim()
    }))
    .filter((message) => isValuableUserInstruction(message.content));
  const recentValuableTurns = valuableMessages.slice(-2).map((message) => ({
    messageId: message.id,
    content: clip(message.content, 4000),
    reason: "包含创作目标、约束、素材说明或修改要求"
  }));
  const combined = valuableMessages.map((message) => message.content).join("\n\n");
  const rebuiltContext = combined
    ? {
        taskGoal: inferTaskGoal(combined),
        sourceRequest: clip(combined, 2000),
        audience: inferAudience(combined),
        styleConstraints: collectMatchingLines(combined, /风格|语气|语言|口吻|自然|正式|温暖|热烈|AI\s*味/u, 20),
        contentRequirements: collectMatchingLines(combined, /要求|需要|重点|展示|分类|结构|标题|正文|配图|素材|继续|补充/u, 30),
        prohibitedContent: collectMatchingLines(combined, /不要|避免|禁止|不能|不出现/u, 20),
        unresolvedQuestions: [],
        confidence: combined.length >= 20 ? "medium" as const : "low" as const
      }
    : undefined;

  return conversationInstructionMemorySchema.parse({
    ...(rebuiltContext ? { rebuiltContext } : {}),
    recentValuableTurns
  });
}

export function extractArtifactResourceIds(value: unknown): string[] {
  const ids = new Set<string>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.resourceId === "string") ids.add(record.resourceId);
    if (record.attrs && typeof record.attrs === "object") {
      const attrs = record.attrs as Record<string, unknown>;
      if (typeof attrs.resourceId === "string") ids.add(attrs.resourceId);
    }
    for (const value of Object.values(record)) visit(value);
  };
  visit(value);
  return [...ids];
}

export function buildResourceContext(input: {
  currentResourceIds: string[];
  inheritedResourceIds: string[];
  artifactResourceIds: string[];
  currentMaterialSummary: ConversationResourceContext["materialSummary"];
  previousMemory: ConversationWorkingMemory;
  creationMode: Exclude<CreationMode, "auto">;
}): ConversationResourceContext {
  const inheritedResourceIds = input.creationMode === "new" ? [] : input.inheritedResourceIds;
  const artifactResourceIds = input.creationMode === "revise" ? input.artifactResourceIds : [];
  const allowedResourceIds = new Set([
    ...input.currentResourceIds,
    ...inheritedResourceIds,
    ...artifactResourceIds
  ]);
  const previousSummary = input.previousMemory.resourceContext?.materialSummary
    ?? input.previousMemory.materialSummary
    ?? [];
  const summaryById = new Map<string, ConversationMaterialSummary & Record<string, unknown>>();
  for (const item of previousSummary) {
    if (allowedResourceIds.has(item.resourceId)) summaryById.set(item.resourceId, item);
  }
  for (const item of input.currentMaterialSummary) {
    if (allowedResourceIds.has(item.resourceId)) summaryById.set(item.resourceId, item);
  }
  return conversationResourceContextSchema.parse({
    currentResourceIds: input.currentResourceIds,
    inheritedResourceIds,
    artifactResourceIds,
    materialSummary: [...summaryById.values()]
  });
}

import type {
  ContentIdentity,
  ConversationWorkingMemory,
  CreateConversationTurnRequest,
  CreationRunContext,
  IntentResolution,
  ResolvedCreationRequest
} from "@mediaforge/contracts";
import { resolvedCreationRequestSchema } from "@mediaforge/contracts";
import type { RebuildUserMessage } from "./context-rebuild";

function clip(value: string, maxLength: number): string {
  return value.trim().replace(/\s+/gu, " ").slice(0, maxLength);
}

function normalizeInstruction(value: string): string {
  return clip(value, 80).replace(/[。！？!?,，；;：:\s]+$/gu, "");
}

export function isThinContinuationInstruction(value: string): boolean {
  const normalized = normalizeInstruction(value);
  if (!normalized) return false;
  return /^(继续|继续任务|继续生成|接着写|往下写|重新生成|重新来|重试|再来一次|再生成|重新生成一下|重新生成吧|再试一次|继续完善)$/u
    .test(normalized);
}

export function isExplicitNewTopicInstruction(value: string): boolean {
  return /新主题|换一个主题|换个主题|不要上面的|不用上面的|另写一篇|从头写|重新生成一篇|重新写一篇/u.test(value);
}

function isRevisionInstruction(value: string): boolean {
  return /改|调整|优化|换个标题|标题|语气|风格|加上|删除|删掉|补充|重写|更自然|更吸引/u.test(value);
}

function isSelfContainedCreationInstruction(value: string): boolean {
  const hasCreationGoal = /写一篇|生成(?:一篇|一个)?|创作(?:一篇|一个)?|公众号(?:文章|文案)|文案/u.test(value);
  const referencesExisting = /上一版|上一个版本|上文|这篇|这版|刚才|原文|第[一二三四五六七八九十\d]+(?:段|章|节)/u.test(value);
  return hasCreationGoal && !referencesExisting && value.trim().length >= 16;
}

function isStyleOnlyRevision(value: string): boolean {
  return /风格|语气|口吻|视觉|颜色|色彩|排版|版式|装饰|呈现/u.test(value)
    && !/主题|改成.{2,}(?:主题|故事|活动|品牌)|新增事实|补充内容/u.test(value);
}

function isExplicitContinuation(value: string): boolean {
  return /继续|接着|往下|扩写|延展|沿用|补充/u.test(value);
}

function inferMutationScope(value: string): ResolvedCreationRequest["mutationScope"] {
  const scopes = new Set<ResolvedCreationRequest["mutationScope"][number]>();
  if (/标题|题目/u.test(value)) scopes.add("title");
  if (/结构|提纲|章节|段落顺序/u.test(value)) scopes.add("structure");
  if (/图片|配图|封面|素材/u.test(value)) scopes.add("images");
  if (/语气|风格|口吻|视觉|颜色|色彩|排版|版式|装饰|呈现/u.test(value)) scopes.add("presentation");
  if (/正文|内容|第[一二三四五六七八九十\d]+段|加上|删除|删掉|补充|扩写|重写/u.test(value)) scopes.add("content");
  return [...scopes];
}

function emptyContentIdentity(topicSummary: string): ContentIdentity {
  return {
    topicSummary: clip(topicSummary, 300) || "待确认的创作主题",
    namedEntities: [],
    requiredFacts: [],
    requiredClaims: [],
    mustIncludeVerbatim: [],
    prohibitedClaims: []
  };
}

function currentContentIdentity(currentInstruction: string): ContentIdentity {
  const firstLine = currentInstruction
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  return emptyContentIdentity(firstLine ?? currentInstruction);
}

function inheritedContentIdentity(memory: ConversationWorkingMemory, currentInstruction: string): ContentIdentity {
  return memory.successfulBaseline?.contentIdentity
    ?? memory.brief?.contentIdentity
    ?? emptyContentIdentity(
      memory.brief?.creativeTheme
      ?? memory.brief?.subject
      ?? memory.instructionMemory.rebuiltContext?.taskGoal
      ?? currentInstruction
    );
}

function buildResolvedRequest(input: {
  operation: ResolvedCreationRequest["operation"];
  decisionSource: ResolvedCreationRequest["decisionSource"];
  confidence: ResolvedCreationRequest["confidence"];
  currentInstruction: string;
  memory: ConversationWorkingMemory;
  currentMessageId?: string;
  mutationScope?: ResolvedCreationRequest["mutationScope"];
  clarification?: ResolvedCreationRequest["clarification"];
}): ResolvedCreationRequest {
  const isNew = input.operation === "new";
  const isContinue = input.operation === "continue";
  const baseArtifactId = input.operation === "revise" ? input.memory.lastArtifactId : undefined;
  const mutationScope = input.mutationScope
    ?? (isNew ? ["content", "title", "structure", "images", "presentation"] : []);
  const contentIdentity = isNew
    ? currentContentIdentity(input.currentInstruction)
    : inheritedContentIdentity(input.memory, input.currentInstruction);
  const provenance: ResolvedCreationRequest["provenance"] = [{
    field: "currentInstruction",
    source: "current_turn",
    sourceId: input.currentMessageId ?? `turn:${input.memory.contextVersion}`
  }, {
    field: "contentIdentity.topicSummary",
    source: isNew ? "current_turn" : "working_memory",
    sourceId: isNew
      ? input.currentMessageId ?? `turn:${input.memory.contextVersion}`
      : input.memory.lastArtifactId ?? `memory:${input.memory.contextVersion}`
  }];

  return resolvedCreationRequestSchema.parse({
    schemaVersion: 2,
    operation: input.operation,
    decisionSource: input.decisionSource,
    confidence: input.confidence,
    currentInstruction: input.currentInstruction,
    baseArtifactId,
    mutationScope,
    inheritance: {
      content: isNew ? "replace" : isContinue ? "extend" : "preserve",
      presentation: isNew || mutationScope.includes("presentation") ? "replace" : "preserve",
      resources: isNew ? "current_only" : input.operation === "revise" ? "artifact_used" : "explicit"
    },
    contentIdentity,
    provenance,
    clarification: input.clarification
  });
}

export function resolveCanonicalCreationRequest(input: {
  requestedCreationMode: CreateConversationTurnRequest["creationMode"];
  currentInstruction: string;
  currentResourceIds: string[];
  memory: ConversationWorkingMemory;
  userMessages: RebuildUserMessage[];
}): ResolvedCreationRequest {
  const currentInstruction = clip(input.currentInstruction, 4000);
  const currentMessageId = input.userMessages.at(-1)?.id;
  const hasHistoricalTask = Boolean(
    input.memory.lastArtifactId
    || input.memory.successfulBaseline
    || input.memory.brief
    || input.memory.draftSummary
    || input.memory.instructionMemory.rebuiltContext
    || input.userMessages.length > 1
  );

  if (
    /^(重试|重新试一次|再试一次|重新生成|再生成一次)[。！!\s]*$/u.test(currentInstruction)
    && input.memory.lastAttempt?.status === "failed"
    && input.memory.lastAttempt.resolvedRequest
  ) {
    return resolvedCreationRequestSchema.parse({
      ...input.memory.lastAttempt.resolvedRequest,
      decisionSource: "user",
      confidence: "high"
    });
  }

  if (input.requestedCreationMode === "new") {
    return buildResolvedRequest({
      operation: "new",
      decisionSource: "user",
      confidence: "high",
      currentInstruction,
      currentMessageId,
      memory: input.memory
    });
  }
  if (input.requestedCreationMode === "revise") {
    if (!input.memory.lastArtifactId) {
      return buildResolvedRequest({
        operation: "clarify",
        decisionSource: "user",
        confidence: "low",
        currentInstruction,
        currentMessageId,
        memory: input.memory,
        clarification: {
          reasonCode: "REVISION_BASE_MISSING",
          question: "当前没有可修改的成功版本。需要按这条要求重新创作吗？"
        }
      });
    }
    return buildResolvedRequest({
      operation: "revise",
      decisionSource: "user",
      confidence: "high",
      currentInstruction,
      currentMessageId,
      memory: input.memory,
      mutationScope: inferMutationScope(currentInstruction).length > 0
        ? inferMutationScope(currentInstruction)
        : ["content", "title", "structure", "images", "presentation"]
    });
  }
  if (input.requestedCreationMode === "continue") {
    return buildResolvedRequest({
      operation: hasHistoricalTask ? "continue" : "clarify",
      decisionSource: "user",
      confidence: hasHistoricalTask ? "high" : "low",
      currentInstruction,
      currentMessageId,
      memory: input.memory,
      mutationScope: hasHistoricalTask ? ["content"] : [],
      clarification: hasHistoricalTask ? undefined : {
        reasonCode: "CONTINUATION_BASE_MISSING",
        question: "当前没有可继续的创作内容。请提供要创作的主题和主要素材。"
      }
    });
  }

  if (!hasHistoricalTask || isExplicitNewTopicInstruction(currentInstruction) || isSelfContainedCreationInstruction(currentInstruction)) {
    return buildResolvedRequest({
      operation: "new",
      decisionSource: "rule",
      confidence: hasHistoricalTask ? "medium" : "high",
      currentInstruction,
      currentMessageId,
      memory: input.memory
    });
  }
  if (isThinContinuationInstruction(currentInstruction) || isExplicitContinuation(currentInstruction)) {
    return buildResolvedRequest({
      operation: "continue",
      decisionSource: "rule",
      confidence: "high",
      currentInstruction,
      currentMessageId,
      memory: input.memory,
      mutationScope: ["content"]
    });
  }
  const mutationScope = inferMutationScope(currentInstruction);
  if (input.memory.lastArtifactId && (isRevisionInstruction(currentInstruction) || isStyleOnlyRevision(currentInstruction))) {
    return buildResolvedRequest({
      operation: "revise",
      decisionSource: "rule",
      confidence: isStyleOnlyRevision(currentInstruction) ? "high" : "medium",
      currentInstruction,
      currentMessageId,
      memory: input.memory,
      mutationScope: mutationScope.length > 0 ? mutationScope : ["content"]
    });
  }

  return buildResolvedRequest({
    operation: "clarify",
    decisionSource: "rule",
    confidence: "low",
    currentInstruction,
    currentMessageId,
    memory: input.memory,
    clarification: {
      reasonCode: "CREATION_INTENT_AMBIGUOUS",
      question: "这次是要基于上一版继续修改，还是按当前提示重新创作一篇？"
    }
  });
}

export function isValuableUserInstruction(value: string): boolean {
  const normalized = normalizeInstruction(value);
  if (!normalized) return false;
  if (isThinContinuationInstruction(normalized)) return false;
  return !/^(好的|好|嗯|可以|开始|下一步)$/u.test(normalized);
}

function historicalMessages(messages: RebuildUserMessage[]): RebuildUserMessage[] {
  return messages.slice(0, Math.max(0, messages.length - 1));
}

function inheritedMessages(messages: RebuildUserMessage[]): RebuildUserMessage[] {
  return historicalMessages(messages)
    .map((message) => ({ ...message, content: message.content.trim() }))
    .filter((message) => isValuableUserInstruction(message.content))
    .slice(-2);
}

function historicalInstruction(memory: ConversationWorkingMemory, inherited: RebuildUserMessage[]): string | undefined {
  const rebuilt = memory.instructionMemory.rebuiltContext;
  const fromMemory = [
    rebuilt?.taskGoal ? `任务目标：${rebuilt.taskGoal}` : "",
    rebuilt?.sourceRequest ? `原始需求：${rebuilt.sourceRequest}` : "",
    rebuilt?.audience ? `目标读者：${rebuilt.audience}` : "",
    ...(rebuilt?.contentRequirements ?? []).map((item) => `内容要求：${item}`),
    ...(rebuilt?.styleConstraints ?? []).map((item) => `风格约束：${item}`)
  ].filter(Boolean).join("\n");
  const fromMessages = inherited.map((message) => message.content).join("\n\n");
  const combined = [fromMemory, fromMessages].filter(Boolean).join("\n\n");
  return combined ? clip(combined, 6000) : undefined;
}

function explicitModeResolution(
  requested: Exclude<CreateConversationTurnRequest["creationMode"], "auto">,
  currentInstruction: string,
  inherited: RebuildUserMessage[],
  memory: ConversationWorkingMemory
): IntentResolution {
  const sameTopic = requested !== "new";
  return {
    mode: requested,
    sameTopic,
    confidence: "high",
    effectiveInstruction: currentInstruction,
    inheritedMessageIds: sameTopic ? inherited.map((message) => message.id) : [],
    reason: `用户显式选择 creationMode=${requested}`
  };
}

export function resolveConversationIntent(input: {
  requestedCreationMode: CreateConversationTurnRequest["creationMode"];
  currentInstruction: string;
  currentResourceIds: string[];
  memory: ConversationWorkingMemory;
  userMessages: RebuildUserMessage[];
}): IntentResolution {
  const currentInstruction = clip(input.currentInstruction, 4000);
  const inherited = inheritedMessages(input.userMessages);
  const history = historicalInstruction(input.memory, inherited);
  const hasHistoricalTask = Boolean(history || input.memory.brief || input.memory.draftSummary);

  if (input.requestedCreationMode !== "auto") {
    return explicitModeResolution(input.requestedCreationMode, currentInstruction, inherited, input.memory);
  }

  if (isExplicitNewTopicInstruction(currentInstruction)) {
    return {
      mode: "new",
      sameTopic: false,
      confidence: "high",
      effectiveInstruction: currentInstruction,
      inheritedMessageIds: [],
      reason: "用户明确表达新主题或不沿用上文"
    };
  }

  if (isThinContinuationInstruction(currentInstruction)) {
    if (!hasHistoricalTask) {
      return {
        mode: "clarify",
        sameTopic: true,
        confidence: "low",
        effectiveInstruction: currentInstruction,
        inheritedMessageIds: [],
        reason: "短指令没有可继承的历史创作需求"
      };
    }
    const mode: IntentResolution["mode"] = input.memory.lastArtifactId && isRevisionInstruction(currentInstruction)
      ? "revise"
      : "continue";
    return {
      mode,
      sameTopic: true,
      confidence: "high",
      effectiveInstruction: currentInstruction,
      inheritedMessageIds: inherited.map((message) => message.id),
      reason: "同一会话内短指令默认继承历史主题"
    };
  }

  if (!hasHistoricalTask) {
    return {
      mode: "new",
      sameTopic: false,
      confidence: "medium",
      effectiveInstruction: currentInstruction,
      inheritedMessageIds: [],
      reason: "当前会话没有可继承的历史创作需求"
    };
  }

  if (currentInstruction.length >= 80 && input.currentResourceIds.length > 0) {
    return {
      mode: "new",
      sameTopic: false,
      confidence: "medium",
      effectiveInstruction: currentInstruction,
      inheritedMessageIds: [],
      reason: "当前输入较完整且包含本轮新资源，规则兜底判定为新创作"
    };
  }

  const mode: CreationRunContext["creationMode"] = input.memory.lastArtifactId && isRevisionInstruction(currentInstruction)
    ? "revise"
    : "continue";
  return {
    mode,
    sameTopic: true,
    confidence: "medium",
    effectiveInstruction: currentInstruction,
    inheritedMessageIds: inherited.map((message) => message.id),
    reason: "同一会话默认延续历史主题"
  };
}

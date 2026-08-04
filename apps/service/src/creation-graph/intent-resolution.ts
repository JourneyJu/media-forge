import type {
  ConversationWorkingMemory,
  CreateConversationTurnRequest,
  CreationRunContext,
  IntentResolution
} from "@mediaforge/contracts";
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
  const history = sameTopic ? historicalInstruction(memory, inherited) : undefined;
  return {
    mode: requested,
    sameTopic,
    confidence: "high",
    effectiveInstruction: clip(history ? `${history}\n\n本轮指令：${currentInstruction}` : currentInstruction, 8000),
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
      effectiveInstruction: clip(`${history ?? ""}\n\n本轮指令：${currentInstruction}`, 8000),
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
    effectiveInstruction: clip(`${history ?? ""}\n\n本轮指令：${currentInstruction}`, 8000),
    inheritedMessageIds: inherited.map((message) => message.id),
    reason: "同一会话默认延续历史主题"
  };
}

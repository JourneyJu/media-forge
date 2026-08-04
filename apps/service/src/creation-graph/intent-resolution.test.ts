import type { ConversationWorkingMemory } from "@mediaforge/contracts";
import { describe, expect, it } from "vitest";
import {
  isThinContinuationInstruction,
  resolveConversationIntent
} from "./intent-resolution";

const emptyMemory: ConversationWorkingMemory = {
  conversationId: "conversation_1",
  contextVersion: 1,
  instructionMemory: {
    recentValuableTurns: []
  },
  resourceContext: {
    currentResourceIds: [],
    inheritedResourceIds: [],
    artifactResourceIds: [],
    materialSummary: []
  },
  materialSummary: [],
  userConstraints: [],
  updatedAt: "2026-08-04T00:00:00.000Z"
};

describe("resolveConversationIntent", () => {
  it("treats regenerate as a thin continuation instruction", () => {
    expect(isThinContinuationInstruction("重新生成")).toBe(true);
    expect(isThinContinuationInstruction("重新生成。")).toBe(true);
  });

  it("inherits the previous topic after a failed run without an artifact", () => {
    const intent = resolveConversationIntent({
      requestedCreationMode: "auto",
      currentInstruction: "重新生成",
      currentResourceIds: [],
      memory: emptyMemory,
      userMessages: [
        {
          id: "message_1",
          content: "金舞艺术的舞蹈《蚊子哪里跑》在小兰花获奖了，请根据这些内容生成公众号文章。"
        },
        { id: "message_2", content: "重新生成" }
      ]
    });

    expect(intent.mode).toBe("continue");
    expect(intent.sameTopic).toBe(true);
    expect(intent.inheritedMessageIds).toEqual(["message_1"]);
    expect(intent.effectiveInstruction).toContain("蚊子哪里跑");
    expect(intent.effectiveInstruction).toContain("本轮指令：重新生成");
  });

  it("starts a new topic only when the user explicitly asks for it", () => {
    const intent = resolveConversationIntent({
      requestedCreationMode: "auto",
      currentInstruction: "新主题：写一篇暑期招生公众号文章",
      currentResourceIds: [],
      memory: {
        ...emptyMemory,
        instructionMemory: {
          recentValuableTurns: [{
            messageId: "message_1",
            content: "金舞艺术获奖公众号文章",
            reason: "历史主题"
          }]
        }
      },
      userMessages: [
        { id: "message_1", content: "金舞艺术获奖公众号文章" },
        { id: "message_2", content: "新主题：写一篇暑期招生公众号文章" }
      ]
    });

    expect(intent.mode).toBe("new");
    expect(intent.sameTopic).toBe(false);
    expect(intent.inheritedMessageIds).toEqual([]);
  });

  it("asks for clarification when a thin instruction has no history", () => {
    const intent = resolveConversationIntent({
      requestedCreationMode: "auto",
      currentInstruction: "继续",
      currentResourceIds: [],
      memory: emptyMemory,
      userMessages: [{ id: "message_1", content: "继续" }]
    });

    expect(intent.mode).toBe("clarify");
    expect(intent.confidence).toBe("low");
  });
});

import type { ConversationWorkingMemory } from "@mediaforge/contracts";
import { describe, expect, it } from "vitest";
import {
  isThinContinuationInstruction,
  resolveCanonicalCreationRequest,
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
    expect(intent.effectiveInstruction).toBe("重新生成");
  });

  it("treats a self-contained replacement prompt as a new creation without magic words", () => {
    const request = resolveCanonicalCreationRequest({
      requestedCreationMode: "auto",
      currentInstruction: "请写一篇面向年轻父母的夏日亲子阅读公众号文章，语气轻松自然。",
      currentResourceIds: [],
      memory: {
        ...emptyMemory,
        lastArtifactId: "artifact_old",
        brief: {
          subject: "旧的舞蹈获奖主题",
          goal: "event",
          audience: "家长",
          contentType: "活动报道",
          tone: "warm",
          storyAngle: "获奖故事",
          materialRequirements: [],
          resourceIds: [],
          constraints: [],
          prohibitedContent: [],
          skillId: "auto"
        }
      },
      userMessages: [
        { id: "message_1", content: "写一篇舞蹈获奖文章" },
        { id: "message_2", content: "请写一篇面向年轻父母的夏日亲子阅读公众号文章，语气轻松自然。" }
      ]
    });

    expect(request.operation).toBe("new");
    expect(request.baseArtifactId).toBeUndefined();
    expect(request.inheritance).toEqual({
      content: "replace",
      presentation: "replace",
      resources: "current_only"
    });
  });

  it("maps a style-only request to a presentation revision", () => {
    const request = resolveCanonicalCreationRequest({
      requestedCreationMode: "auto",
      currentInstruction: "换种风格重新实现",
      currentResourceIds: [],
      memory: {
        ...emptyMemory,
        lastArtifactId: "artifact_1",
        brief: {
          subject: "慢下来，才能看见的东西",
          goal: "story",
          audience: "公众号读者",
          contentType: "个人感悟",
          tone: "warm",
          storyAngle: "术后慢行",
          materialRequirements: [],
          resourceIds: [],
          constraints: [],
          prohibitedContent: [],
          skillId: "auto"
        }
      },
      userMessages: [
        { id: "message_1", content: "写一篇术后慢行的个人感悟" },
        { id: "message_2", content: "换种风格重新实现" }
      ]
    });

    expect(request.operation).toBe("revise");
    expect(request.mutationScope).toEqual(["presentation"]);
    expect(request.baseArtifactId).toBe("artifact_1");
    expect(request.contentIdentity.topicSummary).toBe("慢下来，才能看见的东西");
  });

  it("clarifies an ambiguous request instead of inheriting silently", () => {
    const request = resolveCanonicalCreationRequest({
      requestedCreationMode: "auto",
      currentInstruction: "做得更好一点",
      currentResourceIds: [],
      memory: { ...emptyMemory, lastArtifactId: "artifact_1" },
      userMessages: [
        { id: "message_1", content: "写一篇文章" },
        { id: "message_2", content: "做得更好一点" }
      ]
    });

    expect(request.operation).toBe("clarify");
    expect(request.clarification?.reasonCode).toBe("CREATION_INTENT_AMBIGUOUS");
  });

  it("reuses the frozen failed request when the user retries", () => {
    const frozen = resolveCanonicalCreationRequest({
      requestedCreationMode: "new",
      currentInstruction: "写一篇夏日亲子阅读公众号文章",
      currentResourceIds: [],
      memory: emptyMemory,
      userMessages: [{ id: "message_1", content: "写一篇夏日亲子阅读公众号文章" }]
    });
    const request = resolveCanonicalCreationRequest({
      requestedCreationMode: "auto",
      currentInstruction: "重试",
      currentResourceIds: [],
      memory: {
        ...emptyMemory,
        lastAttempt: {
          runId: "run_failed",
          operation: "new",
          mutationScope: frozen.mutationScope,
          status: "failed",
          resolvedRequest: frozen,
          failure: {
            code: "MODEL_PROVIDER_UNAVAILABLE",
            stage: "writer",
            category: "provider",
            recoverability: "retry_same",
            summary: "模型暂时不可用。",
            violations: []
          },
          updatedAt: "2026-08-27T00:00:00.000Z"
        }
      },
      userMessages: [
        { id: "message_1", content: "写一篇夏日亲子阅读公众号文章" },
        { id: "message_2", content: "重试" }
      ]
    });

    expect(request.operation).toBe("new");
    expect(request.currentInstruction).toBe("写一篇夏日亲子阅读公众号文章");
    expect(request.contentIdentity).toEqual(frozen.contentIdentity);
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

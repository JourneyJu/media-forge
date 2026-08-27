import type { ConversationWorkingMemory } from "@mediaforge/contracts";
import { describe, expect, it } from "vitest";
import { assembleCreationRunContext } from "./creation-context-assembler";

const memory: ConversationWorkingMemory = {
  conversationId: "conversation_1",
  contextVersion: 2,
  instructionMemory: {
    rebuiltContext: {
      taskGoal: "旧的舞蹈获奖文章",
      sourceRequest: "写一篇舞蹈获奖公众号文章",
      styleConstraints: [],
      contentRequirements: [],
      prohibitedContent: [],
      unresolvedQuestions: [],
      confidence: "medium"
    },
    recentValuableTurns: []
  },
  brief: {
    subject: "旧的舞蹈获奖文章",
    goal: "event",
    audience: "家长",
    contentType: "活动报道",
    tone: "warm",
    storyAngle: "获奖故事",
    materialRequirements: [],
    resourceIds: ["old_image"],
    constraints: [],
    prohibitedContent: [],
    skillId: "auto"
  },
  resourceContext: {
    currentResourceIds: [],
    inheritedResourceIds: ["old_image"],
    artifactResourceIds: ["old_image"],
    materialSummary: [{
      resourceId: "old_image",
      type: "image",
      description: "旧图片"
    }]
  },
  materialSummary: [],
  userConstraints: [],
  lastArtifactId: "artifact_1",
  updatedAt: "2026-08-27T00:00:00.000Z"
};

function baseInput() {
  return {
    conversationId: "conversation_1",
    contextVersion: 3,
    resourceIds: [] as string[],
    skillId: "auto",
    selectedSkills: [],
    maxSteps: 12,
    currentResourceIds: [] as string[],
    inheritedResourceIds: ["old_image"],
    currentMaterialSummary: [],
    artifactResourceIds: ["old_image"],
    memory,
    now: "2026-08-27T01:00:00.000Z"
  };
}

describe("assembleCreationRunContext", () => {
  it("isolates an explicit new creation from old memory and resources", () => {
    const userInput = "写一篇夏日亲子阅读公众号文章，面向年轻父母。";
    const context = assembleCreationRunContext({
      ...baseInput(),
      userInput,
      requestedCreationMode: "new",
      userMessages: [
        { id: "message_1", content: "写一篇舞蹈获奖文章" },
        { id: "message_2", content: userInput }
      ],
      v2Mode: "explicit"
    });

    expect(context.schemaVersion).toBe(2);
    expect(context.creationMode).toBe("new");
    expect(context.resolvedRequest?.operation).toBe("new");
    expect(context.resourceIds).toEqual([]);
    expect(context.memory.brief).toBeUndefined();
    expect(context.memory.lastArtifactId).toBeUndefined();
    expect(context.memory.instructionMemory.recentValuableTurns).toEqual([]);
  });

  it("maps an explicit style revision to presentation without duplicating the current instruction", () => {
    const userInput = "换种风格重新实现";
    const context = assembleCreationRunContext({
      ...baseInput(),
      userInput,
      requestedCreationMode: "revise",
      userMessages: [
        { id: "message_1", content: "写一篇舞蹈获奖文章" },
        { id: "message_2", content: userInput }
      ],
      v2Mode: "explicit"
    });

    expect(context.resolvedRequest?.mutationScope).toEqual(["presentation"]);
    expect(context.memory.revisionIntent?.target).toBe("style");
    expect(context.resourceIds).toEqual(["old_image"]);
    expect(context.memory.instructionMemory.recentValuableTurns.map((turn) => turn.content)).not.toContain(userInput);
    expect(context.currentInstruction).toBe(userInput);
  });

  it("keeps Auto execution on V1 while exposing a zero-write shadow decision", () => {
    const userInput = "请写一篇面向年轻父母的夏日亲子阅读公众号文章，语气轻松自然。";
    const context = assembleCreationRunContext({
      ...baseInput(),
      userInput,
      requestedCreationMode: "auto",
      userMessages: [
        { id: "message_1", content: "写一篇舞蹈获奖文章" },
        { id: "message_2", content: userInput }
      ],
      v2Mode: "shadow"
    });

    expect(context.schemaVersion).toBeUndefined();
    expect(context.resolvedRequest?.operation).toBe("new");
    expect(context.creationMode).toBe("revise");
    expect(context.memory.brief?.subject).toBe("旧的舞蹈获奖文章");
  });
});

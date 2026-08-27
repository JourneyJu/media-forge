import type { ConversationWorkingMemory, CreationRunContext } from "@mediaforge/contracts";
import { describe, expect, it } from "vitest";
import { memoryFromFailedRun, mergeClarificationIntoRunContext } from "./persistence";

const context: CreationRunContext = {
  userInput: "请为儿童舞蹈获奖重新生成公众号文章",
  currentInstruction: "请为儿童舞蹈获奖重新生成公众号文章",
  creationMode: "new",
  resourceIds: [],
  currentResourceIds: [],
  inheritedResourceIds: [],
  skillId: "auto",
  selectedSkills: [],
  maxSteps: 12,
  contextVersion: 1,
  memory: {
    instructionMemory: {
      recentValuableTurns: [{
        messageId: "message_1",
        content: "请为儿童舞蹈获奖重新生成公众号文章",
        reason: "包含创作主题"
      }]
    },
    resourceContext: {
      currentResourceIds: [],
      inheritedResourceIds: [],
      artifactResourceIds: [],
      materialSummary: []
    },
    materialSummary: [],
    userConstraints: []
  }
};

describe("mergeClarificationIntoRunContext", () => {
  it("uses the original request and clarification as the resumed instruction", () => {
    const result = mergeClarificationIntoRunContext(context, [
      { questionId: "audience", value: "儿童家长" }
    ]);

    expect(result.userInput).toContain("请为儿童舞蹈获奖重新生成公众号文章");
    expect(result.userInput).toContain("audience: 儿童家长");
    expect(result.currentInstruction).toBe(result.userInput);
    expect(result.memory.userConstraints).toContain("audience: 儿童家长");
  });
  it("adds clarification resources to the resumed run context", () => {
    const result = mergeClarificationIntoRunContext(context, [
      { questionId: "audience", value: "parent" }
    ], [{
      id: "image_1",
      uploadSessionId: "upload_1",
      conversationId: "conversation_1",
      status: "attached",
      source: "upload",
      originalName: "dance.jpg",
      contentType: "image/jpeg",
      sizeBytes: 1024,
      previewUrl: "/resources/image_1/preview",
      contentUrl: "/resources/image_1/content",
      createdAt: new Date("2026-08-04T00:00:00.000Z").toISOString()
    }]);

    expect(result.resourceIds).toContain("image_1");
    expect(result.currentResourceIds).toContain("image_1");
    expect(result.resourceContext.materialSummary[0]?.resourceId).toBe("image_1");
    expect(result.memory.resourceContext.currentResourceIds).toContain("image_1");
    expect(result.memory.materialSummary[0]?.type).toBe("image");
  });
});

describe("failed run memory", () => {
  it("records the failed attempt without replacing the successful baseline", () => {
    const previous: ConversationWorkingMemory = {
      conversationId: "conversation_1",
      contextVersion: 1,
      instructionMemory: { recentValuableTurns: [] },
      resourceContext: {
        currentResourceIds: [],
        inheritedResourceIds: [],
        artifactResourceIds: [],
        materialSummary: []
      },
      materialSummary: [],
      userConstraints: [],
      successfulBaseline: {
        artifactId: "artifact_success",
        contentIdentity: {
          topicSummary: "原有成功主题",
          namedEntities: [],
          requiredFacts: [],
          requiredClaims: [],
          mustIncludeVerbatim: [],
          prohibitedClaims: []
        },
        sectionIds: [],
        imageSemanticRefs: [],
        updatedAt: "2026-08-27T00:00:00.000Z"
      },
      lastArtifactId: "artifact_success",
      updatedAt: "2026-08-27T00:00:00.000Z"
    };
    const next = memoryFromFailedRun("conversation_1", 2, previous, {
      runId: "run_failed",
      operation: "revise",
      mutationScope: ["presentation"],
      failure: {
        code: "CREATION_INTEGRITY_FAILED",
        stage: "artifact",
        category: "integrity",
        recoverability: "revise_input",
        summary: "最终内容未通过发布校验。",
        violations: []
      },
      updatedAt: "2026-08-27T01:00:00.000Z"
    });

    expect(next.successfulBaseline?.artifactId).toBe("artifact_success");
    expect(next.lastArtifactId).toBe("artifact_success");
    expect(next.lastAttempt).toMatchObject({
      runId: "run_failed",
      status: "failed",
      mutationScope: ["presentation"]
    });
  });
});

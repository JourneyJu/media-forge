import type { CreationRunContext } from "@mediaforge/contracts";
import { describe, expect, it } from "vitest";
import { mergeClarificationIntoRunContext } from "./persistence";

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
});

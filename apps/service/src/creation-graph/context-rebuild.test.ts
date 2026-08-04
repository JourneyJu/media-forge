import { describe, expect, it } from "vitest";
import {
  buildResourceContext,
  rebuildInstructionMemory
} from "./context-rebuild";

const previousMemory = {
  conversationId: "conversation_1",
  contextVersion: 2,
  instructionMemory: {
    recentValuableTurns: []
  },
  resourceContext: {
    currentResourceIds: [],
    inheritedResourceIds: [],
    artifactResourceIds: [],
    materialSummary: [{
      resourceId: "old_image",
      type: "image" as const,
      description: "旧主题图片"
    }, {
      resourceId: "used_image",
      type: "image" as const,
      description: "上一版文章使用的图片"
    }]
  },
  materialSummary: [],
  userConstraints: [],
  updatedAt: "2026-08-04T00:00:00.000Z"
};

describe("context rebuild fallback", () => {
  it("keeps recent valuable turns and ignores thin continue commands", () => {
    const memory = rebuildInstructionMemory([
      { id: "m1", content: "请写一篇小兰花艺术节获奖公众号，面向少儿舞蹈学员家长。" },
      { id: "m2", content: "风格热烈但不要夸张，重点写孩子成长和老师陪伴。" },
      { id: "m3", content: "继续任务" }
    ], "continue");

    expect(memory.recentValuableTurns.map((turn) => turn.messageId)).toEqual(["m1", "m2"]);
    expect(memory.rebuiltContext?.sourceRequest).toContain("小兰花艺术节");
    expect(memory.rebuiltContext?.styleConstraints).toContain("风格热烈但不要夸张，重点写孩子成长和老师陪伴。");
  });

  it("does not let regenerate replace the previous valuable request", () => {
    const memory = rebuildInstructionMemory([
      {
        id: "m1",
        content: "金舞艺术的舞蹈《蚊子哪里跑》在小兰花获奖了，请生成公众号文章，风格自然去 AI 味。"
      },
      { id: "m2", content: "重新生成" }
    ], "continue");

    expect(memory.recentValuableTurns.map((turn) => turn.messageId)).toEqual(["m1"]);
    expect(memory.rebuiltContext?.sourceRequest).toContain("蚊子哪里跑");
    expect(memory.rebuiltContext?.sourceRequest).not.toBe("重新生成");
  });

  it("does not inherit historical resources for a new creation", () => {
    const context = buildResourceContext({
      currentResourceIds: ["new_image"],
      inheritedResourceIds: ["old_image"],
      artifactResourceIds: ["used_image"],
      currentMaterialSummary: [{
        resourceId: "new_image",
        type: "image",
        description: "新主题图片"
      }],
      previousMemory,
      creationMode: "new"
    });

    expect(context.currentResourceIds).toEqual(["new_image"]);
    expect(context.inheritedResourceIds).toEqual([]);
    expect(context.artifactResourceIds).toEqual([]);
    expect(context.materialSummary.map((item) => item.resourceId)).toEqual(["new_image"]);
  });

  it("allows artifact resources for revise without inheriting every old resource", () => {
    const context = buildResourceContext({
      currentResourceIds: [],
      inheritedResourceIds: [],
      artifactResourceIds: ["used_image"],
      currentMaterialSummary: [],
      previousMemory,
      creationMode: "revise"
    });

    expect(context.artifactResourceIds).toEqual(["used_image"]);
    expect(context.materialSummary.map((item) => item.resourceId)).toEqual(["used_image"]);
    expect(context.materialSummary.map((item) => item.resourceId)).not.toContain("old_image");
  });
});

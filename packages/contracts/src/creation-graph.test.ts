import { describe, expect, it } from "vitest";
import {
  creationRunJobSchema,
  creationRunContextSchema,
  conversationWorkingMemorySchema,
  creativeBriefSchema,
  intentResolutionSchema,
  titleCandidatesSchema
} from "./creation-graph";

describe("creation graph contracts", () => {
  it("keeps the queue payload limited to identifiers and versions", () => {
    const job = creationRunJobSchema.parse({
      runId: "run_1",
      conversationId: "conversation_1",
      workspaceId: "workspace_1",
      contextVersion: 1,
      graphName: "wechat_article_creation",
      graphVersion: "2026-08-03"
    });

    expect(job.contextVersion).toBe(1);
    expect(job).not.toHaveProperty("userInput");
  });

  it("separates a short subject from the original user instruction", () => {
    const brief = creativeBriefSchema.parse({
      subject: "儿童摄影团队品牌宣传",
      goal: "brand",
      audience: "儿童家长",
      contentType: "品牌故事",
      campaignObject: "摄影团队",
      tone: "warm",
      storyAngle: "从孩子成长瞬间切入",
      materialRequirements: ["按三种摄影风格分类"],
      resourceIds: [],
      constraints: ["语言自然"],
      prohibitedContent: ["不要出现 AI 过程"],
      skillId: "auto"
    });

    expect(brief.subject).toBe("儿童摄影团队品牌宣传");
  });

  it("requires the selected title to reference a candidate", () => {
    const items = ["a", "b", "c"].map((id) => ({
      id,
      title: `标题 ${id}`,
      angle: "故事",
      audienceFit: 90,
      brandFit: 88,
      clickPotential: 85,
      riskFlags: []
    }));

    expect(() => titleCandidatesSchema.parse({
      items,
      selectedId: "missing",
      selectionReason: "综合评分最高"
    })).toThrow();
  });

  it("defaults missing run context memory for older graph runs", () => {
    const context = creationRunContextSchema.parse({
      userInput: "写一篇公众号文章，介绍本周活动。",
      resourceIds: [],
      currentInstruction: "写一篇公众号文章，介绍本周活动。",
      skillId: "auto",
      maxSteps: 12
    });

    expect(context.memory.materialSummary).toEqual([]);
    expect(context.memory.userConstraints).toEqual([]);
    expect(context.memory.instructionMemory.recentValuableTurns).toEqual([]);
    expect(context.memory.resourceContext.materialSummary).toEqual([]);
    expect(context.creationMode).toBe("new");
    expect(context.currentResourceIds).toEqual([]);
    expect(context.intentResolution).toBeUndefined();
  });

  it("validates intent resolution for same-topic continuation", () => {
    const intent = intentResolutionSchema.parse({
      mode: "continue",
      sameTopic: true,
      confidence: "high",
      effectiveInstruction: "围绕小兰花获奖公众号文章重新生成。本轮指令：重新生成",
      inheritedMessageIds: ["message_1"],
      reason: "同一会话内短指令默认继承上一轮创作主题"
    });

    expect(intent.mode).toBe("continue");
    expect(intent.sameTopic).toBe(true);
    expect(intent.inheritedMessageIds).toEqual(["message_1"]);
  });

  it("validates conversation scoped working memory", () => {
    const memory = conversationWorkingMemorySchema.parse({
      conversationId: "conversation_1",
      contextVersion: 2,
      instructionMemory: {
        rebuiltContext: {
          taskGoal: "儿童摄影品牌宣传",
          sourceRequest: "历史需求摘要：儿童摄影品牌宣传。",
          audience: "儿童家长",
          styleConstraints: ["语气温暖"],
          contentRequirements: ["继续围绕成长瞬间扩写。"],
          prohibitedContent: [],
          unresolvedQuestions: [],
          confidence: "medium"
        },
        recentValuableTurns: [
          { messageId: "message_1", content: "面向儿童家长，语气温暖。", reason: "包含目标读者和风格" },
          { messageId: "message_2", content: "继续围绕成长瞬间扩写。", reason: "包含继续创作方向" }
        ]
      },
      selectedTitle: {
        id: "story",
        title: "把童年留在镜头里",
        angle: "成长故事"
      },
      materialSummary: [{
        resourceId: "resource_1",
        type: "image",
        description: "儿童摄影样片",
        quality: "high"
      }],
      resourceContext: {
        currentResourceIds: ["resource_1"],
        inheritedResourceIds: [],
        artifactResourceIds: [],
        materialSummary: [{
          resourceId: "resource_1",
          type: "image",
          description: "儿童摄影样片",
          quality: "high"
        }]
      },
      userConstraints: ["语气温暖"],
      lastArtifactId: "artifact_1",
      updatedAt: new Date("2026-08-02T00:00:00.000Z").toISOString()
    });

    expect(memory.conversationId).toBe("conversation_1");
    expect(memory.instructionMemory.recentValuableTurns).toHaveLength(2);
    expect(memory.resourceContext.materialSummary[0]?.resourceId).toBe("resource_1");
    expect(memory.lastArtifactId).toBe("artifact_1");
  });
});

import { describe, expect, it } from "vitest";
import {
  creationRunJobSchema,
  creativeBriefSchema,
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
      graphVersion: "2026-07-27"
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
});

import { describe, expect, it } from "vitest";
import type {
  ArticleDraft,
  ArticleOutline,
  ImagePlan,
  TitleCandidates
} from "@mediaforge/contracts";
import { validateArticleArtifact } from "./artifact-builder";

const titles: TitleCandidates = {
  items: [
    { id: "a", title: "把童年留在镜头里", angle: "故事", audienceFit: 95, brandFit: 92, clickPotential: 90, riskFlags: [] },
    { id: "b", title: "孩子长大的瞬间", angle: "共鸣", audienceFit: 94, brandFit: 88, clickPotential: 92, riskFlags: [] },
    { id: "c", title: "好的儿童摄影是什么", angle: "专业", audienceFit: 90, brandFit: 95, clickPotential: 86, riskFlags: [] }
  ],
  selectedId: "a",
  selectionReason: "综合评分最高"
};

const outline: ArticleOutline = {
  title: "把童年留在镜头里",
  openingHook: "从家庭日常切入",
  callToAction: "了解更多案例",
  sections: [
    { title: "第一章", objective: "共鸣", storyBeat: "成长", commercialGoal: "理解价值" },
    { title: "第二章", objective: "专业", storyBeat: "拍摄", commercialGoal: "建立信任" },
    { title: "第三章", objective: "行动", storyBeat: "回忆", commercialGoal: "引导咨询" }
  ]
};

const imagePlan: ImagePlan = {
  items: [{ placement: "cover", description: "自然儿童照片" }]
};

describe("artifact builder guard", () => {
  it("rejects raw instructions and titles outside selected candidates", () => {
    const draft: ArticleDraft = {
      title: "帮我做一个公众号文案，要求如下",
      paragraphs: ["我会先整理计划。", "正文第二段。", "正文第三段。"]
    };

    const result = validateArticleArtifact({
      userInput: "帮我做一个公众号文案，要求如下",
      titles,
      outline,
      draft,
      imagePlan
    });

    expect(result.passed).toBe(false);
    expect(result.violations.map((item) => item.code)).toContain("TITLE_SOURCE_INVALID");
    expect(result.violations.map((item) => item.code)).toContain("PROCESS_COPY_LEAK");
  });

  it("allows a concise topic inside a crafted title but rejects the raw prompt as the title", () => {
    const topic = "多 Agent 流式任务进度";
    const craftedTitles: TitleCandidates = {
      items: [
        {
          id: "topic",
          title: `从一个真实场景，重新认识${topic}`,
          angle: "场景故事",
          audienceFit: 90,
          brandFit: 90,
          clickPotential: 88,
          riskFlags: []
        }
      ],
      selectedId: "topic",
      selectionReason: "对主题进行了标题化表达"
    };
    const draft: ArticleDraft = {
      title: craftedTitles.items[0]!.title,
      paragraphs: ["第一段正文。", "第二段正文。", "第三段正文。"]
    };

    expect(validateArticleArtifact({
      userInput: topic,
      titles: craftedTitles,
      outline: { ...outline, title: draft.title },
      draft,
      imagePlan
    }).passed).toBe(true);

    const rawTitle = {
      ...draft,
      title: topic
    };
    const rawTitles: TitleCandidates = {
      ...craftedTitles,
      items: [{ ...craftedTitles.items[0]!, title: topic }]
    };
    expect(validateArticleArtifact({
      userInput: topic,
      titles: rawTitles,
      outline: { ...outline, title: topic },
      draft: rawTitle,
      imagePlan
    }).violations.map((item) => item.code)).toContain("RAW_PROMPT_AS_TITLE");
  });
});

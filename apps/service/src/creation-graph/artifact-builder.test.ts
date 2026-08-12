import { describe, expect, it } from "vitest";
import type {
  ArticleDraft,
  ArticleOutline,
  ContentPlan,
  CreativeBrief,
  ImagePlan,
  LayoutPlan,
  ResolvedUserSkill,
  TitleCandidates
} from "@mediaforge/contracts";
import { buildArticleDocument, hasSubjectCoverage, validateArticleArtifact } from "./artifact-builder";

const title = "小兰花舞台上的获奖时刻";
const titles: TitleCandidates = {
  items: [
    { id: "a", title, angle: "事件", audienceFit: 95, brandFit: 92, clickPotential: 90, riskFlags: [] },
    { id: "b", title: "一次舞台绽放", angle: "现场", audienceFit: 94, brandFit: 88, clickPotential: 92, riskFlags: [] },
    { id: "c", title: "荣誉背后的成长", angle: "意义", audienceFit: 90, brandFit: 95, clickPotential: 86, riskFlags: [] }
  ],
  selectedId: "a",
  selectionReason: "准确表达本轮主题"
};
const headings = ["获奖消息", "舞台现场", "成长意义"];
const brief: CreativeBrief = {
  subject: "小兰花舞蹈获奖",
  goal: "event",
  audience: "关注舞蹈艺术的读者",
  contentType: "公众号图文",
  tone: "lively",
  storyAngle: "从获奖事实和舞台现场展开",
  materialRequirements: [],
  resourceIds: ["dance_1"],
  constraints: [],
  prohibitedContent: ["旧摄影主题"],
  skillId: "auto"
};
const contentPlan: ContentPlan = {
  angle: "获奖事实",
  narrative: "事实、现场、意义",
  requirements: [],
  sections: headings.map((heading) => ({ heading, purpose: heading, keyPoints: [heading], assetRefs: heading === "舞台现场" ? ["dance_1"] : [] })),
  callToAction: "关注后续演出"
};
const outline: ArticleOutline = {
  title,
  openingHook: "从获奖消息切入",
  callToAction: "关注后续演出",
  sections: headings.map((heading) => ({ title: heading, objective: heading, storyBeat: heading, commercialGoal: "准确表达" }))
};
const imagePlan: ImagePlan = {
  items: [{ placement: "section", description: "舞台合照", resourceId: "dance_1" }]
};
const layoutPlan: LayoutPlan = {
  theme: "celebration",
  palette: { primary: "#C51D5D", accent: "#F2B134", text: "#20252B", surface: "#F7F8F6" },
  titleTreatment: "poster",
  introTreatment: "highlight-panel",
  sectionTreatment: "labelled",
  imageTreatment: "full-width",
  blocks: [{ kind: "title" }, { kind: "intro" }, { kind: "section", sectionIndex: 0 }, { kind: "cta" }]
};
const brandSkill: ResolvedUserSkill = {
  skillId: "skill_1",
  versionId: "version_1",
  name: "金舞艺术品牌风格",
  manifest: {
    manifestVersion: "1.0",
    name: "金舞艺术品牌风格",
    category: "wechat_article_style",
    style: { tone: "热烈" },
    assets: [{ key: "consult_qrcode", type: "qrcode", usage: "文章结尾咨询" }]
  },
  assets: [{ id: "asset_1", key: "consult_qrcode", type: "qrcode", usage: "文章结尾咨询" }]
};

function validDraft(): ArticleDraft {
  return {
    title,
    intro: "小兰花舞蹈获奖的消息，为这次舞台经历留下了清晰注脚。",
    sections: headings.map((heading) => ({
      heading,
      purpose: heading,
      paragraphs: [`围绕${heading}展开具体叙述。`],
      assetRefs: heading === "舞台现场" ? ["dance_1"] : []
    })),
    conclusion: "小兰花舞蹈获奖既是荣誉，也是新的开始。",
    callToAction: "关注后续演出"
  };
}

describe("artifact builder guard", () => {
  it("accepts natural wording while rejecting an unrelated subject", () => {
    const subject = "金舞艺术《蚊子哪里跑》小兰花奖特金奖喜报";
    const article = "《蚊子哪里跑》拿下小兰花奖特金奖。那天，金舞艺术的孩子们捧回了这份荣誉。";

    expect(hasSubjectCoverage(subject, article)).toBe(true);
    expect(hasSubjectCoverage(subject, "一篇关于儿童摄影自然抓拍的文章")).toBe(false);
  });

  it("rejects process copy and titles outside selected candidates", () => {
    const result = validateArticleArtifact({
      userInput: "帮我做一个公众号文案，要求如下",
      brief,
      contentPlan,
      titles,
      outline,
      draft: { ...validDraft(), title: "帮我做一个公众号文案，要求如下", intro: "我会先整理计划。" },
      imagePlan,
      layoutPlan
    });

    expect(result.violations.map((item) => item.code)).toContain("TITLE_SOURCE_INVALID");
    expect(result.violations.map((item) => item.code)).toContain("PROCESS_COPY_LEAK");
  });

  it("builds section and image blocks from the structured draft", () => {
    const result = buildArticleDocument({
      userInput: "为小兰花舞蹈获奖写一篇公众号文章",
      brief,
      contentPlan,
      titles,
      outline,
      draft: validDraft(),
      imagePlan,
      layoutPlan
    });

    expect(result.validation.passed).toBe(true);
    expect(result.document.content.filter((block) => block.type === "heading")).toHaveLength(3);
    expect(result.document.content.find((block) => block.type === "image")?.attrs?.resourceId).toBe("dance_1");
    expect(result.document.attrs.scenario).toBe("celebration");
  });

  it("accepts a polished heading when the stable section identity is unchanged", () => {
    const draft = validDraft();
    draft.sections[0]!.heading = "舞台上的获奖消息";

    const result = buildArticleDocument({
      userInput: "为小兰花舞蹈获奖写一篇公众号文章",
      brief,
      contentPlan,
      titles,
      outline,
      draft,
      imagePlan,
      layoutPlan
    });

    expect(result.validation.passed).toBe(true);
    expect(result.document.content.find((block) => block.type === "heading")?.content?.[0]?.text).toBe("舞台上的获奖消息");
  });

  it("falls back to image plan resources when draft assetRefs are missing", () => {
    const draft = {
      ...validDraft(),
      sections: validDraft().sections.map((section) => ({ ...section, assetRefs: [] }))
    };
    const result = buildArticleDocument({
      userInput: "涓哄皬鍏拌姳鑸炶箞鑾峰鍐欎竴绡囧叕浼楀彿鏂囩珷",
      brief,
      contentPlan,
      titles,
      outline,
      draft,
      imagePlan,
      layoutPlan: {
        ...layoutPlan,
        blocks: [
          ...layoutPlan.blocks,
          { kind: "image", sectionIndex: 1, assetRef: "dance_1" }
        ]
      }
    });

    expect(result.document.content.find((block) => block.type === "image")?.attrs).toMatchObject({
      resourceId: "dance_1",
      sectionIndex: 1
    });
  });

  it("uses image plan sectionIndex instead of a mismatched draft assetRef", () => {
    const result = buildArticleDocument({
      userInput: "涓哄皬鍏拌姳鑸炶箞鑾峰鍐欎竴绡囧叕浼楀彿鏂囩珷",
      brief,
      contentPlan,
      titles,
      outline,
      draft: {
        ...validDraft(),
        sections: validDraft().sections.map((section, index) => ({
          ...section,
          assetRefs: index === 0 ? ["dance_1"] : []
        }))
      },
      imagePlan: {
        items: [{
          placement: "section",
          description: "舞台现场",
          resourceId: "dance_1",
          sectionIndex: 1,
          visualRole: "scene",
          matchReason: "图片与舞台现场章节匹配",
          confidence: 0.9
        }]
      },
      layoutPlan
    });

    expect(result.document.content.find((block) => block.type === "image")?.attrs).toMatchObject({
      resourceId: "dance_1",
      sectionIndex: 1,
      visualRole: "scene",
      confidence: 0.9
    });
  });

  it("places an unused cover image after the intro", () => {
    const result = buildArticleDocument({
      userInput: "涓哄皬鍏拌姳鑸炶箞鑾峰鍐欎竴绡囧叕浼楀彿鏂囩珷",
      brief,
      contentPlan,
      titles,
      outline,
      draft: {
        ...validDraft(),
        sections: validDraft().sections.map((section) => ({ ...section, assetRefs: [] }))
      },
      imagePlan: { items: [{ placement: "cover", description: "cover image", resourceId: "dance_1" }] },
      layoutPlan
    });

    expect(result.document.content[0]?.type).toBe("callout");
    expect(result.document.content[1]?.type).toBe("image");
    expect(result.document.content[1]?.attrs?.resourceId).toBe("dance_1");
  });

  it("resolves a frozen Skill qrcode only into the ending area", () => {
    const result = buildArticleDocument({
      userInput: "为小兰花舞蹈获奖写一篇公众号文章",
      brief,
      contentPlan,
      titles,
      outline,
      draft: validDraft(),
      imagePlan: {
        items: [
          ...imagePlan.items,
          { placement: "ending", description: "扫码咨询", assetKey: "consult_qrcode" }
        ]
      },
      layoutPlan,
      selectedSkills: [brandSkill]
    });

    expect(result.document.content.find((block) => block.type === "qrcode")?.attrs).toMatchObject({
      assetKey: "consult_qrcode",
      src: "/user-skills/assets/asset_1/preview",
      placement: "ending"
    });
  });

  it("rejects qrcode placement outside the ending area", () => {
    const result = validateArticleArtifact({
      userInput: "为小兰花舞蹈获奖写一篇公众号文章",
      brief,
      contentPlan,
      titles,
      outline,
      draft: validDraft(),
      imagePlan: { items: [{ placement: "section", description: "扫码咨询", assetKey: "consult_qrcode" }] },
      layoutPlan,
      selectedSkills: [brandSkill]
    });

    expect(result.violations.map((item) => item.code)).toContain("QRCODE_PLACEMENT_INVALID");
  });
});

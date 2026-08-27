import { describe, expect, it } from "vitest";
import {
  createDeterministicPresentationDecision,
  enforceUserPresentationConstraints,
  extractUserPresentationConstraints
} from "./presentation";

describe("extractUserPresentationConstraints", () => {
  it("extracts explicit color anchors, usage, and prohibited colors", () => {
    const result = extractUserPresentationConstraints(
      "标题使用 #173F37，金色只用于少量点缀；不要红色，整体减少装饰。"
    );

    expect(result.requestedColors).toEqual(["#173F37", "金色"]);
    expect(result.prohibitedColors).toEqual(["红色"]);
    expect(result.colorUsage).toContain("标题使用 #173F37，金色只用于少量点缀");
    expect(result.decorationRequirements).toContain("不要红色，整体减少装饰");
  });

  it("keeps image and brand presentation requirements separate", () => {
    const result = extractUserPresentationConstraints(
      "首图使用大图，章节图片不要圆角。品牌 Logo 放在文末，二维码保持克制。"
    );

    expect(result.imageRequirements).toEqual([
      "首图使用大图，章节图片不要圆角"
    ]);
    expect(result.brandRequirements).toEqual([
      "品牌 Logo 放在文末，二维码保持克制"
    ]);
  });

  it("returns empty controlled fields when the prompt has no presentation instruction", () => {
    expect(extractUserPresentationConstraints("写一篇介绍春季研学活动的公众号文章。"))
      .toEqual({
        rawFragments: [],
        requestedColors: [],
        prohibitedColors: [],
        colorUsage: [],
        decorationRequirements: [],
        imageRequirements: [],
        brandRequirements: []
      });
  });
});

describe("createDeterministicPresentationDecision", () => {
  const baseInput = {
    structureVersion: "structure-v1",
    subject: "春季研学活动",
    goal: "event" as const,
    tone: "温暖、真实",
    narrative: "从出发到共同成长",
    callToAction: "欢迎关注后续活动",
    imageCount: 4,
    selectedSkills: []
  };

  it("uses explicit user colors as anchors while inferring the remaining palette", () => {
    const constraints = extractUserPresentationConstraints(
      "主色使用 #173F37，金色只做点缀，不要红色。"
    );
    const result = createDeterministicPresentationDecision({
      ...baseInput,
      constraints
    });

    expect(result.source).toBe("user");
    expect(result.colorDecoration.colorSource).toBe("user");
    expect(result.colorDecoration.requestedColors).toEqual(["#173F37", "金色"]);
    expect(result.colorDecoration.prohibitedColors).toEqual(["红色"]);
    expect(result.colorDecoration.paletteIntent.primary).toBe("#173F37");
    expect(result.colorDecoration.paletteIntent.accent).toBe("金色");
  });

  it("infers a presentation style from content when no visual instruction exists", () => {
    const result = createDeterministicPresentationDecision({
      ...baseInput,
      subject: "年度经营数据复盘报告",
      tone: "专业、克制",
      constraints: extractUserPresentationConstraints("请完成正文。")
    });

    expect(result.source).toBe("content");
    expect(result.visual.theme).toBe("professional-report");
    expect(result.colorDecoration.colorSource).toBe("content");
  });

  it("enforces user color anchors after an AI decision", () => {
    const original = createDeterministicPresentationDecision({
      ...baseInput,
      constraints: extractUserPresentationConstraints("请完成正文。")
    });
    const constraints = extractUserPresentationConstraints(
      "主色使用 #173F37，金色只做点缀，不要红色，整体减少装饰。"
    );
    const result = enforceUserPresentationConstraints(original, constraints);

    expect(result.colorDecoration.paletteIntent.primary).toBe("#173F37");
    expect(result.colorDecoration.paletteIntent.accent).toBe("金色");
    expect(result.colorDecoration.prohibitedColors).toEqual(["红色"]);
    expect(result.colorDecoration.ornamentLevel).toBe("minimal");
  });
});

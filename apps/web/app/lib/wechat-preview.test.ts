import { describe, expect, it } from "vitest";
import type { ArticleDocument } from "@mediaforge/contracts";
import { buildEditorialWechatHtml, buildWechatPreviewHtml } from "./wechat-preview";

describe("buildEditorialWechatHtml", () => {
  it("includes every selected image in an inline-style WeChat layout", () => {
    const document: ArticleDocument = {
      type: "doc",
      attrs: { title: "儿童摄影", scenario: "story" },
      content: [
        { id: "p1", type: "paragraph", content: [{ type: "text", text: "记录成长" }] },
        { id: "h1", type: "heading", content: [{ type: "text", text: "自然的光" }] },
        { id: "p2", type: "paragraph", content: [{ type: "text", text: "留下真实瞬间" }] }
      ]
    };
    const html = buildEditorialWechatHtml(document, [
      { id: "a1", name: "one.jpg", dataUrl: "data:image/jpeg;base64,ONE" },
      { id: "a2", name: "two.jpg", dataUrl: "data:image/jpeg;base64,TWO" },
      { id: "a3", name: "three.jpg", dataUrl: "data:image/jpeg;base64,THREE" }
    ]);

    expect(html.match(/<img /g)).toHaveLength(3);
    expect(html).toContain("PART 02");
    expect(html).not.toContain("<style");
    expect(html).not.toContain("class=");
    expect(html).not.toContain("<script");
  });

  it("renders distinct visual systems for all four article styles", () => {
    const baseDocument: ArticleDocument = {
      type: "doc",
      attrs: { title: "儿童摄影", scenario: "story" },
      content: [
        { id: "h1", type: "heading", content: [{ type: "text", text: "成长瞬间" }] },
        { id: "p1", type: "paragraph", content: [{ type: "text", text: "记录自然表情" }] }
      ]
    };

    const outputs = ["story", "practical", "list", "promotion"].map((style) =>
      buildWechatPreviewHtml(
        { ...baseDocument, attrs: { ...baseDocument.attrs, scenario: style } },
        []
      )
    );

    expect(new Set(outputs).size).toBe(4);
    expect(outputs[0]).toContain("STORY");
    expect(outputs[1]).toContain("GUIDE");
    expect(outputs[2]).toContain("清单");
    expect(outputs[3]).toContain("立即了解");
  });

  it("renders the youth growth skill with numbered sections and paced images", () => {
    const document: ArticleDocument = {
      type: "doc",
      attrs: { title: "让孩子在舞蹈里慢慢长大", scenario: "list" },
      content: [
        { id: "intro", type: "paragraph", content: [{ type: "text", text: "每一次练习，都在积累身体与内心的力量。" }] },
        { id: "h1", type: "heading", content: [{ type: "text", text: "01 建立身体协调性" }] },
        { id: "p1", type: "paragraph", content: [{ type: "text", text: "在循序渐进的动作中感受身体。" }] },
        { id: "h2", type: "heading", content: [{ type: "text", text: "02 学会坚持" }] },
        { id: "p2", type: "paragraph", content: [{ type: "text", text: "把小目标变成看得见的进步。" }] }
      ]
    };

    const html = buildWechatPreviewHtml(document, [
      { id: "a1", name: "hero.jpg", dataUrl: "data:image/jpeg;base64,HERO" },
      { id: "a2", name: "detail.jpg", dataUrl: "data:image/jpeg;base64,DETAIL" }
    ], "youth-growth-listicle");

    expect(html).toContain("GROWTH JOURNAL");
    expect(html).toContain(">01<");
    expect(html).toContain(">02<");
    expect(html).toContain("#e6007e");
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html).not.toContain("01 01");
    expect(html).not.toContain("<style");
    expect(html).not.toContain("class=");
    expect(html).not.toContain("<script");
  });
});

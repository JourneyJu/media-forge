import { describe, expect, it } from "vitest";
import type { ArticleDocument } from "@mediaforge/contracts";
import { renderWechatArticle } from "./wechat-renderer";

describe("renderWechatArticle", () => {
  it("escapes text and emits inline-only conservative HTML", () => {
    const document: ArticleDocument = {
      type: "doc",
      attrs: { title: "<script>alert(1)</script>", scenario: "promotion" },
      content: [
        {
          id: "block_1",
          type: "paragraph",
          content: [{ type: "text", text: "<b>限时优惠</b>" }]
        }
      ]
    };

    const result = renderWechatArticle(document);

    expect(result.html).toContain("&lt;b&gt;限时优惠&lt;/b&gt;");
    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain("<style");
    expect(result.html).not.toContain("class=");
  });

  it("warns for non-https images and video placeholders", () => {
    const document: ArticleDocument = {
      type: "doc",
      attrs: { title: "活动预告", scenario: "event" },
      content: [
        { id: "image_1", type: "image", attrs: { src: "http://example.com/poster.jpg", alt: "海报" } },
        { id: "video_1", type: "video", attrs: { title: "课程介绍视频" } }
      ]
    };

    const result = renderWechatArticle(document);

    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "IMAGE_URL_NOT_HTTPS",
      "VIDEO_REQUIRES_MANUAL_INSERT"
    ]);
    expect(result.html).toContain("请在公众号后台手动插入视频");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArticleDocument } from "@mediaforge/contracts";
import {
  articleDocumentToPlainText,
  getWechatArticleStats,
  writeWechatRichText
} from "./wechat-clipboard";

const document: ArticleDocument = {
  type: "doc",
  attrs: { title: "本周玩什么？", scenario: "event" },
  content: [
    { id: "heading_1", type: "heading", content: [{ type: "text", text: "活动安排" }] },
    { id: "paragraph_1", type: "paragraph", content: [{ type: "text", text: "13:00 破冰游戏" }] },
    { id: "image_1", type: "image", attrs: { src: "https://example.com/one.jpg" } },
    { id: "qrcode_1", type: "qrcode", attrs: { src: "https://example.com/code.jpg" } },
    { id: "divider_1", type: "divider" }
  ]
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("wechat clipboard", () => {
  it("builds readable plain text without HTML or Markdown markers", () => {
    expect(articleDocumentToPlainText(document)).toBe("本周玩什么？\n\n活动安排\n\n13:00 破冰游戏");
  });

  it("counts textual blocks and images from the article document", () => {
    expect(getWechatArticleStats(document)).toEqual({ paragraphCount: 2, imageCount: 2 });
    expect(getWechatArticleStats()).toEqual({ paragraphCount: 0, imageCount: 0 });
  });

  it("writes HTML and plain text in one clipboard operation", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const clipboardItems: Array<Record<string, Blob>> = [];

    vi.stubGlobal("navigator", { clipboard: { write } });
    vi.stubGlobal("ClipboardItem", class ClipboardItemMock {
      constructor(items: Record<string, Blob>) {
        clipboardItems.push(items);
      }
    });

    await writeWechatRichText("<p>活动安排</p>", "活动安排");

    expect(write).toHaveBeenCalledTimes(1);
    const clipboardItem = clipboardItems[0];
    expect(clipboardItem).toBeDefined();
    if (!clipboardItem) throw new Error("ClipboardItem was not created");
    expect(clipboardItem).toHaveProperty("text/html");
    expect(clipboardItem).toHaveProperty("text/plain");
    expect(await clipboardItem["text/html"]?.text()).toBe("<p>活动安排</p>");
    expect(await clipboardItem["text/plain"]?.text()).toBe("活动安排");
  });

  it("rejects when rich clipboard support is unavailable", async () => {
    vi.stubGlobal("navigator", { clipboard: {} });
    vi.stubGlobal("ClipboardItem", undefined);

    await expect(writeWechatRichText("<p>正文</p>", "正文"))
      .rejects.toThrow("RICH_CLIPBOARD_UNAVAILABLE");
  });
});

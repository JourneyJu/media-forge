import type { ArticleDocument } from "@mediaforge/contracts";

export interface WechatArticleStats {
  paragraphCount: number;
  imageCount: number;
}

function blockText(block: ArticleDocument["content"][number]): string {
  return (block.content ?? []).map((item) => item.text).join("").trim();
}

export function getWechatArticleStats(document?: ArticleDocument): WechatArticleStats {
  if (!document) return { paragraphCount: 0, imageCount: 0 };

  return document.content.reduce<WechatArticleStats>((stats, block) => {
    if (block.type === "image" || block.type === "qrcode") stats.imageCount += 1;
    if (blockText(block)) stats.paragraphCount += 1;
    return stats;
  }, { paragraphCount: 0, imageCount: 0 });
}

export function articleDocumentToPlainText(document: ArticleDocument): string {
  const lines = [document.attrs.title.trim()];

  for (const block of document.content) {
    const text = blockText(block);
    if (text) lines.push(text);
  }

  return lines.filter(Boolean).join("\n\n");
}

export function canWriteRichClipboard(): boolean {
  return typeof ClipboardItem !== "undefined"
    && typeof navigator !== "undefined"
    && typeof navigator.clipboard?.write === "function";
}

export async function writeWechatRichText(html: string, plainText: string): Promise<void> {
  if (!canWriteRichClipboard()) {
    throw new Error("RICH_CLIPBOARD_UNAVAILABLE");
  }

  const item = new ClipboardItem({
    "text/html": new Blob([html], { type: "text/html" }),
    "text/plain": new Blob([plainText], { type: "text/plain" })
  });

  await navigator.clipboard.write([item]);
}

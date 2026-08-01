import type {
  ArticleBlock,
  ArticleDocument,
  WechatRenderResult,
  WechatRenderWarning
} from "@mediaforge/contracts";

const RENDERER_VERSION = "wechat-inline-v1";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function blockText(block: ArticleBlock): string {
  return (block.content ?? []).map((item) => escapeHtml(item.text)).join("");
}

function renderBlock(block: ArticleBlock, warnings: WechatRenderWarning[]): string {
  const text = blockText(block);

  switch (block.type) {
    case "heading":
      return `<h2 style="margin:28px 0 12px;font-size:22px;line-height:1.45;color:#17202a;font-weight:700;">${text}</h2>`;
    case "paragraph":
      return `<p style="margin:0 0 16px;font-size:16px;line-height:1.9;color:#27313d;text-align:justify;">${text}</p>`;
    case "quote":
      return `<blockquote style="margin:20px 0;padding:14px 16px;border-left:4px solid #16745b;background:#f3f8f6;color:#3d4b47;font-size:15px;line-height:1.8;">${text}</blockquote>`;
    case "divider":
      return `<hr style="margin:28px 0;border:0;border-top:1px solid #dfe5e2;" />`;
    case "image":
    case "qrcode": {
      const src = String(block.attrs?.src ?? "");
      if (!src) {
        warnings.push({ code: "IMAGE_URL_MISSING", blockId: block.id, message: "图片缺少可访问地址" });
        return "";
      }
      if (!src.startsWith("https://")) {
        warnings.push({ code: "IMAGE_URL_NOT_HTTPS", blockId: block.id, message: "图片地址应使用 HTTPS" });
      }
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(block.attrs?.alt)}" style="display:block;width:100%;height:auto;margin:20px auto;" />`;
    }
    case "button":
      return `<p style="margin:24px 0;text-align:center;"><span style="display:inline-block;padding:10px 22px;background:#16745b;color:#ffffff;font-size:16px;line-height:1.5;">${text}</span></p>`;
    case "video":
      warnings.push({
        code: "VIDEO_REQUIRES_MANUAL_INSERT",
        blockId: block.id,
        message: "视频需在公众号后台手动插入"
      });
      return `<p style="margin:20px 0;padding:16px;border:1px dashed #9ba9a3;color:#5c6863;text-align:center;font-size:14px;line-height:1.7;">请在公众号后台手动插入视频：${escapeHtml(block.attrs?.title)}</p>`;
    case "callout":
    case "signup":
    case "address":
    case "footer":
      return `<section style="margin:20px 0;padding:16px;background:#f5f7f6;font-size:15px;line-height:1.8;color:#33413b;">${text}</section>`;
    default:
      return "";
  }
}

export function renderWechatArticle(document: ArticleDocument): WechatRenderResult {
  const warnings: WechatRenderWarning[] = [];
  const body = document.content.map((block) => renderBlock(block, warnings)).join("");
  const title = escapeHtml(document.attrs.title);

  return {
    html: `<section style="max-width:677px;margin:0 auto;padding:8px 12px;background:#ffffff;"><h1 style="margin:12px 0 24px;font-size:26px;line-height:1.4;color:#17202a;font-weight:700;">${title}</h1>${body}</section>`,
    rendererVersion: RENDERER_VERSION,
    warnings
  };
}

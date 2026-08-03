import {
  layoutPlanSchema,
  type ArticleBlock,
  type ArticleDocument,
  type LayoutPlan,
  type WechatRenderResult,
  type WechatRenderWarning
} from "@mediaforge/contracts";

const RENDERER_VERSION = "wechat-layout-plan-v2";

const defaultLayout: LayoutPlan = {
  theme: "editorial",
  palette: { primary: "#16745B", accent: "#E7654B", text: "#20252B", surface: "#F7F8F6" },
  titleTreatment: "left-editorial",
  introTreatment: "plain",
  sectionTreatment: "minimal",
  imageTreatment: "full-width",
  blocks: [{ kind: "title" }, { kind: "intro" }]
};

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

function headingPrefix(block: ArticleBlock, plan: LayoutPlan): string {
  const index = Number(block.attrs?.sectionIndex ?? 0) + 1;
  if (plan.sectionTreatment === "numbered") return `<span style="display:block;color:${plan.palette.accent};font-size:28px;line-height:1;margin-bottom:8px;">${String(index).padStart(2, "0")}</span>`;
  if (plan.sectionTreatment === "labelled") return `<span style="display:inline-block;margin-bottom:8px;padding:3px 8px;background:${plan.palette.accent};color:#ffffff;font-size:12px;line-height:1.5;">SECTION ${String(index).padStart(2, "0")}</span>`;
  if (plan.sectionTreatment === "timeline") return `<span style="color:${plan.palette.accent};margin-right:8px;">●</span>`;
  return "";
}

function renderBlock(block: ArticleBlock, plan: LayoutPlan, warnings: WechatRenderWarning[]): string {
  const text = blockText(block);
  switch (block.type) {
    case "heading":
      return `<h2 style="margin:32px 0 14px;font-size:21px;line-height:1.5;color:${plan.palette.primary};font-weight:700;">${headingPrefix(block, plan)}${text}</h2>`;
    case "paragraph":
      return `<p style="margin:0 0 16px;font-size:16px;line-height:1.9;color:${plan.palette.text};text-align:justify;">${text}</p>`;
    case "quote":
      return `<blockquote style="margin:22px 0;padding:15px 17px;border-left:4px solid ${plan.palette.accent};background:${plan.palette.surface};color:${plan.palette.text};font-size:15px;line-height:1.8;">${text}</blockquote>`;
    case "divider":
      return `<hr style="margin:28px 0;border:0;border-top:1px solid ${plan.palette.primary};" />`;
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
      const frame = plan.imageTreatment === "framed" ? `padding:6px;border:1px solid ${plan.palette.primary};box-sizing:border-box;` : "";
      const width = block.type === "qrcode" ? "180px" : block.attrs?.assetType === "logo" ? "120px" : "100%";
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(block.attrs?.alt)}" style="display:block;width:${width};max-width:100%;height:auto;margin:22px auto;${frame}" />`;
    }
    case "button":
      return `<p style="margin:24px 0;text-align:center;"><span style="display:inline-block;padding:10px 22px;background:${plan.palette.primary};color:#ffffff;font-size:16px;line-height:1.5;">${text}</span></p>`;
    case "video":
      warnings.push({ code: "VIDEO_REQUIRES_MANUAL_INSERT", blockId: block.id, message: "视频需在公众号后台手动插入" });
      return `<p style="margin:20px 0;padding:16px;border:1px dashed ${plan.palette.primary};color:${plan.palette.text};text-align:center;font-size:14px;line-height:1.7;">请在公众号后台手动插入视频：${escapeHtml(block.attrs?.title)}</p>`;
    case "callout":
    case "signup":
    case "address":
    case "footer":
      return `<section style="margin:22px 0;padding:17px;background:${plan.palette.surface};font-size:15px;line-height:1.85;color:${plan.palette.text};">${text}</section>`;
    default:
      return "";
  }
}

function titleStyle(plan: LayoutPlan): string {
  if (plan.titleTreatment === "centered") return "text-align:center;";
  if (plan.titleTreatment === "poster") return `text-align:center;padding:22px 12px;border-top:5px solid ${plan.palette.accent};border-bottom:1px solid ${plan.palette.primary};`;
  return `text-align:left;border-left:5px solid ${plan.palette.accent};padding-left:14px;`;
}

export function renderWechatArticle(document: ArticleDocument, inputPlan?: LayoutPlan): WechatRenderResult {
  const warnings: WechatRenderWarning[] = [];
  const parsed = layoutPlanSchema.safeParse(inputPlan);
  const plan = parsed.success ? parsed.data : defaultLayout;
  const body = document.content.map((block) => renderBlock(block, plan, warnings)).join("");
  const title = escapeHtml(document.attrs.title);

  return {
    html: `<section style="max-width:677px;margin:0 auto;padding:10px 14px;background:#ffffff;"><h1 style="margin:12px 0 26px;font-size:27px;line-height:1.42;color:${plan.palette.text};font-weight:700;${titleStyle(plan)}">${title}</h1>${body}</section>`,
    rendererVersion: RENDERER_VERSION,
    warnings
  };
}

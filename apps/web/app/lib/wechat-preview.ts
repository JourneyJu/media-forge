import type {
  ArticleBlock,
  ArticleDocument,
  BuiltInLayoutSkillId
} from "@mediaforge/contracts";

export interface PreviewAsset {
  id: string;
  name: string;
  dataUrl: string;
}

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

function renderImage(asset: PreviewAsset, width = "100%"): string {
  return `<img src="${escapeHtml(asset.dataUrl)}" alt="${escapeHtml(asset.name)}" style="display:inline-block;width:${width};height:auto;vertical-align:top;" />`;
}

function renderGallery(assets: PreviewAsset[]): string {
  if (assets.length === 0) return "";
  if (assets.length === 1) {
    return `<section style="margin:26px 0;">${renderImage(assets[0]!)}</section>`;
  }

  return `<section style="margin:26px 0;font-size:0;text-align:justify;">${assets
    .map((asset) => renderImage(asset, "49%"))
    .join('<span style="display:inline-block;width:2%;"></span>')}</section>`;
}

function renderBlock(block: ArticleBlock, index: number): string {
  const text = blockText(block);

  switch (block.type) {
    case "heading":
      return `<section style="margin:38px 0 16px;"><span style="display:inline-block;margin-bottom:9px;padding:3px 9px;background:#d85f4a;color:#ffffff;font-size:12px;line-height:1.5;">PART ${String(index + 1).padStart(2, "0")}</span><h2 style="margin:0;font-family:'Songti SC','Noto Serif SC',Georgia,serif;font-size:23px;line-height:1.55;color:#173f37;font-weight:700;">${text}</h2><span style="display:block;width:34px;margin-top:11px;border-top:3px solid #173f37;"></span></section>`;
    case "paragraph":
      return `<p style="margin:0 0 18px;font-size:16px;line-height:2;color:#39433f;letter-spacing:0;text-align:justify;">${text}</p>`;
    case "quote":
      return `<blockquote style="margin:28px 0;padding:22px 20px;border:0;background:#edf4f1;color:#173f37;font-family:'Songti SC','Noto Serif SC',Georgia,serif;font-size:18px;line-height:1.8;text-align:center;">${text}</blockquote>`;
    case "footer":
    case "callout":
    case "signup":
      return `<section style="margin:34px 0 8px;padding:24px 20px;border-top:1px solid #b8c8c2;border-bottom:1px solid #b8c8c2;color:#50605a;font-size:14px;line-height:1.9;text-align:center;">${text}</section>`;
    case "divider":
      return `<p style="margin:34px 0;text-align:center;color:#d85f4a;font-size:17px;letter-spacing:0;">◆</p>`;
    default:
      return text
        ? `<p style="margin:0 0 18px;font-size:16px;line-height:2;color:#39433f;">${text}</p>`
        : "";
  }
}

export function buildEditorialWechatHtml(document: ArticleDocument, assets: PreviewAsset[]): string {
  const [hero, ...galleryAssets] = assets;
  const textBlocks = document.content.filter((block) => !["image", "qrcode", "video"].includes(block.type));
  const galleryGroups: PreviewAsset[][] = [];

  for (let index = 0; index < galleryAssets.length; index += 2) {
    galleryGroups.push(galleryAssets.slice(index, index + 2));
  }

  let galleryIndex = 0;
  const content = textBlocks.map((block, index) => {
    const rendered = renderBlock(block, index);
    const shouldInsertGallery = block.type === "paragraph" && galleryGroups[galleryIndex];
    if (!shouldInsertGallery) return rendered;

    const gallery = renderGallery(galleryGroups[galleryIndex]!);
    galleryIndex += 1;
    return `${rendered}${gallery}`;
  }).join("");

  const remainingGalleries = galleryGroups.slice(galleryIndex).map(renderGallery).join("");

  return `<section style="max-width:677px;margin:0 auto;padding:0 14px 36px;background:#ffffff;"><section style="padding:34px 8px 26px;text-align:left;"><span style="display:inline-block;margin-bottom:14px;color:#d85f4a;font-size:12px;font-weight:700;line-height:1.4;">STORY · PORTRAIT</span><h1 style="margin:0;font-family:'Songti SC','Noto Serif SC',Georgia,serif;font-size:31px;line-height:1.35;color:#173f37;font-weight:700;">${escapeHtml(document.attrs.title)}</h1><p style="margin:13px 0 0;color:#7a8580;font-size:13px;line-height:1.7;">把寻常日子，留成日后会反复翻看的光。</p></section>${hero ? `<section style="margin:0 -14px 30px;">${renderImage(hero)}</section>` : ""}<section style="padding:0 8px;">${content}${remainingGalleries}</section><section style="margin:42px 8px 0;padding-top:18px;border-top:3px solid #173f37;text-align:right;"><strong style="display:block;color:#173f37;font-family:'Songti SC','Noto Serif SC',Georgia,serif;font-size:18px;">认真记录，慢慢长大</strong><span style="display:block;margin-top:6px;color:#8a948f;font-size:12px;">THANKS FOR READING</span></section></section>`;
}

function textBlocks(document: ArticleDocument): ArticleBlock[] {
  return document.content.filter((block) => !["image", "qrcode", "video"].includes(block.type));
}

function plainGallery(assets: PreviewAsset[]): string {
  return assets.map((asset) => `<section style="margin:22px 0;">${renderImage(asset)}</section>`).join("");
}

function withoutLeadingNumber(value: string): string {
  return value.replace(/^\s*(?:\d{1,2}[.、\s]+)+/, "").trim();
}

function buildYouthGrowthListicleHtml(
  document: ArticleDocument,
  assets: PreviewAsset[]
): string {
  const blocks = textBlocks(document);
  const introIndex = blocks.findIndex((block) => block.type === "paragraph");
  const intro = introIndex >= 0 ? blockText(blocks[introIndex]!) : "";
  const bodyBlocks = blocks.filter((_, index) => index !== introIndex);
  const [hero, ...inlineAssets] = assets;
  let sectionNumber = 0;
  let imageIndex = 0;
  let headingCount = 0;

  const content = bodyBlocks.map((block) => {
    const text = blockText(block);
    if (block.type === "heading") {
      sectionNumber += 1;
      headingCount += 1;
      const image = headingCount % 2 === 0 ? inlineAssets[imageIndex++] : undefined;
      return `${image ? `<section style="margin:34px 0 28px;">${renderImage(image)}</section>` : ""}<section style="margin:38px 0 14px;text-align:center;"><span style="display:block;color:#e6007e;font-family:Georgia,'Times New Roman',serif;font-size:38px;line-height:1;font-weight:700;">${String(sectionNumber).padStart(2, "0")}</span><span style="display:block;width:28px;margin:10px auto 12px;border-top:3px solid #67b95c;"></span><h2 style="margin:0;color:#1f2421;font-family:'Songti SC','Noto Serif SC',Georgia,serif;font-size:22px;line-height:1.55;font-weight:700;">${withoutLeadingNumber(text)}</h2></section>`;
    }
    if (block.type === "quote") {
      return `<blockquote style="margin:28px 0;padding:20px 22px;border:0;background:#fbfcef;color:#579e50;font-size:16px;line-height:1.9;text-align:center;">${text}</blockquote>`;
    }
    return `<p style="margin:0 3px 20px;color:#444a46;font-size:16px;line-height:2;text-align:justify;">${text}</p>`;
  }).join("");

  const remainingImages = inlineAssets.slice(imageIndex)
    .map((asset) => `<section style="margin:34px 0 28px;">${renderImage(asset)}</section>`)
    .join("");

  return `<section style="max-width:677px;margin:0 auto;padding:0 16px 42px;background:#ffffff;"><section style="padding:34px 4px 24px;text-align:center;"><span style="display:inline-block;color:#e6007e;font-size:12px;line-height:1.4;font-weight:700;">GROWTH NOTES</span><h1 style="margin:12px 0 0;color:#1f2421;font-family:'Songti SC','Noto Serif SC',Georgia,serif;font-size:30px;line-height:1.4;font-weight:700;">${escapeHtml(document.attrs.title)}</h1></section>${intro ? `<section style="margin:0 0 26px;padding:22px 24px;background:#fbfcef;color:#5fa756;font-size:15px;line-height:2;text-align:center;">${intro}</section>` : ""}${hero ? `<section style="margin:0 0 32px;padding:5px;border:4px solid #67b95c;background:#ffffff;">${renderImage(hero)}</section>` : ""}<section style="margin:34px 0 30px;text-align:center;"><span style="display:block;color:#67b95c;font-size:11px;line-height:1.4;font-weight:700;">/ GROWTH JOURNAL</span><strong style="display:block;margin-top:8px;color:#1f2421;font-family:'Songti SC','Noto Serif SC',Georgia,serif;font-size:24px;line-height:1.5;">在一次次尝试里，看见成长</strong></section>${content}${remainingImages}<section style="margin-top:42px;padding:22px 18px;border-top:2px solid #67b95c;border-bottom:2px solid #e6007e;text-align:center;"><strong style="display:block;color:#1f2421;font-size:17px;line-height:1.7;">成长没有统一速度，每一次认真都值得被看见</strong><span style="display:block;margin-top:7px;color:#67b95c;font-size:11px;font-weight:700;">THANKS FOR READING</span></section></section>`;
}

function buildPracticalHtml(document: ArticleDocument, assets: PreviewAsset[]): string {
  const content = textBlocks(document).map((block) => {
    const text = blockText(block);
    if (block.type === "heading") {
      return `<h2 style="margin:30px 0 13px;padding-left:12px;border-left:4px solid #087e8b;color:#163b40;font-size:21px;line-height:1.5;">${text}</h2>`;
    }
    return `<p style="margin:0 0 16px;color:#33484b;font-size:16px;line-height:1.9;text-align:justify;">${text}</p>`;
  }).join("");

  return `<section style="max-width:677px;margin:0 auto;padding:28px 18px 40px;background:#ffffff;"><span style="color:#087e8b;font-size:12px;font-weight:700;">PRACTICAL GUIDE</span><h1 style="margin:10px 0 12px;color:#15383d;font-size:29px;line-height:1.4;">${escapeHtml(document.attrs.title)}</h1><p style="margin:0 0 24px;padding-bottom:18px;border-bottom:1px solid #bdd4d7;color:#688084;font-size:13px;line-height:1.7;">把复杂信息整理成清楚、可靠、能够立即使用的指南。</p>${assets[0] ? renderImage(assets[0]) : ""}<section style="margin-top:24px;">${content}</section>${plainGallery(assets.slice(1))}<p style="margin-top:36px;padding:16px;background:#eaf4f5;color:#24545a;font-size:14px;line-height:1.8;">保存这份 GUIDE，在需要做决定时随时回来查看。</p></section>`;
}

function buildListHtml(document: ArticleDocument, assets: PreviewAsset[]): string {
  let number = 0;
  const content = textBlocks(document).map((block) => {
    const text = blockText(block);
    if (block.type === "heading") {
      number += 1;
      return `<section style="margin:26px 0 10px;padding:16px;border:1px solid #272b2a;"><span style="display:block;color:#c44536;font-size:12px;font-weight:700;">清单 ${String(number).padStart(2, "0")}</span><h2 style="margin:6px 0 0;color:#202423;font-size:20px;line-height:1.5;">${text}</h2></section>`;
    }
    return `<p style="margin:0 4px 16px;color:#414745;font-size:16px;line-height:1.9;">${text}</p>`;
  }).join("");

  return `<section style="max-width:677px;margin:0 auto;padding:30px 18px 42px;background:#f7f7f4;"><span style="display:inline-block;padding:4px 9px;background:#202423;color:#ffffff;font-size:11px;">CHECK LIST</span><h1 style="margin:16px 0 22px;color:#202423;font-size:30px;line-height:1.35;">${escapeHtml(document.attrs.title)}</h1>${assets[0] ? renderImage(assets[0]) : ""}${content}${plainGallery(assets.slice(1))}<p style="margin-top:32px;border-top:2px solid #202423;padding-top:14px;color:#c44536;font-size:13px;font-weight:700;">按清单逐项确认，让选择更简单。</p></section>`;
}

function buildPromotionHtml(document: ArticleDocument, assets: PreviewAsset[]): string {
  const content = textBlocks(document).map((block) => {
    const text = blockText(block);
    if (block.type === "heading") {
      return `<h2 style="margin:30px 0 12px;color:#8d2d23;font-family:'Songti SC',Georgia,serif;font-size:23px;line-height:1.5;text-align:center;">${text}</h2>`;
    }
    return `<p style="margin:0 0 17px;color:#4e3c38;font-size:16px;line-height:1.95;text-align:justify;">${text}</p>`;
  }).join("");

  return `<section style="max-width:677px;margin:0 auto;padding-bottom:40px;background:#fffaf5;"><section style="padding:32px 20px;background:#a83f31;color:#ffffff;text-align:center;"><span style="font-size:11px;font-weight:700;">FEATURED EVENT</span><h1 style="margin:10px 0 0;font-family:'Songti SC',Georgia,serif;font-size:30px;line-height:1.4;">${escapeHtml(document.attrs.title)}</h1></section>${assets[0] ? renderImage(assets[0]) : ""}<section style="padding:26px 20px;">${content}${plainGallery(assets.slice(1))}<p style="margin:32px 0 0;padding:13px 20px;background:#a83f31;color:#ffffff;font-size:16px;font-weight:700;text-align:center;">立即了解</p></section></section>`;
}

export function buildWechatPreviewHtml(
  document: ArticleDocument,
  assets: PreviewAsset[],
  layoutSkill: BuiltInLayoutSkillId = "auto"
): string {
  if (layoutSkill === "youth-growth-listicle") {
    return buildYouthGrowthListicleHtml(document, assets);
  }

  switch (document.attrs.scenario) {
    case "practical":
      return buildPracticalHtml(document, assets);
    case "list":
      return buildListHtml(document, assets);
    case "promotion":
      return buildPromotionHtml(document, assets);
    case "story":
    default:
      return buildEditorialWechatHtml(document, assets);
  }
}

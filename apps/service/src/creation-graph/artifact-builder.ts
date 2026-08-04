import { randomUUID } from "node:crypto";
import {
  articleDocumentSchema,
  artifactValidationResultSchema,
  layoutPlanSchema,
  type ArticleDocument,
  type ArticleDraft,
  type ArticleOutline,
  type ArtifactValidationResult,
  type ContentPlan,
  type CreativeBrief,
  type ImagePlanItem,
  type GenerateWechatArticleResponse,
  type ImagePlan,
  type LayoutPlan,
  type ResolvedUserSkill,
  type TitleCandidates
} from "@mediaforge/contracts";
import { renderWechatArticle } from "../wechat-renderer";

const processCopyPattern = /帮我(?:写|做)|要求如下|我会先|执行计划|审校报告|思考过程|作为\s*AI|AI\s*味/u;

interface ArtifactBuilderInput {
  userInput: string;
  brief: CreativeBrief;
  contentPlan: ContentPlan;
  titles: TitleCandidates;
  outline: ArticleOutline;
  draft: ArticleDraft;
  imagePlan: ImagePlan;
  layoutPlan: LayoutPlan;
  selectedSkills?: ResolvedUserSkill[];
}

function getSelectedTitle(titles: TitleCandidates) {
  return titles.items.find((item) => item.id === titles.selectedId);
}

function articleText(draft: ArticleDraft): string {
  return [
    draft.title,
    draft.subtitle ?? "",
    draft.intro,
    ...draft.sections.flatMap((section) => [section.heading, ...section.paragraphs, section.emphasis ?? ""]),
    draft.conclusion,
    draft.callToAction ?? ""
  ].join("\n");
}

function normalizeTopicText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function hasSubjectCoverage(subject: string, article: string): boolean {
  const normalizedSubject = normalizeTopicText(subject);
  const normalizedArticle = normalizeTopicText(article);
  if (!normalizedSubject) return true;
  if (normalizedArticle.includes(normalizedSubject)) return true;
  if (normalizedSubject.length < 4) return normalizedArticle.includes(normalizedSubject);

  const pairs = Array.from({ length: normalizedSubject.length - 1 }, (_, index) =>
    normalizedSubject.slice(index, index + 2)
  );
  const covered = pairs.filter((pair) => normalizedArticle.includes(pair)).length;
  return covered / pairs.length >= 0.65;
}

export function validateArticleArtifact(input: ArtifactBuilderInput): ArtifactValidationResult {
  const violations: Array<{ code: string; message: string }> = [];
  const selected = getSelectedTitle(input.titles);
  const text = articleText(input.draft);
  const normalizedPrompt = input.userInput.trim().replace(/\s+/g, " ");
  const normalizedArticle = text.replace(/\s+/g, " ");
  const normalizedTitle = input.draft.title.trim().replace(/\s+/g, " ");

  if (!selected || input.draft.title !== selected.title) {
    violations.push({ code: "TITLE_SOURCE_INVALID", message: "最终标题必须来自 Title Agent 的 selectedId" });
  }
  if (normalizedPrompt.length >= 8 && normalizedTitle === normalizedPrompt) {
    violations.push({ code: "RAW_PROMPT_AS_TITLE", message: "最终标题不能直接使用用户原始输入" });
  }
  if (normalizedPrompt.length >= 16 && normalizedArticle.includes(normalizedPrompt)) {
    violations.push({ code: "RAW_PROMPT_LEAK", message: "最终内容包含用户原始提示词" });
  }
  if (processCopyPattern.test(text)) {
    violations.push({ code: "PROCESS_COPY_LEAK", message: "最终内容包含用户指令或 AI 执行过程" });
  }
  if (input.draft.sections.length < 3) {
    violations.push({ code: "ARTICLE_TOO_THIN", message: "正文至少需要三个有明确目的的章节" });
  }
  if (!hasSubjectCoverage(input.brief.subject, normalizedArticle)) {
    violations.push({ code: "SUBJECT_MISMATCH", message: "最终内容没有围绕本轮 CreativeBrief 主题" });
  }
  const plannedHeadings = new Set(input.contentPlan.sections.map((section) => section.heading));
  if (input.draft.sections.some((section) => !plannedHeadings.has(section.heading))) {
    violations.push({ code: "CONTENT_PLAN_DRIFT", message: "正文结构偏离 ContentPlan" });
  }
  if (layoutPlanSchema.safeParse(input.layoutPlan).success === false) {
    violations.push({ code: "LAYOUT_PLAN_INVALID", message: "LayoutPlan 不符合受控 schema" });
  }
  const skillAssets = new Map(
    (input.selectedSkills ?? []).flatMap((skill) => skill.assets).map((asset) => [asset.key, asset])
  );
  for (const item of input.imagePlan.items.filter((image) => image.assetKey)) {
    const asset = skillAssets.get(item.assetKey!);
    if (!asset) {
      violations.push({ code: "SKILL_ASSET_NOT_FOUND", message: `Skill 资源 ${item.assetKey} 不存在于冻结版本` });
    } else if (asset.type === "qrcode" && item.placement !== "ending") {
      violations.push({ code: "QRCODE_PLACEMENT_INVALID", message: "二维码只能放在文章结尾 CTA 区域" });
    }
  }

  return artifactValidationResultSchema.parse({ passed: violations.length === 0, violations });
}

function textBlock(type: "paragraph" | "callout" | "quote" | "footer", text: string, attrs?: Record<string, unknown>) {
  return { id: randomUUID(), type, attrs, content: [{ type: "text" as const, text }] };
}

function imageBlock(resourceId: string, planned: ImagePlanItem, sectionIndex?: number) {
  return {
    id: randomUUID(),
    type: "image" as const,
    attrs: {
      resourceId,
      src: `/resources/${encodeURIComponent(resourceId)}/content`,
      alt: planned.description,
      ...(sectionIndex !== undefined ? { sectionIndex } : {})
    }
  };
}

export function buildArticleDocument(input: ArtifactBuilderInput): {
  document: ArticleDocument;
  validation: ArtifactValidationResult;
} {
  const validation = validateArticleArtifact(input);
  if (!validation.passed) {
    throw new Error(`ARTIFACT_VALIDATION_FAILED:${validation.violations.map((item) => item.code).join(",")}`);
  }

  const content: ArticleDocument["content"] = [
    textBlock(input.layoutPlan.introTreatment === "quote" ? "quote" : input.layoutPlan.introTreatment === "highlight-panel" ? "callout" : "paragraph", input.draft.intro, { role: "intro" })
  ];
  const plannedImages = new Map(
    input.imagePlan.items
      .filter((item) => item.resourceId)
      .map((item) => [item.resourceId!, item])
  );
  const draftAssetRefs = new Set(input.draft.sections.flatMap((section) => section.assetRefs));
  const usedResourceIds = new Set<string>();
  const coverImage = input.imagePlan.items.find((item) =>
    item.placement === "cover" && item.resourceId && !draftAssetRefs.has(item.resourceId)
  );
  if (coverImage?.resourceId) {
    content.push(imageBlock(coverImage.resourceId, coverImage));
    usedResourceIds.add(coverImage.resourceId);
  }
  const layoutSectionImages = new Map<number, ImagePlanItem[]>();
  for (const block of input.layoutPlan.blocks) {
    if (block.kind !== "image" || block.sectionIndex === undefined || !block.assetRef) continue;
    const planned = plannedImages.get(block.assetRef);
    if (!planned || planned.placement !== "section") continue;
    layoutSectionImages.set(block.sectionIndex, [...(layoutSectionImages.get(block.sectionIndex) ?? []), planned]);
  }
  const unassignedSectionImages = input.imagePlan.items.filter((item) =>
    item.placement === "section"
    && item.resourceId
    && !draftAssetRefs.has(item.resourceId)
    && !input.layoutPlan.blocks.some((block) => block.kind === "image" && block.assetRef === item.resourceId)
  );
  let unassignedImageIndex = 0;

  input.draft.sections.forEach((section, sectionIndex) => {
    let insertedSectionImage = false;
    content.push({
      id: randomUUID(),
      type: "heading",
      attrs: { sectionIndex, treatment: input.layoutPlan.sectionTreatment },
      content: [{ type: "text", text: section.heading }]
    });
    for (const paragraph of section.paragraphs) {
      content.push(textBlock("paragraph", paragraph, { sectionIndex }));
    }
    if (section.emphasis) content.push(textBlock("quote", section.emphasis, { sectionIndex }));
    for (const assetRef of section.assetRefs) {
      const planned = plannedImages.get(assetRef);
      if (!planned || usedResourceIds.has(assetRef)) continue;
      content.push(imageBlock(assetRef, planned, sectionIndex));
      usedResourceIds.add(assetRef);
      insertedSectionImage = true;
    }
    if (!insertedSectionImage) {
      const fallback = layoutSectionImages.get(sectionIndex)?.find((item) =>
        item.resourceId && !usedResourceIds.has(item.resourceId)
      ) ?? unassignedSectionImages.slice(unassignedImageIndex).find((item) =>
        item.resourceId && !usedResourceIds.has(item.resourceId)
      );
      if (fallback?.resourceId) {
        content.push(imageBlock(fallback.resourceId, fallback, sectionIndex));
        usedResourceIds.add(fallback.resourceId);
        const index = unassignedSectionImages.indexOf(fallback);
        if (index >= unassignedImageIndex) unassignedImageIndex = index + 1;
      }
    }
  });

  content.push(textBlock("footer", input.draft.conclusion, { role: "conclusion" }));
  if (input.draft.callToAction) content.push(textBlock("callout", input.draft.callToAction, { role: "cta" }));

  const skillAssets = new Map(
    (input.selectedSkills ?? []).flatMap((skill) => skill.assets).map((asset) => [asset.key, asset])
  );
  for (const planned of input.imagePlan.items.filter((item) => item.assetKey)) {
    const asset = skillAssets.get(planned.assetKey!);
    if (!asset) continue;
    content.push({
      id: randomUUID(),
      type: asset.type === "qrcode" ? "qrcode" : "image",
      attrs: {
        assetKey: asset.key,
        assetType: asset.type,
        src: `/user-skills/assets/${encodeURIComponent(asset.id)}/preview`,
        alt: planned.description,
        placement: planned.placement
      }
    });
  }

  return {
    validation,
    document: articleDocumentSchema.parse({
      type: "doc",
      attrs: { title: input.draft.title, scenario: input.layoutPlan.theme },
      content
    })
  };
}

export function buildWechatArticleResponse(
  document: ArticleDocument,
  mode: "gateway" | "local-demo",
  layoutPlan?: LayoutPlan
): GenerateWechatArticleResponse {
  return {
    articleId: randomUUID(),
    versionId: randomUUID(),
    document,
    layoutPlan,
    render: renderWechatArticle(document, layoutPlan),
    model: {
      provider: mode === "gateway" ? "configured-route" : "local",
      name: mode === "gateway" ? "configured-model" : "multi-agent-demo-v2",
      mode
    }
  };
}

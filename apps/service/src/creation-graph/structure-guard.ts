import { createHash } from "node:crypto";
import {
  articleDraftSchema,
  articleOutlineSchema,
  contentPlanSchema,
  imagePlanSchema,
  layoutPlanSchema,
  presentationStyleDecisionSchema,
  type ArticleDraft,
  type ArticleOutline,
  type ContentPlan,
  type ContentPlanInput,
  type ImagePlan,
  type LayoutPlan,
  type PresentationStyleDecision
} from "@mediaforge/contracts";

export type StructureGuardCode =
  | "STRUCTURE_VERSION_STALE"
  | "SECTION_ID_MISSING"
  | "SECTION_ID_DUPLICATED"
  | "SECTION_SET_MISMATCH"
  | "SECTION_ORDER_DRIFT"
  | "SECTION_REFERENCE_INVALID";

export class StructureGuardError extends Error {
  constructor(
    public readonly code: StructureGuardCode,
    public readonly details: Record<string, unknown>
  ) {
    super(`STRUCTURE_GUARD_FAILED:${code}`);
    this.name = "StructureGuardError";
  }
}

export type ModelStructureCode =
  | "MODEL_SECTION_COUNT_MISMATCH"
  | "MODEL_SECTION_INDEX_INVALID"
  | "MODEL_OUTPUT_SCHEMA_INVALID";

export class ModelStructureError extends Error {
  constructor(
    public readonly code: ModelStructureCode,
    public readonly details: Record<string, unknown>
  ) {
    super(`MODEL_STRUCTURE_INVALID:${code}`);
    this.name = "ModelStructureError";
  }
}

function stableToken(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function assignContentPlanIdentity(
  input: ContentPlanInput | ContentPlan,
  runId: string
): ContentPlan {
  const structureSeed = input.sections
    .map((section) => `${section.heading}\u0000${section.purpose}`)
    .join("\u0001");
  const structureVersion = "structureVersion" in input
    ? input.structureVersion
    : `structure_${stableToken(`${runId}\u0000${structureSeed}`)}`;

  const contentPlan = contentPlanSchema.parse({
    ...input,
    structureVersion,
    sections: input.sections.map((section, index) => ({
      ...section,
      sectionId: "sectionId" in section
        ? section.sectionId
        : `section_${index + 1}_${stableToken(`${structureVersion}\u0000${index}`)}`
    }))
  });
  const sectionIds = contentPlan.sections.map((section) => section.sectionId);
  if (new Set(sectionIds).size !== sectionIds.length) {
    throw new StructureGuardError("SECTION_ID_DUPLICATED", { actualSectionIds: sectionIds });
  }
  return contentPlan;
}

function assertVersion(contentPlan: ContentPlan, structureVersion: string): void {
  if (structureVersion !== contentPlan.structureVersion) {
    throw new StructureGuardError("STRUCTURE_VERSION_STALE", {
      expectedStructureVersion: contentPlan.structureVersion,
      actualStructureVersion: structureVersion
    });
  }
}

function assertOrderedSections(contentPlan: ContentPlan, actualSectionIds: string[]): void {
  const expectedSectionIds = contentPlan.sections.map((section) => section.sectionId);
  if (actualSectionIds.some((sectionId) => !sectionId)) {
    throw new StructureGuardError("SECTION_ID_MISSING", { expectedSectionIds, actualSectionIds });
  }
  if (new Set(actualSectionIds).size !== actualSectionIds.length) {
    throw new StructureGuardError("SECTION_ID_DUPLICATED", { expectedSectionIds, actualSectionIds });
  }
  const expectedSet = new Set(expectedSectionIds);
  if (
    actualSectionIds.length !== expectedSectionIds.length
    || actualSectionIds.some((sectionId) => !expectedSet.has(sectionId))
  ) {
    throw new StructureGuardError("SECTION_SET_MISMATCH", { expectedSectionIds, actualSectionIds });
  }
  if (actualSectionIds.some((sectionId, index) => sectionId !== expectedSectionIds[index])) {
    throw new StructureGuardError("SECTION_ORDER_DRIFT", { expectedSectionIds, actualSectionIds });
  }
}

function assertReferences(contentPlan: ContentPlan, sectionIds: Array<string | undefined>): void {
  const expectedSectionIds = new Set(contentPlan.sections.map((section) => section.sectionId));
  const invalidSectionIds = sectionIds.filter(
    (sectionId): sectionId is string => !sectionId || !expectedSectionIds.has(sectionId)
  );
  if (invalidSectionIds.length > 0 || sectionIds.some((sectionId) => !sectionId)) {
    throw new StructureGuardError("SECTION_REFERENCE_INVALID", {
      expectedSectionIds: [...expectedSectionIds],
      invalidSectionIds
    });
  }
}

export function assertOutlineStructure(contentPlan: ContentPlan, outline: ArticleOutline): void {
  assertVersion(contentPlan, outline.structureVersion);
  assertOrderedSections(contentPlan, outline.sections.map((section) => section.sectionId));
}

export function assertDraftStructure(contentPlan: ContentPlan, draft: ArticleDraft): void {
  assertVersion(contentPlan, draft.structureVersion);
  assertOrderedSections(contentPlan, draft.sections.map((section) => section.sectionId));
}

export function assertImagePlanStructure(contentPlan: ContentPlan, imagePlan: ImagePlan): void {
  assertVersion(contentPlan, imagePlan.structureVersion);
  assertReferences(
    contentPlan,
    imagePlan.items.filter((item) => item.placement === "section").map((item) => item.sectionId)
  );
}

export function assertLayoutPlanStructure(contentPlan: ContentPlan, layoutPlan: LayoutPlan): void {
  assertVersion(contentPlan, layoutPlan.structureVersion);
  assertReferences(
    contentPlan,
    layoutPlan.blocks
      .filter((block) => block.kind === "section" || (block.kind === "image" && block.sectionIndex !== undefined))
      .map((block) => block.sectionId)
  );
}

function assertModelSectionCount(
  contentPlan: ContentPlan,
  sections: unknown[],
  outputKind: "outline" | "draft"
): void {
  if (sections.length !== contentPlan.sections.length) {
    throw new ModelStructureError("MODEL_SECTION_COUNT_MISMATCH", {
      outputKind,
      expectedSectionCount: contentPlan.sections.length,
      actualSectionCount: sections.length
    });
  }
}

export function canonicalizeOutlineStructure(contentPlan: ContentPlan, value: unknown): ArticleOutline {
  const candidate = value as Record<string, unknown>;
  const sections = Array.isArray(candidate.sections) ? candidate.sections : [];
  assertModelSectionCount(contentPlan, sections, "outline");

  return articleOutlineSchema.parse({
    ...candidate,
    structureVersion: contentPlan.structureVersion,
    sections: sections.map((section, index) => {
      const { sectionId: _modelSectionId, ...content } = section as Record<string, unknown>;
      return {
        ...content,
        sectionId: contentPlan.sections[index]!.sectionId
      };
    })
  });
}

export function canonicalizeDraftStructure(contentPlan: ContentPlan, value: unknown): ArticleDraft {
  const candidate = value as Record<string, unknown>;
  const sections = Array.isArray(candidate.sections) ? candidate.sections : [];
  assertModelSectionCount(contentPlan, sections, "draft");

  return articleDraftSchema.parse({
    ...candidate,
    structureVersion: contentPlan.structureVersion,
    sections: sections.map((section, index) => {
      const { sectionId: _modelSectionId, ...content } = section as Record<string, unknown>;
      return {
        ...content,
        sectionId: contentPlan.sections[index]!.sectionId
      };
    })
  });
}

function resolveModelSectionId(
  contentPlan: ContentPlan,
  sectionIndex: unknown,
  outputKind: "imagePlan" | "layoutPlan"
): string {
  if (
    typeof sectionIndex !== "number"
    || !Number.isInteger(sectionIndex)
    || sectionIndex < 0
    || sectionIndex >= contentPlan.sections.length
  ) {
    throw new ModelStructureError("MODEL_SECTION_INDEX_INVALID", {
      outputKind,
      sectionIndex,
      allowedSectionIndexes: contentPlan.sections.map((_section, index) => index)
    });
  }
  return contentPlan.sections[sectionIndex]!.sectionId;
}

export function canonicalizeImagePlanStructure(contentPlan: ContentPlan, value: unknown): ImagePlan {
  const candidate = value as Record<string, unknown>;
  const items = Array.isArray(candidate.items) ? candidate.items : [];

  return imagePlanSchema.parse({
    ...candidate,
    structureVersion: contentPlan.structureVersion,
    items: items.map((item) => {
      const {
        sectionId: _modelSectionId,
        sectionIndex: modelSectionIndex,
        ...content
      } = item as Record<string, unknown>;
      if (content.placement !== "section") return content;
      return {
        ...content,
        sectionIndex: modelSectionIndex,
        sectionId: resolveModelSectionId(contentPlan, modelSectionIndex, "imagePlan")
      };
    })
  });
}

export function canonicalizeLayoutPlanStructure(contentPlan: ContentPlan, value: unknown): LayoutPlan {
  const candidate = value as Record<string, unknown>;
  const blocks = Array.isArray(candidate.blocks) ? candidate.blocks : [];

  return layoutPlanSchema.parse({
    ...candidate,
    structureVersion: contentPlan.structureVersion,
    blocks: blocks.map((block) => {
      const {
        sectionId: _modelSectionId,
        sectionIndex: modelSectionIndex,
        ...content
      } = block as Record<string, unknown>;
      const referencesSection = content.kind === "section"
        || (content.kind === "image" && modelSectionIndex !== undefined);
      if (!referencesSection) return content;
      return {
        ...content,
        sectionIndex: modelSectionIndex,
        sectionId: resolveModelSectionId(contentPlan, modelSectionIndex, "layoutPlan")
      };
    })
  });
}

export function canonicalizePresentationStructure(
  contentPlan: ContentPlan,
  value: unknown
): PresentationStyleDecision {
  const candidate = value as Record<string, unknown>;
  return presentationStyleDecisionSchema.parse({
    ...candidate,
    structureVersion: contentPlan.structureVersion
  });
}

export function normalizeOutlineStructure(contentPlan: ContentPlan, value: unknown): ArticleOutline {
  const candidate = value as Record<string, unknown>;
  const sections = Array.isArray(candidate.sections) ? candidate.sections : [];
  return articleOutlineSchema.parse({
    ...candidate,
    structureVersion: candidate.structureVersion ?? contentPlan.structureVersion,
    sections: sections.map((section, index) => ({
      ...(section as Record<string, unknown>),
      sectionId: (section as Record<string, unknown>).sectionId ?? contentPlan.sections[index]?.sectionId
    }))
  });
}

export function normalizeDraftStructure(contentPlan: ContentPlan, value: unknown): ArticleDraft {
  const candidate = value as Record<string, unknown>;
  const sections = Array.isArray(candidate.sections) ? candidate.sections : [];
  return articleDraftSchema.parse({
    ...candidate,
    structureVersion: candidate.structureVersion ?? contentPlan.structureVersion,
    sections: sections.map((section, index) => ({
      ...(section as Record<string, unknown>),
      sectionId: (section as Record<string, unknown>).sectionId ?? contentPlan.sections[index]?.sectionId
    }))
  });
}

export function normalizeImagePlanStructure(contentPlan: ContentPlan, value: unknown): ImagePlan {
  const candidate = value as Record<string, unknown>;
  const items = Array.isArray(candidate.items) ? candidate.items : [];
  return imagePlanSchema.parse({
    ...candidate,
    structureVersion: candidate.structureVersion ?? contentPlan.structureVersion,
    items: items.map((item) => {
      const record = item as Record<string, unknown>;
      const index = typeof record.sectionIndex === "number" ? record.sectionIndex : undefined;
      return {
        ...record,
        sectionId: record.sectionId ?? (record.placement === "section" && index !== undefined
          ? contentPlan.sections[index]?.sectionId
          : undefined)
      };
    })
  });
}

export function normalizeLayoutPlanStructure(contentPlan: ContentPlan, value: unknown): LayoutPlan {
  const candidate = value as Record<string, unknown>;
  const blocks = Array.isArray(candidate.blocks) ? candidate.blocks : [];
  return layoutPlanSchema.parse({
    ...candidate,
    structureVersion: candidate.structureVersion ?? contentPlan.structureVersion,
    blocks: blocks.map((block) => {
      const record = block as Record<string, unknown>;
      const index = typeof record.sectionIndex === "number" ? record.sectionIndex : undefined;
      return {
        ...record,
        sectionId: record.sectionId ?? (index !== undefined ? contentPlan.sections[index]?.sectionId : undefined)
      };
    })
  });
}

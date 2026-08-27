import { describe, expect, it } from "vitest";
import type { ArticleDraft, ContentPlan, ImagePlan, LayoutPlan } from "@mediaforge/contracts";
import {
  assignContentPlanIdentity,
  assertDraftStructure,
  assertImagePlanStructure,
  assertLayoutPlanStructure,
  canonicalizeDraftStructure,
  canonicalizeImagePlanStructure,
  canonicalizeLayoutPlanStructure,
  canonicalizeOutlineStructure,
  canonicalizePresentationStructure,
  ModelStructureError,
  StructureGuardError
} from "./structure-guard";
import {
  createDeterministicPresentationDecision,
  extractUserPresentationConstraints
} from "./presentation";

function plan(): ContentPlan {
  return assignContentPlanIdentity({
    angle: "award fact",
    narrative: "stage to growth",
    requirements: [],
    sections: [
      { heading: "Opening: stage light", purpose: "open", keyPoints: ["award"], assetRefs: [] },
      { heading: "Looking back: practice", purpose: "process", keyPoints: ["effort"], assetRefs: [] },
      { heading: "Forward: next dance", purpose: "close", keyPoints: ["future"], assetRefs: [] }
    ],
    callToAction: "follow"
  }, "run_1");
}

function draft(contentPlan: ContentPlan): ArticleDraft {
  return {
    structureVersion: contentPlan.structureVersion,
    title: "award moment",
    intro: "award news",
    sections: contentPlan.sections.map((section) => ({
      sectionId: section.sectionId,
      heading: section.heading,
      purpose: section.purpose,
      paragraphs: ["body"],
      assetRefs: []
    })),
    conclusion: "keep going"
  };
}

describe("structure guard", () => {
  it("binds authoritative outline identities instead of trusting copied model identifiers", () => {
    const contentPlan = plan();
    const rawOutline = {
      structureVersion: "model_supplied_version",
      title: "award moment",
      openingHook: "award news",
      callToAction: "follow",
      sections: contentPlan.sections.map((section, index) => ({
        sectionId: index === 0 ? "section_1_transposed" : section.sectionId,
        title: section.heading,
        objective: section.purpose,
        storyBeat: "story",
        commercialGoal: "brand"
      }))
    };

    const outline = canonicalizeOutlineStructure(contentPlan, rawOutline);

    expect(outline.structureVersion).toBe(contentPlan.structureVersion);
    expect(outline.sections.map((section) => section.sectionId)).toEqual(
      contentPlan.sections.map((section) => section.sectionId)
    );
    expect(() => assertDraftStructure(contentPlan, canonicalizeDraftStructure(contentPlan, {
      ...draft(contentPlan),
      structureVersion: "model_supplied_version",
      sections: draft(contentPlan).sections.map(({ sectionId: _sectionId, ...section }) => section)
    }))).not.toThrow();
  });

  it("rejects ordered model output with a different section count before binding identities", () => {
    const contentPlan = plan();
    const rawDraft = draft(contentPlan);
    rawDraft.sections.pop();

    expect(() => canonicalizeDraftStructure(contentPlan, rawDraft)).toThrowError(
      expect.objectContaining<ModelStructureError>({
        code: "MODEL_SECTION_COUNT_MISMATCH"
      })
    );
  });

  it("resolves local image and layout indexes to authoritative section identities", () => {
    const contentPlan = plan();

    const imagePlan = canonicalizeImagePlanStructure(contentPlan, {
      structureVersion: "model_supplied_version",
      items: [{
        placement: "section",
        sectionIndex: 1,
        sectionId: "model_supplied_id",
        description: "practice image"
      }]
    });
    const layoutPlan = canonicalizeLayoutPlanStructure(contentPlan, {
      structureVersion: "model_supplied_version",
      theme: "story",
      palette: { primary: "#111111", accent: "#222222", text: "#333333", surface: "#FFFFFF" },
      titleTreatment: "centered",
      introTreatment: "plain",
      sectionTreatment: "minimal",
      imageTreatment: "framed",
      blocks: [
        { kind: "title" },
        { kind: "section", sectionIndex: 2, sectionId: "model_supplied_id" }
      ]
    });

    expect(imagePlan.structureVersion).toBe(contentPlan.structureVersion);
    expect(imagePlan.items[0]?.sectionId).toBe(contentPlan.sections[1]?.sectionId);
    expect(layoutPlan.structureVersion).toBe(contentPlan.structureVersion);
    expect(layoutPlan.blocks[1]?.sectionId).toBe(contentPlan.sections[2]?.sectionId);
  });

  it("rejects out-of-range local section indexes before canonical structure validation", () => {
    const contentPlan = plan();

    for (const canonicalize of [
      () => canonicalizeImagePlanStructure(contentPlan, {
        items: [{ placement: "section", sectionIndex: 9, description: "image" }]
      }),
      () => canonicalizeLayoutPlanStructure(contentPlan, {
        theme: "story",
        palette: { primary: "#111111", accent: "#222222", text: "#333333", surface: "#FFFFFF" },
        titleTreatment: "centered",
        introTreatment: "plain",
        sectionTreatment: "minimal",
        imageTreatment: "framed",
        blocks: [{ kind: "title" }, { kind: "section", sectionIndex: 9 }]
      })
    ]) {
      expect(canonicalize).toThrowError(expect.objectContaining<ModelStructureError>({
        code: "MODEL_SECTION_INDEX_INVALID"
      }));
    }
  });

  it("binds the presentation structure version on the server", () => {
    const contentPlan = plan();
    const rawDecision = createDeterministicPresentationDecision({
      structureVersion: "model_supplied_version",
      subject: "award",
      goal: "event",
      tone: "warm",
      narrative: "growth",
      callToAction: "follow",
      imageCount: 2,
      constraints: extractUserPresentationConstraints("complete the article"),
      selectedSkills: []
    });

    expect(canonicalizePresentationStructure(contentPlan, rawDecision).structureVersion)
      .toBe(contentPlan.structureVersion);
  });

  it("allows display heading changes when section identity remains stable", () => {
    const contentPlan = plan();
    const value = draft(contentPlan);
    value.sections[0]!.heading = "stage light";

    expect(() => assertDraftStructure(contentPlan, value)).not.toThrow();
  });

  it("rejects duplicated and reordered draft section identities", () => {
    const contentPlan = plan();
    const duplicated = draft(contentPlan);
    duplicated.sections[1]!.sectionId = duplicated.sections[0]!.sectionId;
    expect(() => assertDraftStructure(contentPlan, duplicated)).toThrowError(
      expect.objectContaining({ code: "SECTION_ID_DUPLICATED" })
    );

    const reordered = draft(contentPlan);
    reordered.sections.reverse();
    expect(() => assertDraftStructure(contentPlan, reordered)).toThrowError(
      expect.objectContaining({ code: "SECTION_ORDER_DRIFT" })
    );
  });

  it("rejects duplicated identities already present in a content plan", () => {
    const contentPlan = plan();
    contentPlan.sections[1]!.sectionId = contentPlan.sections[0]!.sectionId;

    expect(() => assignContentPlanIdentity(contentPlan, "run_1")).toThrowError(
      expect.objectContaining({ code: "SECTION_ID_DUPLICATED" })
    );
  });

  it("rejects stale structure versions", () => {
    const contentPlan = plan();
    const value = draft(contentPlan);
    value.structureVersion = "old_structure";

    expect(() => assertDraftStructure(contentPlan, value)).toThrowError(
      expect.objectContaining({ code: "STRUCTURE_VERSION_STALE" })
    );
  });

  it("rejects unknown image and layout section references", () => {
    const contentPlan = plan();
    const imagePlan: ImagePlan = {
      structureVersion: contentPlan.structureVersion,
      items: [{ placement: "section", sectionId: "unknown", description: "image" }]
    };
    const layoutPlan: LayoutPlan = {
      structureVersion: contentPlan.structureVersion,
      theme: "story",
      palette: { primary: "#111111", accent: "#222222", text: "#333333", surface: "#FFFFFF" },
      titleTreatment: "centered",
      introTreatment: "plain",
      sectionTreatment: "minimal",
      imageTreatment: "framed",
      blocks: [{ kind: "title" }, { kind: "section", sectionId: "unknown" }]
    };

    for (const check of [
      () => assertImagePlanStructure(contentPlan, imagePlan),
      () => assertLayoutPlanStructure(contentPlan, layoutPlan)
    ]) {
      expect(check).toThrowError(expect.objectContaining({ code: "SECTION_REFERENCE_INVALID" }));
    }
  });

  it("exposes safe structured diagnostics", () => {
    const error = new StructureGuardError("SECTION_SET_MISMATCH", {
      expectedSectionIds: ["section_1"],
      actualSectionIds: []
    });

    expect(error.message).toBe("STRUCTURE_GUARD_FAILED:SECTION_SET_MISMATCH");
    expect(error.details).toEqual({ expectedSectionIds: ["section_1"], actualSectionIds: [] });
  });
});

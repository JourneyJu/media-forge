import { describe, expect, it } from "vitest";
import {
  articleDraftModelOutputSchema,
  articleOutlineModelOutputSchema,
  imagePlanModelOutputSchema,
  layoutPlanModelOutputSchema,
  presentationStyleModelOutputSchema,
  stripSystemStructureIdentity
} from "./agents";

describe("creation agent model output schemas", () => {
  it("keeps system identity out of ordered content model outputs", () => {
    const outline = articleOutlineModelOutputSchema.parse({
      structureVersion: "model_version",
      title: "title",
      openingHook: "hook",
      callToAction: "follow",
      sections: [{
        sectionId: "model_id",
        title: "section",
        objective: "objective",
        storyBeat: "story",
        commercialGoal: "brand"
      }, {
        title: "section 2",
        objective: "objective",
        storyBeat: "story",
        commercialGoal: "brand"
      }, {
        title: "section 3",
        objective: "objective",
        storyBeat: "story",
        commercialGoal: "brand"
      }]
    });
    const draft = articleDraftModelOutputSchema.parse({
      structureVersion: "model_version",
      title: "title",
      intro: "intro",
      sections: [1, 2, 3].map((index) => ({
        sectionId: `model_${index}`,
        heading: `section ${index}`,
        purpose: "purpose",
        paragraphs: ["body"],
        assetRefs: []
      })),
      conclusion: "conclusion"
    });

    expect(outline).not.toHaveProperty("structureVersion");
    expect(outline.sections[0]).not.toHaveProperty("sectionId");
    expect(draft).not.toHaveProperty("structureVersion");
    expect(draft.sections[0]).not.toHaveProperty("sectionId");
  });

  it("defers exact ordered section counts to the canonicalizer", () => {
    const result = articleOutlineModelOutputSchema.safeParse({
      title: "title",
      openingHook: "hook",
      callToAction: "follow",
      sections: [{
        title: "section",
        objective: "objective",
        storyBeat: "story",
        commercialGoal: "brand"
      }, {
        title: "section 2",
        objective: "objective",
        storyBeat: "story",
        commercialGoal: "brand"
      }]
    });

    expect(result.success).toBe(true);
  });

  it("uses local indexes for image and layout model references", () => {
    const imagePlan = imagePlanModelOutputSchema.parse({
      structureVersion: "model_version",
      items: [{
        placement: "section",
        description: "image",
        sectionIndex: 1,
        sectionId: "model_id"
      }]
    });
    const layoutPlan = layoutPlanModelOutputSchema.parse({
      structureVersion: "model_version",
      theme: "story",
      palette: { primary: "#111111", accent: "#222222", text: "#333333", surface: "#FFFFFF" },
      titleTreatment: "centered",
      introTreatment: "plain",
      sectionTreatment: "minimal",
      imageTreatment: "framed",
      blocks: [{ kind: "title" }, { kind: "section", sectionIndex: 1, sectionId: "model_id" }]
    });

    expect(imagePlan).not.toHaveProperty("structureVersion");
    expect(imagePlan.items[0]).toMatchObject({ sectionIndex: 1 });
    expect(imagePlan.items[0]).not.toHaveProperty("sectionId");
    expect(layoutPlan).not.toHaveProperty("structureVersion");
    expect(layoutPlan.blocks[1]).not.toHaveProperty("sectionId");
  });

  it("keeps the presentation model output free of structure versions", () => {
    expect(presentationStyleModelOutputSchema.keyof().options).not.toContain("structureVersion");
  });

  it("removes system structure identity from nested model inputs", () => {
    expect(stripSystemStructureIdentity({
      contentPlan: {
        structureVersion: "structure_1",
        sections: [{ sectionId: "section_1", heading: "opening" }]
      },
      outline: {
        sections: [{ sectionId: "section_1", title: "opening" }]
      },
      userInput: "keep this"
    })).toEqual({
      contentPlan: { sections: [{ heading: "opening" }] },
      outline: { sections: [{ title: "opening" }] },
      userInput: "keep this"
    });
  });
});

import { describe, expect, it } from "vitest";
import { effectiveRunResourceIds } from "./conversation-lifecycle";

describe("conversation lifecycle resource inheritance", () => {
  it("keeps inherited resources for continued runs", () => {
    expect(effectiveRunResourceIds({
      creationMode: "continue",
      currentResourceIds: ["new_image"],
      inheritedResourceIds: ["old_image"],
      artifactResourceIds: ["artifact_image"]
    })).toEqual(["new_image", "old_image"]);
  });

  it("drops inherited resources for new runs", () => {
    expect(effectiveRunResourceIds({
      creationMode: "new",
      currentResourceIds: ["new_image"],
      inheritedResourceIds: ["old_image"],
      artifactResourceIds: ["artifact_image"]
    })).toEqual(["new_image"]);
  });

  it("keeps artifact resources for revisions", () => {
    expect(effectiveRunResourceIds({
      creationMode: "revise",
      currentResourceIds: [],
      inheritedResourceIds: ["old_image"],
      artifactResourceIds: ["artifact_image"]
    })).toEqual(["old_image", "artifact_image"]);
  });
});

import { describe, expect, it } from "vitest";
import { phonePreviewLayout } from "./phone-preview-layout";

describe("phonePreviewLayout", () => {
  it("keeps the article viewport at 390 by 844 while scaling the full device to 80 percent", () => {
    expect(phonePreviewLayout.viewport).toEqual({ width: 390, height: 844 });
    expect(phonePreviewLayout.device).toEqual({ width: 410, height: 864 });
    expect(phonePreviewLayout.scale).toBe(0.8);
    expect(phonePreviewLayout.stage).toEqual({ width: 328, height: 691.2 });
  });

  it("allocates a compact preview column without shrinking the editor", () => {
    expect(phonePreviewLayout.columns).toEqual({
      history: 260,
      collapsedHistory: 72,
      editorMinimum: 720,
      preview: 400,
      gap: 18,
      trailingPadding: 22
    });
    expect(phonePreviewLayout.workbenchMinimum).toBe(1438);
    expect(phonePreviewLayout.collapsedWorkbenchMinimum).toBe(1250);
  });
});

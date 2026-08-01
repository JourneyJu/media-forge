import { describe, expect, it } from "vitest";
import { analyzeAssetRequestSchema } from "./ai-generation";

describe("analyzeAssetRequestSchema", () => {
  it("accepts an HTTPS image and fills the default purpose", () => {
    const result = analyzeAssetRequestSchema.parse({
      workspaceId: "workspace_1",
      assetId: "asset_1",
      imageUrl: "https://cdn.example.com/poster.jpg"
    });

    expect(result.purpose).toBe("body");
  });

  it("rejects an HTTP image URL", () => {
    expect(() =>
      analyzeAssetRequestSchema.parse({
        workspaceId: "workspace_1",
        assetId: "asset_1",
        imageUrl: "http://cdn.example.com/poster.jpg"
      })
    ).toThrow();
  });
});

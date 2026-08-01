import { describe, expect, it } from "vitest";
import { generateWechatArticleRequestSchema } from "./ai-generation";

describe("generateWechatArticleRequestSchema", () => {
  it("fills conservative generation defaults", () => {
    const result = generateWechatArticleRequestSchema.parse({
      workspaceId: "workspace_1",
      topic: "暑期少儿编程班"
    });

    expect(result.tone).toBe("friendly");
    expect(result.style).toBe("practical");
    expect(result.assetIds).toEqual([]);
  });

  it("rejects a blank topic", () => {
    expect(() =>
      generateWechatArticleRequestSchema.parse({
        workspaceId: "workspace_1",
        topic: " "
      })
    ).toThrow();
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { generateWechatArticle, parseGenerateWechatArticleRequest } from "./ai-generation";

describe("wechat article generation", () => {
  beforeEach(() => {
    process.env.MODEL_MODE = "demo";
  });
  it("generates a structured document and compatible HTML in local demo mode", async () => {
    const input = parseGenerateWechatArticleRequest({
      workspaceId: "workspace_1",
      topic: "周末亲子烘焙课",
      audience: "6-10 岁孩子的家长",
      sellingPoints: ["小班教学", "成品可以带回家"]
    });

    const result = await generateWechatArticle(input);

    expect(result.document.attrs.title).toBe("周末亲子烘焙课");
    expect(result.document.content.some((block) => block.type === "heading")).toBe(true);
    expect(result.render.html).toContain("周末亲子烘焙课");
    expect(result.model.mode).toBe("local-demo");
  });

  it("never exposes writing instructions or review language in article copy", async () => {
    const input = parseGenerateWechatArticleRequest({
      workspaceId: "workspace_1",
      topic: "儿童摄影",
      audience: "未成年儿童的家长",
      sellingPoints: ["留住儿童成长的时光"],
      style: "story"
    });

    const result = await generateWechatArticle(input);
    const copy = result.document.content
      .flatMap((block) => block.content ?? [])
      .map((item) => item.text)
      .join("");

    expect(copy).not.toMatch(/补充真实信息|案例和行动建议|让内容更可信|围绕[“"].*[”"]/);
    expect(copy).toContain("儿童摄影");
    expect(copy).toContain("留住儿童成长的时光");
  });
});

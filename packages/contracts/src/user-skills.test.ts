import { describe, expect, it } from "vitest";
import {
  createConversationTurnRequestSchema,
  resolvedUserSkillSchema,
  userSkillManifestSchema
} from "./index";

describe("user private skill contracts", () => {
  it("accepts a private wechat style skill with logo and qrcode assets", () => {
    const manifest = userSkillManifestSchema.parse({
      manifestVersion: "1.0",
      name: "高端托育园温暖风",
      description: "适合托育园招生公众号",
      category: "wechat_article_style",
      style: {
        tone: "温暖、专业、有信任感",
        audience: "0-3岁儿童家长",
        paragraphLength: "medium",
        primaryColor: "#6B8F71"
      },
      writingRules: ["开头先进入家长熟悉的生活场景"],
      forbiddenRules: ["不要使用焦虑营销"],
      assets: [
        { key: "brand_logo", type: "logo", required: true, usage: "文章结尾品牌露出" },
        { key: "consult_qrcode", type: "qrcode", required: true, usage: "CTA 引导扫码咨询" }
      ]
    });

    expect(manifest.assets.map((asset) => asset.key)).toEqual(["brand_logo", "consult_qrcode"]);
  });

  it("rejects duplicate asset keys", () => {
    expect(() => userSkillManifestSchema.parse({
      manifestVersion: "1.0",
      name: "重复资源",
      category: "wechat_article_style",
      style: { tone: "温暖" },
      assets: [
        { key: "brand_logo", type: "logo", usage: "结尾露出" },
        { key: "brand_logo", type: "qrcode", usage: "扫码咨询" }
      ]
    })).toThrow();
  });

  it("keeps skill mentions structured on conversation turns", () => {
    const turn = createConversationTurnRequestSchema.parse({
      idempotencyKey: "turn-with-private-skill",
      content: "@高端托育园温暖风 写一篇秋季招生活动",
      skillMentions: [{
        skillId: "skill_1",
        versionId: "skill_version_1",
        alias: "高端托育园温暖风"
      }]
    });

    expect(turn.skillMentions[0]?.skillId).toBe("skill_1");
  });

  it("describes resolved skill assets without exposing raw files", () => {
    const resolved = resolvedUserSkillSchema.parse({
      skillId: "skill_1",
      versionId: "skill_version_1",
      name: "高端托育园温暖风",
      manifest: {
        manifestVersion: "1.0",
        name: "高端托育园温暖风",
        category: "wechat_article_style",
        style: { tone: "温暖" },
        assets: [{ key: "consult_qrcode", type: "qrcode", usage: "CTA 引导扫码咨询" }]
      },
      assets: [{ key: "consult_qrcode", type: "qrcode", usage: "CTA 引导扫码咨询", objectKey: "users/u/skills/s/assets/a/original" }]
    });

    expect(resolved.assets[0]?.key).toBe("consult_qrcode");
  });
});

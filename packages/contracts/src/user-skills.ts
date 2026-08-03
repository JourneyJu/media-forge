import { z } from "zod";

export const userSkillStatusSchema = z.enum(["draft", "active", "disabled", "rejected"]);
export const userSkillInstallStatusSchema = z.enum(["active", "disabled", "removed"]);
export const userSkillAssetTypeSchema = z.enum(["logo", "qrcode", "cover", "divider", "cta_image", "example_image"]);
export const userSkillAssetStatusSchema = z.enum(["active", "blocked", "deleted"]);
export const userSkillCategorySchema = z.enum(["wechat_article_style"]);

export const userSkillStyleSchema = z.object({
  tone: z.string().trim().min(1).max(120),
  audience: z.string().trim().max(200).optional(),
  paragraphLength: z.enum(["short", "medium", "long"]).optional(),
  titleStyle: z.string().trim().max(200).optional(),
  primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/u).optional()
});

export const userSkillManifestAssetSchema = z.object({
  key: z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/u),
  file: z.string().trim().min(1).max(300).optional(),
  type: userSkillAssetTypeSchema,
  required: z.boolean().default(false),
  usage: z.string().trim().min(1).max(300)
});

export const userSkillExampleSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(500)
});

export const userSkillManifestSchema = z.object({
  manifestVersion: z.literal("1.0"),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  category: userSkillCategorySchema.default("wechat_article_style"),
  style: userSkillStyleSchema,
  writingRules: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  forbiddenRules: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  assets: z.array(userSkillManifestAssetSchema).max(20).default([]),
  examples: z.array(userSkillExampleSchema).max(10).default([])
}).superRefine((value, context) => {
  const keys = new Set<string>();
  for (const [index, asset] of value.assets.entries()) {
    if (keys.has(asset.key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assets", index, "key"],
        message: "asset key must be unique"
      });
    }
    keys.add(asset.key);
  }
});

export const importUserSkillRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(100),
  manifest: userSkillManifestSchema
});

export const installUserSkillRequestSchema = z.object({
  versionId: z.string().trim().min(1).optional(),
  alias: z.string().trim().min(1).max(80).optional()
});

export const userSkillMentionSchema = z.object({
  skillId: z.string().trim().min(1),
  versionId: z.string().trim().min(1),
  alias: z.string().trim().min(1).max(80).optional()
});

export const resolvedUserSkillAssetSchema = z.object({
  id: z.string().trim().min(1),
  key: z.string().trim().min(1),
  type: userSkillAssetTypeSchema,
  usage: z.string().trim().min(1).max(300),
  objectKey: z.string().trim().min(1).optional(),
  previewObjectKey: z.string().trim().min(1).optional()
});

export const resolvedUserSkillSchema = z.object({
  skillId: z.string().trim().min(1),
  versionId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(80),
  alias: z.string().trim().min(1).max(80).optional(),
  manifest: userSkillManifestSchema,
  assets: z.array(resolvedUserSkillAssetSchema).max(20)
});

export type UserSkillStatus = z.infer<typeof userSkillStatusSchema>;
export type UserSkillInstallStatus = z.infer<typeof userSkillInstallStatusSchema>;
export type UserSkillAssetType = z.infer<typeof userSkillAssetTypeSchema>;
export type UserSkillAssetStatus = z.infer<typeof userSkillAssetStatusSchema>;
export type UserSkillCategory = z.infer<typeof userSkillCategorySchema>;
export type UserSkillManifest = z.infer<typeof userSkillManifestSchema>;
export type ImportUserSkillRequest = z.infer<typeof importUserSkillRequestSchema>;
export type InstallUserSkillRequest = z.infer<typeof installUserSkillRequestSchema>;
export type UserSkillMention = z.infer<typeof userSkillMentionSchema>;
export type ResolvedUserSkillAsset = z.infer<typeof resolvedUserSkillAssetSchema>;
export type ResolvedUserSkill = z.infer<typeof resolvedUserSkillSchema>;

export interface UserSkillAsset {
  id: string;
  skillId: string;
  versionId: string;
  assetKey: string;
  type: UserSkillAssetType;
  usage: string;
  originalName?: string;
  contentType?: string;
  sizeBytes?: number;
  previewUrl?: string;
  status: UserSkillAssetStatus;
  createdAt: string;
}

export interface UserSkillSummary {
  id: string;
  name: string;
  description: string;
  category: UserSkillCategory;
  status: UserSkillStatus;
  currentVersionId: string;
  alias?: string;
  installed: boolean;
  installedVersionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserSkillDetail extends UserSkillSummary {
  manifest: UserSkillManifest;
  assets: UserSkillAsset[];
  validationResult: Record<string, unknown>;
}

export interface ListUserSkillsResponse {
  items: UserSkillSummary[];
}

export interface ImportUserSkillResponse {
  skill: UserSkillDetail;
}

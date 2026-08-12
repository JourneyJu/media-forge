import { z } from "zod";
import type { Id, IsoDateTime } from "./common";

export type ArticleStatus = "draft" | "exported" | "archived";
export type ArticleVersionSource = "ai" | "manual" | "restore" | "import";

export type ArticleBlockType =
  | "heading"
  | "paragraph"
  | "image"
  | "quote"
  | "divider"
  | "callout"
  | "button"
  | "video"
  | "footer"
  | "signup"
  | "address"
  | "qrcode";

export type WechatRenderWarningCode =
  | "IMAGE_URL_NOT_HTTPS"
  | "IMAGE_URL_MISSING"
  | "VIDEO_REQUIRES_MANUAL_INSERT";

export interface WechatRenderWarning {
  code: WechatRenderWarningCode;
  blockId: Id;
  message: string;
}

export interface WechatRenderResult {
  html: string;
  rendererVersion: string;
  warnings: WechatRenderWarning[];
}

export interface ArticleDocument {
  type: "doc";
  attrs: {
    title: string;
    scenario: string;
    structureVersion?: string;
  };
  content: ArticleBlock[];
}

export interface ArticleBlock {
  id: Id;
  type: ArticleBlockType;
  attrs?: Record<string, unknown>;
  content?: Array<{ type: "text"; text: string }>;
}

export const articleBlockSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "heading", "paragraph", "image", "quote", "divider", "callout",
    "button", "video", "footer", "signup", "address", "qrcode"
  ]),
  attrs: z.record(z.unknown()).optional(),
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })).optional()
}) satisfies z.ZodType<ArticleBlock>;

export const articleDocumentSchema = z.object({
  type: z.literal("doc"),
  attrs: z.object({
    title: z.string().trim().min(1).max(200),
    scenario: z.string().trim().min(1).max(80),
    structureVersion: z.string().trim().min(1).optional()
  }),
  content: z.array(articleBlockSchema).min(1).max(100)
}) satisfies z.ZodType<ArticleDocument>;

export interface ArticleSummary {
  id: Id;
  workspaceId: Id;
  title: string;
  status: ArticleStatus;
  currentVersionId?: Id;
  updatedAt: IsoDateTime;
}

export interface ArticleVersionSummary {
  id: Id;
  articleId: Id;
  versionNo: number;
  source: ArticleVersionSource;
  skillPackId?: Id;
  skillPackVersion?: string;
  rendererVersion: string;
  createdAt: IsoDateTime;
}

import { z } from "zod";
import type { ArticleDocument, WechatRenderResult } from "./articles";

export const articleToneSchema = z.enum(["friendly", "professional", "lively", "warm"]);
export const articleStyleSchema = z.enum(["practical", "story", "list", "promotion"]);

export const generateWechatArticleRequestSchema = z.object({
  workspaceId: z.string().trim().min(1),
  topic: z.string().trim().min(1).max(200),
  audience: z.string().trim().max(500).default(""),
  sellingPoints: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
  tone: articleToneSchema.default("friendly"),
  style: articleStyleSchema.default("practical"),
  assetIds: z.array(z.string().trim().min(1)).max(30).default([]),
  extraInstructions: z.string().trim().max(2000).default("")
});

export const reviseWechatArticleRequestSchema = z.object({
  articleId: z.string().trim().min(1),
  instruction: z.string().trim().min(1).max(2000),
  currentDocument: z.custom<ArticleDocument>(
    (value) => typeof value === "object" && value !== null && (value as ArticleDocument).type === "doc",
    "文章结构不合法"
  )
});

export type GenerateWechatArticleRequest = z.infer<typeof generateWechatArticleRequestSchema>;
export type ReviseWechatArticleRequest = z.infer<typeof reviseWechatArticleRequestSchema>;

export const analyzeAssetRequestSchema = z.object({
  workspaceId: z.string().trim().min(1),
  assetId: z.string().trim().min(1),
  imageUrl: z.string().url().refine((value) => value.startsWith("https://"), "图片地址必须使用 HTTPS"),
  purpose: z.enum(["cover", "body", "qrcode", "poster"]).default("body")
});

export type AnalyzeAssetRequest = z.infer<typeof analyzeAssetRequestSchema>;

export interface AnalyzeAssetResponse {
  assetId: string;
  description: string;
  detectedType: "qrcode" | "poster" | "product" | "environment" | "unknown";
  ocrText: string;
  suggestedUsage: string;
  model: {
    provider: string;
    name: string;
    mode: "gateway" | "local-demo";
  };
}

export interface GenerateWechatArticleResponse {
  articleId: string;
  versionId: string;
  document: ArticleDocument;
  render: WechatRenderResult;
  model: {
    provider: string;
    name: string;
    mode: "gateway" | "local-demo";
  };
}

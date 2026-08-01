import type { Id, IsoDateTime } from "./common";
import { z } from "zod";

export type AssetUsageType = "cover" | "body" | "qrcode" | "product" | "store" | "course" | "poster";
export type AssetDetectedType = "qrcode" | "poster" | "store" | "teacher" | "student" | "product" | "course" | "environment" | "unknown";
export type SafeReviewStatus = "pending" | "pass" | "warning" | "blocked";

export interface AssetSummary {
  id: Id;
  workspaceId: Id;
  originalName: string;
  previewUrl: string;
  usageType: AssetUsageType;
  detectedType: AssetDetectedType;
  aiDescription?: string;
  ocrText?: string;
  qualityScore?: number;
  hasQrcode: boolean;
  safeReviewStatus: SafeReviewStatus;
  createdAt: IsoDateTime;
}

export const resourceStatusSchema = z.enum(["uploading", "staged", "attached", "failed", "deleting"]);
export const uploadSessionStatusSchema = z.enum(["active", "consumed", "expired"]);

export const createUploadSessionRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(100)
});

export type ResourceStatus = z.infer<typeof resourceStatusSchema>;
export type UploadSessionStatus = z.infer<typeof uploadSessionStatusSchema>;
export type CreateUploadSessionRequest = z.infer<typeof createUploadSessionRequestSchema>;

export interface UploadSession {
  id: Id;
  status: UploadSessionStatus;
  expiresAt: IsoDateTime;
  createdAt: IsoDateTime;
}

export interface ResourceSummary {
  id: Id;
  uploadSessionId: Id | null;
  conversationId: Id | null;
  status: ResourceStatus;
  source: "upload" | "paste";
  originalName: string;
  contentType: string;
  sizeBytes: number;
  previewUrl: string;
  contentUrl: string;
  createdAt: IsoDateTime;
}

export interface GetUploadSessionResponse {
  uploadSession: UploadSession;
  resources: ResourceSummary[];
}

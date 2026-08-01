import { z } from "zod";
import { authRoleSchema, authUserSchema, displayNameSchema, usernameSchema, userStatusSchema } from "./auth";

export const adminUserSchema = authUserSchema.extend({
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastLoginAt: z.string().datetime().nullable()
});

export const adminUserListQuerySchema = z.object({
  search: z.string().trim().max(64).default(""),
  status: userStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export const adminUserListResponseSchema = z.object({
  items: z.array(adminUserSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive()
});

export const createAdminUserRequestSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  role: authRoleSchema.default("user")
});

export const updateAdminUserRequestSchema = z.object({
  displayName: displayNameSchema.optional(),
  role: authRoleSchema.optional(),
  status: userStatusSchema.optional()
}).refine((value) => Object.keys(value).length > 0);

export const modelConnectionStatusSchema = z.enum(["draft", "active", "disabled"]);
export const modelTestStatusSchema = z.enum(["untested", "success", "failed"]);
export const modelModalitySchema = z.enum(["text", "multimodal"]);
export const modelRouteKeySchema = z.enum(["text_generation", "multimodal_generation"]);

export const modelConnectionSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(64),
  adapterType: z.literal("openai_compatible"),
  baseUrl: z.string().url(),
  secretConfigured: z.boolean(),
  status: modelConnectionStatusSchema,
  lastTestedAt: z.string().datetime().nullable(),
  lastTestStatus: modelTestStatusSchema,
  lastErrorCode: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const upsertModelConnectionRequestSchema = z.object({
  name: z.string().trim().min(1).max(64),
  adapterType: z.literal("openai_compatible").default("openai_compatible"),
  baseUrl: z.string().url(),
  apiKey: z.string().trim().min(1).max(4096).optional(),
  version: z.number().int().positive().optional()
});

export const modelConfigSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  displayName: z.string().trim().min(1).max(64),
  modelId: z.string().trim().min(1).max(128),
  modality: modelModalitySchema,
  supportsTextInput: z.boolean(),
  supportsImageInput: z.boolean(),
  supportsStructuredOutput: z.boolean(),
  contextWindow: z.number().int().positive().nullable(),
  maxOutputTokens: z.number().int().positive().nullable(),
  temperatureDefault: z.number().min(0).max(2),
  timeoutMs: z.number().int().min(1000).max(300000),
  status: modelConnectionStatusSchema,
  lastValidatedAt: z.string().datetime().nullable(),
  lastValidationStatus: modelTestStatusSchema,
  lastErrorCode: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const upsertModelConfigRequestSchema = z.object({
  connectionId: z.string().trim().min(1),
  displayName: z.string().trim().min(1).max(64),
  modelId: z.string().trim().min(1).max(128),
  modality: modelModalitySchema,
  supportsTextInput: z.boolean().default(true),
  supportsImageInput: z.boolean().default(false),
  supportsStructuredOutput: z.boolean().default(true),
  contextWindow: z.number().int().positive().nullable().default(null),
  maxOutputTokens: z.number().int().positive().nullable().default(null),
  temperatureDefault: z.number().min(0).max(2).default(0.5),
  timeoutMs: z.number().int().min(1000).max(300000).default(60000),
  version: z.number().int().positive().optional()
}).superRefine((value, context) => {
  if (value.modality === "text" && value.supportsImageInput) {
    context.addIssue({ code: "custom", message: "text model cannot support image input", path: ["supportsImageInput"] });
  }
});

export const modelRouteSchema = z.object({
  routeKey: modelRouteKeySchema,
  modelConfigId: z.string().nullable(),
  modelDisplayName: z.string().nullable(),
  updatedAt: z.string().datetime().nullable(),
  version: z.number().int().positive()
});

export const updateModelRouteRequestSchema = z.object({
  modelConfigId: z.string().trim().min(1),
  version: z.number().int().positive()
});

export const usageRangeQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  userId: z.string().optional(),
  modelConfigId: z.string().optional(),
  search: z.string().trim().max(64).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export const usageSummarySchema = z.object({
  generationCount: z.number().int().nonnegative(),
  generationSuccessCount: z.number().int().nonnegative(),
  generationFailedCount: z.number().int().nonnegative(),
  generationCancelledCount: z.number().int().nonnegative(),
  generationSuccessRate: z.number().min(0).max(1).nullable(),
  activeUsers: z.number().int().nonnegative(),
  modelCallCount: z.number().int().nonnegative(),
  modelSuccessCount: z.number().int().nonnegative(),
  modelFailedCount: z.number().int().nonnegative(),
  modelSuccessRate: z.number().min(0).max(1).nullable(),
  averageDurationMs: z.number().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  unavailableTokenCallCount: z.number().int().nonnegative()
});

export const usageTrendPointSchema = z.object({
  date: z.string().date(),
  generationCount: z.number().int().nonnegative(),
  modelCallCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  unavailableTokenCallCount: z.number().int().nonnegative()
});

export const userUsageRowSchema = usageSummarySchema.extend({
  userId: z.string(),
  username: usernameSchema,
  displayName: displayNameSchema
});

export const modelUsageRowSchema = usageSummarySchema.extend({
  modelConfigId: z.string(),
  modelDisplayName: z.string(),
  modelId: z.string(),
  activeUserCount: z.number().int().nonnegative(),
  modality: modelModalitySchema
});

export const usageDashboardResponseSchema = z.object({
  summary: usageSummarySchema,
  trend: z.array(usageTrendPointSchema),
  users: z.array(userUsageRowSchema),
  models: z.array(modelUsageRowSchema)
});

export type AdminUser = z.infer<typeof adminUserSchema>;
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;
export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>;
export type CreateAdminUserRequest = z.infer<typeof createAdminUserRequestSchema>;
export type UpdateAdminUserRequest = z.infer<typeof updateAdminUserRequestSchema>;
export type ModelConnection = z.infer<typeof modelConnectionSchema>;
export type ModelConfig = z.infer<typeof modelConfigSchema>;
export type ModelRoute = z.infer<typeof modelRouteSchema>;
export type ModelRouteKey = z.infer<typeof modelRouteKeySchema>;
export type UsageDashboardResponse = z.infer<typeof usageDashboardResponseSchema>;
export type UsageSummary = z.infer<typeof usageSummarySchema>;
export type UserUsageRow = z.infer<typeof userUsageRowSchema>;
export type ModelUsageRow = z.infer<typeof modelUsageRowSchema>;

import { describe, expect, it } from "vitest";
import {
  createAdminUserRequestSchema,
  upsertModelConfigRequestSchema,
  usageRangeQuerySchema,
  usageDashboardResponseSchema
} from "./admin";

describe("admin user contract", () => {
  it("accepts letters, numbers and underscores in a username", () => {
    expect(createAdminUserRequestSchema.parse({
      username: "2026_user",
      displayName: "林 Alice",
      role: "user"
    }).username).toBe("2026_user");
  });

  it("rejects unsupported username punctuation", () => {
    expect(() => createAdminUserRequestSchema.parse({
      username: "user-name",
      displayName: "User",
      role: "user"
    })).toThrow();
  });
});

describe("model configuration contract", () => {
  it("requires image input to be declared only by a multimodal model", () => {
    expect(() => upsertModelConfigRequestSchema.parse({
      connectionId: "connection_1",
      displayName: "Text model",
      modelId: "text-1",
      modality: "text",
      supportsImageInput: true
    })).toThrow();
  });
});

describe("usage monitoring contract", () => {
  it("applies paging defaults and validates a complete dashboard response", () => {
    expect(usageRangeQuerySchema.parse({ from: "2026-07-01", to: "2026-07-31" })).toMatchObject({
      page: 1,
      pageSize: 20
    });
    expect(() => usageDashboardResponseSchema.parse({
      summary: {
        generationCount: 1,
        generationSuccessCount: 1,
        generationFailedCount: 0,
        generationCancelledCount: 0,
        generationSuccessRate: 1,
        activeUsers: 1,
        modelCallCount: 1,
        modelSuccessCount: 1,
        modelFailedCount: 0,
        modelSuccessRate: 1,
        averageDurationMs: 120,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        unavailableTokenCallCount: 0
      },
      trend: [],
      users: [],
      models: []
    })).not.toThrow();
  });
});

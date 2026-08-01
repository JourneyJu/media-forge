import { describe, expect, it } from "vitest";
import { createUploadSessionRequestSchema } from "./assets";

describe("resource upload contracts", () => {
  it("requires an idempotency key before resources are uploaded", () => {
    expect(
      createUploadSessionRequestSchema.parse({
        idempotencyKey: "upload-request-001"
      })
    ).toEqual({
      idempotencyKey: "upload-request-001"
    });
  });

  it("rejects an implicit or empty upload session", () => {
    expect(() =>
      createUploadSessionRequestSchema.parse({
        idempotencyKey: ""
      })
    ).toThrow();
  });
});

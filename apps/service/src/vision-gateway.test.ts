import { afterEach, describe, expect, it } from "vitest";
import { readVisionGatewayConfig } from "./vision-gateway";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("readVisionGatewayConfig", () => {
  it("returns null when the visual model configuration is incomplete", () => {
    delete process.env.VISION_GATEWAY_BASE_URL;
    delete process.env.VISION_GATEWAY_API_KEY;
    delete process.env.VISION_GATEWAY_MODEL;

    expect(readVisionGatewayConfig()).toBeNull();
  });

  it("ignores legacy visual model environment variables", () => {
    process.env.VISION_GATEWAY_BASE_URL = "https://ark.example.com/api/v3/";
    process.env.VISION_GATEWAY_API_KEY = "test-secret";
    process.env.VISION_GATEWAY_MODEL = "vision-endpoint-id";

    expect(readVisionGatewayConfig()).toBeNull();
  });
});

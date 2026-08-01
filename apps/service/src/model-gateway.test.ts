import { afterEach, describe, expect, it } from "vitest";
import { readModelGatewayConfig } from "./model-gateway";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("readModelGatewayConfig", () => {
  it("stays in local demo mode when credentials are incomplete", () => {
    delete process.env.MODEL_GATEWAY_BASE_URL;
    delete process.env.MODEL_GATEWAY_API_KEY;
    delete process.env.MODEL_GATEWAY_DEFAULT_MODEL;

    expect(readModelGatewayConfig()).toBeNull();
  });

  it("ignores legacy model environment variables", () => {
    process.env.MODEL_GATEWAY_BASE_URL = "https://gateway.example.com/v1/";
    process.env.MODEL_GATEWAY_API_KEY = "test-secret";
    process.env.MODEL_GATEWAY_DEFAULT_MODEL = "example-model";

    expect(readModelGatewayConfig()).toBeNull();
  });
});

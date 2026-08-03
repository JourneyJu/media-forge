import { describe, expect, it } from "vitest";
import { assertProductionModelMode } from "./model-mode";

describe("production model mode", () => {
  it("rejects demo mode in production", () => {
    expect(() => assertProductionModelMode({ NODE_ENV: "production", MODEL_MODE: "demo" }))
      .toThrow("PRODUCTION_MODEL_MODE_DEMO_FORBIDDEN");
    expect(() => assertProductionModelMode({ NODE_ENV: "production" }))
      .toThrow("PRODUCTION_MODEL_MODE_DEMO_FORBIDDEN");
  });

  it("allows gateway mode in production and demo mode in tests", () => {
    expect(() => assertProductionModelMode({ NODE_ENV: "production", MODEL_MODE: "gateway" }))
      .not.toThrow();
    expect(() => assertProductionModelMode({ NODE_ENV: "test", MODEL_MODE: "demo" }))
      .not.toThrow();
  });
});

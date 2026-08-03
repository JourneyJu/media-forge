export function assertProductionModelMode(
  env: { NODE_ENV?: string; MODEL_MODE?: string } = process.env
): void {
  if (env.NODE_ENV === "production" && env.MODEL_MODE !== "gateway") {
    throw new Error("PRODUCTION_MODEL_MODE_DEMO_FORBIDDEN");
  }
}

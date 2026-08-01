import { describe, expect, it } from "vitest";
import { createWorkspaceRequestSchema } from "./workspaces";

describe("createWorkspaceRequestSchema", () => {
  it("fills optional workspace defaults", () => {
    const result = createWorkspaceRequestSchema.parse({
      name: "暑期招生",
      industry: "training",
      scenario: "enrollment"
    });

    expect(result.memoryEnabled).toBe(true);
    expect(result.defaultModules).toEqual([]);
    expect(result.forbiddenWords).toEqual([]);
  });

  it("rejects empty workspace names", () => {
    expect(() =>
      createWorkspaceRequestSchema.parse({
        name: " ",
        industry: "training",
        scenario: "enrollment"
      })
    ).toThrow();
  });
});

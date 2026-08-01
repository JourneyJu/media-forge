import { describe, expect, it } from "vitest";
import { buildWorkspaceProfile, parseCreateWorkspaceRequest } from "./workspaces";

describe("workspaces service", () => {
  it("builds a workspace profile from validated input", () => {
    const input = parseCreateWorkspaceRequest({
      name: "春季课程招生活动",
      industry: "training",
      scenario: "enrollment",
      audience: "家长",
      brandProfile: "少儿编程机构",
      stylePrompt: "清晰、可信、有行动按钮"
    });

    const workspace = buildWorkspaceProfile(input, "workspace_1");

    expect(workspace).toMatchObject({
      id: "workspace_1",
      name: "春季课程招生活动",
      memoryEnabled: true
    });
  });
});

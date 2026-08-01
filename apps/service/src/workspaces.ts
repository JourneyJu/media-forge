import { randomUUID } from "node:crypto";
import {
  createWorkspaceRequestSchema,
  type CreateWorkspaceRequest,
  type WorkspaceProfile
} from "@mediaforge/contracts";

export function parseCreateWorkspaceRequest(input: unknown): CreateWorkspaceRequest {
  return createWorkspaceRequestSchema.parse(input);
}

export function buildWorkspaceProfile(input: CreateWorkspaceRequest, id = randomUUID()): WorkspaceProfile {
  return {
    id,
    name: input.name,
    industry: input.industry,
    scenario: input.scenario,
    audience: input.audience,
    brandProfile: input.brandProfile,
    stylePrompt: input.stylePrompt,
    defaultModules: input.defaultModules,
    forbiddenWords: input.forbiddenWords,
    memoryEnabled: input.memoryEnabled
  };
}

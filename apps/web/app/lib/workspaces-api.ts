import {
  createWorkspaceRequestSchema,
  workspaceProfileSchema,
  type CreateWorkspaceRequest,
  type WorkspaceProfile
} from "@mediaforge/contracts";

export async function createWorkspace(
  apiBaseUrl: string,
  input: CreateWorkspaceRequest,
  fetchImpl: typeof fetch = fetch
): Promise<WorkspaceProfile> {
  const requestBody = createWorkspaceRequestSchema.parse(input);
  const response = await fetchImpl(`${apiBaseUrl}/workspaces`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error(`create_workspace_failed:${response.status}`);
  }

  return workspaceProfileSchema.parse(await response.json());
}

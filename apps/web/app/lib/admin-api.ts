import type {
  AdminUser,
  AdminUserListResponse,
  CreateAdminUserRequest,
  ModelConfig,
  ModelConnection,
  ModelRoute,
  ModelUsageRow,
  UpdateAdminUserRequest,
  UsageDashboardResponse,
  UserUsageRow
} from "@mediaforge/contracts";
import { authFetch } from "./auth-api";
import { serviceFetch } from "./api-client";

async function read<T>(response: Response): Promise<T> {
  if (response.status === 403) {
    if (typeof window !== "undefined") window.location.assign("/");
    throw new Error("仅管理员可以访问系统设置");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message ?? "请求失败，请稍后重试");
  }
  return response.json() as Promise<T>;
}

export async function listAdminUsers(search = "", status = "", page = 1, pageSize = 20): Promise<AdminUserListResponse> {
  const query = new URLSearchParams({ search, page: String(page), pageSize: String(pageSize) });
  if (status) query.set("status", status);
  return read(await authFetch(`/auth/admin/users?${query}`));
}

export async function getAdminUser(userId: string): Promise<AdminUser> {
  return read(await authFetch(`/auth/admin/users/${userId}`));
}

export async function createAdminUser(input: CreateAdminUserRequest): Promise<AdminUser> {
  return read(await authFetch("/auth/admin/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  }));
}

export async function updateAdminUser(userId: string, input: UpdateAdminUserRequest): Promise<AdminUser> {
  return read(await authFetch(`/auth/admin/users/${userId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  }));
}

export async function resetAdminUserPassword(userId: string): Promise<{ temporaryPassword: string }> {
  return read(await authFetch(`/auth/admin/users/${userId}/reset-password`, { method: "POST" }));
}

export async function listModelConnections(): Promise<ModelConnection[]> {
  return read(await serviceFetch("/admin/model-connections"));
}

export async function saveModelConnection(
  input: { name: string; adapterType: "openai_compatible"; baseUrl: string; apiKey?: string; version?: number },
  id?: string
): Promise<ModelConnection> {
  return read(await serviceFetch(id ? `/admin/model-connections/${id}` : "/admin/model-connections", {
    method: id ? "PATCH" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  }));
}

export async function testModelConnection(id: string): Promise<ModelConnection> {
  return read(await serviceFetch(`/admin/model-connections/${id}/test`, { method: "POST" }));
}

export async function disableModelConnection(id: string): Promise<ModelConnection> {
  return read(await serviceFetch(`/admin/model-connections/${id}/disable`, { method: "POST" }));
}

export async function listModelConfigs(): Promise<ModelConfig[]> {
  return read(await serviceFetch("/admin/model-configs"));
}

export async function getModelConfig(id: string): Promise<ModelConfig> {
  return read(await serviceFetch(`/admin/model-configs/${id}`));
}

export type ModelConfigInput = {
  connectionId: string;
  displayName: string;
  modelId: string;
  modality: "text" | "multimodal";
  supportsTextInput: boolean;
  supportsImageInput: boolean;
  supportsStructuredOutput: boolean;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  temperatureDefault: number;
  timeoutMs: number;
  version?: number;
};

export async function saveModelConfig(input: ModelConfigInput, id?: string): Promise<ModelConfig> {
  return read(await serviceFetch(id ? `/admin/model-configs/${id}` : "/admin/model-configs", {
    method: id ? "PATCH" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  }));
}

export async function validateModelConfig(id: string): Promise<ModelConfig> {
  return read(await serviceFetch(`/admin/model-configs/${id}/validate`, { method: "POST" }));
}

export async function disableModelConfig(id: string): Promise<ModelConfig> {
  return read(await serviceFetch(`/admin/model-configs/${id}/disable`, { method: "POST" }));
}

export async function listModelRoutes(): Promise<ModelRoute[]> {
  return read(await serviceFetch("/admin/model-routes"));
}

export async function updateModelRoute(route: ModelRoute, modelConfigId: string): Promise<ModelRoute> {
  return read(await serviceFetch(`/admin/model-routes/${route.routeKey}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ modelConfigId, version: route.version })
  }));
}

export async function getUsageDashboard(from: string, to: string): Promise<UsageDashboardResponse> {
  return read(await serviceFetch(`/admin/usage?${new URLSearchParams({ from, to })}`));
}

export type UsageUserDetail = {
  user: UserUsageRow;
  models: Array<Pick<ModelUsageRow,
    "modelConfigId" | "modelDisplayName" | "modelId" | "modality" | "modelCallCount"
    | "modelSuccessCount" | "modelFailedCount" | "modelSuccessRate" | "averageDurationMs"
    | "inputTokens" | "outputTokens" | "totalTokens" | "unavailableTokenCallCount">>;
  recentGenerations: Array<{
    generationId: string;
    generationType: string;
    status: string;
    modelCallCount: number;
    startedAt: string;
    completedAt: string | null;
  }>;
};

export async function getUsageUserDetail(userId: string, from: string, to: string): Promise<UsageUserDetail> {
  return read(await serviceFetch(`/admin/usage/users/${userId}?${new URLSearchParams({ from, to })}`));
}

export type UsageModelDetail = {
  model: ModelUsageRow;
  users: Array<Pick<UserUsageRow, "userId" | "username" | "displayName"
    | "modelCallCount" | "modelSuccessCount" | "modelFailedCount" | "modelSuccessRate"
    | "averageDurationMs" | "inputTokens" | "outputTokens" | "totalTokens"
    | "unavailableTokenCallCount">>;
};

export async function getUsageModelDetail(modelId: string, from: string, to: string): Promise<UsageModelDetail> {
  return read(await serviceFetch(`/admin/usage/models/${modelId}?${new URLSearchParams({ from, to })}`));
}

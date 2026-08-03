import type {
  Artifact,
  Conversation,
  CreateConversationTurnRequest,
  CreateConversationTurnResponse,
  CreateUploadSessionRequest,
  DeleteConversationResponse,
  GetConversationResponse,
  ListConversationsResponse,
  ResourceSummary,
  RunEvent,
  SubmitRunClarificationRequest,
  UploadSession
} from "@mediaforge/contracts";
import { getAccessToken } from "./auth-session";
import { serviceFetch, serviceUrl } from "./api-client";

async function readResponse<TBody>(response: Response, fallbackMessage: string): Promise<TBody> {
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(error?.message ?? fallbackMessage);
  }
  return response.json() as Promise<TBody>;
}

export function resolveResourceUrl(path: string): string {
  const url = new URL(path, serviceUrl);
  const accessToken = getAccessToken();
  if (accessToken) url.searchParams.set("access_token", accessToken);
  return url.toString();
}

export async function createConversation(
  input: CreateConversationTurnRequest
): Promise<CreateConversationTurnResponse> {
  return readResponse(await serviceFetch("/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  }), "会话创建失败，请稍后重试");
}

export async function appendConversationTurn(
  conversationId: string,
  input: CreateConversationTurnRequest
): Promise<CreateConversationTurnResponse> {
  return readResponse(await serviceFetch(`/conversations/${conversationId}/turns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  }), "消息发送失败，请稍后重试");
}

export async function listConversations(): Promise<ListConversationsResponse> {
  return readResponse(
    await serviceFetch("/conversations", { cache: "no-store" }),
    "历史会话读取失败"
  );
}

export async function getConversation(conversationId: string): Promise<GetConversationResponse> {
  return readResponse(
    await serviceFetch(`/conversations/${conversationId}`, { cache: "no-store" }),
    "会话读取失败，请稍后重试"
  );
}

export async function deleteConversation(conversationId: string): Promise<DeleteConversationResponse> {
  return readResponse(await serviceFetch(`/conversations/${conversationId}`, {
    method: "DELETE"
  }), "会话删除失败，请稍后重试");
}

export async function createUploadSession(input: CreateUploadSessionRequest): Promise<UploadSession> {
  return readResponse(await serviceFetch("/upload-sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  }), "上传会话创建失败");
}

export async function uploadResource(
  uploadSessionId: string,
  file: File,
  source: "upload" | "paste" = "upload",
  onProgress?: (progress: number) => void
): Promise<ResourceSummary> {
  if (onProgress) {
    const accessToken = getAccessToken();
    return new Promise<ResourceSummary>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", new URL(`/upload-sessions/${uploadSessionId}/resources`, serviceUrl).toString());
      request.setRequestHeader("content-type", file.type);
      request.setRequestHeader("x-file-name", encodeURIComponent(file.name || "pasted-image"));
      request.setRequestHeader("x-resource-source", source);
      request.setRequestHeader("idempotency-key", crypto.randomUUID());
      if (accessToken) request.setRequestHeader("authorization", `Bearer ${accessToken}`);
      request.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
      request.onerror = () => reject(new Error(`${file.name || "图片"}上传失败`));
      request.onload = () => {
        if (request.status >= 200 && request.status < 300) {
          onProgress(100);
          resolve(JSON.parse(request.responseText) as ResourceSummary);
          return;
        }
        const error = JSON.parse(request.responseText || "null") as { message?: string } | null;
        reject(new Error(error?.message ?? `${file.name || "图片"}上传失败`));
      };
      request.send(file);
    });
  }

  return readResponse(await serviceFetch(`/upload-sessions/${uploadSessionId}/resources`, {
    method: "POST",
    headers: {
      "content-type": file.type,
      "x-file-name": encodeURIComponent(file.name || "pasted-image"),
      "x-resource-source": source,
      "idempotency-key": crypto.randomUUID()
    },
    body: file
  }), `${file.name || "图片"}上传失败`);
}

export async function removeStagedResource(uploadSessionId: string, resourceId: string): Promise<void> {
  const response = await serviceFetch(
    `/upload-sessions/${uploadSessionId}/resources/${resourceId}`,
    { method: "DELETE" }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(error?.message ?? "资源移除失败");
  }
}

export async function submitRunClarification(
  runId: string,
  input: SubmitRunClarificationRequest
) {
  return readResponse(await serviceFetch(`/runs/${runId}/clarifications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  }), "追问信息提交失败，请稍后重试");
}

export async function getArtifact(artifactId: string): Promise<Artifact> {
  return readResponse(
    await serviceFetch(`/artifacts/${artifactId}`),
    "产物读取失败，请稍后重试"
  );
}

export function createRunEventSource(runId: string, afterEventNo?: number): EventSource {
  const url = new URL(`${serviceUrl}/runs/${runId}/events`);
  if (afterEventNo && afterEventNo > 0) url.searchParams.set("after", String(afterEventNo));
  const accessToken = getAccessToken();
  if (accessToken) url.searchParams.set("access_token", accessToken);
  return new EventSource(url.toString());
}

export function parseRunEvent(event: MessageEvent<string>): RunEvent["payload"] {
  return JSON.parse(event.data) as RunEvent["payload"];
}

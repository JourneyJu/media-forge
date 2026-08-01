import { redirectToLogin, refreshAccessToken } from "./auth-api";
import { clearAccessToken, getAccessToken } from "./auth-session";

export const serviceUrl = process.env.NEXT_PUBLIC_SERVICE_URL ?? "http://localhost:4000";

let refreshing: Promise<string> | null = null;

function toServiceUrl(path: string): string {
  return new URL(path, serviceUrl).toString();
}

async function refreshOnce(): Promise<string> {
  refreshing ??= refreshAccessToken().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

function withAuthorization(init: RequestInit, token: string | null): RequestInit {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return {
    ...init,
    headers
  };
}

export async function serviceFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let token = getAccessToken();
  if (!token) {
    try {
      token = await refreshOnce();
    } catch {
      clearAccessToken();
    }
  }

  let response = await fetch(toServiceUrl(path), withAuthorization(init, token));
  if (response.status !== 401) return response;

  try {
    token = await refreshOnce();
  } catch {
    clearAccessToken();
    redirectToLogin();
    return response;
  }

  response = await fetch(toServiceUrl(path), withAuthorization(init, token));
  if (response.status === 401) {
    clearAccessToken();
    redirectToLogin();
  }
  return response;
}

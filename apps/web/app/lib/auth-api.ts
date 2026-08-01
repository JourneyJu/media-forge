import type {
  EncryptedPassword,
  LoginResponse,
  MeResponse,
  PasswordEncryptionKeyResponse
} from "@mediaforge/contracts";
import { clearAccessToken, setAccessToken } from "./auth-session";

const authUrl = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:4100";
let passwordKeyCache: PasswordEncryptionKeyResponse | null = null;
let refreshingAccessToken: Promise<string> | null = null;

async function readResponse<TBody>(response: Response, fallbackMessage: string): Promise<TBody> {
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { code?: string; message?: string } | null;
    if (error?.code === "AUTH_INVALID_CREDENTIALS") {
      throw new Error("账号或密码不正确");
    }
    throw new Error(error?.message ?? fallbackMessage);
  }
  return response.json() as Promise<TBody>;
}

export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let token = (await import("./auth-session")).getAccessToken();
  if (!token) {
    try {
      token = await refreshAccessToken();
    } catch {
      token = null;
      clearAccessToken();
      redirectToLogin();
    }
  }
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  let response = await fetch(`${authUrl}${path}`, { ...init, headers, credentials: "include" });
  if (response.status === 401 && token) {
    try {
      token = await refreshAccessToken();
      headers.set("authorization", `Bearer ${token}`);
      response = await fetch(`${authUrl}${path}`, { ...init, headers, credentials: "include" });
    } catch {
      clearAccessToken();
      redirectToLogin();
    }
  }
  return response;
}

export async function getMe(): Promise<MeResponse> {
  return readResponse(await authFetch("/auth/me"), "用户信息获取失败");
}

async function getPasswordEncryptionKey(): Promise<PasswordEncryptionKeyResponse> {
  if (passwordKeyCache) return passwordKeyCache;
  const key = await readResponse<PasswordEncryptionKeyResponse>(await fetch(`${authUrl}/auth/password-key`, {
    method: "GET",
    credentials: "include"
  }), "密码加密密钥获取失败，请稍后重试");
  passwordKeyCache = key;
  return key;
}

function toBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

async function encryptPassword(password: string): Promise<EncryptedPassword> {
  const key = await getPasswordEncryptionKey();
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    key.publicKey,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    cryptoKey,
    new TextEncoder().encode(password)
  );
  return {
    alg: "RSA-OAEP-256",
    kid: key.kid,
    ciphertext: toBase64url(new Uint8Array(ciphertext))
  };
}

export async function login(input: { account: string; password: string }): Promise<LoginResponse> {
  const response = await readResponse<LoginResponse>(await fetch(`${authUrl}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      account: input.account,
      username: input.account,
      password: await encryptPassword(input.password)
    })
  }), "登录失败，请稍后重试");
  setAccessToken(response.accessToken);
  return response;
}

export async function changePassword(
  input: { currentPassword: string; nextPassword: string },
  accessToken: string
): Promise<MeResponse> {
  return readResponse(await fetch(`${authUrl}/auth/password/change`, {
    method: "POST",
    credentials: "include",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      currentPassword: await encryptPassword(input.currentPassword),
      nextPassword: await encryptPassword(input.nextPassword)
    })
  }), "密码修改失败，请稍后重试");
}

async function requestRefreshAccessToken(): Promise<string> {
  const response = await readResponse<{ accessToken: string }>(await fetch(`${authUrl}/auth/refresh`, {
    method: "POST",
    credentials: "include"
  }), "登录状态已过期，请重新登录");
  setAccessToken(response.accessToken);
  return response.accessToken;
}

export function redirectToLogin(): void {
  if (typeof window === "undefined" || window.location.pathname === "/login") return;
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

export async function refreshAccessToken(): Promise<string> {
  refreshingAccessToken ??= requestRefreshAccessToken().finally(() => {
    refreshingAccessToken = null;
  });
  return refreshingAccessToken;
}

export async function logout(): Promise<void> {
  const response = await fetch(`${authUrl}/auth/logout`, {
    method: "POST",
    credentials: "include"
  });
  if (!response.ok && response.status !== 204) {
    throw new Error("退出登录失败，请稍后重试");
  }
  clearAccessToken();
}

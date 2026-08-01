import { createPublicKey, createVerify, type JsonWebKey, type KeyObject } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { authContextSchema, type AuthContext } from "@mediaforge/contracts";

type JwtHeader = {
  alg: string;
  kid: string;
};

type AccessTokenPayload = {
  iss: string;
  sub: string;
  aud: string;
  role: string;
  session_id?: string;
  must_change_password?: boolean;
  membership_id?: string;
  exp: number;
};

type PublicJwk = JsonWebKey & {
  kid: string;
  alg?: string;
};

type JwksResponse = {
  keys: PublicJwk[];
};

const authJwksUrl = process.env.AUTH_JWKS_URL ?? "http://localhost:4100/auth/jwks.json";
const authIssuer = process.env.AUTH_JWT_ISSUER ?? "http://localhost:4100";
const authAudience = process.env.AUTH_JWT_AUDIENCE ?? "mediaforge-service";
const authSessionValidateUrl = process.env.AUTH_SESSION_VALIDATE_URL
  ?? "http://localhost:4100/auth/session/validate";
const jwksCacheTtlMs = 5 * 60 * 1000;

let jwksCache: { expiresAt: number; keys: Map<string, KeyObject> } | null = null;

function parseBase64urlJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

function bearerToken(request: IncomingMessage): string | null {
  const value = request.headers.authorization;
  const header = Array.isArray(value) ? value[0] : value;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

async function fetchJwks(): Promise<Map<string, KeyObject>> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;

  const response = await fetch(authJwksUrl);
  if (!response.ok) throw new Error("AUTH_JWKS_UNAVAILABLE");
  const body = await response.json() as JwksResponse;
  const keys = new Map<string, KeyObject>();
  for (const jwk of body.keys) {
    if (!jwk.kid) continue;
    keys.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }));
  }
  jwksCache = { expiresAt: Date.now() + jwksCacheTtlMs, keys };
  return keys;
}

export async function verifyServiceAccessToken(token: string): Promise<AuthContext> {
  const [encodedHeader, encodedPayload, signature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !signature) throw new Error("UNAUTHORIZED");

  const header = parseBase64urlJson<JwtHeader>(encodedHeader);
  if (header.alg !== "RS256" || !header.kid) throw new Error("UNAUTHORIZED");

  const keys = await fetchJwks();
  const key = keys.get(header.kid);
  if (!key) throw new Error("UNAUTHORIZED");

  const ok = createVerify("RSA-SHA256")
    .update(`${encodedHeader}.${encodedPayload}`)
    .end()
    .verify(key, signature, "base64url");
  if (!ok) throw new Error("UNAUTHORIZED");

  const payload = parseBase64urlJson<AccessTokenPayload>(encodedPayload);
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== authIssuer || payload.aud !== authAudience || payload.exp <= now) {
    throw new Error("UNAUTHORIZED");
  }

  if (!payload.session_id) throw new Error("UNAUTHORIZED");
  let response: Response;
  try {
    response = await fetch(authSessionValidateUrl, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000)
    });
  } catch {
    throw new Error("AUTH_SERVICE_UNAVAILABLE");
  }
  if (response.status === 401 || response.status === 403) throw new Error("UNAUTHORIZED");
  if (!response.ok) throw new Error("AUTH_SERVICE_UNAVAILABLE");
  return authContextSchema.parse(await response.json());
}

export async function requireAuthContext(
  request: IncomingMessage,
  requestUrl: URL
): Promise<AuthContext> {
  const token = bearerToken(request) ?? requestUrl.searchParams.get("access_token");
  if (!token) throw new Error("UNAUTHORIZED");
  const context = await verifyServiceAccessToken(token);
  if (context.mustChangePassword) throw new Error("AUTH_PASSWORD_CHANGE_REQUIRED");
  return context;
}

export function requireAdmin(context: AuthContext): void {
  if (context.role !== "admin") throw new Error("PERMISSION_REQUIRED");
}

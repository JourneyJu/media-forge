import { createHash, createPrivateKey, createPublicKey, createSign, createVerify, generateKeyPairSync, randomBytes } from "node:crypto";
import type { AuthContext } from "@mediaforge/contracts";
import type { KeyObject } from "node:crypto";

type JwtHeader = { alg: "RS256"; typ: "JWT"; kid: string };

export type AccessTokenPayload = {
  iss: string;
  sub: string;
  aud: string;
  role: AuthContext["role"];
  session_id: string;
  must_change_password: boolean;
  iat: number;
  exp: number;
};

export type TokenSigner = { kid: string; privateKey: KeyObject; publicKey: KeyObject };

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createTokenSigner(): TokenSigner {
  const pem = process.env.AUTH_JWT_PRIVATE_KEY_PEM?.replace(/\\n/g, "\n");
  const privateKey = pem ? createPrivateKey(pem) : generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const publicKey = createPublicKey(privateKey);
  const der = publicKey.export({ type: "spki", format: "der" });
  return { kid: createHash("sha256").update(der).digest("base64url").slice(0, 16), privateKey, publicKey };
}

export function signAccessToken(input: {
  signer: TokenSigner;
  issuer: string;
  audience: string;
  context: AuthContext;
  ttlSeconds: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header: JwtHeader = { alg: "RS256", typ: "JWT", kid: input.signer.kid };
  const payload: AccessTokenPayload = {
    iss: input.issuer,
    sub: input.context.userId,
    aud: input.audience,
    role: input.context.role,
    session_id: input.context.sessionId,
    must_change_password: input.context.mustChangePassword,
    iat: now,
    exp: now + input.ttlSeconds
  };
  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const signature = createSign("RSA-SHA256").update(signingInput).end().sign(input.signer.privateKey, "base64url");
  return `${signingInput}.${signature}`;
}

function parseBase64urlJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

export function verifyAccessToken(input: {
  token: string;
  signer: TokenSigner;
  issuer: string;
  audience: string;
}): AccessTokenPayload {
  const [encodedHeader, encodedPayload, signature] = input.token.split(".");
  if (!encodedHeader || !encodedPayload || !signature) throw new Error("UNAUTHORIZED");
  const header = parseBase64urlJson<JwtHeader>(encodedHeader);
  if (header.alg !== "RS256" || header.kid !== input.signer.kid) throw new Error("UNAUTHORIZED");
  const valid = createVerify("RSA-SHA256")
    .update(`${encodedHeader}.${encodedPayload}`)
    .end()
    .verify(input.signer.publicKey, signature, "base64url");
  if (!valid) throw new Error("UNAUTHORIZED");
  const payload = parseBase64urlJson<AccessTokenPayload>(encodedPayload);
  if (payload.iss !== input.issuer || payload.aud !== input.audience || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("UNAUTHORIZED");
  }
  return payload;
}

export function createRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createSessionSecret(): string {
  return randomBytes(32).toString("base64url");
}

type PublicJwk = JsonWebKey & { kid: string; alg: "RS256"; use: "sig" };

export function publicJwks(signer: TokenSigner): { keys: PublicJwk[] } {
  return {
    keys: [{
      ...signer.publicKey.export({ format: "jwk" }),
      kid: signer.kid,
      alg: "RS256",
      use: "sig"
    }]
  };
}

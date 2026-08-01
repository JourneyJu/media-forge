import { randomBytes } from "node:crypto";

export type AuthConfig = {
  port: number;
  databaseUrl: string;
  webOrigin: string;
  issuer: string;
  audience: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  bootstrapAdminAccount: string;
  bootstrapAdminPassword: string | null;
  allowGeneratedBootstrapPassword: boolean;
};

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function loadAuthConfig(): AuthConfig {
  const bootstrapAdminPassword = process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD ?? null;
  if (isProduction() && !bootstrapAdminPassword) {
    throw new Error("AUTH_BOOTSTRAP_ADMIN_PASSWORD_REQUIRED");
  }

  return {
    port: Number(process.env.PORT ?? 4100),
    databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/mediaforge",
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    issuer: process.env.AUTH_JWT_ISSUER ?? "http://localhost:4100",
    audience: process.env.AUTH_JWT_AUDIENCE ?? "mediaforge-service",
    accessTokenTtlSeconds: Number(process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS ?? 900),
    refreshTokenTtlDays: Number(process.env.AUTH_REFRESH_TOKEN_TTL_DAYS ?? 30),
    bootstrapAdminAccount: process.env.AUTH_BOOTSTRAP_ADMIN_ACCOUNT ?? "admin",
    bootstrapAdminPassword,
    allowGeneratedBootstrapPassword: !isProduction()
  };
}

export function createGeneratedBootstrapPassword(): string {
  return `local-${randomBytes(18).toString("base64url")}`;
}

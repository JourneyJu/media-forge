import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";
import {
  adminUserListQuerySchema,
  changePasswordRequestSchema,
  createAdminUserRequestSchema,
  loginRequestSchema,
  updateAdminUserRequestSchema
} from "@mediaforge/contracts";
import type { AuthConfig } from "./config";
import type { AuthService } from "./auth-service";
import type { TokenSigner } from "./tokens";
import { publicJwks } from "./tokens";
import type { PasswordDecryptor } from "./password-encryption";
import { decryptPassword, passwordEncryptionKey } from "./password-encryption";

function sendJson(response: ServerResponse, statusCode: number, body: unknown, config: AuthConfig): void {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "access-control-allow-origin": config.webOrigin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS"
  });
  response.end(JSON.stringify(body));
}

function setRefreshCookie(response: ServerResponse, refreshToken: string, config: AuthConfig): void {
  const secure = config.webOrigin.startsWith("https://") ? "; Secure" : "";
  response.setHeader("set-cookie", [
    `mediaforge_refresh=${refreshToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.refreshTokenTtlDays * 24 * 60 * 60}${secure}`
  ]);
}

function refreshCookie(request: IncomingMessage): string | null {
  const header = request.headers.cookie;
  const cookieHeader = Array.isArray(header) ? header.join("; ") : header;
  if (!cookieHeader) return null;
  for (const item of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = item.trim().split("=");
    if (rawName === "mediaforge_refresh") {
      return decodeURIComponent(rawValue.join("="));
    }
  }
  return null;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function bearerToken(request: IncomingMessage): string {
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");
  return value.slice("Bearer ".length);
}

function sendError(response: ServerResponse, error: unknown, config: AuthConfig): void {
  if (error instanceof ZodError || error instanceof SyntaxError) {
    sendJson(response, 400, { code: "VALIDATION_ERROR", message: "请求参数不合法" }, config);
    return;
  }
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  const statusByCode: Record<string, number> = {
    UNAUTHORIZED: 401,
    AUTH_INVALID_CREDENTIALS: 401,
    AUTH_PASSWORD_KEY_INVALID: 400,
    AUTH_SESSION_EXPIRED: 401,
    AUTH_REFRESH_TOKEN_REUSED: 401,
    AUTH_PASSWORD_CHANGE_REQUIRED: 403,
    AUTH_PASSWORD_POLICY_VIOLATION: 400,
    AUTH_LOGIN_LOCKED: 429,
    PERMISSION_REQUIRED: 403,
    USER_DISABLED: 403,
    USERNAME_CONFLICT: 409,
    LAST_ADMIN_REQUIRED: 409,
    SELF_ADMIN_CHANGE_FORBIDDEN: 409,
    NOT_FOUND: 404
  };
  const status = statusByCode[code] ?? 500;
  const message = status === 500 ? "认证服务内部错误" : "当前认证请求无法完成";
  sendJson(response, status, { code, message }, config);
}

export function createRequestHandler(input: {
  authService: AuthService;
  config: AuthConfig;
  passwordDecryptor: PasswordDecryptor;
  signer: TokenSigner;
}) {
  return async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    if (request.method === "OPTIONS") {
      sendJson(response, 204, {}, input.config);
      return;
    }

    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, { status: "ok", service: "mediaforge-auth" }, input.config);
      return;
    }

    if (request.method === "GET" && pathname === "/auth/jwks.json") {
      sendJson(response, 200, publicJwks(input.signer), input.config);
      return;
    }

    if (request.method === "GET" && pathname === "/auth/password-key") {
      sendJson(response, 200, passwordEncryptionKey(input.passwordDecryptor), input.config);
      return;
    }

    if (request.method === "POST" && pathname === "/auth/login") {
      try {
        const login = loginRequestSchema.parse(await readJson(request));
        const result = await input.authService.login(
          login.username ?? login.account!,
          decryptPassword(login.password, input.passwordDecryptor)
        );
        setRefreshCookie(response, result.refreshToken, input.config);
        const { refreshToken: _refreshToken, ...body } = result;
        sendJson(response, 200, body, input.config);
      } catch (error) {
        sendError(response, error, input.config);
      }
      return;
    }

    if (request.method === "POST" && pathname === "/auth/refresh") {
      try {
        const cookieRefreshToken = refreshCookie(request);
        if (!cookieRefreshToken) throw new Error("AUTH_SESSION_EXPIRED");
        const result = await input.authService.refresh(cookieRefreshToken);
        setRefreshCookie(response, result.refreshToken, input.config);
        const { refreshToken: _refreshToken, ...body } = result;
        sendJson(response, 200, body, input.config);
      } catch (error) {
        sendError(response, error, input.config);
      }
      return;
    }

    if (request.method === "GET" && pathname === "/auth/me") {
      try {
        sendJson(response, 200, await input.authService.me(bearerToken(request)), input.config);
      } catch (error) {
        sendError(response, error, input.config);
      }
      return;
    }

    if (request.method === "GET" && pathname === "/auth/session/validate") {
      try {
        sendJson(
          response,
          200,
          await input.authService.validateSession(bearerToken(request)),
          input.config
        );
      } catch (error) {
        sendError(response, error, input.config);
      }
      return;
    }

    if (request.method === "POST" && pathname === "/auth/password/change") {
      try {
        const body = changePasswordRequestSchema.parse(await readJson(request));
        sendJson(
          response,
          200,
          await input.authService.changePassword(
            bearerToken(request),
            decryptPassword(body.currentPassword, input.passwordDecryptor),
            decryptPassword(body.nextPassword, input.passwordDecryptor)
          ),
          input.config
        );
      } catch (error) {
        sendError(response, error, input.config);
      }
      return;
    }

    if (request.method === "POST" && pathname === "/auth/logout") {
      try {
        await input.authService.logout(refreshCookie(request));
        response.writeHead(204, {
          "access-control-allow-origin": input.config.webOrigin,
          "access-control-allow-credentials": "true",
          "set-cookie": [
            "mediaforge_refresh=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
            "mediaforge_refresh=; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=0"
          ]
        });
        response.end();
      } catch (error) {
        sendError(response, error, input.config);
      }
      return;
    }

    if (pathname === "/auth/admin/users" && request.method === "GET") {
      try {
        const query = adminUserListQuerySchema.parse(Object.fromEntries(url.searchParams.entries()));
        sendJson(response, 200, await input.authService.listUsers(bearerToken(request), query), input.config);
      } catch (error) {
        sendError(response, error, input.config);
      }
      return;
    }

    if (pathname === "/auth/admin/users" && request.method === "POST") {
      try {
        const body = createAdminUserRequestSchema.parse(await readJson(request));
        sendJson(response, 201, await input.authService.createUser(bearerToken(request), body), input.config);
      } catch (error) {
        sendError(response, error, input.config);
      }
      return;
    }

    const userRoute = pathname.match(/^\/auth\/admin\/users\/([^/]+)(?:\/(reset-password|disable|enable))?$/u);
    if (userRoute) {
      const userId = decodeURIComponent(userRoute[1]!);
      const action = userRoute[2];
      try {
        if (request.method === "GET" && !action) {
          sendJson(response, 200, await input.authService.getUser(bearerToken(request), userId), input.config);
          return;
        }
        if (request.method === "PATCH" && !action) {
          const body = updateAdminUserRequestSchema.parse(await readJson(request));
          sendJson(response, 200, await input.authService.updateUser(bearerToken(request), userId, body), input.config);
          return;
        }
        if (request.method === "POST" && action === "reset-password") {
          sendJson(response, 200, await input.authService.resetUserPassword(bearerToken(request), userId), input.config);
          return;
        }
        if (request.method === "POST" && (action === "disable" || action === "enable")) {
          const status = action === "disable" ? "disabled" : "active";
          sendJson(
            response,
            200,
            await input.authService.updateUser(bearerToken(request), userId, { status }),
            input.config
          );
          return;
        }
      } catch (error) {
        sendError(response, error, input.config);
        return;
      }
    }

    sendJson(response, 404, { code: "NOT_FOUND", message: "接口不存在" }, input.config);
  };
}

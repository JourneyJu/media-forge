import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type AuthContext,
  createConversationTurnRequestSchema,
  createConversationMessageRequestSchema,
  createConversationResourceRequestSchema,
  createConversationRunRequestSchema,
  createUploadSessionRequestSchema,
  createAgentRunRequestSchema,
  modelRouteKeySchema,
  renameConversationRequestSchema,
  updateModelRouteRequestSchema,
  upsertModelConfigRequestSchema,
  upsertModelConnectionRequestSchema,
  usageRangeQuerySchema,
  submitRunClarificationRequestSchema,
  submitAgentDecisionRequestSchema,
  importUserSkillRequestSchema,
  installUserSkillRequestSchema
} from "@mediaforge/contracts";
import { ZodError } from "zod";
import { agentRunStore } from "./agent-runs/agent-run";
import { generateWechatArticle, parseGenerateWechatArticleRequest } from "./ai-generation";
import { analyzeAsset, parseAnalyzeAssetRequest } from "./vision-gateway";
import { requireAdmin, requireAuthContext } from "./auth";
import { adminConsole } from "./admin-console";
import { conversationStore } from "./conversations/conversation-store";
import { createConversationLifecycleService } from "./conversations/conversation-lifecycle";
import { createResourceService } from "./assets/resource-service";
import { createUserSkillService } from "./user-skills/user-skill-service";
import { getCreationRuntime } from "./creation-graph/runtime";
import { buildWorkspaceProfile, parseCreateWorkspaceRequest } from "./workspaces";

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "access-control-allow-origin": process.env.WEB_ORIGIN || "http://localhost:3000",
    "access-control-allow-headers": "authorization,content-type,idempotency-key,x-file-name,x-resource-source",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS"
  });
  response.end(JSON.stringify(body));
}

const resourceService = createResourceService();
const userSkillService = createUserSkillService();
const conversationLifecycle = createConversationLifecycleService(undefined, userSkillService);

export async function closeHttpServices(): Promise<void> {
  await Promise.all([conversationLifecycle.close(), resourceService.close(), userSkillService.close(), adminConsole.close()]);
}

function getHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function* requestBody(request: IncomingMessage): AsyncGenerator<Uint8Array> {
  for await (const chunk of request) {
    yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  }
}

function sendDomainError(response: ServerResponse, error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = error.message;
  const statusByCode: Record<string, number> = {
    CONVERSATION_NOT_FOUND: 404,
    CONVERSATION_DELETING: 409,
    RESOURCE_NOT_FOUND: 404,
    RESOURCE_NOT_STAGED: 409,
    RESOURCE_ALREADY_ATTACHED: 409,
    RESOURCE_TYPE_UNSUPPORTED: 422,
    RESOURCE_SIGNATURE_INVALID: 422,
    RESOURCE_LENGTH_MISMATCH: 422,
    RESOURCE_TOO_LARGE: 413,
    UPLOAD_SESSION_NOT_FOUND: 404,
    UPLOAD_SESSION_EXPIRED: 410,
    MODEL_CONNECTION_NOT_FOUND: 404,
    MODEL_CONFIG_NOT_FOUND: 404,
    MODEL_CONFIG_CONFLICT: 409,
    MODEL_ROUTE_VERSION_CONFLICT: 409,
    MODEL_CONNECTION_IN_USE: 409,
    MODEL_CONFIG_IN_USE: 409,
    MODEL_CAPABILITY_MISMATCH: 422,
    MODEL_CONNECTION_NOT_ACTIVE: 409,
    MODEL_CONFIG_NOT_ACTIVE: 409,
    MODEL_ENCRYPTION_KEY_REQUIRED: 503,
    MODEL_ENCRYPTION_KEY_INVALID: 503,
    MODEL_BASE_URL_INVALID: 400,
    MODEL_BASE_URL_HTTPS_REQUIRED: 400,
    MODEL_BASE_URL_PRIVATE_FORBIDDEN: 400,
    USAGE_RANGE_INVALID: 400,
    USAGE_USER_NOT_FOUND: 404,
    USAGE_MODEL_NOT_FOUND: 404,
    GENERATION_MODEL_UNAVAILABLE: 503,
    USER_SKILL_NOT_FOUND: 404,
    USER_SKILL_IMPORT_INVALID: 422,
    USER_SKILL_FORBIDDEN: 403,
    USER_SKILL_ASSET_INVALID: 422,
    USER_SKILL_VERSION_CONFLICT: 409,
    LAYOUT_SKILL_DISABLED: 409
  };
  const status = statusByCode[code];
  if (!status) return false;
  sendJson(response, status, { code, message: "当前请求无法完成，请检查会话或资源状态" });
  return true;
}

async function sendObject(
  response: ServerResponse,
  content: Awaited<ReturnType<typeof resourceService.getPreview>>
): Promise<void> {
  response.writeHead(200, {
    "content-type": content.contentType ?? "application/octet-stream",
    ...(content.contentLength !== undefined ? { "content-length": String(content.contentLength) } : {}),
    "cache-control": "private, max-age=3600",
    "access-control-allow-origin": process.env.WEB_ORIGIN || "http://localhost:3000"
  });
  content.body.pipe(response);
}

async function sendRunEventStream(request: IncomingMessage, response: ServerResponse, runId: string): Promise<void> {
  const run = await conversationStore.getRun(runId);
  if (!run) {
    sendJson(response, 404, { code: "RUN_NOT_FOUND", message: "Run not found" });
    return;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  const lastEventIdHeader = Array.isArray(request.headers["last-event-id"])
    ? request.headers["last-event-id"][0]
    : request.headers["last-event-id"];
  const afterEventNo = Number(url.searchParams.get("after") ?? lastEventIdHeader ?? 0);

  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive",
    "access-control-allow-origin": process.env.WEB_ORIGIN || "http://localhost:3000"
  });
  response.write(": connected\n\n");

  const unsubscribe = await conversationStore.subscribeRunEvents(
    runId,
    Number.isFinite(afterEventNo) ? afterEventNo : 0,
    (event) => {
      response.write(`id: ${event.eventNo}\n`);
      response.write(`event: ${event.type}\n`);
      response.write(`data: ${JSON.stringify(event.payload)}\n\n`);
    }
  );

  request.on("close", unsubscribe);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  const pathname = requestUrl.pathname;

  if (request.method === "GET" && request.url === "/health") {
    try {
      const runtime = getCreationRuntime();
      await Promise.all([
        runtime.persistence.healthcheck(),
        runtime.queue.waitUntilReady(),
        runtime.queue.getJobCounts("waiting")
      ]);
      sendJson(response, 200, {
        status: "ok",
        service: "mediaforge-service",
        dependencies: {
          postgres: "ok",
          redis: "ok"
        }
      });
    } catch {
      sendJson(response, 503, {
        status: "unavailable",
        service: "mediaforge-service",
        dependencies: {
          postgres: "unknown",
          redis: "unknown"
        }
      });
    }
    return;
  }

  let auth: AuthContext;
  try {
    auth = await requireAuthContext(request, requestUrl);
  } catch (error) {
    if (error instanceof Error && (error.message === "UNAUTHORIZED" || error.message === "AUTH_JWKS_UNAVAILABLE")) {
      sendJson(response, 401, { code: "UNAUTHORIZED", message: "请先登录后再继续操作" });
      return;
    }
    if (error instanceof Error && error.message === "AUTH_SERVICE_UNAVAILABLE") {
      sendJson(response, 503, { code: error.message, message: "认证服务暂时不可用" });
      return;
    }
    if (error instanceof Error && error.message === "AUTH_PASSWORD_CHANGE_REQUIRED") {
      sendJson(response, 403, { code: error.message, message: "请先修改初始密码" });
      return;
    }
    throw error;
  }
  const ownerId = auth.userId;

  if (pathname.startsWith("/user-skills")) {
    try {
      const assetPreviewRoute = pathname.match(/^\/user-skills\/assets\/([^/]+)\/preview$/u);
      if (request.method === "GET" && assetPreviewRoute) {
        await sendObject(response, await userSkillService.getAssetPreview(ownerId, decodeURIComponent(assetPreviewRoute[1]!)));
        return;
      }
      if (request.method === "GET" && pathname === "/user-skills") {
        sendJson(response, 200, await userSkillService.list(ownerId));
        return;
      }
      if (request.method === "POST" && pathname === "/user-skills/import") {
        const body = importUserSkillRequestSchema.parse(await readJson(request));
        sendJson(response, 201, await userSkillService.importManifest(ownerId, body));
        return;
      }
      const assetRoute = pathname.match(/^\/user-skills\/([^/]+)\/versions\/([^/]+)\/assets\/([^/]+)$/u);
      if (request.method === "POST" && assetRoute) {
        const contentType = getHeader(request, "content-type")?.split(";")[0]?.trim() ?? "";
        const contentLength = Number(getHeader(request, "content-length"));
        const encodedName = getHeader(request, "x-file-name") ?? assetRoute[3]!;
        sendJson(response, 201, await userSkillService.uploadAsset(ownerId, decodeURIComponent(assetRoute[1]!), decodeURIComponent(assetRoute[2]!), decodeURIComponent(assetRoute[3]!), {
          originalName: decodeURIComponent(encodedName),
          contentType,
          contentLength,
          body: requestBody(request)
        }));
        return;
      }
      const skillRoute = pathname.match(/^\/user-skills\/([^/]+)(?:\/(install|disable))?$/u);
      if (skillRoute) {
        const skillId = decodeURIComponent(skillRoute[1]!);
        if (request.method === "GET" && !skillRoute[2]) {
          sendJson(response, 200, await userSkillService.get(ownerId, skillId));
          return;
        }
        if (request.method === "POST" && skillRoute[2] === "install") {
          const body = installUserSkillRequestSchema.parse(await readJson(request));
          sendJson(response, 200, await userSkillService.install(ownerId, skillId, body));
          return;
        }
        if (request.method === "POST" && skillRoute[2] === "disable") {
          sendJson(response, 200, await userSkillService.disable(ownerId, skillId));
          return;
        }
      }
    } catch (error) {
      if (error instanceof URIError || error instanceof ZodError || error instanceof SyntaxError) {
        sendJson(response, 400, { code: "VALIDATION_ERROR", message: "Skill 参数不合法" });
        return;
      }
      if (sendDomainError(response, error)) return;
      throw error;
    }
  }

  if (pathname.startsWith("/admin/")) {
    try {
      requireAdmin(auth);

      if (request.method === "GET" && pathname === "/admin/model-connections") {
        sendJson(response, 200, await adminConsole.listConnections());
        return;
      }
      if (request.method === "POST" && pathname === "/admin/model-connections") {
        const body = upsertModelConnectionRequestSchema.parse(await readJson(request));
        sendJson(response, 201, await adminConsole.createConnection(ownerId, body));
        return;
      }
      const connectionRoute = pathname.match(/^\/admin\/model-connections\/([^/]+)(?:\/(test|disable))?$/u);
      if (connectionRoute) {
        const id = decodeURIComponent(connectionRoute[1]!);
        if (request.method === "PATCH" && !connectionRoute[2]) {
          const body = upsertModelConnectionRequestSchema.parse(await readJson(request));
          sendJson(response, 200, await adminConsole.updateConnection(ownerId, id, body));
          return;
        }
        if (request.method === "POST" && connectionRoute[2] === "test") {
          sendJson(response, 200, await adminConsole.testConnection(ownerId, id));
          return;
        }
        if (request.method === "POST" && connectionRoute[2] === "disable") {
          sendJson(response, 200, await adminConsole.disableConnection(ownerId, id));
          return;
        }
      }

      if (request.method === "GET" && pathname === "/admin/model-configs") {
        sendJson(response, 200, await adminConsole.listConfigs());
        return;
      }
      if (request.method === "POST" && pathname === "/admin/model-configs") {
        const body = upsertModelConfigRequestSchema.parse(await readJson(request));
        sendJson(response, 201, await adminConsole.createConfig(ownerId, body));
        return;
      }
      const configRoute = pathname.match(/^\/admin\/model-configs\/([^/]+)(?:\/(validate|disable))?$/u);
      if (configRoute) {
        const id = decodeURIComponent(configRoute[1]!);
        if (request.method === "GET" && !configRoute[2]) {
          sendJson(response, 200, await adminConsole.getConfig(id));
          return;
        }
        if (request.method === "PATCH" && !configRoute[2]) {
          const body = upsertModelConfigRequestSchema.parse(await readJson(request));
          sendJson(response, 200, await adminConsole.updateConfig(ownerId, id, body));
          return;
        }
        if (request.method === "POST" && configRoute[2] === "validate") {
          sendJson(response, 200, await adminConsole.validateConfig(ownerId, id));
          return;
        }
        if (request.method === "POST" && configRoute[2] === "disable") {
          sendJson(response, 200, await adminConsole.disableConfig(ownerId, id));
          return;
        }
      }

      if (request.method === "GET" && pathname === "/admin/model-routes") {
        sendJson(response, 200, await adminConsole.listRoutes());
        return;
      }
      const routeMatch = pathname.match(/^\/admin\/model-routes\/([^/]+)$/u);
      if (request.method === "PATCH" && routeMatch) {
        const routeKey = modelRouteKeySchema.parse(decodeURIComponent(routeMatch[1]!));
        const body = updateModelRouteRequestSchema.parse(await readJson(request));
        sendJson(response, 200, await adminConsole.updateRoute(ownerId, routeKey, body.modelConfigId, body.version));
        return;
      }

      const usageUserMatch = pathname.match(/^\/admin\/usage\/users\/([^/]+)$/u);
      if (request.method === "GET" && usageUserMatch) {
        const query = usageRangeQuerySchema.parse(Object.fromEntries(requestUrl.searchParams.entries()));
        sendJson(response, 200, await adminConsole.usageUserDetail(
          ownerId, decodeURIComponent(usageUserMatch[1]!), query.from, query.to
        ));
        return;
      }
      const usageModelMatch = pathname.match(/^\/admin\/usage\/models\/([^/]+)$/u);
      if (request.method === "GET" && usageModelMatch) {
        const query = usageRangeQuerySchema.parse(Object.fromEntries(requestUrl.searchParams.entries()));
        sendJson(response, 200, await adminConsole.usageModelDetail(
          ownerId, decodeURIComponent(usageModelMatch[1]!), query.from, query.to
        ));
        return;
      }
      if (request.method === "GET" && [
        "/admin/usage", "/admin/usage/overview", "/admin/usage/trends",
        "/admin/usage/users", "/admin/usage/models"
      ].includes(pathname)) {
        const query = usageRangeQuerySchema.parse(Object.fromEntries(requestUrl.searchParams.entries()));
        const dashboard = await adminConsole.usageDashboard(query.from, query.to);
        if (pathname === "/admin/usage/overview") sendJson(response, 200, dashboard.summary);
        else if (pathname === "/admin/usage/trends") sendJson(response, 200, dashboard.trend);
        else if (pathname === "/admin/usage/users") {
          const keyword = query.search.toLowerCase();
          const filtered = dashboard.users.filter((item) =>
            !keyword || item.username.toLowerCase().includes(keyword) || item.displayName.toLowerCase().includes(keyword)
          );
          const start = (query.page - 1) * query.pageSize;
          sendJson(response, 200, { items: filtered.slice(start, start + query.pageSize), total: filtered.length });
        } else if (pathname === "/admin/usage/models") {
          const start = (query.page - 1) * query.pageSize;
          sendJson(response, 200, { items: dashboard.models.slice(start, start + query.pageSize), total: dashboard.models.length });
        } else sendJson(response, 200, dashboard);
        return;
      }
    } catch (error) {
      if (error instanceof Error && error.message === "PERMISSION_REQUIRED") {
        sendJson(response, 403, { code: error.message, message: "仅管理员可以访问系统设置" });
        return;
      }
      if (error instanceof ZodError || error instanceof SyntaxError) {
        sendJson(response, 400, { code: "VALIDATION_ERROR", message: "管理配置参数不合法" });
        return;
      }
      if (sendDomainError(response, error)) return;
      throw error;
    }
  }

  if (request.method === "POST" && request.url === "/workspaces") {
    try {
      const input = parseCreateWorkspaceRequest(await readJson(request));
      sendJson(response, 201, buildWorkspaceProfile(input));
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        sendJson(response, 400, {
          code: "VALIDATION_ERROR",
          message: "工作区参数不合法"
        });
        return;
      }
      if (sendDomainError(response, error)) return;

      throw error;
    }

    return;
  }

  if (request.method === "POST" && request.url === "/ai/wechat-articles/generate") {
    try {
      const input = parseGenerateWechatArticleRequest(await readJson(request));
      sendJson(response, 201, await generateWechatArticle(input, ownerId));
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        sendJson(response, 400, {
          code: "VALIDATION_ERROR",
          message: "公众号文章生成参数不合法"
        });
        return;
      }
      if (sendDomainError(response, error)) return;

      throw error;
    }

    return;
  }

  if (request.method === "POST" && request.url === "/ai/assets/analyze") {
    try {
      const input = parseAnalyzeAssetRequest(await readJson(request));
      sendJson(response, 200, await analyzeAsset(input, { userId: ownerId }));
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        sendJson(response, 400, {
          code: "VALIDATION_ERROR",
          message: "素材分析参数或模型输出不合法"
        });
        return;
      }

      throw error;
    }

    return;
  }

  if (request.method === "POST" && request.url === "/agent-runs") {
    try {
      const input = createAgentRunRequestSchema.parse(await readJson(request));
      sendJson(response, 202, await agentRunStore.create(input));
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        sendJson(response, 400, { code: "VALIDATION_ERROR", message: "Agent 运行参数不合法" });
        return;
      }
      throw error;
    }
    return;
  }

  if (request.method === "POST" && pathname === "/upload-sessions") {
    try {
      const input = createUploadSessionRequestSchema.parse(await readJson(request));
      sendJson(response, 201, await resourceService.createUploadSession(ownerId, input));
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        sendJson(response, 400, { code: "VALIDATION_ERROR", message: "上传会话参数不合法" });
        return;
      }
      if (sendDomainError(response, error)) return;
      throw error;
    }
    return;
  }

  const uploadSessionMatch = pathname.match(/^\/upload-sessions\/([^/]+)$/);
  if (request.method === "GET" && uploadSessionMatch) {
    try {
      sendJson(
        response,
        200,
        await resourceService.getUploadSession(ownerId, uploadSessionMatch[1]!)
      );
    } catch (error) {
      if (sendDomainError(response, error)) return;
      throw error;
    }
    return;
  }

  const uploadResourceMatch = pathname.match(/^\/upload-sessions\/([^/]+)\/resources$/);
  if (request.method === "POST" && uploadResourceMatch) {
    try {
      const contentType = getHeader(request, "content-type")?.split(";")[0]?.trim() ?? "";
      const contentLength = Number(getHeader(request, "content-length"));
      const encodedName = getHeader(request, "x-file-name") ?? "image";
      const idempotencyKey = getHeader(request, "idempotency-key") ?? "";
      if (!idempotencyKey) throw new Error("RESOURCE_IDEMPOTENCY_REQUIRED");
      const source = getHeader(request, "x-resource-source") === "paste" ? "paste" : "upload";
      sendJson(response, 201, await resourceService.upload(
        ownerId,
        uploadResourceMatch[1]!,
        {
          originalName: decodeURIComponent(encodedName),
          contentType,
          contentLength,
          source,
          idempotencyKey,
          body: requestBody(request)
        }
      ));
    } catch (error) {
      if (error instanceof URIError) {
        sendJson(response, 400, { code: "VALIDATION_ERROR", message: "文件名编码不合法" });
        return;
      }
      if (sendDomainError(response, error)) return;
      throw error;
    }
    return;
  }

  const stagedResourceMatch = pathname.match(/^\/upload-sessions\/([^/]+)\/resources\/([^/]+)$/);
  if (request.method === "DELETE" && stagedResourceMatch) {
    try {
      await resourceService.removeStaged(
        ownerId,
        stagedResourceMatch[1]!,
        stagedResourceMatch[2]!
      );
      response.writeHead(204, {
        "access-control-allow-origin": process.env.WEB_ORIGIN || "http://localhost:3000"
      });
      response.end();
    } catch (error) {
      if (sendDomainError(response, error)) return;
      throw error;
    }
    return;
  }

  const resourceContentMatch = pathname.match(/^\/resources\/([^/]+)\/(content|preview)$/);
  if (request.method === "GET" && resourceContentMatch) {
    try {
      const content = resourceContentMatch[2] === "preview"
        ? await resourceService.getPreview(ownerId, resourceContentMatch[1]!)
        : await resourceService.getContent(ownerId, resourceContentMatch[1]!);
      await sendObject(response, content);
    } catch (error) {
      if (sendDomainError(response, error)) return;
      throw error;
    }
    return;
  }

  if (request.method === "POST" && pathname === "/conversations") {
    try {
      const input = createConversationTurnRequestSchema.parse(await readJson(request));
      const result = await conversationLifecycle.createFirstTurn(ownerId, input);
      await getCreationRuntime().dispatcher.dispatchPending();
      sendJson(response, 201, result);
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        sendJson(response, 400, { code: "VALIDATION_ERROR", message: "首次创作参数不合法" });
        return;
      }
      if (sendDomainError(response, error)) return;
      throw error;
    }
    return;
  }

  if (request.method === "GET" && pathname === "/conversations") {
    const requestedLimit = Number(requestUrl.searchParams.get("limit") ?? 30);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 100)
      : 30;
    sendJson(
      response,
      200,
      await conversationLifecycle.list(ownerId, limit)
    );
    return;
  }

  const workspaceConversationsMatch = request.url?.match(/^\/workspaces\/([^/]+)\/conversations$/);
  if (request.method === "GET" && workspaceConversationsMatch) {
    if (workspaceConversationsMatch[1] !== ownerId) {
      sendJson(response, 403, { code: "FORBIDDEN", message: "当前账号无权访问该工作区" });
      return;
    }
    sendJson(response, 200, { items: await conversationStore.listWorkspaceConversations(workspaceConversationsMatch[1]!) });
    return;
  }

  const conversationMatch = pathname.match(/^\/conversations\/([^/]+)$/);
  if (request.method === "GET" && conversationMatch) {
    try {
      sendJson(response, 200, await conversationLifecycle.getConversation(ownerId, conversationMatch[1]!));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("CONVERSATION_")) {
        sendJson(response, error.message === "CONVERSATION_NOT_FOUND" ? 404 : 409, {
          code: error.message,
          message: "会话不存在或当前状态不允许操作"
        });
        return;
      }
      throw error;
    }
    return;
  }

  if (request.method === "PATCH" && conversationMatch) {
    try {
      const input = renameConversationRequestSchema.parse(await readJson(request));
      sendJson(
        response,
        200,
        await conversationLifecycle.rename(ownerId, conversationMatch[1]!, input)
      );
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        sendJson(response, 400, { code: "VALIDATION_ERROR", message: "会话标题参数不合法" });
        return;
      }
      if (sendDomainError(response, error)) return;
      throw error;
    }
    return;
  }

  if (request.method === "DELETE" && conversationMatch) {
    try {
      sendJson(
        response,
        202,
        await conversationLifecycle.remove(ownerId, conversationMatch[1]!)
      );
    } catch (error) {
      if (sendDomainError(response, error)) return;
      throw error;
    }
    return;
  }

  const conversationTurnsMatch = pathname.match(/^\/conversations\/([^/]+)\/turns$/);
  if (request.method === "POST" && conversationTurnsMatch) {
    try {
      const input = createConversationTurnRequestSchema.parse(await readJson(request));
      const result = await conversationLifecycle.appendTurn(
        ownerId,
        conversationTurnsMatch[1]!,
        input
      );
      await getCreationRuntime().dispatcher.dispatchPending();
      sendJson(response, 201, result);
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        sendJson(response, 400, { code: "VALIDATION_ERROR", message: "会话消息参数不合法" });
        return;
      }
      if (sendDomainError(response, error)) return;
      throw error;
    }
    return;
  }

  const conversationMessagesMatch = request.url?.match(/^\/conversations\/([^/]+)\/messages$/);
  if (request.method === "POST" && conversationMessagesMatch) {
    try {
      const input = createConversationMessageRequestSchema.parse(await readJson(request));
      sendJson(response, 201, await conversationStore.addMessage(conversationMessagesMatch[1]!, input));
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        sendJson(response, 400, { code: "VALIDATION_ERROR", message: "会话消息参数不合法" });
        return;
      }
      if (error instanceof Error && error.message.startsWith("CONVERSATION_")) {
        sendJson(response, error.message === "CONVERSATION_NOT_FOUND" ? 404 : 409, {
          code: error.message,
          message: "会话不存在或当前状态不允许操作"
        });
        return;
      }
      throw error;
    }
    return;
  }

  const conversationResourcesMatch = request.url?.match(/^\/conversations\/([^/]+)\/resources$/);
  if (request.method === "POST" && conversationResourcesMatch) {
    try {
      const input = createConversationResourceRequestSchema.parse(await readJson(request));
      sendJson(response, 201, await conversationStore.addResource(conversationResourcesMatch[1]!, input));
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        sendJson(response, 400, { code: "VALIDATION_ERROR", message: "会话资源参数不合法" });
        return;
      }
      if (error instanceof Error && error.message.startsWith("CONVERSATION_")) {
        sendJson(response, error.message === "CONVERSATION_NOT_FOUND" ? 404 : 409, {
          code: error.message,
          message: "会话不存在或当前状态不允许操作"
        });
        return;
      }
      throw error;
    }
    return;
  }

  const conversationRunsMatch = request.url?.match(/^\/conversations\/([^/]+)\/runs$/);
  if (request.method === "POST" && conversationRunsMatch) {
    try {
      const input = createConversationRunRequestSchema.parse(await readJson(request));
      sendJson(response, 202, await conversationStore.createRun(conversationRunsMatch[1]!, input));
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        sendJson(response, 400, { code: "VALIDATION_ERROR", message: "Run 参数不合法" });
        return;
      }
      if (error instanceof Error && (
        error.message.startsWith("CONVERSATION_") ||
        error.message === "CONVERSATION_MESSAGE_REQUIRED"
      )) {
        sendJson(response, error.message === "CONVERSATION_NOT_FOUND" ? 404 : 409, {
          code: error.message,
          message: "会话不存在或缺少用户消息"
        });
        return;
      }
      throw error;
    }
    return;
  }

  const runEventsMatch = request.url?.match(/^\/runs\/([^/?]+)\/events(?:\?.*)?$/);
  if (request.method === "GET" && runEventsMatch) {
    await sendRunEventStream(request, response, runEventsMatch[1]!);
    return;
  }

  const runMatch = request.url?.match(/^\/runs\/([^/]+)$/);
  if (request.method === "GET" && runMatch) {
    const run = await conversationStore.getRun(runMatch[1]!);
    sendJson(response, run ? 200 : 404, run ?? { code: "RUN_NOT_FOUND", message: "Run 不存在" });
    return;
  }

  const runDecisionMatch = request.url?.match(/^\/runs\/([^/]+)\/decisions$/);
  if (request.method === "POST" && runDecisionMatch) {
    try {
      const input = submitAgentDecisionRequestSchema.parse(await readJson(request));
      sendJson(response, 200, await conversationStore.decide(runDecisionMatch[1]!, input));
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        sendJson(response, 400, { code: "VALIDATION_ERROR", message: "Run 决定参数不合法" });
        return;
      }
      if (error instanceof Error && (error.message.startsWith("RUN_") || error.message.startsWith("AGENT_RUN_"))) {
        const status = error.message.endsWith("NOT_FOUND") ? 404 : 409;
        sendJson(response, status, { code: error.message.replace("AGENT_", ""), message: "Run 当前状态不允许此操作" });
        return;
      }
      throw error;
    }
    return;
  }

  const runClarificationMatch = request.url?.match(/^\/runs\/([^/]+)\/clarifications$/);
  if (request.method === "POST" && runClarificationMatch) {
    try {
      const input = submitRunClarificationRequestSchema.parse(await readJson(request));
      sendJson(response, 200, await conversationStore.submitClarification(runClarificationMatch[1]!, input));
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        sendJson(response, 400, { code: "VALIDATION_ERROR", message: "追问信息参数不合法" });
        return;
      }
      if (error instanceof Error && error.message.startsWith("RUN_")) {
        sendJson(response, error.message.endsWith("NOT_FOUND") ? 404 : 409, {
          code: error.message,
          message: "当前任务状态不允许提交追问信息"
        });
        return;
      }
      throw error;
    }
    return;
  }

  const conversationArtifactsMatch = request.url?.match(/^\/conversations\/([^/]+)\/artifacts$/);
  if (request.method === "GET" && conversationArtifactsMatch) {
    try {
      sendJson(response, 200, { items: await conversationStore.listArtifacts(conversationArtifactsMatch[1]!) });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("CONVERSATION_")) {
        sendJson(response, error.message === "CONVERSATION_NOT_FOUND" ? 404 : 409, {
          code: error.message,
          message: "会话不存在或当前状态不允许操作"
        });
        return;
      }
      throw error;
    }
    return;
  }

  const artifactMatch = request.url?.match(/^\/artifacts\/([^/]+)$/);
  if (request.method === "GET" && artifactMatch) {
    const artifact = await conversationStore.getArtifact(artifactMatch[1]!);
    sendJson(response, artifact ? 200 : 404, artifact ?? { code: "ARTIFACT_NOT_FOUND", message: "产物不存在" });
    return;
  }

  const agentRunMatch = request.url?.match(/^\/agent-runs\/([^/]+)$/);
  if (request.method === "GET" && agentRunMatch) {
    const run = agentRunStore.get(agentRunMatch[1]!);
    sendJson(
      response,
      run ? 200 : 404,
      run ?? { code: "AGENT_RUN_NOT_FOUND", message: "Agent 运行不存在" }
    );
    return;
  }

  const agentStepsMatch = request.url?.match(/^\/agent-runs\/([^/]+)\/steps$/);
  if (request.method === "GET" && agentStepsMatch) {
    const run = agentRunStore.get(agentStepsMatch[1]!);
    sendJson(
      response,
      run ? 200 : 404,
      run ? { items: run.steps, nextCursor: null } : { code: "AGENT_RUN_NOT_FOUND", message: "Agent 运行不存在" }
    );
    return;
  }

  const agentDecisionMatch = request.url?.match(/^\/agent-runs\/([^/]+)\/decisions$/);
  if (request.method === "POST" && agentDecisionMatch) {
    try {
      const input = submitAgentDecisionRequestSchema.parse(await readJson(request));
      sendJson(response, 200, await agentRunStore.decide(agentDecisionMatch[1]!, input));
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        sendJson(response, 400, { code: "VALIDATION_ERROR", message: "Agent 决定参数不合法" });
        return;
      }
      if (error instanceof Error && error.message.startsWith("AGENT_RUN_")) {
        const status = error.message === "AGENT_RUN_NOT_FOUND" ? 404 : 409;
        sendJson(response, status, { code: error.message, message: "Agent 当前状态不允许此操作" });
        return;
      }
      throw error;
    }
    return;
  }

  sendJson(response, 404, { code: "NOT_FOUND", message: "接口不存在" });
}

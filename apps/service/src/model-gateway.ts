import {
  articleDocumentSchema,
  type ArticleDocument,
  type GenerateWechatArticleRequest
} from "@mediaforge/contracts";
import type { z } from "zod";
import type { ModelRouteKey } from "@mediaforge/contracts";
import { adminConsole } from "./admin-console";

export interface ModelGatewayConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  id?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** @deprecated Runtime model configuration is stored in PostgreSQL. */
export function readModelGatewayConfig(): ModelGatewayConfig | null {
  return null;
}

export async function resolveModelGatewayConfig(routeKey: ModelRouteKey): Promise<ModelGatewayConfig & {
  modelConfigId: string;
}> {
  const resolved = await adminConsole.resolveModel(routeKey);
  return {
    provider: resolved.adapterType,
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    model: resolved.modelId,
    timeoutMs: resolved.timeoutMs,
    modelConfigId: resolved.modelConfigId
  };
}

export async function generateDocumentWithGateway(
  input: GenerateWechatArticleRequest,
  config: ModelGatewayConfig,
  usage?: {
    userId: string;
    runId?: string;
    modelConfigId: string;
    routeKey: ModelRouteKey;
  }
): Promise<ArticleDocument> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = Date.now();
  const usageId = usage ? await adminConsole.startModelUsage(usage) : null;
  const prompt = {
    task: "生成一篇可复制到微信公众号后台的中文文章结构",
    requirements: {
      topic: input.topic,
      audience: input.audience,
      sellingPoints: input.sellingPoints,
      tone: input.tone,
      style: input.style,
      extraInstructions: input.extraInstructions,
      output: "只返回符合 ArticleDocument 的 JSON，不返回 Markdown 或 HTML",
      allowedBlockTypes: [
        "heading", "paragraph", "image", "quote", "divider", "callout",
        "button", "video", "footer", "signup", "address", "qrcode"
      ]
    }
  };

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "你是公众号内容编辑，只输出严格 JSON。" },
          { role: "user", content: JSON.stringify(prompt) }
        ]
      }),
      redirect: "error",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`MODEL_GATEWAY_ERROR:${response.status}`);
    }

    const payload = await response.json() as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("MODEL_GATEWAY_INVALID_RESPONSE");
    }

    const document = articleDocumentSchema.parse(JSON.parse(content));
    if (usageId) {
      await adminConsole.finishModelUsage(usageId, {
        status: "succeeded",
        inputTokens: payload.usage?.prompt_tokens,
        outputTokens: payload.usage?.completion_tokens,
        totalTokens: payload.usage?.total_tokens,
        providerRequestId: payload.id,
        latencyMs: Date.now() - startedAt
      });
    }
    return document;
  } catch (error) {
    if (usageId) {
      await adminConsole.finishModelUsage(usageId, {
        status: "failed",
        errorCode: error instanceof Error ? error.message.slice(0, 128) : "MODEL_GATEWAY_ERROR",
        latencyMs: Date.now() - startedAt
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateStructuredJsonWithGateway<T>(
  config: ModelGatewayConfig,
  options: {
    agentName: string;
    systemPrompt: string;
    input: unknown;
    schema: z.ZodType<T>;
    temperature?: number;
    usage?: {
      userId: string;
      runId?: string;
      modelConfigId: string;
      routeKey: ModelRouteKey;
    };
  }
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = Date.now();
  const usageId = options.usage
    ? await adminConsole.startModelUsage(options.usage)
    : null;

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        temperature: options.temperature ?? 0.5,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `${options.systemPrompt}\n只返回严格 JSON，不返回 Markdown、解释、思考过程或执行计划。`
          },
          {
            role: "user",
            content: JSON.stringify({
              agent: options.agentName,
              input: options.input
            })
          }
        ]
      }),
      redirect: "error",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`MODEL_GATEWAY_ERROR:${response.status}`);
    }

    const payload = await response.json() as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("MODEL_GATEWAY_INVALID_RESPONSE");
    }

    const parsed = options.schema.parse(JSON.parse(content));
    if (usageId) {
      await adminConsole.finishModelUsage(usageId, {
        status: "succeeded",
        inputTokens: payload.usage?.prompt_tokens,
        outputTokens: payload.usage?.completion_tokens,
        totalTokens: payload.usage?.total_tokens,
        providerRequestId: payload.id,
        latencyMs: Date.now() - startedAt
      });
    }
    return parsed;
  } catch (error) {
    if (usageId) {
      await adminConsole.finishModelUsage(usageId, {
        status: "failed",
        errorCode: error instanceof Error ? error.message.slice(0, 128) : "MODEL_GATEWAY_ERROR",
        latencyMs: Date.now() - startedAt
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

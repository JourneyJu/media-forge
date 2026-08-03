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

export interface ModelGatewayProgressEvent {
  type: "phase" | "reasoning" | "retry";
  phase: "thinking" | "generating" | "validating" | "retrying";
  delta?: string;
  summary?: string;
  retryCount: number;
}

async function readCompletionResponse(
  response: Response,
  onProgress: ((event: ModelGatewayProgressEvent) => void | Promise<void>) | undefined,
  retryCount: number
): Promise<ChatCompletionResponse> {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    return response.json() as Promise<ChatCompletionResponse>;
  }
  if (!response.body) throw new Error("MODEL_GATEWAY_STREAM_MISSING");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let requestId: string | undefined;
  let usage: ChatCompletionResponse["usage"];
  let generatingReported = false;

  const consumeBlock = async (block: string): Promise<void> => {
    for (const line of block.split(/\r?\n/u)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let chunk: Record<string, unknown>;
      try {
        chunk = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (typeof chunk.id === "string") requestId = chunk.id;
      if (chunk.usage && typeof chunk.usage === "object") {
        const value = chunk.usage as Record<string, unknown>;
        usage = {
          prompt_tokens: typeof value.prompt_tokens === "number" ? value.prompt_tokens : undefined,
          completion_tokens: typeof value.completion_tokens === "number" ? value.completion_tokens : undefined,
          total_tokens: typeof value.total_tokens === "number" ? value.total_tokens : undefined
        };
      }
      const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
      const first = choices[0] as Record<string, unknown> | undefined;
      const delta = first?.delta && typeof first.delta === "object"
        ? first.delta as Record<string, unknown>
        : undefined;
      const reasoning = typeof delta?.reasoning_content === "string" ? delta.reasoning_content : "";
      const nextContent = typeof delta?.content === "string" ? delta.content : "";
      if (reasoning) {
        await onProgress?.({
          type: "reasoning",
          phase: "thinking",
          delta: reasoning,
          retryCount
        });
      }
      if (nextContent) {
        if (!generatingReported) {
          generatingReported = true;
          await onProgress?.({
            type: "phase",
            phase: "generating",
            summary: "正在生成结构化结果",
            retryCount
          });
        }
        content += nextContent;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.replace(/\r\n/gu, "\n").split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) await consumeBlock(block);
    if (done) break;
  }
  if (buffer.trim()) await consumeBlock(buffer);

  return {
    id: requestId,
    usage,
    choices: [{ message: { content } }]
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
    outputContract: string;
    input: unknown;
    schema: z.ZodType<T>;
    temperature?: number;
    onProgress?: (event: ModelGatewayProgressEvent) => void | Promise<void>;
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
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content: `${options.systemPrompt}\n只返回严格 JSON，不返回 Markdown、解释、思考过程或执行计划。\n输出契约：${options.outputContract}`
    },
    {
      role: "user",
      content: JSON.stringify({
        agent: options.agentName,
        input: options.input
      })
    }
  ];
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let providerRequestId: string | undefined;

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await options.onProgress?.({
        type: "phase",
        phase: "thinking",
        summary: attempt === 0 ? "正在分析输入和输出要求" : "正在根据校验结果重新组织输出",
        retryCount: attempt
      });
      const requestBody = {
        model: config.model,
        temperature: options.temperature ?? 0.5,
        response_format: { type: "json_object" },
        messages
      };
      let response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          ...requestBody,
          stream: true,
          stream_options: { include_usage: true }
        }),
        redirect: "error",
        signal: controller.signal
      });

      if ([400, 404, 422].includes(response.status)) {
        await options.onProgress?.({
          type: "phase",
          phase: "generating",
          summary: "模型不支持流式响应，正在等待完整结果",
          retryCount: attempt
        });
        response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(requestBody),
          redirect: "error",
          signal: controller.signal
        });
      }

      if (!response.ok) {
        throw new Error(`MODEL_GATEWAY_ERROR:${response.status}`);
      }

      const payload = await readCompletionResponse(response, options.onProgress, attempt);
      providerRequestId = payload.id ?? providerRequestId;
      inputTokens += payload.usage?.prompt_tokens ?? 0;
      outputTokens += payload.usage?.completion_tokens ?? 0;
      totalTokens += payload.usage?.total_tokens ?? 0;
      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("MODEL_GATEWAY_INVALID_RESPONSE");
      }

      try {
        await options.onProgress?.({
          type: "phase",
          phase: "validating",
          summary: "正在校验结构和必填字段",
          retryCount: attempt
        });
        const parsed = options.schema.parse(JSON.parse(content));
        if (usageId) {
          await adminConsole.finishModelUsage(usageId, {
            status: "succeeded",
            inputTokens,
            outputTokens,
            totalTokens,
            providerRequestId,
            latencyMs: Date.now() - startedAt
          });
        }
        return parsed;
      } catch (error) {
        if (attempt === 1) throw error;
        await options.onProgress?.({
          type: "retry",
          phase: "retrying",
          summary: "输出结构未通过校验，正在自动修正",
          retryCount: attempt + 1
        });
        const details = error instanceof Error ? error.message.slice(0, 2000) : "JSON does not match the output contract";
        messages.push(
          { role: "assistant", content },
          {
            role: "user",
            content: `上一个 JSON 不符合输出契约。校验错误：${details}\n请严格按照输出契约返回完整替代 JSON，所有必填字段都必须存在。`
          }
        );
      }
    }
    throw new Error("MODEL_GATEWAY_SCHEMA_RETRY_EXHAUSTED");
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

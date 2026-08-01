import {
  analyzeAssetRequestSchema,
  type AnalyzeAssetRequest,
  type AnalyzeAssetResponse
} from "@mediaforge/contracts";
import { z } from "zod";
import { adminConsole } from "./admin-console";
import { resolveModelGatewayConfig } from "./model-gateway";

interface ChatCompletionResponse {
  id?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

const visionResultSchema = z.object({
  description: z.string().trim().min(1).max(2000),
  detectedType: z.enum(["qrcode", "poster", "product", "environment", "unknown"]),
  ocrText: z.string().max(10000).default(""),
  suggestedUsage: z.string().trim().min(1).max(1000)
});

/** @deprecated Visual models are resolved from the multimodal_generation database route. */
export function readVisionGatewayConfig(): null {
  return null;
}

export function parseAnalyzeAssetRequest(input: unknown): AnalyzeAssetRequest {
  return analyzeAssetRequestSchema.parse(input);
}

function localDemoAnalysis(input: AnalyzeAssetRequest): AnalyzeAssetResponse {
  return {
    assetId: input.assetId,
    description: "当前为本地演示模式，仅确认素材地址和用途参数有效。",
    detectedType: input.purpose === "qrcode" ? "qrcode" : input.purpose === "poster" ? "poster" : "unknown",
    ocrText: "",
    suggestedUsage: "启用多模态模型后可获取图片描述、OCR 文本和排版建议。",
    model: { provider: "local", name: "mediaforge-vision-demo", mode: "local-demo" }
  };
}

export async function analyzeAsset(
  input: AnalyzeAssetRequest,
  context: { userId: string; runId?: string } = { userId: "system" }
): Promise<AnalyzeAssetResponse> {
  if (process.env.MODEL_MODE === "demo" || process.env.NODE_ENV === "test") {
    return localDemoAnalysis(input);
  }

  const config = await resolveModelGatewayConfig("multimodal_generation");
  const usageId = await adminConsole.startModelUsage({
    ...context,
    modelConfigId: config.modelConfigId,
    routeKey: "multimodal_generation"
  });
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "你是公众号素材分析助手。识别图片内容和文字，只返回严格 JSON。"
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `分析这张公众号${input.purpose}素材。返回 JSON 字段：description、detectedType（qrcode/poster/product/environment/unknown）、ocrText、suggestedUsage。`
              },
              { type: "image_url", image_url: { url: input.imageUrl } }
            ]
          }
        ]
      }),
      redirect: "error",
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`VISION_GATEWAY_ERROR:${response.status}`);
    const payload = await response.json() as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("VISION_GATEWAY_INVALID_RESPONSE");

    const analysis = visionResultSchema.parse(JSON.parse(content));
    await adminConsole.finishModelUsage(usageId, {
      status: "succeeded",
      inputTokens: payload.usage?.prompt_tokens,
      outputTokens: payload.usage?.completion_tokens,
      totalTokens: payload.usage?.total_tokens,
      providerRequestId: payload.id,
      latencyMs: Date.now() - startedAt
    });
    return {
      assetId: input.assetId,
      ...analysis,
      model: { provider: config.provider, name: config.model, mode: "gateway" }
    };
  } catch (error) {
    await adminConsole.finishModelUsage(usageId, {
      status: "failed",
      errorCode: error instanceof Error ? error.message.slice(0, 128) : "VISION_GATEWAY_ERROR",
      latencyMs: Date.now() - startedAt
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

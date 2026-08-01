import type {
  GenerateWechatArticleRequest,
  GenerateWechatArticleResponse
} from "@mediaforge/contracts";
import { serviceFetch } from "./api-client";

export async function generateWechatArticle(
  input: GenerateWechatArticleRequest
): Promise<GenerateWechatArticleResponse> {
  const response = await serviceFetch("/ai/wechat-articles/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(error?.message ?? "文章生成失败，请稍后重试");
  }

  return response.json() as Promise<GenerateWechatArticleResponse>;
}

import { randomUUID } from "node:crypto";
import {
  generateWechatArticleRequestSchema,
  type ArticleDocument,
  type GenerateWechatArticleRequest,
  type GenerateWechatArticleResponse
} from "@mediaforge/contracts";
import { renderWechatArticle } from "./wechat-renderer";
import { generateDocumentWithGateway, resolveModelGatewayConfig } from "./model-gateway";
import { adminConsole } from "./admin-console";

export function parseGenerateWechatArticleRequest(input: unknown): GenerateWechatArticleRequest {
  return generateWechatArticleRequestSchema.parse(input);
}

function createLocalDemoDocument(input: GenerateWechatArticleRequest): ArticleDocument {
  const audience = input.audience || "关注这个话题的朋友";
  const sellingPoints = input.sellingPoints.length > 0
    ? input.sellingPoints
    : ["信息清楚，读起来轻松", "给出可以马上行动的建议"];

  return {
    type: "doc",
    attrs: { title: input.topic, scenario: input.style },
    content: [
      {
        id: randomUUID(),
        type: "paragraph",
        content: [{
          type: "text",
          text: `关于${input.topic}，真正打动${audience}的，往往不是刻意堆砌的信息，而是那些与生活有关、能够留下记忆的真实细节。`
        }]
      },
      ...sellingPoints.flatMap((point, index) => [
        {
          id: randomUUID(),
          type: "heading" as const,
          content: [{ type: "text" as const, text: `${index + 1}. ${point}` }]
        },
        {
          id: randomUUID(),
          type: "paragraph" as const,
          content: [{
            type: "text" as const,
            text: input.style === "story"
              ? `${point}，不是一句抽象的表达。它藏在${input.topic}发生的每一个自然瞬间里，也会在许多年后，重新唤起一家人共同经历过的温度。`
              : `选择${input.topic}时，可以把“${point}”作为重要判断依据。先确认自己的真实需求，再看过程是否自然、结果是否经得起时间，这比短暂的热闹更重要。`
          }]
        }
      ]),
      {
        id: randomUUID(),
        type: "footer",
        content: [{ type: "text", text: `愿每一次${input.topic}，都能留下值得反复翻看的片段。` }]
      }
    ]
  };
}

const metaCopyPattern = /补充真实信息|案例和行动建议|让内容更可信|本文将|下文将|建议补充|围绕[“"].*[”"]/;

function removeMetaCopy(document: ArticleDocument, input: GenerateWechatArticleRequest): ArticleDocument {
  const point = input.sellingPoints[0] || input.topic;
  return {
    ...document,
    content: document.content.map((block) => ({
      ...block,
      content: block.content?.map((item) => ({
        ...item,
        text: metaCopyPattern.test(item.text)
          ? `对${input.audience || "读者"}来说，${input.topic}的意义，在于把${point}变成可以被看见、被感受，也能被长久保留的真实体验。`
          : item.text
      }))
    }))
  };
}

export async function generateWechatArticle(
  input: GenerateWechatArticleRequest,
  userId = "system"
): Promise<GenerateWechatArticleResponse> {
  const demo = process.env.MODEL_MODE === "demo" || process.env.NODE_ENV === "test";
  const runId = `direct_${randomUUID()}`;
  const config = demo ? null : await resolveModelGatewayConfig("text_generation");
  if (!demo) await adminConsole.acceptGeneration(userId, runId);
  let generatedDocument: ArticleDocument;
  try {
    generatedDocument = config
      ? await generateDocumentWithGateway(input, config, {
          userId,
          runId,
          modelConfigId: config.modelConfigId,
          routeKey: "text_generation"
        })
      : createLocalDemoDocument(input);
    if (!demo) await adminConsole.finishGeneration(runId, "completed");
  } catch (error) {
    if (!demo) {
      await adminConsole.finishGeneration(
        runId,
        "failed",
        error instanceof Error ? error.message.slice(0, 128) : "GENERATION_FAILED"
      );
    }
    throw error;
  }
  const document = removeMetaCopy(generatedDocument, input);

  return {
    articleId: randomUUID(),
    versionId: randomUUID(),
    document,
    render: renderWechatArticle(document),
    model: {
      provider: config?.provider || "local",
      name: config?.model || "mediaforge-demo",
      mode: config ? "gateway" : "local-demo"
    }
  };
}

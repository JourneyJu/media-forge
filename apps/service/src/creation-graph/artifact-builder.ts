import { randomUUID } from "node:crypto";
import {
  articleDocumentSchema,
  artifactValidationResultSchema,
  type ArticleDocument,
  type ArticleDraft,
  type ArticleOutline,
  type ArtifactValidationResult,
  type GenerateWechatArticleResponse,
  type ImagePlan,
  type TitleCandidates
} from "@mediaforge/contracts";
import { renderWechatArticle } from "../wechat-renderer";

const processCopyPattern = /帮我(?:写|做)|要求如下|我会先|执行计划|审校报告|思考过程|作为\s*AI|AI\s*味/u;

interface ArtifactBuilderInput {
  userInput: string;
  titles: TitleCandidates;
  outline: ArticleOutline;
  draft: ArticleDraft;
  imagePlan: ImagePlan;
}

function getSelectedTitle(titles: TitleCandidates) {
  return titles.items.find((item) => item.id === titles.selectedId);
}

export function validateArticleArtifact(input: ArtifactBuilderInput): ArtifactValidationResult {
  const violations: Array<{ code: string; message: string }> = [];
  const selected = getSelectedTitle(input.titles);
  const articleText = [input.draft.title, input.draft.subtitle ?? "", ...input.draft.paragraphs].join("\n");
  const normalizedPrompt = input.userInput.trim().replace(/\s+/g, " ");
  const normalizedArticle = articleText.replace(/\s+/g, " ");
  const normalizedTitle = input.draft.title.trim().replace(/\s+/g, " ");
  const instructionLikePrompt =
    input.userInput.includes("\n") ||
    normalizedPrompt.length >= 80 ||
    /帮我|请|要求|需要|提供|不要|避免|面向|风格|生成|创作|写一篇/u.test(normalizedPrompt);

  if (!selected || input.draft.title !== selected.title) {
    violations.push({
      code: "TITLE_SOURCE_INVALID",
      message: "最终标题必须来自 Title Agent 的 selectedId"
    });
  }
  if (normalizedPrompt.length >= 8 && normalizedTitle === normalizedPrompt) {
    violations.push({
      code: "RAW_PROMPT_AS_TITLE",
      message: "最终标题不能直接使用用户原始输入"
    });
  }
  if (
    instructionLikePrompt &&
    normalizedPrompt.length >= 16 &&
    normalizedArticle.includes(normalizedPrompt)
  ) {
    violations.push({
      code: "RAW_PROMPT_LEAK",
      message: "最终内容包含用户原始提示词"
    });
  }
  if (processCopyPattern.test(articleText)) {
    violations.push({
      code: "PROCESS_COPY_LEAK",
      message: "最终内容包含用户指令或 AI 执行过程"
    });
  }
  if (input.draft.paragraphs.length < 3) {
    violations.push({
      code: "ARTICLE_TOO_THIN",
      message: "正文内容不足"
    });
  }

  return artifactValidationResultSchema.parse({
    passed: violations.length === 0,
    violations
  });
}

export function buildArticleDocument(input: ArtifactBuilderInput): {
  document: ArticleDocument;
  validation: ArtifactValidationResult;
} {
  const validation = validateArticleArtifact(input);
  if (!validation.passed) {
    throw new Error(`ARTIFACT_VALIDATION_FAILED:${validation.violations.map((item) => item.code).join(",")}`);
  }

  const content: ArticleDocument["content"] = [];
  input.draft.paragraphs.forEach((paragraph, index) => {
    if (index > 0 && index <= input.outline.sections.length) {
      content.push({
        id: randomUUID(),
        type: "heading",
        content: [{ type: "text", text: input.outline.sections[index - 1]!.title }]
      });
    }
    content.push({
      id: randomUUID(),
      type: index === input.draft.paragraphs.length - 1 ? "footer" : "paragraph",
      content: [{ type: "text", text: paragraph }]
    });
  });

  return {
    validation,
    document: articleDocumentSchema.parse({
      type: "doc",
      attrs: {
        title: input.draft.title,
        scenario: "story"
      },
      content
    })
  };
}

export function buildWechatArticleResponse(
  document: ArticleDocument,
  mode: "gateway" | "local-demo"
): GenerateWechatArticleResponse {
  return {
    articleId: randomUUID(),
    versionId: randomUUID(),
    document,
    render: renderWechatArticle(document),
    model: {
      provider: mode === "gateway" ? process.env.MODEL_GATEWAY_PROVIDER?.trim() || "openai-compatible" : "local",
      name: mode === "gateway" ? process.env.MODEL_GATEWAY_DEFAULT_MODEL?.trim() || "configured-model" : "multi-agent-demo-v1",
      mode
    }
  };
}

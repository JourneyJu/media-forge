import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type {
  ArtifactValidationResult,
  ArticleDraft,
  ArticleOutline,
  ClarificationRequest,
  CreationGraphState,
  CreativeBrief,
  ImagePlan,
  ReviewReport,
  TitleCandidates
} from "@mediaforge/contracts";
import { buildArticleDocument } from "./artifact-builder";
import {
  createCreationAgents,
  type CreationAgents
} from "./agents";

export interface GraphExecutionObserver {
  onNodeStarted?(nodeName: string, title: string): void | Promise<void>;
  onNodeCompleted?(
    nodeName: string,
    title: string,
    summary: string,
    update: Partial<CreationGraphState>
  ): void | Promise<void>;
}

interface GraphOptions {
  agents?: CreationAgents;
  observer?: GraphExecutionObserver;
}

const GraphAnnotation = Annotation.Root({
  workspaceId: Annotation<string>(),
  conversationId: Annotation<string>(),
  runId: Annotation<string>(),
  userInput: Annotation<string>(),
  resourceIds: Annotation<string[]>({
    reducer: (_current, update) => update,
    default: () => []
  }),
  skillId: Annotation<string>(),
  brief: Annotation<CreativeBrief | undefined>(),
  clarification: Annotation<ClarificationRequest | undefined>(),
  titles: Annotation<TitleCandidates | undefined>(),
  outline: Annotation<ArticleOutline | undefined>(),
  draft: Annotation<ArticleDraft | undefined>(),
  imagePlan: Annotation<ImagePlan | undefined>(),
  reviewReports: Annotation<ReviewReport[]>({
    reducer: (_current, update) => update,
    default: () => []
  }),
  artifactValidation: Annotation<ArtifactValidationResult | undefined>(),
  finalDocument: Annotation<CreationGraphState["finalDocument"] | undefined>(),
  artifactId: Annotation<string | undefined>(),
  revisionCount: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0
  }),
  maxRevisionCount: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 2
  }),
  status: Annotation<CreationGraphState["status"]>()
});

function requiresClarification(input: string): boolean {
  return input.trim().length < 12;
}

function selectedTitle(titles: TitleCandidates): string {
  return titles.items.find((item) => item.id === titles.selectedId)?.title ?? titles.items[0]!.title;
}

function createObservedNode(
  observer: GraphExecutionObserver | undefined,
  nodeName: string,
  title: string,
  execute: (state: CreationGraphState) => Promise<Partial<CreationGraphState>>,
  summarize: (update: Partial<CreationGraphState>) => string
) {
  return async (state: CreationGraphState): Promise<Partial<CreationGraphState>> => {
    await observer?.onNodeStarted?.(nodeName, title);
    const update = await execute(state);
    await observer?.onNodeCompleted?.(nodeName, title, summarize(update), update);
    return update;
  };
}

function requireBrief(state: CreationGraphState): CreativeBrief {
  if (!state.brief) throw new Error("GRAPH_BRIEF_REQUIRED");
  return state.brief;
}

function requireTitles(state: CreationGraphState): TitleCandidates {
  if (!state.titles) throw new Error("GRAPH_TITLES_REQUIRED");
  return state.titles;
}

function requireOutline(state: CreationGraphState): ArticleOutline {
  if (!state.outline) throw new Error("GRAPH_OUTLINE_REQUIRED");
  return state.outline;
}

function requireDraft(state: CreationGraphState): ArticleDraft {
  if (!state.draft) throw new Error("GRAPH_DRAFT_REQUIRED");
  return state.draft;
}

function requireImagePlan(state: CreationGraphState): ImagePlan {
  if (!state.imagePlan) throw new Error("GRAPH_IMAGE_PLAN_REQUIRED");
  return state.imagePlan;
}

function routeAfterClarification(state: CreationGraphState): "title_node" | typeof END {
  return state.status === "waiting_clarification" ? END : "title_node";
}

function routeAfterReview(state: CreationGraphState): "revision_node" | "artifact_node" | "fail_node" {
  const report = state.reviewReports.at(-1);
  if (report?.passed) return "artifact_node";
  return state.revisionCount < state.maxRevisionCount ? "revision_node" : "fail_node";
}

export function createWechatArticleGraph(options: GraphOptions = {}) {
  const agents = options.agents ?? createCreationAgents();
  const observer = options.observer;

  const briefNode = createObservedNode(
    observer,
    "brief",
    "需求理解",
    async (state) => ({
      brief: await agents.buildBrief({
        userInput: state.userInput,
        resourceIds: state.resourceIds,
        skillId: state.skillId
      }),
      status: "running"
    }),
    (update) => `已识别主题“${update.brief?.subject ?? ""}”和目标读者`
  );

  const clarificationNode = createObservedNode(
    observer,
    "clarification",
    "信息完整性检查",
    async (state) => requiresClarification(state.userInput)
      ? {
          clarification: {
            reason: "创作主题或目标读者信息不足，继续生成会显著影响文章方向。",
            questions: [{
              id: "audience",
              label: "这篇文章主要面向谁？",
              required: true,
              suggestions: ["儿童家长", "本地消费者", "老客户"]
            }]
          },
          status: "waiting_clarification"
        }
      : {
          clarification: undefined,
          status: "running"
        },
    (update) => update.status === "waiting_clarification" ? "需要补充目标读者" : "创作信息已满足执行条件"
  );

  const titleNode = createObservedNode(
    observer,
    "title",
    "标题策划",
    async (state) => ({
      titles: await agents.createTitles({ brief: requireBrief(state) })
    }),
    (update) => `已推荐《${update.titles ? selectedTitle(update.titles) : ""}》`
  );

  const outlineNode = createObservedNode(
    observer,
    "outline",
    "结构设计",
    async (state) => ({
      outline: await agents.createOutline({
        brief: requireBrief(state),
        titles: requireTitles(state)
      })
    }),
    (update) => `已完成 ${update.outline?.sections.length ?? 0} 个章节的故事与商业结构`
  );

  const writerNode = createObservedNode(
    observer,
    "writer",
    "正文创作",
    async (state) => ({
      draft: await agents.writeDraft({
        brief: requireBrief(state),
        titles: requireTitles(state),
        outline: requireOutline(state)
      })
    }),
    (update) => `已完成 ${update.draft?.paragraphs.length ?? 0} 个正文段落`
  );

  const imagePlanNode = createObservedNode(
    observer,
    "image_plan",
    "配图规划",
    async (state) => ({
      imagePlan: await agents.planImages({
        brief: requireBrief(state),
        outline: requireOutline(state)
      })
    }),
    (update) => `已规划 ${update.imagePlan?.items.length ?? 0} 个图片位置`
  );

  const reviewNode = createObservedNode(
    observer,
    "review",
    "质量审校",
    async (state) => {
      const report = await agents.reviewDraft({
        brief: requireBrief(state),
        draft: requireDraft(state),
        imagePlan: requireImagePlan(state)
      });
      return {
        reviewReports: [...state.reviewReports, report]
      };
    },
    (update) => update.reviewReports?.at(-1)?.passed ? "故事性、商业表达和微信阅读检查通过" : "发现问题，准备定向修订"
  );

  const revisionNode = createObservedNode(
    observer,
    "revision",
    "内容修订",
    async (state) => ({
      draft: await agents.reviseDraft({
        brief: requireBrief(state),
        draft: requireDraft(state),
        imagePlan: requireImagePlan(state),
        report: state.reviewReports.at(-1)!
      }),
      revisionCount: state.revisionCount + 1
    }),
    () => "已按审校问题完成定向修订"
  );

  const artifactNode = createObservedNode(
    observer,
    "artifact",
    "微信排版",
    async (state) => {
      const result = buildArticleDocument({
        userInput: state.userInput,
        titles: requireTitles(state),
        outline: requireOutline(state),
        draft: requireDraft(state),
        imagePlan: requireImagePlan(state)
      });
      return {
        finalDocument: result.document,
        artifactValidation: result.validation,
        status: "completed"
      };
    },
    () => "最终内容校验通过，已生成微信兼容文章结构"
  );

  const failNode = createObservedNode(
    observer,
    "failed",
    "任务终止",
    async () => ({ status: "failed" }),
    () => "审校问题超过最大修订次数"
  );

  return new StateGraph(GraphAnnotation)
    .addNode("brief_node", briefNode)
    .addNode("clarification_node", clarificationNode)
    .addNode("title_node", titleNode)
    .addNode("outline_node", outlineNode)
    .addNode("writer_node", writerNode)
    .addNode("image_plan_node", imagePlanNode)
    .addNode("review_node", reviewNode)
    .addNode("revision_node", revisionNode)
    .addNode("artifact_node", artifactNode)
    .addNode("fail_node", failNode)
    .addEdge(START, "brief_node")
    .addEdge("brief_node", "clarification_node")
    .addConditionalEdges("clarification_node", routeAfterClarification)
    .addEdge("title_node", "outline_node")
    .addEdge("outline_node", "writer_node")
    .addEdge("writer_node", "image_plan_node")
    .addEdge("image_plan_node", "review_node")
    .addConditionalEdges("review_node", routeAfterReview)
    .addEdge("revision_node", "review_node")
    .addEdge("artifact_node", END)
    .addEdge("fail_node", END)
    .compile();
}

export async function runWechatArticleGraph(
  initialState: CreationGraphState,
  options: GraphOptions = {}
): Promise<CreationGraphState> {
  return createWechatArticleGraph(options).invoke(initialState) as Promise<CreationGraphState>;
}

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type {
  ArtifactValidationResult,
  ArticleDraft,
  ArticleOutline,
  ClarificationRequest,
  ContentPlan,
  CreationGraphState,
  CreativeBrief,
  ImagePlan,
  LayoutPlan,
  MaterialAnalysis,
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
  selectedSkills: Annotation<CreationGraphState["selectedSkills"]>({
    reducer: (_current, update) => update,
    default: () => []
  }),
  memory: Annotation<CreationGraphState["memory"] | undefined>(),
  materials: Annotation<MaterialAnalysis | undefined>(),
  brief: Annotation<CreativeBrief | undefined>(),
  contentPlan: Annotation<ContentPlan | undefined>(),
  clarification: Annotation<ClarificationRequest | undefined>(),
  titles: Annotation<TitleCandidates | undefined>(),
  outline: Annotation<ArticleOutline | undefined>(),
  draft: Annotation<ArticleDraft | undefined>(),
  imagePlan: Annotation<ImagePlan | undefined>(),
  layoutPlan: Annotation<LayoutPlan | undefined>(),
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

function requiresClarification(state: CreationGraphState): boolean {
  if (state.memory?.lastArtifactId) return false;
  return state.userInput.trim().length < 12;
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

function requireMaterials(state: CreationGraphState): MaterialAnalysis {
  if (!state.materials) throw new Error("GRAPH_MATERIALS_REQUIRED");
  return state.materials;
}

function requireContentPlan(state: CreationGraphState): ContentPlan {
  if (!state.contentPlan) throw new Error("GRAPH_CONTENT_PLAN_REQUIRED");
  return state.contentPlan;
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

function requireLayoutPlan(state: CreationGraphState): LayoutPlan {
  if (!state.layoutPlan) throw new Error("GRAPH_LAYOUT_PLAN_REQUIRED");
  return state.layoutPlan;
}

function routeAfterClarification(state: CreationGraphState): "planner_node" | typeof END {
  return state.status === "waiting_clarification" ? END : "planner_node";
}

function routeAfterReview(
  state: CreationGraphState
): "brief_node" | "planner_node" | "revision_node" | "image_plan_node" | "layout_node" | "artifact_node" | "fail_node" {
  const report = state.reviewReports.at(-1);
  if (report?.passed) return "artifact_node";
  if (state.revisionCount >= state.maxRevisionCount) return "fail_node";
  const targets = new Set(report?.issues.filter((issue) => issue.severity === "error").map((issue) => issue.target));
  if (targets.has("brief")) return "brief_node";
  if (targets.has("plan") || targets.has("outline")) return "planner_node";
  if (targets.has("image")) return "image_plan_node";
  if (targets.has("layout")) return "layout_node";
  return "revision_node";
}

export function createWechatArticleGraph(options: GraphOptions = {}) {
  const agents = options.agents ?? createCreationAgents();
  const observer = options.observer;

  const materialNode = createObservedNode(
    observer,
    "material",
    "素材理解",
    async (state) => ({
      materials: await agents.analyzeMaterials({
        resourceIds: state.resourceIds,
        memory: state.memory,
        selectedSkills: state.selectedSkills
      })
    }),
    (update) => `已完成 ${update.materials?.items.length ?? 0} 项素材摘要`
  );

  const briefNode = createObservedNode(
    observer,
    "brief",
    "需求理解",
    async (state) => ({
      brief: await agents.buildBrief({
        userInput: state.userInput,
        resourceIds: state.resourceIds,
        skillId: state.skillId,
        materials: requireMaterials(state),
        selectedSkills: state.selectedSkills,
        memory: state.memory
      }),
      status: "running"
    }),
    (update) => `已识别主题“${update.brief?.subject ?? ""}”和目标读者`
  );

  const plannerNode = createObservedNode(
    observer,
    "planner",
    "内容策划",
    async (state) => ({
      contentPlan: await agents.createContentPlan({
        userInput: state.userInput,
        brief: requireBrief(state),
        materials: requireMaterials(state),
        selectedSkills: state.selectedSkills
      })
    }),
    (update) => `已完成 ${update.contentPlan?.sections.length ?? 0} 个章节的内容设计`
  );

  const clarificationNode = createObservedNode(
    observer,
    "clarification",
    "信息完整性检查",
    async (state) => requiresClarification(state)
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
      titles: await agents.createTitles({
        brief: requireBrief(state),
        contentPlan: requireContentPlan(state),
        selectedSkills: state.selectedSkills
      })
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
        contentPlan: requireContentPlan(state),
        titles: requireTitles(state),
        selectedSkills: state.selectedSkills
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
        contentPlan: requireContentPlan(state),
        titles: requireTitles(state),
        outline: requireOutline(state),
        selectedSkills: state.selectedSkills,
        memory: state.memory
      })
    }),
    (update) => `已完成 ${update.draft?.sections.length ?? 0} 个正文章节`
  );

  const imagePlanNode = createObservedNode(
    observer,
    "image_plan",
    "配图规划",
    async (state) => ({
      imagePlan: await agents.planImages({
        brief: requireBrief(state),
        contentPlan: requireContentPlan(state),
        draft: requireDraft(state),
        materials: requireMaterials(state),
        selectedSkills: state.selectedSkills
      })
    }),
    (update) => `已规划 ${update.imagePlan?.items.length ?? 0} 个图片位置`
  );

  const layoutNode = createObservedNode(
    observer,
    "layout",
    "版式设计",
    async (state) => ({
      layoutPlan: await agents.createLayout({
        brief: requireBrief(state),
        contentPlan: requireContentPlan(state),
        draft: requireDraft(state),
        imagePlan: requireImagePlan(state),
        selectedSkills: state.selectedSkills
      })
    }),
    (update) => `已生成 ${update.layoutPlan?.theme ?? ""} 主题版式`
  );

  const reviewNode = createObservedNode(
    observer,
    "review",
    "质量审校",
    async (state) => {
      const report = await agents.reviewDraft({
        userInput: state.userInput,
        brief: requireBrief(state),
        contentPlan: requireContentPlan(state),
        draft: requireDraft(state),
        imagePlan: requireImagePlan(state),
        layoutPlan: requireLayoutPlan(state),
        selectedSkills: state.selectedSkills
      });
      return {
        reviewReports: [...state.reviewReports, report],
        revisionCount: report.passed ? state.revisionCount : state.revisionCount + 1
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
        contentPlan: requireContentPlan(state),
        draft: requireDraft(state),
        imagePlan: requireImagePlan(state),
        layoutPlan: requireLayoutPlan(state),
        userInput: state.userInput,
        report: state.reviewReports.at(-1)!,
        selectedSkills: state.selectedSkills,
        memory: state.memory
      }),
      revisionCount: state.revisionCount
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
        brief: requireBrief(state),
        contentPlan: requireContentPlan(state),
        titles: requireTitles(state),
        outline: requireOutline(state),
        draft: requireDraft(state),
        imagePlan: requireImagePlan(state),
        layoutPlan: requireLayoutPlan(state),
        selectedSkills: state.selectedSkills
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
    .addNode("material_node", materialNode)
    .addNode("brief_node", briefNode)
    .addNode("planner_node", plannerNode)
    .addNode("clarification_node", clarificationNode)
    .addNode("title_node", titleNode)
    .addNode("outline_node", outlineNode)
    .addNode("writer_node", writerNode)
    .addNode("image_plan_node", imagePlanNode)
    .addNode("layout_node", layoutNode)
    .addNode("review_node", reviewNode)
    .addNode("revision_node", revisionNode)
    .addNode("artifact_node", artifactNode)
    .addNode("fail_node", failNode)
    .addEdge(START, "material_node")
    .addEdge("material_node", "brief_node")
    .addEdge("brief_node", "clarification_node")
    .addConditionalEdges("clarification_node", routeAfterClarification)
    .addEdge("planner_node", "title_node")
    .addEdge("title_node", "outline_node")
    .addEdge("outline_node", "writer_node")
    .addEdge("writer_node", "image_plan_node")
    .addEdge("image_plan_node", "layout_node")
    .addEdge("layout_node", "review_node")
    .addConditionalEdges("review_node", routeAfterReview)
    .addEdge("revision_node", "image_plan_node")
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

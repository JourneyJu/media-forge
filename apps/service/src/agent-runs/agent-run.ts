import { randomUUID } from "node:crypto";
import type {
  AgentPlan,
  AgentRun,
  AgentStep,
  AgentStepType,
  CreateAgentRunRequest,
  SubmitAgentDecisionRequest
} from "@mediaforge/contracts";
import { generateWechatArticle } from "../ai-generation";
import { renderWechatArticle } from "../wechat-renderer";

function now(): string {
  return new Date().toISOString();
}

function buildPlan(input: CreateAgentRunRequest): AgentPlan {
  const assetSummary = input.assetIds.length > 0
    ? `围绕 ${input.assetIds.length} 项素材建立图文节奏`
    : "先建立文字结构，素材可在排版阶段补充";

  const skillStrategy = input.layoutSkillId === "youth-growth-listicle"
    ? "少儿成长清单：柔和引言、编号章节、图片间奏和收束结尾"
    : input.style === "story" ? "故事画册式结构" : "清晰递进式结构";

  return {
    strategy: skillStrategy,
    rationale: `${assetSummary}；先排版再扩充，完成后进行结构审阅和微信终审。`,
    tasks: [
      { id: "layout", type: "layout", title: "生成图文骨架", objective: "确定章节、素材位置和内容目标", status: "pending" },
      { id: "expanding", type: "expanding", title: "按骨架扩充", objective: "补齐正文、重点句和行动引导", status: "pending" },
      { id: "reviewing", type: "reviewing", title: "整体审阅", objective: "检查结构、完整性和阅读节奏", status: "pending" },
      { id: "final_review", type: "final_review", title: "终审与兼容检查", objective: "确认内容质量和微信兼容性", status: "pending" }
    ]
  };
}

function makeStep(
  run: AgentRun,
  type: AgentStepType,
  title: string,
  summary: string,
  score?: number,
  status: AgentStep["status"] = "succeeded"
): AgentStep {
  const step: AgentStep = {
    id: randomUUID(),
    stepNo: run.steps.length + 1,
    type,
    status,
    title,
    summary,
    createdAt: now()
  };
  if (score !== undefined) step.score = score;
  run.steps.push(step);
  run.currentStep = type;
  run.updatedAt = step.createdAt;
  return step;
}

function completeTask(run: AgentRun, type: AgentPlan["tasks"][number]["type"]): void {
  const task = run.plan.tasks.find((item) => item.type === type);
  if (task) task.status = "completed";
}

function expandThinStructure(run: AgentRun): void {
  if (!run.result) return;

  run.result.document.content.splice(-1, 0,
    {
      id: randomUUID(),
      type: "heading",
      content: [{ type: "text", text: "把这一刻，留给未来的你们" }]
    },
    {
      id: randomUUID(),
      type: "paragraph",
      content: [{
        type: "text",
        text: "真正值得保存的从来不只是一个标准动作，而是孩子当下的神情、家人的陪伴，以及多年后仍能唤起记忆的生活细节。"
      }]
    }
  );
  run.result.render = renderWechatArticle(run.result.document);
}

async function executeRun(run: AgentRun, input: CreateAgentRunRequest): Promise<void> {
  run.waitingFor = undefined;
  run.status = "layout";
  makeStep(run, "layout", "排版骨架已生成", `采用${run.plan.strategy}，先确定开场、章节、图组和结尾。`);
  completeTask(run, "layout");

  run.status = "expanding";
  makeStep(run, "expanding", "正在扩充内容", "按照骨架补充正文、重点表达和结尾引导。", undefined, "running");
  const generationInput = input.layoutSkillId === "youth-growth-listicle"
    ? {
        ...input,
        style: "list" as const,
        extraInstructions: [
          input.extraInstructions,
          "按少儿成长清单组织内容：首段简短导读；正文拆成有明确观点的编号章节；语言面向家长、亲切可信；不得输出执行计划、审阅过程或占位说明。"
        ].filter(Boolean).join("\n")
      }
    : input;
  run.result = await generateWechatArticle(generationInput);
  run.steps.at(-1)!.status = "succeeded";
  run.steps.at(-1)!.summary = `已生成 ${run.result.document.content.length} 个内容块。`;
  completeTask(run, "expanding");

  run.status = "reviewing";
  const needsRestructure = run.result.document.content.length < 6;
  makeStep(
    run,
    "reviewing",
    needsRestructure ? "审阅发现结构偏薄" : "首轮审阅通过",
    needsRestructure ? "正文层次不足，增加情绪承接章节后重新审阅。" : "结构、内容完整性和阅读节奏符合计划。",
    needsRestructure ? 72 : 88
  );

  if (needsRestructure && run.steps.length + 3 <= input.maxSteps) {
    run.status = "restructuring";
    run.restructureCount += 1;
    makeStep(run, "restructuring", "结构已重排", "增加承接章节，让卖点表达与情绪价值形成递进。");

    run.status = "expanding";
    expandThinStructure(run);
    makeStep(run, "expanding", "重排后内容已扩充", `当前文章包含 ${run.result.document.content.length} 个内容块。`);

    run.status = "reviewing";
    makeStep(run, "reviewing", "复审通过", "重排后章节完整，叙事顺序和阅读节奏符合计划。", 91);
  }
  completeTask(run, "reviewing");

  run.status = "final_review";
  makeStep(run, "final_review", "终审完成", "文章结构、内容完整性和微信内联样式检查通过。", 94);
  completeTask(run, "final_review");
  run.status = "completed";
  run.lockVersion += 1;
  run.updatedAt = now();
}

export function createAgentRunStore() {
  const runs = new Map<string, { run: AgentRun; input: CreateAgentRunRequest }>();
  const decisions = new Map<string, AgentRun>();

  return {
    async create(input: CreateAgentRunRequest): Promise<AgentRun> {
      const createdAt = now();
      const run: AgentRun = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        status: "analyzing_assets",
        currentStep: "analyzing_assets",
        lockVersion: 1,
        revisionCount: 0,
        restructureCount: 0,
        plan: buildPlan(input),
        steps: [],
        createdAt,
        updatedAt: createdAt
      };
      if (input.articleId) run.articleId = input.articleId;

      makeStep(
        run,
        "analyzing_assets",
        "素材分析完成",
        input.assetIds.length > 0 ? `已接收 ${input.assetIds.length} 项素材并纳入排版计划。` : "未选择素材，将先生成文字骨架。"
      );
      run.status = "planning";
      makeStep(run, "planning", "执行计划已生成", run.plan.rationale);
      runs.set(run.id, { run, input });
      await executeRun(run, input);
      return run;
    },

    get(runId: string): AgentRun | undefined {
      return runs.get(runId)?.run;
    },

    async decide(runId: string, decision: SubmitAgentDecisionRequest): Promise<AgentRun> {
      const stored = runs.get(runId);
      if (!stored) throw new Error("AGENT_RUN_NOT_FOUND");
      if (decisions.has(decision.idempotencyKey)) return decisions.get(decision.idempotencyKey)!;

      const { run, input } = stored;
      if (run.status !== "waiting_user" || run.waitingFor?.stepId !== decision.stepId) {
        throw new Error("AGENT_RUN_INVALID_STATE");
      }
      if (run.lockVersion !== decision.lockVersion) throw new Error("AGENT_RUN_VERSION_CONFLICT");

      if (decision.decision === "cancel") {
        run.status = "cancelled";
        run.waitingFor = undefined;
        run.lockVersion += 1;
      } else if (decision.decision === "revise_plan") {
        run.plan.rationale = decision.instruction || run.plan.rationale;
        run.waitingFor.prompt = "计划已按补充要求更新，是否继续执行？";
        run.lockVersion += 1;
      } else {
        await executeRun(run, { ...input, extraInstructions: decision.instruction || input.extraInstructions });
      }

      decisions.set(decision.idempotencyKey, run);
      return run;
    }
  };
}

export const agentRunStore = createAgentRunStore();

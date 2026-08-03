import {
  articleDraftSchema,
  articleOutlineSchema,
  creativeBriefSchema,
  imagePlanSchema,
  reviewReportSchema,
  titleCandidatesSchema,
  type ArticleDraft,
  type ArticleOutline,
  type CreationGraphState,
  type CreativeBrief,
  type ImagePlan,
  type ReviewReport,
  type TitleCandidates
} from "@mediaforge/contracts";
import {
  generateStructuredJsonWithGateway,
  resolveModelGatewayConfig
} from "../model-gateway";

interface BriefInput {
  userInput: string;
  resourceIds: string[];
  skillId: string;
  selectedSkills?: CreationGraphState["selectedSkills"];
  memory?: CreationGraphState["memory"];
}

interface TitleInput {
  brief: CreativeBrief;
  selectedSkills?: CreationGraphState["selectedSkills"];
}

interface OutlineInput {
  brief: CreativeBrief;
  titles: TitleCandidates;
  selectedSkills?: CreationGraphState["selectedSkills"];
}

interface DraftInput {
  brief: CreativeBrief;
  titles: TitleCandidates;
  outline: ArticleOutline;
  selectedSkills?: CreationGraphState["selectedSkills"];
  memory?: CreationGraphState["memory"];
}

interface ImagePlanInput {
  brief: CreativeBrief;
  outline: ArticleOutline;
  selectedSkills?: CreationGraphState["selectedSkills"];
}

interface ReviewInput {
  brief: CreativeBrief;
  draft: ArticleDraft;
  imagePlan: ImagePlan;
  selectedSkills?: CreationGraphState["selectedSkills"];
}

interface RevisionInput extends ReviewInput {
  report: ReviewReport;
  memory?: CreationGraphState["memory"];
}

export interface CreationAgents {
  buildBrief(input: BriefInput): Promise<CreativeBrief>;
  createTitles(input: TitleInput): Promise<TitleCandidates>;
  createOutline(input: OutlineInput): Promise<ArticleOutline>;
  writeDraft(input: DraftInput): Promise<ArticleDraft>;
  planImages(input: ImagePlanInput): Promise<ImagePlan>;
  reviewDraft(input: ReviewInput): Promise<ReviewReport>;
  reviseDraft(input: RevisionInput): Promise<ArticleDraft>;
}

function selectedTitle(titles: TitleCandidates) {
  return titles.items.find((item) => item.id === titles.selectedId) ?? titles.items[0]!;
}

function clip(value: string, maxLength: number): string {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function inferSubject(input: string): string {
  const topicMatch = input.match(/主题(?:是|为|：|:)\s*([^，。；;\n]+)/u);
  if (topicMatch?.[1]) return clip(topicMatch[1], 60);

  if (input.includes("儿童摄影")) {
    if (input.includes("团队") || input.includes("宣传")) return "儿童摄影团队品牌宣传";
    return "儿童摄影";
  }
  if (input.includes("新品")) return "新品发布";
  if (input.includes("活动")) return "活动宣传";

  const firstMeaningfulLine = input
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*\d+[.、]\s*/u, "").trim())
    .find((line) => line.length >= 4 && !/^(帮我|请|要求如下)/u.test(line));

  return clip(firstMeaningfulLine ?? "公众号内容创作", 60);
}

function inferAudience(input: string): string {
  const match = input.match(/面向(?:的是)?\s*([^，。；;\n]+)/u);
  if (match?.[1]) return clip(match[1], 80);
  if (input.includes("家长")) return "儿童家长";
  if (input.includes("老客户")) return "老客户";
  return "关注该主题的微信读者";
}

function createDemoBrief(input: BriefInput): CreativeBrief {
  const selectedSkill = input.selectedSkills?.[0];
  const skillRules = selectedSkill
    ? [
        `使用用户私有 Skill：${selectedSkill.alias ?? selectedSkill.name}`,
        `语气：${selectedSkill.manifest.style.tone}`,
        ...selectedSkill.manifest.writingRules,
        ...selectedSkill.manifest.assets.map((asset) => `资源 ${asset.key} 用途：${asset.usage}`)
      ]
    : [];
  const forbiddenRules = selectedSkill?.manifest.forbiddenRules ?? [];

  if (input.memory?.brief && input.userInput.trim().length <= 40) {
    return creativeBriefSchema.parse({
      ...input.memory.brief,
      constraints: [
        ...input.memory.brief.constraints,
        input.userInput,
        ...skillRules
      ].slice(-20),
      resourceIds: [...new Set([...input.memory.brief.resourceIds, ...input.resourceIds])],
      skillId: input.skillId
    });
  }

  const materialRequirements = input.userInput
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*\d+[.、]\s*/u, "").trim())
    .filter((line) => /素材|图片|分类|组图/u.test(line))
    .slice(0, 10);
  const constraints = input.userInput
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*\d+[.、]\s*/u, "").trim())
    .filter((line) => /风格|语言|不要|避免|要求/u.test(line))
    .slice(0, 10);

  return creativeBriefSchema.parse({
    subject: inferSubject(input.userInput),
    goal: input.userInput.includes("宣传") || input.userInput.includes("品牌")
      ? "brand"
      : input.userInput.includes("活动")
        ? "event"
        : "education",
    audience: inferAudience(input.userInput),
    contentType: input.userInput.includes("故事") ? "品牌故事" : "公众号图文",
    campaignObject: input.userInput.includes("团队") ? "服务团队" : undefined,
    tone: input.userInput.includes("温暖") || input.userInput.includes("自然") ? "warm" : "friendly",
    storyAngle: input.userInput.includes("儿童")
      ? "从孩子成长中的真实瞬间切入"
      : "从读者熟悉的生活场景切入",
    materialRequirements,
    resourceIds: input.resourceIds,
    constraints: [...constraints, ...skillRules].slice(0, 20),
    prohibitedContent: ["用户原始指令", "AI 思考过程", "执行计划", "审校说明", ...forbiddenRules].slice(0, 20),
    skillId: input.skillId
  });
}

function createDemoTitles(brief: CreativeBrief): TitleCandidates {
  const subject = brief.subject.replace(/团队品牌宣传|品牌宣传|宣传/gu, "").trim() || brief.subject;
  const childTheme = subject.includes("儿童") || brief.audience.includes("家长");
  const items = childTheme
    ? [
        { id: "story", title: "把童年留在镜头里", subtitle: "那些成长中的小事，值得被认真收藏", angle: "成长故事", audienceFit: 94, brandFit: 92, clickPotential: 90, riskFlags: [] },
        { id: "scene", title: "孩子长大的瞬间，比想象中更快", subtitle: "用自然的影像记住真实童年", angle: "情绪共鸣", audienceFit: 96, brandFit: 88, clickPotential: 93, riskFlags: [] },
        { id: "brand", title: "好的儿童摄影，不只是拍一张好看的照片", subtitle: "看见孩子，也看见每个家庭的故事", angle: "专业价值", audienceFit: 90, brandFit: 95, clickPotential: 87, riskFlags: [] }
      ]
    : [
        { id: "value", title: `${clip(subject, 24)}，真正重要的是什么`, angle: "价值解释", audienceFit: 90, brandFit: 90, clickPotential: 86, riskFlags: [] },
        { id: "scene", title: `从一个真实场景，重新认识${clip(subject, 20)}`, angle: "场景故事", audienceFit: 92, brandFit: 88, clickPotential: 89, riskFlags: [] },
        { id: "guide", title: `关于${clip(subject, 22)}，这几件事值得认真说清楚`, angle: "实用指南", audienceFit: 88, brandFit: 90, clickPotential: 87, riskFlags: [] }
      ];

  return titleCandidatesSchema.parse({
    items,
    selectedId: childTheme ? "story" : "scene",
    selectionReason: "兼顾目标读者的情绪共鸣、品牌表达和微信阅读场景"
  });
}

function createDemoOutline(input: OutlineInput): ArticleOutline {
  const title = selectedTitle(input.titles);
  return articleOutlineSchema.parse({
    title: title.title,
    subtitle: title.subtitle,
    openingHook: `从${input.brief.audience}熟悉的日常瞬间切入，让主题先与读者产生关系。`,
    callToAction: "邀请读者进一步了解服务、查看案例或进行咨询。",
    sections: [
      {
        title: "时间藏在那些不起眼的小事里",
        objective: "用具体生活场景建立情绪连接",
        storyBeat: "孩子不经意的表情和动作，成为家庭记忆的入口",
        commercialGoal: "让读者理解记录的价值"
      },
      {
        title: "自然，比标准答案更动人",
        objective: "说明专业方法和品牌差异",
        storyBeat: "从摆拍与真实互动的差别展开",
        commercialGoal: "体现团队的观察力和专业能力"
      },
      {
        title: "为每个家庭留下自己的故事",
        objective: "收束品牌价值并引导行动",
        storyBeat: "将一次拍摄连接到多年后的家庭回忆",
        commercialGoal: "引导咨询和案例了解"
      }
    ]
  });
}

function createDemoDraft(input: DraftInput): ArticleDraft {
  const title = selectedTitle(input.titles);
  const audience = input.brief.audience;
  const revisionInstruction = input.memory?.revisionIntent?.instruction;
  const revisionLead = revisionInstruction
    ? `根据本轮修改要求“${clip(revisionInstruction, 80)}”，在保留原有结构的基础上调整表达。`
    : "";
  return articleDraftSchema.parse({
    title: title.title,
    subtitle: title.subtitle,
    paragraphs: [
      `${revisionLead}孩子长大的速度，常常比我们意识到的更快。今天还会因为一颗糖开心很久，明天就开始有了自己的主意。对${audience}来说，真正舍不得忘记的，往往不是某个标准动作，而是这些带着性格和温度的小瞬间。`,
      "镜头的意义，是让时间稍微慢下来。一个低头摆弄玩具的侧影，一次忍不住的大笑，或者牵着家人时下意识握紧的小手，都比刻意安排的表情更接近孩子本来的样子。",
      "因此，儿童摄影首先需要的不是让孩子配合，而是让拍摄者愿意等待、观察并进入他们的节奏。熟悉之后的放松、玩耍时的专注、和家人互动时的依赖，才会自然地留在画面里。",
      "不同孩子有不同的表达方式。有的明亮活泼，适合轻快的生活场景；有的安静细腻，更适合克制、干净的画面；还有一些家庭，希望把陪伴本身也放进照片，让影像成为一家人的共同记忆。",
      "专业团队的价值，正是把这些差异看见。前期了解家庭的期待，拍摄中保留孩子的主动性，后期控制色彩和修饰的分寸，让照片好看，却依然能认出那个真实的孩子。",
      "许多年后再翻开这些影像，人们记住的不会只是一次拍摄，而是孩子当时的神情、家人的陪伴，以及那个阶段独一无二的生活。好的记录不会替童年加上模板，它只是认真地把故事留下来。",
      "每个家庭都值得拥有属于自己的成长记录。可以从喜欢的影像风格和孩子当下的状态开始，慢慢找到最适合你们的表达方式。"
    ]
  });
}

function createDemoImagePlan(input: ImagePlanInput): ImagePlan {
  return imagePlanSchema.parse({
    items: [
      {
        placement: "cover",
        description: "选择一张主体清晰、表情自然、留有标题空间的儿童照片作为封面。",
        resourceId: input.brief.resourceIds[0]
      },
      ...input.outline.sections.slice(0, 3).map((section, index) => ({
        placement: "section" as const,
        description: `用于“${section.title}”章节，优先选择第 ${index + 1} 类素材中能体现真实互动的照片。`,
        resourceId: input.brief.resourceIds[index + 1]
      }))
    ]
  });
}

function createDemoReview(input: ReviewInput): ReviewReport {
  const text = [input.draft.title, ...input.draft.paragraphs].join("\n");
  const issues = [];
  if (/帮我|要求如下|我会先|执行计划|作为AI|作为 AI/u.test(text)) {
    issues.push({
      code: "PROCESS_COPY_LEAK",
      severity: "error" as const,
      target: "body" as const,
      instruction: "删除用户指令或 AI 执行过程，只保留可发布正文。"
    });
  }
  if (input.draft.paragraphs.length < 5) {
    issues.push({
      code: "BODY_TOO_THIN",
      severity: "error" as const,
      target: "body" as const,
      instruction: "补充故事场景、专业价值和行动引导。"
    });
  }

  return reviewReportSchema.parse({
    passed: issues.every((issue) => issue.severity !== "error"),
    scores: {
      story: 90,
      commercial: 86,
      audienceFit: 92,
      naturalness: issues.length === 0 ? 94 : 70,
      wechatReadability: 91,
      factualRisk: 95
    },
    issues
  });
}

function createDemoAgents(): CreationAgents {
  return {
    async buildBrief(input) {
      return createDemoBrief(input);
    },
    async createTitles({ brief }) {
      return createDemoTitles(brief);
    },
    async createOutline(input) {
      return createDemoOutline(input);
    },
    async writeDraft(input) {
      return createDemoDraft(input);
    },
    async planImages(input) {
      return createDemoImagePlan(input);
    },
    async reviewDraft(input) {
      return createDemoReview(input);
    },
    async reviseDraft(input) {
      const cleaned = input.draft.paragraphs
        .map((paragraph) => paragraph.replace(/帮我|要求如下|我会先|执行计划|作为\s*AI/gu, "").trim())
        .filter(Boolean);
      return articleDraftSchema.parse({
        ...input.draft,
        paragraphs: cleaned.length >= 3 ? cleaned : createDemoDraft({
          brief: input.brief,
          titles: createDemoTitles(input.brief),
          outline: createDemoOutline({
            brief: input.brief,
            titles: createDemoTitles(input.brief)
          })
        }).paragraphs
      });
    }
  };
}

function createGatewayAgents(context: { userId: string; runId?: string }): CreationAgents {
  async function generate<T>(
    options: Parameters<typeof generateStructuredJsonWithGateway<T>>[1]
  ): Promise<T> {
    const config = await resolveModelGatewayConfig("text_generation");
    return generateStructuredJsonWithGateway(config, {
      ...options,
      usage: {
        ...context,
        modelConfigId: config.modelConfigId,
        routeKey: "text_generation"
      }
    });
  }

  return {
    buildBrief: (input) => generate({
      agentName: "BriefAgent",
      systemPrompt: "将用户创作需求提取为结构化 CreativeBrief。subject 必须是简短主题，不能复制用户完整指令。",
      input,
      schema: creativeBriefSchema,
      temperature: 0.2
    }),
    createTitles: (input) => generate({
      agentName: "TitleAgent",
      systemPrompt: "基于 CreativeBrief 生成 3 到 5 个公众号标题候选，评分并自动选择最合适的一项。标题不得包含用户指令。",
      input,
      schema: titleCandidatesSchema,
      temperature: 0.7
    }),
    createOutline: (input) => generate({
      agentName: "OutlineAgent",
      systemPrompt: "设计兼具故事性和商业表达的公众号文章结构，明确每节故事节拍和商业目标。",
      input,
      schema: articleOutlineSchema,
      temperature: 0.5
    }),
    writeDraft: (input) => generate({
      agentName: "WriterAgent",
      systemPrompt: "根据 Brief、选定标题和 Outline 写可直接发布的中文正文。不得输出指令、计划、审校说明或 AI 过程。",
      input,
      schema: articleDraftSchema,
      temperature: 0.7
    }),
    planImages: (input) => generate({
      agentName: "ImagePlannerAgent",
      systemPrompt: "规划封面和正文图片位置，并优先映射已有 resourceIds。",
      input,
      schema: imagePlanSchema,
      temperature: 0.4
    }),
    reviewDraft: (input) => generate({
      agentName: "ReviewerAgent",
      systemPrompt: "审校故事性、商业表达、受众匹配、自然度、微信阅读体验和事实风险。有严重问题必须 passed=false。",
      input,
      schema: reviewReportSchema,
      temperature: 0.2
    }),
    reviseDraft: (input) => generate({
      agentName: "RevisionAgent",
      systemPrompt: "只根据 ReviewReport 定向修订正文，保留选定标题，不输出修改说明。",
      input,
      schema: articleDraftSchema,
      temperature: 0.5
    })
  };
}

export function createCreationAgents(context: { userId: string; runId?: string } = { userId: "system" }): CreationAgents {
  if (process.env.MODEL_MODE === "demo" || process.env.NODE_ENV === "test") return createDemoAgents();
  return createGatewayAgents(context);
}

export function createDemoCreationAgents(): CreationAgents {
  return createDemoAgents();
}

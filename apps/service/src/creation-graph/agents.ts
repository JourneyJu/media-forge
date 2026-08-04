import {
  articleDraftSchema,
  articleOutlineSchema,
  contentPlanSchema,
  creativeBriefSchema,
  imagePlanSchema,
  layoutPlanSchema,
  materialAnalysisSchema,
  reviewReportSchema,
  titleCandidatesSchema,
  type ArticleDraft,
  type ArticleOutline,
  type ContentPlan,
  type CreationGraphState,
  type CreativeBrief,
  type ImagePlan,
  type LayoutPlan,
  type MaterialAnalysis,
  type ReviewReport,
  type TitleCandidates
} from "@mediaforge/contracts";
import {
  generateStructuredJsonWithGateway,
  resolveModelGatewayConfig,
  type ModelGatewayProgressEvent
} from "../model-gateway";

type SelectedSkills = CreationGraphState["selectedSkills"];

interface MaterialInput {
  resourceIds: string[];
  memory?: CreationGraphState["memory"];
  selectedSkills?: SelectedSkills;
}

interface BriefInput {
  userInput: string;
  resourceIds: string[];
  skillId: string;
  materials: MaterialAnalysis;
  selectedSkills?: SelectedSkills;
  memory?: CreationGraphState["memory"];
}

interface PlanInput {
  userInput: string;
  brief: CreativeBrief;
  materials: MaterialAnalysis;
  selectedSkills?: SelectedSkills;
  memory?: CreationGraphState["memory"];
}

interface TitleInput {
  brief: CreativeBrief;
  contentPlan: ContentPlan;
  selectedSkills?: SelectedSkills;
}

interface OutlineInput extends TitleInput {
  titles: TitleCandidates;
}

interface DraftInput extends OutlineInput {
  outline: ArticleOutline;
  imagePlan: ImagePlan;
  memory?: CreationGraphState["memory"];
}

interface ImagePlanInput {
  brief: CreativeBrief;
  contentPlan: ContentPlan;
  outline: ArticleOutline;
  draft?: ArticleDraft;
  materials: MaterialAnalysis;
  selectedSkills?: SelectedSkills;
}

interface LayoutInput {
  brief: CreativeBrief;
  contentPlan: ContentPlan;
  draft: ArticleDraft;
  imagePlan: ImagePlan;
  selectedSkills?: SelectedSkills;
}

interface ReviewInput extends LayoutInput {
  userInput: string;
  layoutPlan: LayoutPlan;
}

interface RevisionInput extends ReviewInput {
  report: ReviewReport;
  memory?: CreationGraphState["memory"];
}

export interface CreationAgents {
  analyzeMaterials(input: MaterialInput): Promise<MaterialAnalysis>;
  buildBrief(input: BriefInput): Promise<CreativeBrief>;
  createContentPlan(input: PlanInput): Promise<ContentPlan>;
  createTitles(input: TitleInput): Promise<TitleCandidates>;
  createOutline(input: OutlineInput): Promise<ArticleOutline>;
  writeDraft(input: DraftInput): Promise<ArticleDraft>;
  planImages(input: ImagePlanInput): Promise<ImagePlan>;
  createLayout(input: LayoutInput): Promise<LayoutPlan>;
  reviewDraft(input: ReviewInput): Promise<ReviewReport>;
  reviseDraft(input: RevisionInput): Promise<ArticleDraft>;
}

function clip(value: string, maxLength: number): string {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function selectedTitle(titles: TitleCandidates) {
  return titles.items.find((item) => item.id === titles.selectedId) ?? titles.items[0]!;
}

function inferSubject(input: string): string {
  const topicMatch = input.match(/主题(?:是|为|：|:)\s*([^，。；;\n]+)/u);
  if (topicMatch?.[1]) return clip(topicMatch[1], 60);
  const firstMeaningfulLine = input
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*\d+[.、]\s*/u, "").trim())
    .find((line) => line.length >= 4 && !/^(帮我|请|要求如下)/u.test(line));
  const factualSubject = (firstMeaningfulLine ?? "公众号内容创作")
    .split(/[，。；;]\s*(?=请|帮我|根据|需要|要求)/u, 1)[0]!
    .replace(/(?:请围绕|请根据|帮我|需要你|要求).*/u, "")
    .trim();
  return clip(factualSubject || "公众号内容创作", 60);
}

function instructionContext(memory: CreationGraphState["memory"] | undefined): string {
  const rebuilt = memory?.instructionMemory?.rebuiltContext;
  const parts = [
    rebuilt
      ? [
          rebuilt.taskGoal ? `任务目标：${rebuilt.taskGoal}` : "",
          rebuilt.sourceRequest ? `原始核心需求：${rebuilt.sourceRequest}` : "",
          rebuilt.audience ? `目标读者：${rebuilt.audience}` : "",
          rebuilt.styleConstraints.length > 0 ? `风格约束：${rebuilt.styleConstraints.join("；")}` : "",
          rebuilt.contentRequirements.length > 0 ? `内容要求：${rebuilt.contentRequirements.join("；")}` : "",
          rebuilt.prohibitedContent.length > 0 ? `禁止内容：${rebuilt.prohibitedContent.join("；")}` : ""
        ].filter(Boolean).join("\n")
      : undefined,
    ...(memory?.instructionMemory?.recentValuableTurns ?? []).map((turn) => turn.content)
  ].filter((value): value is string => Boolean(value?.trim()));
  return parts.join("\n\n");
}

function effectiveInstruction(userInput: string, memory: CreationGraphState["memory"] | undefined): string {
  const context = instructionContext(memory);
  return context ? `${context}\n\n本轮指令：${userInput}` : userInput;
}

function inferAudience(input: string): string {
  const match = input.match(/面向(?:的是)?\s*([^，。；;\n]+)/u);
  return clip(match?.[1] ?? "关注该主题的微信读者", 80);
}

function skillRules(skills: SelectedSkills | undefined): {
  writing: string[];
  forbidden: string[];
  layout: string[];
} {
  const skill = skills?.[0];
  if (!skill) return { writing: [], forbidden: [], layout: [] };
  return {
    writing: [
      `Skill：${skill.alias ?? skill.name}`,
      `语气：${skill.manifest.style.tone}`,
      ...skill.manifest.writingRules
    ],
    forbidden: skill.manifest.forbiddenRules,
    layout: [
      ...(skill.manifest.style.primaryColor ? [`主色：${skill.manifest.style.primaryColor}`] : []),
      ...skill.manifest.assets.map((asset) => `${asset.type}:${asset.key}:${asset.usage}`)
    ]
  };
}

function createDemoMaterials(input: MaterialInput): MaterialAnalysis {
  const remembered = new Map(
    (input.memory?.resourceContext?.materialSummary ?? input.memory?.materialSummary ?? [])
      .map((item) => [item.resourceId, item])
  );
  return materialAnalysisSchema.parse({
    items: input.resourceIds.map((resourceId) => remembered.get(resourceId) ?? {
      resourceId,
      type: "image",
      description: "本轮用户上传素材",
      suggestedUsage: "根据内容计划选择封面或对应章节使用",
      quality: "medium"
    })
  });
}

function createDemoBrief(input: BriefInput): CreativeBrief {
  const rules = skillRules(input.selectedSkills);
  const effectiveInput = effectiveInstruction(input.userInput, input.memory);
  const subject = inferSubject(effectiveInput);
  const constraints = effectiveInput
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /风格|语言|不要|避免|要求/u.test(line))
    .slice(0, 12);
  return creativeBriefSchema.parse({
    subject,
    goal: /获奖|活动/u.test(effectiveInput) ? "event" : /宣传|品牌/u.test(effectiveInput) ? "brand" : "story",
    audience: inferAudience(effectiveInput),
    contentType: "公众号图文",
    tone: /热烈|获奖|庆祝/u.test(effectiveInput) ? "lively" : /温暖|自然/u.test(effectiveInput) ? "warm" : "friendly",
    storyAngle: `围绕“${subject}”的真实信息、现场细节和意义展开`,
    materialRequirements: input.materials.items.map((item) => item.description).slice(0, 20),
    resourceIds: input.resourceIds,
    constraints: [...constraints, ...rules.writing].slice(0, 20),
    prohibitedContent: ["旧主题内容", "用户指令", "AI 过程", ...rules.forbidden].slice(0, 20),
    skillId: input.skillId
  });
}

function createDemoContentPlan(input: PlanInput): ContentPlan {
  const subject = input.brief.subject;
  const assetRefs = input.materials.items.map((item) => item.resourceId);
  return contentPlanSchema.parse({
    angle: `从事件事实进入，解释${subject}的过程、亮点和意义`,
    narrative: "事实开场，现场展开，价值收束，避免套用与主题无关的行业模板。",
    requirements: input.brief.constraints.map((requirement) => ({ requirement, evidence: "在对应章节落实" })),
    sections: [
      { heading: "这件事为什么值得记录", purpose: "交代核心事实和读者关系", keyPoints: [subject], assetRefs: assetRefs.slice(0, 1) },
      { heading: "现场与过程中的关键瞬间", purpose: "用素材和细节建立可信度", keyPoints: ["过程", "现场", "人物"], assetRefs: assetRefs.slice(1, 3) },
      { heading: "荣誉背后的成长与意义", purpose: "提炼价值并完成情绪收束", keyPoints: ["意义", "感谢", "下一步"], assetRefs: assetRefs.slice(3) }
    ],
    callToAction: "邀请读者继续关注后续动态"
  });
}

function createDemoTitles(input: TitleInput): TitleCandidates {
  const subject = clip(input.brief.subject, 28);
  return titleCandidatesSchema.parse({
    items: [
      { id: "fact", title: `${subject}，这一刻值得被记住`, angle: "事件事实", audienceFit: 90, brandFit: 90, clickPotential: 88, riskFlags: [] },
      { id: "scene", title: `从现场出发，重新认识${subject}`, angle: "现场叙事", audienceFit: 92, brandFit: 88, clickPotential: 90, riskFlags: [] },
      { id: "meaning", title: `${subject}背后，比结果更动人的事`, angle: "价值意义", audienceFit: 89, brandFit: 92, clickPotential: 87, riskFlags: [] }
    ],
    selectedId: "fact",
    selectionReason: "优先准确呈现本轮主题，同时保留公众号传播张力"
  });
}

function createDemoOutline(input: OutlineInput): ArticleOutline {
  const title = selectedTitle(input.titles);
  return articleOutlineSchema.parse({
    title: title.title,
    subtitle: title.subtitle,
    openingHook: `先交代“${input.brief.subject}”的核心事实，再进入现场细节。`,
    callToAction: input.contentPlan.callToAction,
    sections: input.contentPlan.sections.map((section) => ({
      title: section.heading,
      objective: section.purpose,
      storyBeat: section.keyPoints.join("、"),
      commercialGoal: "准确表达本轮主题并服务读者理解"
    }))
  });
}

function createDemoDraft(input: DraftInput): ArticleDraft {
  const title = selectedTitle(input.titles);
  const subject = input.brief.subject;
  return articleDraftSchema.parse({
    title: title.title,
    subtitle: title.subtitle,
    intro: `关于${subject}，最值得先说清楚的不是一句热闹的口号，而是这件事真实发生的经过，以及它为什么值得被记录。`,
    sections: input.contentPlan.sections.map((section, index) => ({
      heading: section.heading,
      purpose: section.purpose,
      paragraphs: [
        index === 0
          ? `${subject}构成了这篇文章的事实起点。围绕时间、人物和结果展开，读者才能快速理解事件本身。`
          : index === 1
            ? `真正让内容成立的是现场细节。把过程、动作和人物关系写具体，素材就不再只是装饰，而成为叙事证据。`
            : `结果之外，更重要的是这段经历带来的成长、协作和新的期待。文章在这里完成价值收束。`,
        `这一部分围绕${section.keyPoints.join("、")}展开，并只使用与本轮主题直接相关的信息。`
      ],
      assetRefs: section.assetRefs
    })),
    conclusion: `一次值得记录的${subject}，既有清晰的事实，也有属于参与者的情感和意义。`,
    callToAction: input.contentPlan.callToAction
  });
}

function createDemoImagePlan(input: ImagePlanInput): ImagePlan {
  const refs = input.materials.items.map((item) => item.resourceId);
  const skillAssets = input.selectedSkills?.flatMap((skill) => skill.assets) ?? [];
  return imagePlanSchema.parse({
    items: [
      { placement: "cover", description: `选择最能代表“${input.brief.subject}”的清晰素材作为封面`, resourceId: refs[0] },
      ...(input.draft?.sections ?? []).flatMap((section, index) => {
        const resourceId = section.assetRefs[0] ?? refs[index + 1];
        return resourceId ? [{ placement: "section" as const, description: `用于“${section.heading}”并作为内容证据`, resourceId }] : [];
      }),
      ...skillAssets.map((asset) => ({
        placement: asset.type === "qrcode" || asset.type === "logo" ? "ending" as const : "section" as const,
        description: asset.usage,
        assetKey: asset.key
      }))
    ]
  });
}

function createDemoLayout(input: LayoutInput): LayoutPlan {
  const celebratory = /获奖|庆祝|荣誉|舞台/u.test(input.brief.subject);
  const skill = input.selectedSkills?.[0];
  const primary = skill?.manifest.style.primaryColor;
  return layoutPlanSchema.parse({
    theme: celebratory ? "celebration" : "editorial",
    palette: {
      primary: primary && /^#[0-9a-fA-F]{6}$/u.test(primary) ? primary : celebratory ? "#C51D5D" : "#16745B",
      accent: celebratory ? "#F2B134" : "#E7654B",
      text: "#20252B",
      surface: "#F7F8F6"
    },
    titleTreatment: celebratory ? "poster" : "left-editorial",
    introTreatment: "highlight-panel",
    sectionTreatment: celebratory ? "labelled" : "minimal",
    imageTreatment: celebratory ? "full-width" : "framed",
    blocks: [
      { kind: "title" },
      { kind: "intro" },
      ...input.draft.sections.flatMap((section, sectionIndex) => [
        { kind: "section" as const, sectionIndex },
        ...section.assetRefs.slice(0, 1).map((assetRef) => ({ kind: "image" as const, sectionIndex, assetRef }))
      ]),
      { kind: "cta" }
    ]
  });
}

function draftText(draft: ArticleDraft): string {
  return [draft.title, draft.intro, ...draft.sections.flatMap((section) => [section.heading, ...section.paragraphs]), draft.conclusion, draft.callToAction ?? ""].join("\n");
}

function createDemoReview(input: ReviewInput): ReviewReport {
  const text = draftText(input.draft);
  const issues = [];
  if (/帮我|要求如下|我会先|执行计划|作为\s*AI/u.test(text)) {
    issues.push({ code: "PROCESS_COPY_LEAK", severity: "error" as const, target: "body" as const, instruction: "删除用户指令和 AI 过程。" });
  }
  if (!text.includes(clip(input.brief.subject, 20))) {
    issues.push({ code: "SUBJECT_MISMATCH", severity: "error" as const, target: "brief" as const, instruction: "正文必须围绕本轮主题重写。" });
  }
  const passed = issues.length === 0;
  return reviewReportSchema.parse({
    passed,
    scores: {
      story: 88,
      commercial: 84,
      audienceFit: 90,
      naturalness: passed ? 92 : 65,
      wechatReadability: 90,
      factualRisk: 92,
      subjectAlignment: passed ? 96 : 50,
      requirementCoverage: 88,
      contentDepth: 86,
      layoutFit: 92
    },
    issues
  });
}

function demoImageSemanticText(item: MaterialAnalysis["items"][number]): string {
  return [
    item.description,
    item.ocrText,
    item.suggestedUsage,
    item.scene,
    item.mood,
    ...(item.subjects ?? []),
    ...(item.actions ?? []),
    ...(item.visualTags ?? []),
    ...(item.suggestedRoles ?? []),
    ...(item.riskNotes ?? [])
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

function demoSectionSemanticText(section: ContentPlan["sections"][number]): string {
  return [section.heading, section.purpose, ...section.keyPoints].join(" ").toLocaleLowerCase();
}

function demoNarrativeRole(item: MaterialAnalysis["items"][number]) {
  const text = demoImageSemanticText(item);
  if (/award|prize|certificate|medal|trophy|honor|proof|获奖|奖|证书|奖杯|奖牌|荣誉/u.test(text)) return "fact_proof" as const;
  if (/stage|dance|performance|show|现场|舞台|舞蹈|表演|演出/u.test(text)) return "scene" as const;
  if (/smile|hug|warm|happy|growth|thanks|笑|拥抱|温暖|成长|感谢/u.test(text)) return "emotion" as const;
  return "detail" as const;
}

function demoImageCandidates(materials: MaterialAnalysis) {
  return materials.items
    .filter((item) => item.type === "image")
    .map((item) => ({
      resourceId: item.resourceId,
      reason: [item.description, item.suggestedUsage, item.ocrText].filter(Boolean).join(" ").slice(0, 300) || "图片素材",
      role: item.suggestedRoles?.[0] ?? demoNarrativeRole(item)
    }));
}

function createSemanticDemoContentPlan(input: PlanInput): ContentPlan {
  const subject = input.brief.subject;
  const candidateImageRefs = demoImageCandidates(input.materials);
  return contentPlanSchema.parse({
    angle: `从事件事实进入，解释${subject}的过程、亮点和意义`,
    narrative: "事实开场，现场展开，价值收束；图片作为提示词和事实证据参与内容策划。",
    requirements: input.brief.constraints.map((requirement) => ({ requirement, evidence: "在对应章节落地" })),
    sections: [
      {
        heading: "获奖事实与记录价值",
        purpose: "交代核心事实和读者关系",
        keyPoints: [subject, "获奖", "证书", "荣誉"],
        assetRefs: candidateImageRefs.filter((item) => item.role === "fact_proof").map((item) => item.resourceId),
        candidateImageRefs
      },
      {
        heading: "舞台现场与关键瞬间",
        purpose: "用现场素材和细节建立可信度",
        keyPoints: ["舞台", "现场", "表演", "过程"],
        assetRefs: candidateImageRefs.filter((item) => item.role === "scene").map((item) => item.resourceId),
        candidateImageRefs
      },
      {
        heading: "成长意义与温暖收束",
        purpose: "提炼价值并完成情绪收束",
        keyPoints: ["成长", "合影", "感谢", "下一步"],
        assetRefs: candidateImageRefs.filter((item) => item.role === "emotion" || item.role === "detail").map((item) => item.resourceId),
        candidateImageRefs
      }
    ],
    callToAction: "邀请读者继续关注后续动态"
  });
}

function createSemanticDemoOutline(input: OutlineInput): ArticleOutline {
  const title = selectedTitle(input.titles);
  return articleOutlineSchema.parse({
    title: title.title,
    subtitle: title.subtitle,
    openingHook: `先交代“${input.brief.subject}”的核心事实，再进入现场细节。`,
    callToAction: input.contentPlan.callToAction,
    sections: input.contentPlan.sections.map((section) => ({
      title: section.heading,
      objective: section.purpose,
      storyBeat: section.keyPoints.join("、"),
      commercialGoal: "准确表达本轮主题并服务读者理解"
    })),
    imageSlots: input.contentPlan.sections.flatMap((section, sectionIndex) =>
      (section.candidateImageRefs ?? []).slice(0, 2).map((candidate) => ({
        resourceId: candidate.resourceId,
        sectionIndex,
        placement: "section" as const,
        narrativePurpose: candidate.reason
      }))
    )
  });
}

function demoSemanticScore(sectionText: string, imageText: string, sectionIndex: number) {
  type VisualRole = "scene" | "people" | "award" | "detail" | "emotion" | "proof" | "brand";
  const groups = [
    { role: "proof" as const, terms: ["award", "prize", "certificate", "medal", "trophy", "honor", "proof", "获奖", "奖", "证书", "奖杯", "奖牌", "荣誉"] },
    { role: "scene" as const, terms: ["stage", "dance", "performance", "show", "现场", "舞台", "舞蹈", "表演", "演出"] },
    { role: "people" as const, terms: ["group", "children", "kids", "student", "teacher", "family", "people", "合影", "孩子", "学生", "老师", "家长"] },
    { role: "emotion" as const, terms: ["smile", "hug", "warm", "happy", "growth", "thanks", "笑", "拥抱", "温暖", "成长", "感谢"] },
    { role: "brand" as const, terms: ["logo", "brand", "poster", "qr", "海报", "品牌"] }
  ];
  let best: { role: VisualRole; score: number; reason: string } = {
    role: "detail",
    score: 0,
    reason: "语义弱匹配，作为章节细节补充"
  };
  for (const group of groups) {
    const sectionHits = group.terms.filter((term) => sectionText.includes(term)).length;
    const imageHits = group.terms.filter((term) => imageText.includes(term)).length;
    const score = sectionHits * imageHits;
    if (score > best.score) best = { role: group.role, score, reason: `图片与章节共同命中 ${group.role} 语义` };
  }
  if (best.score === 0 && sectionIndex === 0 && /award|certificate|medal|trophy|honor|获奖|奖|证书|奖杯|奖牌|荣誉/u.test(imageText)) {
    return { score: 1, visualRole: "proof" as const, reason: "首段事实交代优先使用获奖或证明类图片" };
  }
  return { score: best.score, visualRole: best.role, reason: best.reason };
}

function createSemanticDemoImagePlan(input: ImagePlanInput): ImagePlan {
  const skillAssets = input.selectedSkills?.flatMap((skill) => skill.assets) ?? [];
  const usedResourceIds = new Set<string>();
  const sectionItems = input.contentPlan.sections.flatMap((section, sectionIndex) => {
    const sectionText = demoSectionSemanticText(section);
    const ranked = input.materials.items
      .filter((item) => item.type === "image" && !usedResourceIds.has(item.resourceId))
      .map((item) => {
        const match = demoSemanticScore(sectionText, demoImageSemanticText(item), sectionIndex);
        return { item, ...match };
      })
      .sort((left, right) => right.score - left.score);
    const selected = ranked[0];
    if (!selected) return [];
    usedResourceIds.add(selected.item.resourceId);
    const confidence = selected.score > 0 ? 0.86 : selected.item.quality === "low" ? 0.35 : 0.55;
    return [{
      placement: "section" as const,
      description: selected.item.description,
      resourceId: selected.item.resourceId,
      sectionIndex,
      visualRole: selected.visualRole,
      matchReason: selected.reason,
      confidence,
      captionHint: section.heading
    }];
  });
  const cover = sectionItems.find((item) => (item.confidence ?? 0) >= 0.8) ?? sectionItems[0];
  return imagePlanSchema.parse({
    items: [
      ...(cover?.resourceId ? [{ ...cover, placement: "cover" as const, sectionIndex: undefined, matchReason: cover.matchReason ?? "选作封面素材" }] : []),
      ...sectionItems,
      ...skillAssets.map((asset) => ({
        placement: asset.type === "qrcode" || asset.type === "logo" ? "ending" as const : "section" as const,
        description: asset.usage,
        assetKey: asset.key
      }))
    ]
  });
}

function createSemanticDemoDraft(input: DraftInput): ArticleDraft {
  const title = selectedTitle(input.titles);
  const subject = input.brief.subject;
  const imageRefsBySection = new Map<number, string[]>();
  for (const item of input.imagePlan.items) {
    if (item.placement !== "section" || item.sectionIndex === undefined || !item.resourceId) continue;
    imageRefsBySection.set(item.sectionIndex, [...(imageRefsBySection.get(item.sectionIndex) ?? []), item.resourceId]);
  }
  return articleDraftSchema.parse({
    title: title.title,
    subtitle: title.subtitle,
    intro: `关于${subject}，先说清楚事实，再让图片里的现场、证据和情绪自然进入正文。`,
    sections: input.contentPlan.sections.map((section, index) => ({
      heading: section.heading,
      purpose: section.purpose,
      paragraphs: [
        index === 0
          ? `${subject}构成了这篇文章的事实起点。围绕时间、人物和结果展开，读者才能快速理解事件本身。`
          : index === 1
            ? "真正让内容成立的是现场细节。把过程、动作和人物关系写具体，素材就不再只是装饰，而成为叙事证据。"
            : "结果之外，更重要的是这段经历带来的成长、协作和新的期待。文章在这里完成价值收束。",
        `这一部分围绕${section.keyPoints.join("、")}展开，并承接对应图片承担的叙事功能。`
      ],
      assetRefs: imageRefsBySection.get(index) ?? section.assetRefs
    })),
    conclusion: `一次值得记录的${subject}，既有清晰的事实，也有属于参与者的情感和意义。`,
    callToAction: input.contentPlan.callToAction
  });
}

function createDemoAgents(): CreationAgents {
  return {
    async analyzeMaterials(input) { return createDemoMaterials(input); },
    async buildBrief(input) { return createDemoBrief(input); },
    async createContentPlan(input) { return createSemanticDemoContentPlan(input); },
    async createTitles(input) { return createDemoTitles(input); },
    async createOutline(input) { return createSemanticDemoOutline(input); },
    async writeDraft(input) { return createSemanticDemoDraft(input); },
    async planImages(input) { return createSemanticDemoImagePlan(input); },
    async createLayout(input) { return createDemoLayout(input); },
    async reviewDraft(input) { return createDemoReview(input); },
    async reviseDraft(input) {
      return articleDraftSchema.parse({
        ...input.draft,
        sections: input.draft.sections.map((section) => ({
          ...section,
          paragraphs: section.paragraphs.map((paragraph) => paragraph.replace(/帮我|要求如下|我会先|执行计划|作为\s*AI/gu, "").trim()).filter(Boolean)
        }))
      });
    }
  };
}

interface CreationAgentContext {
  userId: string;
  runId?: string;
  deadlineAt?: number;
  onProgress?: (agentName: string, event: ModelGatewayProgressEvent) => void | Promise<void>;
}

function createGatewayAgents(context: CreationAgentContext): CreationAgents {
  async function generate<T>(options: Parameters<typeof generateStructuredJsonWithGateway<T>>[1]): Promise<T> {
    const config = await resolveModelGatewayConfig("text_generation");
    const remainingMs = context.deadlineAt ? context.deadlineAt - Date.now() : config.timeoutMs;
    if (remainingMs <= 0) throw new Error("CREATION_RUN_TIMEOUT");
    return generateStructuredJsonWithGateway({
      ...config,
      timeoutMs: Math.min(config.timeoutMs, remainingMs)
    }, {
      ...options,
      ...(context.onProgress
        ? { onProgress: (event: ModelGatewayProgressEvent) => context.onProgress!(options.agentName, event) }
        : {}),
      usage: {
        userId: context.userId,
        ...(context.runId ? { runId: context.runId } : {}),
        modelConfigId: config.modelConfigId,
        routeKey: "text_generation"
      }
    });
  }

  return {
    analyzeMaterials: (input) => generate({
      agentName: "MaterialAgent",
      systemPrompt: "根据本轮资源 ID、已有素材摘要和 Skill 品牌资源生成 MaterialAnalysis。图片要保留结构化语义，供内容策划、结构设计和正文创作使用。不得虚构图片内容；无法识别时标记 unknown 或 low quality。",
      outputContract: '{"items":[{"resourceId":"string","type":"image|document|link|unknown","description":"string","ocrText?":"string","suggestedUsage?":"string","quality?":"high|medium|low","subjects":["string"],"scene?":"string","actions":["string"],"mood?":"string","visualTags":["string"],"suggestedRoles":["cover|fact_proof|scene|emotion|detail|ending|gallery"],"riskNotes":["string"]}]}。items 可为空数组。',
      input,
      schema: materialAnalysisSchema,
      temperature: 0.1
    }),
    buildBrief: (input) => generate({
      agentName: "BriefAgent",
      systemPrompt: "将 userInput、memory.instructionMemory 的历史 rebuild 摘要和最近两条有价值原文共同提取为 CreativeBrief。本轮 userInput 表达当前意图；当它只是继续、扩写或修改时，必须保留 instructionMemory 中的原始创作需求。creationMode=new 时不得沿用旧主题；逐项保留用户约束和 Skill 规则。",
      outputContract: '{"subject":"string","goal":"brand|promotion|event|education|story","audience":"string","contentType":"string","campaignObject?":"string","tone":"string","storyAngle":"string","materialRequirements":["string"],"resourceIds":["string"],"constraints":["string"],"prohibitedContent":["string"],"skillId":"string"}',
      input,
      schema: creativeBriefSchema,
      temperature: 0.2
    }),
    createContentPlan: (input) => generate({
      agentName: "ContentPlannerAgent",
      systemPrompt: "先做内容设计再写正文。结合 Brief、userInput、memory.instructionMemory 的历史 rebuild 摘要、最近两条有价值原文，以及 MaterialAnalysis 中的图片语义，输出当前主题的叙事角度、主线、至少三个章节、每章目的、关键点、素材映射和用户要求覆盖证据。图片要作为事实证据和叙事素材参与规划；禁止按上传顺序硬塞图片，禁止套用无关行业模板。",
      outputContract: '{"angle":"string","narrative":"string","requirements":[{"requirement":"string","evidence":"string"}],"sections":[至少3项{"heading":"string","purpose":"string","keyPoints":["string"],"assetRefs":["string"],"candidateImageRefs":[{"resourceId":"string","reason":"string","role":"cover|fact_proof|scene|emotion|detail|ending|gallery"}]}],"callToAction":"string"}',
      input,
      schema: contentPlanSchema,
      temperature: 0.45
    }),
    createTitles: (input) => generate({
      agentName: "TitleAgent",
      systemPrompt: "基于当前 Brief 和 ContentPlan 生成 3 到 5 个准确且有传播力的标题并选出一项。不得包含旧主题或用户指令。",
      outputContract: '{"items":[3到5项{"id":"string","title":"string","subtitle?":"string","angle":"string","audienceFit":0到100数字,"brandFit":0到100数字,"clickPotential":0到100数字,"riskFlags":["string"]}],"selectedId":"必须引用items中的id","selectionReason":"string"}',
      input,
      schema: titleCandidatesSchema,
      temperature: 0.65
    }),
    createOutline: (input) => generate({
      agentName: "OutlineAgent",
      systemPrompt: "把 ContentPlan 和选定标题落实为公众号提纲，每节必须有独立目标、故事节拍和表达目标，并初步确定关键图片位置。图片位置要服务章节叙事，不得按上传顺序排列，不得改变当前主题。",
      outputContract: '{"title":"string","subtitle?":"string","openingHook":"string","callToAction":"string","sections":[至少3项{"title":"string","objective":"string","storyBeat":"string","commercialGoal":"string"}],"imageSlots":[{"resourceId":"string","sectionIndex?":0到9整数,"placement":"cover|section|ending|gallery","narrativePurpose":"string"}]}',
      input,
      schema: articleOutlineSchema,
      temperature: 0.4
    }),
    writeDraft: (input) => generate({
      agentName: "WriterAgent",
      systemPrompt: "严格按照 Brief、ContentPlan、Outline 和 ImagePlan 写结构化中文正文。图片是提示词和叙事素材，不是排版装饰；每个 section 的 assetRefs 必须优先来自 ImagePlan 中相同 sectionIndex 的 resourceId，并在正文里自然承接图片内容。禁止输出指令、计划、审校说明、AI 过程或无关旧主题。",
      outputContract: '{"title":"string","subtitle?":"string","intro":"string","sections":[至少3项{"heading":"string","purpose":"string","paragraphs":["string"],"assetRefs":["string"],"emphasis?":"string"}],"conclusion":"string","callToAction?":"string"}',
      input,
      schema: articleDraftSchema,
      temperature: 0.65
    }),
    planImages: (input) => generate({
      agentName: "ImagePlannerAgent",
      systemPrompt: "在正文创作之前，根据 MaterialAnalysis 的图片语义、ContentPlan 的章节目的和 Outline 的图片槽位规划封面与章节图片。不要按上传顺序机械填充；必须按图片内容与章节叙事目的匹配。只引用输入中存在的 resourceId 或 Skill assetKey，不得虚构 URL。低置信度图片可以降级为 gallery 或不进入核心章节。",
      outputContract: '{"items":[至少1项{"placement":"cover|section|ending|gallery","description":"string","resourceId?":"只能引用输入中的resourceId","assetKey?":"只能引用输入中的assetKey","sectionIndex?":0到9整数,"visualRole?":"scene|people|award|detail|emotion|proof|brand","matchReason?":"string","confidence?":0到1数字,"captionHint?":"string"}]}',
      input,
      schema: imagePlanSchema,
      temperature: 0.3
    }),
    createLayout: (input) => generate({
      agentName: "LayoutAgent",
      systemPrompt: "根据当前主题、内容密度、已经确定的图片计划和 Skill 生成受控 LayoutPlan。版式只负责视觉呈现，不重新决定图片语义归属；image block 的 assetRef 应来自 ImagePlan，并保持对应 sectionIndex。只使用 schema 白名单，不得输出 HTML、CSS、脚本或事件属性。",
      outputContract: '{"theme":"editorial|celebration|story|report|brand","palette":{"primary":"#RRGGBB","accent":"#RRGGBB","text":"#RRGGBB","surface":"#RRGGBB"},"titleTreatment":"centered|left-editorial|poster","introTreatment":"plain|quote|highlight-panel","sectionTreatment":"numbered|labelled|minimal|timeline","imageTreatment":"full-width|framed|gallery","blocks":[至少2项{"kind":"title|intro|section|image|quote|brand|cta","sectionIndex?":0到9整数,"assetRef?":"string"}]}',
      input,
      schema: layoutPlanSchema,
      temperature: 0.5
    }),
    reviewDraft: (input) => generate({
      agentName: "ReviewerAgent",
      systemPrompt: "审校主题一致性、用户要求覆盖、内容深度、素材匹配、Skill 合规、版式适配、微信阅读和事实风险。发现旧主题、错图或套用旧版式时必须 passed=false，并把 target 指向 brief、plan、body、image 或 layout。",
      outputContract: '{"passed":true或false,"scores":{"story":0到100数字,"commercial":0到100数字,"audienceFit":0到100数字,"naturalness":0到100数字,"wechatReadability":0到100数字,"factualRisk":0到100数字,"subjectAlignment":0到100数字,"requirementCoverage":0到100数字,"contentDepth":0到100数字,"layoutFit":0到100数字},"issues":[{"code":"string","severity":"warning|error","target":"brief|plan|title|outline|body|image|layout|cta","instruction":"string"}]}',
      input,
      schema: reviewReportSchema,
      temperature: 0.15
    }),
    reviseDraft: (input) => generate({
      agentName: "RevisionAgent",
      systemPrompt: "只处理 ReviewReport 中 target=body/title/cta 的问题，保持已确认主题和未要求修改的章节。结构或主题问题不得用正文润色掩盖。",
      outputContract: '{"title":"string","subtitle?":"string","intro":"string","sections":[至少3项{"heading":"string","purpose":"string","paragraphs":["string"],"assetRefs":["string"],"emphasis?":"string"}],"conclusion":"string","callToAction?":"string"}',
      input,
      schema: articleDraftSchema,
      temperature: 0.4
    })
  };
}

export function createCreationAgents(context: CreationAgentContext = { userId: "system" }): CreationAgents {
  if (process.env.MODEL_MODE === "demo" || process.env.NODE_ENV === "test") return createDemoAgents();
  return createGatewayAgents(context);
}

export function createDemoCreationAgents(): CreationAgents {
  return createDemoAgents();
}

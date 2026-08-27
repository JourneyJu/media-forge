import { describe, expect, it } from "vitest";
import {
  articleDraftSchema,
  articleOutlineSchema,
  contentPlanSchema,
  creationFailureEnvelopeSchema,
  creationRunJobSchema,
  creationRunContextSchema,
  conversationWorkingMemorySchema,
  creativeBriefSchema,
  imagePlanSchema,
  intentResolutionSchema,
  materialAnalysisSchema,
  presentationStyleDecisionSchema,
  resolvedCreationRequestSchema,
  reviewIssueSchema,
  titleCandidatesSchema,
  userPresentationConstraintsSchema
} from "./creation-graph";

describe("creation graph contracts", () => {
  it("keeps the queue payload limited to identifiers and versions", () => {
    const job = creationRunJobSchema.parse({
      runId: "run_1",
      conversationId: "conversation_1",
      workspaceId: "workspace_1",
      contextVersion: 1,
      graphName: "wechat_article_creation",
      graphVersion: "2026-08-03"
    });

    expect(job.contextVersion).toBe(1);
    expect(job).not.toHaveProperty("userInput");
  });

  it("separates a short subject from the original user instruction", () => {
    const brief = creativeBriefSchema.parse({
      subject: "儿童摄影团队品牌宣传",
      goal: "brand",
      audience: "儿童家长",
      contentType: "品牌故事",
      campaignObject: "摄影团队",
      tone: "warm",
      storyAngle: "从孩子成长瞬间切入",
      materialRequirements: ["按三种摄影风格分类"],
      resourceIds: [],
      constraints: ["语言自然"],
      prohibitedContent: ["不要出现 AI 过程"],
      skillId: "auto"
    });

    expect(brief.subject).toBe("儿童摄影团队品牌宣传");
  });

  it("requires the selected title to reference a candidate", () => {
    const items = ["a", "b", "c"].map((id) => ({
      id,
      title: `标题 ${id}`,
      angle: "故事",
      audienceFit: 90,
      brandFit: 88,
      clickPotential: 85,
      riskFlags: []
    }));

    expect(() => titleCandidatesSchema.parse({
      items,
      selectedId: "missing",
      selectionReason: "综合评分最高"
    })).toThrow();
  });

  it("defaults missing run context memory for older graph runs", () => {
    const context = creationRunContextSchema.parse({
      userInput: "写一篇公众号文章，介绍本周活动。",
      resourceIds: [],
      currentInstruction: "写一篇公众号文章，介绍本周活动。",
      skillId: "auto",
      maxSteps: 12
    });

    expect(context.memory.materialSummary).toEqual([]);
    expect(context.memory.userConstraints).toEqual([]);
    expect(context.memory.instructionMemory.recentValuableTurns).toEqual([]);
    expect(context.memory.resourceContext.materialSummary).toEqual([]);
    expect(context.creationMode).toBe("new");
    expect(context.schemaVersion).toBeUndefined();
    expect(context.currentResourceIds).toEqual([]);
    expect(context.intentResolution).toBeUndefined();
  });

  it("validates a canonical V2 new creation request", () => {
    const request = resolvedCreationRequestSchema.parse({
      schemaVersion: 2,
      operation: "new",
      decisionSource: "user",
      confidence: "high",
      currentInstruction: "写一篇关于夏日阅读计划的公众号文章。",
      mutationScope: ["content", "title", "structure", "images", "presentation"],
      inheritance: {
        content: "replace",
        presentation: "replace",
        resources: "current_only"
      },
      contentIdentity: {
        topicSummary: "夏日阅读计划",
        namedEntities: [],
        requiredFacts: [],
        requiredClaims: [],
        mustIncludeVerbatim: [],
        prohibitedClaims: []
      },
      provenance: [{
        field: "contentIdentity.topicSummary",
        source: "current_turn",
        sourceId: "message_2"
      }]
    });
    const context = creationRunContextSchema.parse({
      schemaVersion: 2,
      userInput: request.currentInstruction,
      currentInstruction: request.currentInstruction,
      resolvedRequest: request,
      resourceIds: [],
      skillId: "auto",
      maxSteps: 12
    });

    expect(context.resolvedRequest?.operation).toBe("new");
    expect(context.resolvedRequest?.contentIdentity.namedEntities).toEqual([]);
  });

  it("rejects invalid V2 inheritance and duplicate provenance", () => {
    expect(() => resolvedCreationRequestSchema.parse({
      schemaVersion: 2,
      operation: "new",
      decisionSource: "rule",
      confidence: "medium",
      currentInstruction: "写一个新主题。",
      baseArtifactId: "artifact_old",
      mutationScope: ["content"],
      inheritance: {
        content: "preserve",
        presentation: "replace",
        resources: "artifact_used"
      },
      contentIdentity: {
        topicSummary: "新主题",
        namedEntities: [],
        requiredFacts: [],
        requiredClaims: [],
        mustIncludeVerbatim: [],
        prohibitedClaims: []
      },
      provenance: [
        { field: "contentIdentity.topicSummary", source: "current_turn", sourceId: "message_2" },
        { field: "contentIdentity.topicSummary", source: "current_turn", sourceId: "message_2" }
      ]
    })).toThrow();

    expect(() => creationRunContextSchema.parse({
      schemaVersion: 2,
      userInput: "继续",
      currentInstruction: "继续",
      resourceIds: [],
      skillId: "auto",
      maxSteps: 12
    })).toThrow();
  });

  it("validates safe structured failure details", () => {
    const failure = creationFailureEnvelopeSchema.parse({
      code: "CONTENT_IDENTITY_MISMATCH",
      stage: "review",
      category: "quality",
      recoverability: "revise_input",
      summary: "正文遗漏一项必要事实。",
      violations: [{
        code: "REQUIRED_FACT_MISSING",
        target: "contentIdentity.requiredFacts",
        evidence: "未找到活动日期。"
      }]
    });

    expect(failure.violations).toHaveLength(1);
    expect(failure.recoverability).toBe("revise_input");
  });

  it("validates intent resolution for same-topic continuation", () => {
    const intent = intentResolutionSchema.parse({
      mode: "continue",
      sameTopic: true,
      confidence: "high",
      effectiveInstruction: "围绕小兰花获奖公众号文章重新生成。本轮指令：重新生成",
      inheritedMessageIds: ["message_1"],
      reason: "同一会话内短指令默认继承上一轮创作主题"
    });

    expect(intent.mode).toBe("continue");
    expect(intent.sameTopic).toBe(true);
    expect(intent.inheritedMessageIds).toEqual(["message_1"]);
  });

  it("accepts image semantics and section-aware image placement", () => {
    const materials = materialAnalysisSchema.parse({
      items: [{
        resourceId: "certificate_image",
        type: "image",
        description: "award certificate for the dance competition",
        subjects: ["certificate"],
        scene: "award proof",
        visualTags: ["award", "certificate"],
        suggestedRoles: ["fact_proof"],
        quality: "high"
      }]
    });
    const imagePlan = imagePlanSchema.parse({
      structureVersion: "structure_1",
      items: [{
        placement: "section",
        sectionId: "section_1",
        resourceId: "certificate_image",
        description: "获奖证书",
        sectionIndex: 0,
        visualRole: "proof",
        matchReason: "证书图片支撑获奖事实章节",
        confidence: 0.92,
        captionHint: "获奖事实"
      }]
    });

    expect(materials.items[0]?.suggestedRoles).toEqual(["fact_proof"]);
    expect(imagePlan.items[0]).toMatchObject({
      resourceId: "certificate_image",
      sectionIndex: 0,
      visualRole: "proof"
    });
  });

  it("validates conversation scoped working memory", () => {
    const memory = conversationWorkingMemorySchema.parse({
      conversationId: "conversation_1",
      contextVersion: 2,
      instructionMemory: {
        rebuiltContext: {
          taskGoal: "儿童摄影品牌宣传",
          sourceRequest: "历史需求摘要：儿童摄影品牌宣传。",
          audience: "儿童家长",
          styleConstraints: ["语气温暖"],
          contentRequirements: ["继续围绕成长瞬间扩写。"],
          prohibitedContent: [],
          unresolvedQuestions: [],
          confidence: "medium"
        },
        recentValuableTurns: [
          { messageId: "message_1", content: "面向儿童家长，语气温暖。", reason: "包含目标读者和风格" },
          { messageId: "message_2", content: "继续围绕成长瞬间扩写。", reason: "包含继续创作方向" }
        ]
      },
      selectedTitle: {
        id: "story",
        title: "把童年留在镜头里",
        angle: "成长故事"
      },
      materialSummary: [{
        resourceId: "resource_1",
        type: "image",
        description: "儿童摄影样片",
        quality: "high"
      }],
      resourceContext: {
        currentResourceIds: ["resource_1"],
        inheritedResourceIds: [],
        artifactResourceIds: [],
        materialSummary: [{
          resourceId: "resource_1",
          type: "image",
          description: "儿童摄影样片",
          quality: "high"
        }]
      },
      userConstraints: ["语气温暖"],
      lastArtifactId: "artifact_1",
      updatedAt: new Date("2026-08-02T00:00:00.000Z").toISOString()
    });

    expect(memory.conversationId).toBe("conversation_1");
    expect(memory.instructionMemory.recentValuableTurns).toHaveLength(2);
    expect(memory.resourceContext.materialSummary[0]?.resourceId).toBe("resource_1");
    expect(memory.lastArtifactId).toBe("artifact_1");
  });

  it("carries stable section identity through plans, outlines, and drafts", () => {
    const plan = contentPlanSchema.parse({
      structureVersion: "structure_1",
      angle: "event",
      narrative: "fact to meaning",
      requirements: [],
      sections: [
        { sectionId: "section_1", heading: "opening", purpose: "open", keyPoints: ["award"], assetRefs: [] },
        { sectionId: "section_2", heading: "practice", purpose: "process", keyPoints: ["effort"], assetRefs: [] },
        { sectionId: "section_3", heading: "future", purpose: "close", keyPoints: ["next"], assetRefs: [] }
      ],
      callToAction: "follow"
    });
    const outline = articleOutlineSchema.parse({
      structureVersion: plan.structureVersion,
      title: "award moment",
      openingHook: "opening",
      callToAction: "follow",
      sections: plan.sections.map((section) => ({
        sectionId: section.sectionId,
        title: section.heading,
        objective: section.purpose,
        storyBeat: section.keyPoints[0],
        commercialGoal: "accurate"
      }))
    });
    const draft = articleDraftSchema.parse({
      structureVersion: plan.structureVersion,
      title: "award moment",
      intro: "award news",
      sections: outline.sections.map((section) => ({
        sectionId: section.sectionId,
        heading: section.sectionId === "section_1" ? "the light on stage" : section.title,
        purpose: section.objective,
        paragraphs: ["body"],
        assetRefs: []
      })),
      conclusion: "keep going"
    });

    expect(draft.structureVersion).toBe("structure_1");
    expect(draft.sections[0]).toMatchObject({ sectionId: "section_1", heading: "the light on stage" });
  });

  it("preserves explicit user color anchors and prohibited colors", () => {
    const constraints = userPresentationConstraintsSchema.parse({
      rawFragments: ["标题使用 #173F37", "金色只用于少量点缀", "不要红色"],
      requestedColors: ["#173F37", "金色"],
      prohibitedColors: ["红色"],
      colorUsage: ["#173F37 用于标题", "金色只用于少量点缀"],
      decorationRequirements: ["减少装饰"],
      imageRequirements: [],
      brandRequirements: []
    });

    expect(constraints.requestedColors).toEqual(["#173F37", "金色"]);
    expect(constraints.prohibitedColors).toEqual(["红色"]);
  });

  it("validates a versioned presentation decision with four controlled domains", () => {
    const decision = presentationStyleDecisionSchema.parse({
      schemaVersion: "presentation-style-v1",
      structureVersion: "structure_1",
      source: "mixed",
      confidence: 0.9,
      evidence: "用户指定深蓝，内容为克制的舞台获奖纪实。",
      visual: {
        theme: "stage-celebration",
        hierarchy: "title-led",
        typography: "mixed",
        density: "comfortable",
        alignment: "left",
        whitespace: "generous",
        sectionRhythm: "minimal"
      },
      colorDecoration: {
        colorSource: "mixed",
        requestedColors: ["深蓝"],
        prohibitedColors: ["红色"],
        paletteIntent: {
          primary: "深蓝",
          accent: "低比例暖金",
          text: "深灰",
          surface: "灰白"
        },
        brightness: "dark",
        saturation: "low",
        contrast: "medium",
        surfaceTreatment: "border",
        dividerTreatment: "thin-line",
        sectionMarker: "none",
        ornamentLevel: "minimal"
      },
      imagePresentation: {
        heroStrategy: "full-width",
        sizeStrategy: "narrative-role",
        aspectPolicy: "preserve",
        grouping: "text-image-alternating",
        frameTreatment: "thin-border",
        captionPolicy: "fact",
        rhythm: "one-per-section"
      },
      brandPresentation: {
        prominence: "light",
        logoPlacement: "ending",
        fixedModules: [],
        brandAssets: [],
        ctaStyle: "follow",
        qrcodePlacement: "none",
        constraints: []
      }
    });

    expect(decision.structureVersion).toBe("structure_1");
    expect(decision.colorDecoration.requestedColors).toEqual(["深蓝"]);
    expect(decision.imagePresentation.grouping).toBe("text-image-alternating");
  });

  it("accepts presentation review targets and rejects arbitrary presentation fields", () => {
    expect(reviewIssueSchema.parse({
      code: "COLOR_MISMATCH",
      severity: "error",
      target: "presentation",
      instruction: "保留用户指定的深蓝色。"
    }).target).toBe("presentation");

    expect(() => presentationStyleDecisionSchema.parse({
      schemaVersion: "presentation-style-v1",
      structureVersion: "structure_1",
      source: "content",
      confidence: 0.8,
      evidence: "内容为专业报告。",
      visual: {},
      colorDecoration: {},
      imagePresentation: {},
      brandPresentation: {},
      rawCss: "body { display: none; }"
    })).toThrow();
  });
});

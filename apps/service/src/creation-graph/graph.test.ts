import { describe, expect, it } from "vitest";
import type { CreationAgents } from "./agents";
import type { CreationGraphState, ReviewReport, TitleCandidates } from "@mediaforge/contracts";
import { createDemoCreationAgents } from "./agents";
import { runWechatArticleGraph } from "./graph";
import { ZodError } from "zod";

function baseState(userInput: string): CreationGraphState {
  return {
    workspaceId: "workspace_1",
    conversationId: "conversation_1",
    runId: "run_1",
    userInput,
    resourceIds: [],
    skillId: "auto",
    selectedSkills: [],
    reviewReports: [],
    revisionCount: 0,
    maxRevisionCount: 2,
    status: "running"
  };
}

function reviewReport(passed: boolean, issues: ReviewReport["issues"] = []): ReviewReport {
  return {
    passed,
    scores: {
      story: passed ? 90 : 60,
      commercial: passed ? 90 : 60,
      audienceFit: passed ? 90 : 60,
      naturalness: passed ? 90 : 60,
      wechatReadability: passed ? 90 : 60,
      factualRisk: 90,
      subjectAlignment: passed ? 90 : 60,
      requirementCoverage: passed ? 90 : 60,
      contentDepth: passed ? 90 : 60,
      layoutFit: passed ? 90 : 60
    },
    issues
  };
}

function titleCandidates(title: string, selectedId = "selected"): TitleCandidates {
  return {
    items: [
      { id: selectedId, title, angle: "主标题", audienceFit: 90, brandFit: 90, clickPotential: 90, riskFlags: [] },
      { id: "alt_1", title: `${title} 备选一`, angle: "备选", audienceFit: 80, brandFit: 80, clickPotential: 80, riskFlags: [] },
      { id: "alt_2", title: `${title} 备选二`, angle: "备选", audienceFit: 80, brandFit: 80, clickPotential: 80, riskFlags: [] }
    ],
    selectedId,
    selectionReason: "测试选中标题"
  };
}

describe("wechat article creation graph", () => {
  it("runs only presentation downstream nodes for a scoped style revision", async () => {
    const initial = await runWechatArticleGraph(
      baseState("请写一篇春季研学活动公众号文章，面向学生家长，重点介绍活动过程和成长价值。"),
      { agents: createDemoCreationAgents() }
    );
    if (
      !initial.materials
      || !initial.brief
      || !initial.contentPlan
      || !initial.titles
      || !initial.outline
      || !initial.draft
      || !initial.imagePlan
      || !initial.presentationStyleDecision
      || !initial.layoutPlan
    ) throw new Error("TEST_SNAPSHOT_REQUIRED");
    const snapshot = {
      materials: initial.materials,
      brief: initial.brief,
      contentPlan: initial.contentPlan,
      titles: initial.titles,
      outline: initial.outline,
      draft: initial.draft,
      imagePlan: initial.imagePlan,
      presentationStyleDecision: initial.presentationStyleDecision,
      layoutPlan: initial.layoutPlan
    };
    const agents = createDemoCreationAgents();
    const analyzeMaterials = agents.analyzeMaterials.bind(agents);
    const buildBrief = agents.buildBrief.bind(agents);
    const writeDraft = agents.writeDraft.bind(agents);
    const createPresentation = agents.createPresentation.bind(agents);
    const calls = { material: 0, brief: 0, writer: 0, presentation: 0 };
    agents.analyzeMaterials = async (input) => {
      calls.material += 1;
      return analyzeMaterials(input);
    };
    agents.buildBrief = async (input) => {
      calls.brief += 1;
      return buildBrief(input);
    };
    agents.writeDraft = async (input) => {
      calls.writer += 1;
      return writeDraft(input);
    };
    agents.createPresentation = async (input) => {
      calls.presentation += 1;
      return createPresentation(input);
    };
    const state: CreationGraphState = {
      ...baseState("换种风格重新实现"),
      resolvedRequest: {
        schemaVersion: 2,
        operation: "revise",
        decisionSource: "user",
        confidence: "high",
        currentInstruction: "换种风格重新实现",
        baseArtifactId: "artifact_1",
        mutationScope: ["presentation"],
        inheritance: {
          content: "preserve",
          presentation: "replace",
          resources: "artifact_used"
        },
        contentIdentity: {
          topicSummary: snapshot.brief.subject,
          namedEntities: [],
          requiredFacts: [],
          requiredClaims: [],
          mustIncludeVerbatim: [],
          prohibitedClaims: []
        },
        provenance: []
      },
      baseSnapshot: snapshot,
      ...snapshot
    };

    const result = await runWechatArticleGraph(state, { agents });

    expect(result.status).toBe("completed");
    expect(calls).toEqual({ material: 0, brief: 0, writer: 0, presentation: 1 });
    expect(result.draft).toEqual(snapshot.draft);
    expect(result.imagePlan).toEqual(snapshot.imagePlan);
  });

  it("rejects a scoped style revision without a complete base snapshot", async () => {
    await expect(runWechatArticleGraph({
      ...baseState("换种风格重新实现"),
      resolvedRequest: {
        schemaVersion: 2,
        operation: "revise",
        decisionSource: "user",
        confidence: "high",
        currentInstruction: "换种风格重新实现",
        baseArtifactId: "artifact_missing",
        mutationScope: ["presentation"],
        inheritance: {
          content: "preserve",
          presentation: "replace",
          resources: "artifact_used"
        },
        contentIdentity: {
          topicSummary: "既有主题",
          namedEntities: [],
          requiredFacts: [],
          requiredClaims: [],
          mustIncludeVerbatim: [],
          prohibitedClaims: []
        },
        provenance: []
      }
    }, { agents: createDemoCreationAgents() })).rejects.toThrow("REVISION_SNAPSHOT_MISSING");
  });

  it("completes when an outline model response contains a transposed copied section identity", async () => {
    const agents = createDemoCreationAgents();
    const createOutline = agents.createOutline.bind(agents);
    agents.createOutline = async (input) => {
      const outline = await createOutline(input);
      const candidate = outline as NonNullable<CreationGraphState["outline"]>;
      return {
        ...candidate,
        structureVersion: "model_supplied_version",
        sections: candidate.sections.map((section, index) => ({
          ...section,
          sectionId: index === 0 ? "section_1_transposed" : section.sectionId
        }))
      };
    };

    const result = await runWechatArticleGraph(
      baseState("请写一篇春季研学活动公众号文章，面向学生家长，重点介绍活动过程和成长价值。"),
      { agents }
    );

    expect(result.status).toBe("completed");
    expect(result.outline?.structureVersion).toBe(result.contentPlan?.structureVersion);
    expect(result.outline?.sections.map((section) => section.sectionId)).toEqual(
      result.contentPlan?.sections.map((section) => section.sectionId)
    );
  });

  it("retries only the current outline node once after a section count mismatch", async () => {
    const agents = createDemoCreationAgents();
    const createOutline = agents.createOutline.bind(agents);
    const corrections: unknown[] = [];
    let outlineCalls = 0;
    let nodeRetries = 0;
    agents.createOutline = async (input) => {
      outlineCalls += 1;
      corrections.push((input as { structureCorrection?: unknown }).structureCorrection);
      const outline = await createOutline(input);
      return outlineCalls === 1
        ? { ...outline, sections: outline.sections.slice(0, -1) }
        : outline;
    };

    const result = await runWechatArticleGraph(
      baseState("请写一篇春季研学活动公众号文章，面向学生家长，重点介绍活动过程和成长价值。"),
      {
        agents,
        observer: {
          onNodeRetry(nodeName) {
            if (nodeName === "outline") nodeRetries += 1;
          }
        }
      }
    );

    expect(result.status).toBe("completed");
    expect(outlineCalls).toBe(2);
    expect(nodeRetries).toBe(1);
    expect(corrections[0]).toBeUndefined();
    expect(corrections[1]).toEqual(expect.objectContaining({
      code: "MODEL_SECTION_COUNT_MISMATCH",
      expectedSectionCount: 3
    }));
    expect(result.revisionCount).toBe(0);
  });

  it("fails the outline node after one unsuccessful structure correction", async () => {
    const agents = createDemoCreationAgents();
    const createOutline = agents.createOutline.bind(agents);
    let outlineCalls = 0;
    agents.createOutline = async (input) => {
      outlineCalls += 1;
      const outline = await createOutline(input);
      return { ...outline, sections: outline.sections.slice(0, -1) };
    };

    await expect(runWechatArticleGraph(
      baseState("请写一篇春季研学活动公众号文章，面向学生家长，重点介绍活动过程和成长价值。"),
      { agents }
    )).rejects.toEqual(expect.objectContaining({
      code: "MODEL_SECTION_COUNT_MISMATCH"
    }));
    expect(outlineCalls).toBe(2);
  });

  it("classifies exhausted raw schema correction as a model structure failure", async () => {
    const agents = createDemoCreationAgents();
    let outlineCalls = 0;
    agents.createOutline = async () => {
      outlineCalls += 1;
      throw new ZodError([]);
    };

    await expect(runWechatArticleGraph(
      baseState("请写一篇春季研学活动公众号文章，面向学生家长，重点介绍活动过程和成长价值。"),
      { agents }
    )).rejects.toEqual(expect.objectContaining({
      code: "MODEL_OUTPUT_SCHEMA_INVALID"
    }));
    expect(outlineCalls).toBe(1);
  });

  it("runs the multi-agent graph to a final document", async () => {
    const userInput = [
      "帮我做一个公众号文案，要求如下：",
      "1. 提供的材料分为3个种类型，分类显示",
      "2. 主题是留住童年时光",
      "3. 面向的是儿童家长",
      "4. 主要是给摄影团队做宣传",
      "风格符合主题，描述要自然合理，不要太AI味"
    ].join("\n");
    const result = await runWechatArticleGraph(baseState(userInput), {
      agents: createDemoCreationAgents()
    });

    expect(result.status).toBe("completed");
    expect(result.brief?.subject).toBe("留住童年时光");
    expect(result.brief?.audience).toBe("儿童家长");
    expect(result.titles?.items).toHaveLength(3);
    expect(result.titles?.items.some((item) => item.id === result.titles?.selectedId)).toBe(true);
    expect(result.outline?.sections).toHaveLength(3);
    expect(result.materials?.items).toEqual([]);
    expect(result.contentPlan?.sections).toHaveLength(3);
    expect(result.presentationStyleDecision?.schemaVersion).toBe("presentation-style-v1");
    expect(result.presentationStyleDecision?.structureVersion).toBe(result.contentPlan?.structureVersion);
    expect(result.layoutPlan?.theme).toBeDefined();
    expect(result.reviewReports.at(-1)?.passed).toBe(true);
    expect(result.artifactValidation?.passed).toBe(true);
    expect(result.finalDocument?.attrs.title).not.toContain("帮我做一个公众号文案");
    const copy = result.finalDocument?.content
      .flatMap((block) => block.content ?? [])
      .map((item) => item.text)
      .join("");
    expect(copy).not.toContain("要求如下");
    expect(copy).not.toContain("摄影团队");
  });

  it("does not reuse a photography memory for a new dance award topic", async () => {
    const result = await runWechatArticleGraph({
      ...baseState("金舞艺术的舞蹈《蚊子哪里跑》在小兰花获奖了，请围绕获奖现场重新创作。"),
      memory: {
        instructionMemory: {
          recentValuableTurns: [{
            messageId: "message_1",
            content: "金舞艺术的舞蹈《蚊子哪里跑》在小兰花获奖了，请围绕获奖现场重新创作。",
            reason: "包含当前新主题"
          }]
        },
        resourceContext: {
          currentResourceIds: [],
          inheritedResourceIds: [],
          artifactResourceIds: [],
          materialSummary: []
        },
        materialSummary: [],
        userConstraints: [],
        brief: {
          subject: "儿童摄影",
          goal: "brand",
          audience: "儿童家长",
          contentType: "品牌故事",
          tone: "warm",
          storyAngle: "成长记录",
          materialRequirements: [],
          resourceIds: [],
          constraints: [],
          prohibitedContent: [],
          skillId: "auto"
        },
        lastArtifactId: "old_photography_artifact"
      }
    }, { agents: createDemoCreationAgents() });

    const copy = result.finalDocument?.content.flatMap((block) => block.content ?? []).map((item) => item.text).join("") ?? "";
    expect(result.brief?.subject).toContain("小兰花获奖");
    expect(copy).toContain("小兰花");
    expect(copy).not.toContain("摄影");
    expect(result.layoutPlan?.theme).toBe("celebration");
  });

  it("stops for clarification when the input is too thin", async () => {
    const result = await runWechatArticleGraph(baseState("写文章"), {
      agents: createDemoCreationAgents()
    });

    expect(result.status).toBe("waiting_clarification");
    expect(result.clarification?.questions[0]?.id).toBe("audience");
    expect(result.finalDocument).toBeUndefined();
  });

  it("uses rebuilt history and recent valuable instructions when the latest input only says continue", async () => {
    const result = await runWechatArticleGraph({
      ...baseState("继续任务"),
      memory: {
        instructionMemory: {
          rebuiltContext: {
            taskGoal: "小兰花艺术节获奖",
            sourceRequest: "请为春芽舞蹈学校写一篇公众号文章，主题是小兰花艺术节获奖。",
            audience: "少儿舞蹈学员家长",
            styleConstraints: ["风格热烈但不要夸张"],
            contentRequirements: ["重点写《蚊子哪里跑》获奖现场、孩子成长和老师陪伴"],
            prohibitedContent: [],
            unresolvedQuestions: [],
            confidence: "medium"
          },
          recentValuableTurns: [
            { messageId: "message_1", content: "面向少儿舞蹈学员家长，风格热烈但不要夸张。", reason: "包含目标读者和风格" },
            { messageId: "message_2", content: "重点写《蚊子哪里跑》获奖现场、孩子成长和老师陪伴。", reason: "包含内容重点" }
          ]
        },
        resourceContext: {
          currentResourceIds: [],
          inheritedResourceIds: [],
          artifactResourceIds: [],
          materialSummary: []
        },
        materialSummary: [],
        userConstraints: []
      }
    }, {
      agents: createDemoCreationAgents()
    });

    expect(result.status).toBe("completed");
    expect(result.brief?.subject).toContain("小兰花艺术节获奖");
    expect(result.brief?.audience).toContain("少儿舞蹈学员家长");
    expect(result.finalDocument?.attrs.title).not.toContain("继续任务");
  });

  it("uses inherited topic when intent resolution treats regenerate as same-topic continuation", async () => {
    const result = await runWechatArticleGraph({
      ...baseState("金舞艺术的舞蹈《蚊子哪里跑》在小兰花获奖了，请生成公众号文章。\n\n本轮指令：重新生成"),
      intentResolution: {
        mode: "continue",
        sameTopic: true,
        confidence: "high",
        effectiveInstruction: "金舞艺术的舞蹈《蚊子哪里跑》在小兰花获奖了，请生成公众号文章。\n\n本轮指令：重新生成",
        inheritedMessageIds: ["message_1"],
        reason: "同一会话内短指令默认继承历史主题"
      },
      memory: {
        instructionMemory: {
          recentValuableTurns: [{
            messageId: "message_1",
            content: "金舞艺术的舞蹈《蚊子哪里跑》在小兰花获奖了，请生成公众号文章。",
            reason: "包含原始创作主题"
          }]
        },
        resourceContext: {
          currentResourceIds: [],
          inheritedResourceIds: [],
          artifactResourceIds: [],
          materialSummary: []
        },
        materialSummary: [],
        userConstraints: []
      }
    }, {
      agents: createDemoCreationAgents()
    });

    expect(result.status).toBe("completed");
    expect(result.brief?.subject).toContain("蚊子哪里跑");
    expect(result.finalDocument?.attrs.title).not.toBe("重新生成");
  });

  it("asks clarification when intent resolution cannot find an inherited topic", async () => {
    const result = await runWechatArticleGraph({
      ...baseState("继续"),
      intentResolution: {
        mode: "clarify",
        sameTopic: true,
        confidence: "low",
        effectiveInstruction: "继续",
        inheritedMessageIds: [],
        reason: "短指令没有可继承的历史创作需求"
      }
    }, {
      agents: createDemoCreationAgents()
    });

    expect(result.status).toBe("waiting_clarification");
    expect(result.finalDocument).toBeUndefined();
  });

  it("matches shuffled images to sections by semantic content before writing", async () => {
    const result = await runWechatArticleGraph({
      ...baseState("金舞艺术舞蹈《蚊子哪里跑》在小兰花奖获奖，请围绕获奖事实、舞台现场和孩子成长写公众号文章。"),
      resourceIds: ["group_photo", "certificate_photo", "stage_photo"],
      memory: {
        instructionMemory: {
          recentValuableTurns: []
        },
        resourceContext: {
          currentResourceIds: ["group_photo", "certificate_photo", "stage_photo"],
          inheritedResourceIds: [],
          artifactResourceIds: [],
          materialSummary: [
            {
              resourceId: "group_photo",
              type: "image",
              description: "children group photo with teacher, warm smiling family moment",
              suggestedUsage: "use for growth or ending emotion",
              visualTags: ["group", "children", "growth"],
              suggestedRoles: ["emotion"],
              quality: "high"
            },
            {
              resourceId: "certificate_photo",
              type: "image",
              description: "award certificate and medal for dance competition",
              suggestedUsage: "use as proof for award facts",
              visualTags: ["award", "certificate", "medal"],
              suggestedRoles: ["fact_proof"],
              quality: "high"
            },
            {
              resourceId: "stage_photo",
              type: "image",
              description: "dance stage performance scene with children on stage",
              suggestedUsage: "use for stage performance section",
              visualTags: ["stage", "dance", "performance"],
              suggestedRoles: ["scene"],
              quality: "high"
            }
          ]
        },
        materialSummary: [],
        userConstraints: []
      }
    }, {
      agents: createDemoCreationAgents()
    });

    const sectionImages = result.imagePlan?.items.filter((item) => item.placement === "section") ?? [];
    expect(sectionImages.map((item) => [item.sectionIndex, item.resourceId])).toEqual([
      [0, "certificate_photo"],
      [1, "stage_photo"],
      [2, "group_photo"]
    ]);
    expect(result.draft?.sections[0]?.assetRefs).toEqual(["certificate_photo"]);
    expect(result.draft?.sections[1]?.assetRefs).toEqual(["stage_photo"]);
    expect(result.draft?.sections[2]?.assetRefs).toEqual(["group_photo"]);
  });

  it("does not ask clarification for short revision requests with session memory", async () => {
    const result = await runWechatArticleGraph({
      ...baseState("标题更吸引人一点"),
      memory: {
        instructionMemory: {
          recentValuableTurns: [{
            messageId: "message_1",
            content: "写一篇儿童摄影品牌宣传，面向儿童家长，语气温暖。",
            reason: "包含原始创作需求"
          }]
        },
        resourceContext: {
          currentResourceIds: [],
          inheritedResourceIds: [],
          artifactResourceIds: [],
          materialSummary: []
        },
        materialSummary: [],
        userConstraints: ["语气温暖"],
        lastArtifactId: "artifact_1",
        draftSummary: {
          artifactId: "artifact_1",
          title: "把童年留在镜头里",
          paragraphCount: 6,
          sectionTitles: ["自然", "专业", "故事"],
          keyPoints: ["儿童摄影品牌宣传"]
        },
        revisionIntent: {
          target: "title",
          instruction: "标题更吸引人一点",
          createdAt: "2026-08-02T00:00:00.000Z"
        }
      }
    }, {
      agents: createDemoCreationAgents()
    });

    expect(result.status).toBe("completed");
    expect(result.finalDocument).toBeDefined();
  });

  it("preserves the selected title when revision changes the draft title", async () => {
    const demoAgents = createDemoCreationAgents();
    let reviewCount = 0;
    const agents: CreationAgents = {
      ...demoAgents,
      async reviewDraft() {
        reviewCount += 1;
        return reviewCount === 1
          ? reviewReport(false, [{
              code: "BODY_NEEDS_POLISH",
              severity: "error",
              target: "body",
              instruction: "优化正文表达。"
            }])
          : reviewReport(true);
      },
      async reviseDraft(input) {
        return {
          ...input.draft,
          title: "Revision 错误改写的标题",
          intro: `${input.draft.intro} 已完成正文修订。`
        };
      }
    };

    const result = await runWechatArticleGraph(baseState("主题是小兰花获奖，面向舞蹈学员家长，写一篇公众号文章。"), {
      agents
    });
    const selected = result.titles?.items.find((item) => item.id === result.titles?.selectedId);

    expect(result.status).toBe("completed");
    expect(result.draft?.title).toBe(selected?.title);
    expect(result.finalDocument?.attrs.title).toBe(selected?.title);
    expect(result.artifactValidation?.passed).toBe(true);
  });

  it("outputs the last draft with a quality warning when review reaches its limit", async () => {
    const demoAgents = createDemoCreationAgents();
    const issues: ReviewReport["issues"] = [{
      code: "BODY_NEEDS_POLISH",
      severity: "error",
      target: "body",
      instruction: "补充更具体的现场细节。"
    }];
    const result = await runWechatArticleGraph({
      ...baseState("主题是小兰花获奖，面向舞蹈学员家长，写一篇公众号文章。"),
      maxRevisionCount: 1
    }, {
      agents: {
        ...demoAgents,
        async reviewDraft() {
          return reviewReport(false, issues);
        }
      }
    });

    expect(result.status).toBe("completed");
    expect(result.finalDocument).toBeDefined();
    expect(result.qualityStatus).toBe("warning");
    expect(result.completionReason).toBe("max_revision_reached");
    expect(result.unresolvedIssues).toEqual(issues);
  });
  it("routes title review issues back to Title Agent instead of Revision", async () => {
    const demoAgents = createDemoCreationAgents();
    let titleCount = 0;
    let reviewCount = 0;
    let reviseCalled = false;
    const agents: CreationAgents = {
      ...demoAgents,
      async createTitles() {
        titleCount += 1;
        return titleCount === 1
          ? titleCandidates("第一版标题")
          : titleCandidates("第二版标题");
      },
      async reviewDraft() {
        reviewCount += 1;
        return reviewCount === 1
          ? reviewReport(false, [{
              code: "TITLE_NOT_ACCURATE",
              severity: "error",
              target: "title",
              instruction: "标题需要重新生成。"
            }])
          : reviewReport(true);
      },
      async reviseDraft(input) {
        reviseCalled = true;
        return input.draft;
      }
    };

    const result = await runWechatArticleGraph(baseState("主题是小兰花获奖，面向舞蹈学员家长，写一篇公众号文章。"), {
      agents
    });

    expect(result.status).toBe("completed");
    expect(titleCount).toBe(2);
    expect(reviseCalled).toBe(false);
    expect(result.draft?.title).toBe("第二版标题");
    expect(result.finalDocument?.attrs.title).toBe("第二版标题");
  });

  it("routes presentation review issues back to Presentation Director", async () => {
    const demoAgents = createDemoCreationAgents();
    let presentationCount = 0;
    let reviewCount = 0;
    let reviseCalled = false;
    const agents: CreationAgents = {
      ...demoAgents,
      async createPresentation(input) {
        presentationCount += 1;
        return demoAgents.createPresentation(input);
      },
      async reviewDraft() {
        reviewCount += 1;
        return reviewCount === 1
          ? reviewReport(false, [{
              code: "PRESENTATION_COLOR_MISMATCH",
              severity: "error",
              target: "presentation",
              instruction: "按用户指定颜色重新确认内容呈现。"
            }])
          : reviewReport(true);
      },
      async reviseDraft(input) {
        reviseCalled = true;
        return input.draft;
      }
    };

    const result = await runWechatArticleGraph(
      baseState("主题是春季研学活动，主色使用 #173F37，金色只做点缀，不要红色。"),
      { agents }
    );

    expect(result.status).toBe("completed");
    expect(presentationCount).toBe(2);
    expect(reviseCalled).toBe(false);
    expect(result.presentationStyleDecision?.colorDecoration.paletteIntent.primary)
      .toBe("#173F37");
  });
});

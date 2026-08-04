import { describe, expect, it } from "vitest";
import type { CreationGraphState } from "@mediaforge/contracts";
import { createDemoCreationAgents } from "./agents";
import { runWechatArticleGraph } from "./graph";

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

describe("wechat article creation graph", () => {
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
});

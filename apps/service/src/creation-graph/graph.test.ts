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
    expect(result.reviewReports.at(-1)?.passed).toBe(true);
    expect(result.artifactValidation?.passed).toBe(true);
    expect(result.finalDocument?.attrs.title).not.toContain("帮我做一个公众号文案");
    const copy = result.finalDocument?.content
      .flatMap((block) => block.content ?? [])
      .map((item) => item.text)
      .join("");
    expect(copy).not.toContain("要求如下");
  });

  it("stops for clarification when the input is too thin", async () => {
    const result = await runWechatArticleGraph(baseState("写文章"), {
      agents: createDemoCreationAgents()
    });

    expect(result.status).toBe("waiting_clarification");
    expect(result.clarification?.questions[0]?.id).toBe("audience");
    expect(result.finalDocument).toBeUndefined();
  });

  it("does not ask clarification for short revision requests with session memory", async () => {
    const result = await runWechatArticleGraph({
      ...baseState("标题更吸引人一点"),
      memory: {
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

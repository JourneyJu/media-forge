import { describe, expect, it } from "vitest";
import { createConversationStore } from "./conversation-store";

describe("conversation-first creation store", () => {
  it("creates a conversation, message and run with a plan", async () => {
    const store = createConversationStore();
    const conversation = await store.createConversation({
      workspaceId: "workspace_1",
      title: "新的公众号创作"
    });

    await store.addMessage(conversation.id, {
      role: "user",
      content: "写一篇公众号文章，介绍本周活动。",
      resourceIds: []
    });

    const run = await store.createRun(conversation.id, {
      type: "wechat_article_generation",
      layoutSkillId: "auto",
      maxSteps: 12
    });

    expect(run.conversationId).toBe(conversation.id);
    expect(run.status).toBe("completed");
    expect(run.waitingFor).toBeUndefined();
    expect((await store.getConversation(conversation.id)).activeRun?.id).toBe(run.id);
    expect((await store.listRunEvents(run.id)).map((event) => event.type)).toContain("run.completed");
  });

  it("emits visible assistant messages and task card updates for chat workspace", async () => {
    const store = createConversationStore();
    const conversation = await store.createConversation({
      workspaceId: "workspace_1",
      title: "新的公众号创作"
    });
    await store.addMessage(conversation.id, {
      role: "user",
      content: "写一篇儿童摄影活动公众号文案，面向家长，风格温暖。",
      resourceIds: []
    });

    const run = await store.createRun(conversation.id, {
      type: "wechat_article_generation",
      layoutSkillId: "auto",
      maxSteps: 12
    });
    const events = await store.listRunEvents(run.id);

    expect(events.map((event) => event.type)).toContain("assistant.message.created");
    expect(events.map((event) => event.type)).toContain("assistant.message.delta");
    expect(events.map((event) => event.type)).toContain("assistant.message.completed");
    expect(events.map((event) => event.type)).toContain("task.card.updated");
    expect((await store.getConversation(conversation.id)).messages.some((message) => message.role === "assistant")).toBe(true);
  });

  it("creates an artifact without plan approval", async () => {
    const store = createConversationStore();
    const conversation = await store.createConversation({
      workspaceId: "workspace_1",
      title: "新的公众号创作"
    });
    await store.addMessage(conversation.id, {
      role: "user",
      content: "写一篇公众号文章，介绍本周活动。",
      resourceIds: []
    });
    const run = await store.createRun(conversation.id, {
      type: "wechat_article_generation",
      layoutSkillId: "auto",
      maxSteps: 12
    });

    expect(run.status).toBe("completed");
    expect(run.resultArtifact?.type).toBe("wechat_article");
    expect(await store.listArtifacts(conversation.id)).toHaveLength(1);
    expect((await store.listRunEvents(run.id)).map((event) => event.type)).toContain("artifact.created");
    expect((await store.listRunEvents(run.id)).map((event) => event.type)).toContain("run.completed");
  });

  it("replays historical run events before subscribing to live events", async () => {
    const store = createConversationStore();
    const conversation = await store.createConversation({
      workspaceId: "workspace_1",
      title: "鏂扮殑鍏紬鍙峰垱浣?"
    });
    await store.addMessage(conversation.id, {
      role: "user",
      content: "鍐欎竴绡囧叕浼楀彿鏂囩珷锛屼粙缁嶆湰鍛ㄦ椿鍔ㄣ€?",
      resourceIds: []
    });
    const run = await store.createRun(conversation.id, {
      type: "wechat_article_generation",
      layoutSkillId: "auto",
      maxSteps: 12
    });

    const received: string[] = [];
    const unsubscribe = await store.subscribeRunEvents(run.id, 1, (event) => {
      received.push(event.type);
    });
    unsubscribe();

    expect(received).toContain("step.started");
    expect(received).toContain("artifact.created");
    expect(received).toContain("run.completed");
  });
});

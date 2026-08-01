# 中间对话工作区 API 与事件契约

## 范围

本文档记录中间对话工作区需要消费的前后端契约。实际 HTTP 入口仍优先归属 `conversations` 和 `creation-graph`，本文件只固化聊天工作区需要的请求顺序、事件类型和前端投影规则。

会话生命周期和资源归属以 `docs/api/conversations.md`、`docs/api/assets.md` 和规格 007 为准。

## 依赖接口

| 动作 | 接口归属 | 说明 |
| --- | --- | --- |
| 首次 Turn | `conversations` | 原子创建 Conversation、Message、资源关系和 Run。 |
| 后续 Turn | `conversations` | 原子追加 Message、资源关系和 Run。 |
| 上传资源 | `assets` | Conversation 创建前通过 UploadSession 暂存。 |
| 订阅事件 | `conversations` | 通过 `GET /runs/:runId/events` 接收 SSE。 |
| 获取 Artifact | `articles` / `conversations` | 更新右侧手机预览。 |
| 回答追问 | `conversations` / `creation-graph` | 恢复等待中的 Run。 |

## 发送顺序

```text
首次发送：POST /conversations
后续发送：POST /conversations/:conversationId/turns
GET  /runs/:runId/events
```

前端在 Turn 接口返回前可以插入本地临时 `UserMessage`。接口成功后用服务端 ID 替换临时 ID；首次发送失败时不得产生历史 Conversation。

## RunEvent 扩展

中间对话工作区需要以下事件：

```text
assistant.message.created
assistant.message.delta
assistant.message.completed
task.card.updated
clarification.required
artifact.created
run.completed
run.failed
```

现有 `step.started`、`step.completed` 可以继续保留。第一阶段允许同时支持旧事件和新事件，但前端统一投影为 `TaskCardMessage`。

## 事件定义

### assistant.message.created

```ts
type AssistantMessageCreatedEvent = {
  type: "assistant.message.created";
  runId: string;
  messageId: string;
  createdAt: string;
};
```

前端行为：插入一个空的 `AssistantMessage`，并设置 `streaming: true`。

### assistant.message.delta

```ts
type AssistantMessageDeltaEvent = {
  type: "assistant.message.delta";
  runId: string;
  messageId: string;
  delta: string;
  createdAt: string;
};
```

前端行为：把 `delta` 追加到对应 `AssistantMessage.content`。

### assistant.message.completed

```ts
type AssistantMessageCompletedEvent = {
  type: "assistant.message.completed";
  runId: string;
  messageId: string;
  content?: string;
  createdAt: string;
};
```

前端行为：将对应消息设置为 `streaming: false`。如果 `content` 存在，以服务端完整内容为准。

### task.card.updated

```ts
type TaskCardUpdatedEvent = {
  type: "task.card.updated";
  runId: string;
  status: "queued" | "running" | "waiting_clarification" | "completed" | "failed";
  steps: Array<{
    id: string;
    label: string;
    status: "waiting" | "running" | "completed" | "failed";
    summary?: string;
  }>;
  collapsed?: boolean;
  createdAt: string;
};
```

前端行为：创建或更新 `TaskCardMessage`。当 `status` 为 `completed` 时默认收起。

### clarification.required

```ts
type ClarificationRequiredEvent = {
  type: "clarification.required";
  runId: string;
  title: string;
  description: string;
  questions: Array<{
    id: string;
    label: string;
    required: boolean;
    suggestions: string[];
  }>;
  createdAt: string;
};
```

前端行为：插入 `ClarificationMessage`，任务卡状态改为 `waiting_clarification`。

### artifact.created

```ts
type ArtifactCreatedEvent = {
  type: "artifact.created";
  runId: string;
  artifactId: string;
  articleId?: string;
  versionId?: string;
  createdAt: string;
};
```

前端行为：拉取 artifact 或文章版本，刷新右侧手机预览。

### run.completed

```ts
type RunCompletedEvent = {
  type: "run.completed";
  runId: string;
  artifactId?: string;
  createdAt: string;
};
```

前端行为：任务卡收起，插入 `ResultNoticeMessage`。

### run.failed

```ts
type RunFailedEvent = {
  type: "run.failed";
  runId: string;
  errorCode: string;
  message: string;
  retryable: boolean;
  createdAt: string;
};
```

前端行为：任务卡保持展开，显示失败信息和重试入口。

## 兼容规则

- `decision.required` 在旧实现中可临时映射为 `clarification.required`，但新产品语义不再叫“用户确认计划”。
- `step.started` 和 `step.completed` 可映射为 `task.card.updated` 的局部步骤更新。
- 没有 assistant message 事件时，前端不能伪造 AI 流式消息，只能显示任务卡进度。

## 内容安全边界

后端写入 `AssistantMessage` 时必须过滤内部过程。以下内容不得进入对话可见消息和最终文章正文：

- Chain-of-thought 或模型原始思维链。
- 内部 prompt。
- 工具调用参数。
- 审阅 Agent 内部报告。
- 执行计划原文。

最终公众号正文只能来自文章生成结果或 artifact builder，不得直接拼接用户输入和 Agent 过程文本。

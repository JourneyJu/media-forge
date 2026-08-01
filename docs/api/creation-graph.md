# API：Creation Graph 多 Agent 编排

## 实施状态

本文件描述多 Agent API 的当前能力和会话生命周期重构后的目标入口。Conversation Run 已使用 `queued + BullMQ Worker`，任务、输出、事件和追问恢复均已接入 PostgreSQL；Run 改由原子 Turn 创建仍待规格 007 实施。SSE 使用 PostgreSQL 事件回放和定时补查，Redis Pub/Sub 通知属于后续延迟优化。

目标实现见 `docs/specs/006-langgraph-multi-agent-production-completion.md`。

## 定位

Creation Graph 是后端内部多 Agent 编排模块。普通前端主要使用 `docs/api/conversations.md`，本文件只记录多 Agent 相关的新增或扩展 API。

## Run 创建入口

普通前端不再单独创建 Run。`POST /conversations` 首次 Turn 和 `POST /conversations/:conversationId/turns` 后续 Turn 会在同一事务中创建公众号 Run 和 dispatch outbox。

### Turn 中与 Run 相关的请求片段

```json
{
  "type": "wechat_article_generation",
  "layoutSkillId": "auto",
  "maxSteps": 12
}
```

### Turn 响应中的 Run 片段

```json
{
  "id": "run_1",
  "conversationId": "conversation_1",
  "type": "wechat_article_generation",
  "status": "queued",
  "currentStep": "brief",
  "createdAt": "2026-07-27T00:00:00.000Z"
}
```

规则：

- Turn API 不等待完整文章生成。
- Turn API 创建 Run 后写 `run.created`。
- API 使用 `runId` 作为 BullMQ `jobId`，避免重复入队。
- 数据库提交成功但 Redis 暂时不可用时，通过 dispatch outbox 重试，不静默回退旧同步生成。

## `GET /runs/:runId/events`

读取 RunEvent SSE 流。多 Agent 节点进度通过该接口投影给前端。

### 事件示例

```text
id: 4
event: step.started
data: {"runId":"run_1","stepType":"writer","title":"正文创作"}

id: 5
event: step.completed
data: {"runId":"run_1","stepType":"writer","summary":"已完成正文草稿"}

id: 6
event: artifact.created
data: {"runId":"run_1","artifactId":"artifact_1","artifactType":"wechat_article"}
```

事件必须在 Worker 节点真实执行期间写入 PostgreSQL。不得在任务完成后遍历历史步骤制造伪实时事件。

## `POST /runs/:runId/clarifications`

用户补充必要信息后恢复 LangGraph。

### 请求

```json
{
  "answers": [
    {
      "questionId": "audience",
      "value": "家长"
    }
  ],
  "idempotencyKey": "client-generated-key"
}
```

### 响应 `200`

```json
{
  "id": "run_1",
  "status": "queued",
  "waitingFor": null,
  "updatedAt": "2026-07-27T00:00:00.000Z"
}
```

规则：

- 只有 `waiting_clarification` 状态可以提交。
- 提交后写 `clarification.submitted`。`decision.submitted` 仅作为旧客户端迁移期兼容事件。
- Worker 使用 LangGraph resume 继续执行。
- 重复提交同一 `idempotencyKey` 返回同一结果。

## `GET /runs/:runId/tasks`

读取多 Agent 节点任务状态。主要用于后台、调试和运营，不作为普通用户主界面 API。

### 响应 `200`

```json
{
  "items": [
    {
      "id": "task_1",
      "runId": "run_1",
      "agentName": "BriefAgent",
      "nodeName": "brief",
      "status": "succeeded",
      "startedAt": "2026-07-27T00:00:00.000Z",
      "completedAt": "2026-07-27T00:00:02.000Z"
    }
  ]
}
```

## `GET /runs/:runId/outputs`

读取 Agent 结构化输出。默认仅内部可用。

### 响应 `200`

```json
{
  "items": [
    {
      "id": "output_1",
      "runId": "run_1",
      "type": "creative_brief",
      "schemaVersion": "2026-07-27",
      "payload": {}
    }
  ]
}
```

安全规则：

- 不返回原始思维链。
- 不返回密钥。
- 不返回未脱敏 prompt。
- 不返回完整 raw model output。

## 错误码

| 错误码 | HTTP | 说明 |
| --- | --- | --- |
| `RUN_NOT_FOUND` | 404 | Run 不存在或无权访问。 |
| `RUN_INVALID_STATE` | 409 | 当前状态不能提交追问答案。 |
| `RUN_JOB_DUPLICATED` | 200/202 | 队列任务已存在，返回当前 Run。 |
| `RUN_CLARIFICATION_REQUIRED` | 409 | 需要先补充信息。 |
| `RUN_OUTPUT_INVALID` | 422 | Agent 输出不符合 schema。 |
| `RUN_EVENT_STREAM_UNAVAILABLE` | 503 | 事件流暂不可用。 |
| `WORKER_UNAVAILABLE` | 503 | Worker 或队列不可用。 |

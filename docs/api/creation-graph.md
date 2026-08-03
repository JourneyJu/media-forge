# API：Creation Graph 多 Agent 编排

## 实施状态

本文件描述多 Agent API 的当前能力和会话生命周期重构后的目标入口。Conversation Run 已使用 `queued + BullMQ Worker`，任务、输出、事件和追问恢复均已接入 PostgreSQL；Run 改由原子 Turn 创建仍待规格 007 实施。SSE 使用 PostgreSQL 事件回放和定时补查，Redis Pub/Sub 通知属于后续延迟优化。

目标实现见 `docs/specs/006-langgraph-multi-agent-production-completion.md`。

`docs/specs/015-multi-agent-content-and-layout-quality.md` 已确认新的 Turn 上下文、结构化正文和 LayoutPlan 目标契约，但共享 contracts 尚未实施。本节中的目标字段在 contracts 合入前不得视为可调用 API。

## 定位

Creation Graph 是后端内部多 Agent 编排模块。普通前端主要使用 `docs/api/conversations.md`，本文件只记录多 Agent 相关的新增或扩展 API。

## Run 创建入口

普通前端不再单独创建 Run。`POST /conversations` 首次 Turn 和 `POST /conversations/:conversationId/turns` 后续 Turn 会在同一事务中创建公众号 Run 和 dispatch outbox。

### Turn 中与 Run 相关的请求片段

```json
{
  "type": "wechat_article_generation",
  "creationMode": "auto",
  "inheritedResourceIds": [],
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
- `creationMode` 目标枚举为 `auto|new|revise|continue`；显式值优先于服务端推断。
- `new` 默认只使用本 Turn 的 `resourceIds`；旧资源必须通过 `inheritedResourceIds` 显式选择。
- 服务端不得把历史用户消息拼接为当前 Run 的原始指令。

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

### Agent 流式过程事件

规格 016 扩展以下事件：

```text
agent.started
agent.progress
agent.reasoning.delta
agent.reasoning.completed
agent.output.validating
agent.retry.started
agent.completed
agent.failed
run.heartbeat
```

示例：

```text
id: 21
event: agent.reasoning.delta
data: {"runId":"run_1","stepId":"task_1","agentName":"MaterialAgent","sequence":3,"phase":"thinking","delta":"正在核对素材与当前主题的关系","elapsedMs":8200,"retryCount":0,"createdAt":"2026-08-03T00:00:08.200Z"}

id: 22
event: agent.output.validating
data: {"runId":"run_1","stepId":"task_1","agentName":"MaterialAgent","sequence":4,"phase":"validating","summary":"正在检查素材分析字段","elapsedMs":9100,"retryCount":0,"createdAt":"2026-08-03T00:00:09.100Z"}
```

规则：

- `event_no` 仍是 SSE `id`，`sequence` 只用于单 Agent 增量去重。
- `delta` 单条最多 500 字符，仅允许承载平台映射的安全业务摘要，不承载供应商原始 reasoning。
- `run.heartbeat` 不包含模型文本。
- 事件不得包含系统 prompt、原始思维链、raw JSON、API Key 或供应商错误正文。
- 老客户端可以忽略未知事件，现有 SSE URL 和断线续传语义不变。
- 本节事件已纳入共享 contracts；部署前不得视为环境已上线接口。

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

`AgentOutput.type` 已包含 `material_summary`、`content_plan` 和 `layout_plan`。`layout_plan` 只能包含受控设计令牌和模块引用，不得包含 raw HTML、CSS 或脚本。

Material 节点会对本轮图片调用 `multimodal_generation` 路由，结构化记录场景描述、OCR、质量和建议用途。Skill 品牌资源在 RunContext 中冻结为 `assetId + assetKey + type + usage`；模型只引用 `assetKey`，最终资源地址由 Artifact Builder 按 owner 和 Skill version 的解析结果生成。

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
| `GENERATION_MODEL_UNAVAILABLE` | 503 | 生产环境没有可用的 active 模型路由；不得回退 Demo。 |
| `RUN_CONTEXT_INVALID` | 422 | 创作模式、当前资源或继承资源不满足目标上下文约束。 |
| `LAYOUT_PLAN_INVALID` | 422 | LayoutPlan 不符合白名单 schema，禁止进入 Renderer。 |

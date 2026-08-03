# 规格：Run 事件流与流式创作反馈

> 演进说明：本文定义第一阶段 RunEvent + SSE 基础能力。模型调用期间的安全推理摘要、Agent 增量、heartbeat、超时和自动折叠由 `docs/specs/016-streaming-agent-progress.md` 扩展；最终文章仍只以 Artifact / ArticleVersion 为事实源。

## 背景

当前 conversation-first 后端已经将创作建模为 `Conversation → Run → Artifact`。如果继续使用同步请求返回完整结果，用户只能看到“等待中”和“完成后结果”，无法获得计划执行过程中的实时反馈。公众号创作更适合按任务阶段流式展示，而不是直接做 token 级聊天流。

本规格定义最终推荐方案：

```text
SSE + RunEvent + 异步 runner + artifact.created
```

第一阶段先做 Run 事件流，不做 token 级流式输出。文章内容仍以最终 `Artifact` / `ArticleVersion` 为事实源。

## 目标

- 前端可以实时展示 Run 进度、计划步骤、等待确认、失败和完成。
- 页面刷新或 SSE 断线后可以从最后事件继续。
- `artifact.created` 事件通知前端更新手机预览。
- 事件流只承载可展示摘要，不返回模型原始思维链。
- 后续可以扩展到文章块流，但不破坏 ArticleVersion 的事实源地位。

## 非目标

- 第一阶段不做 token 级 streaming。
- 第一阶段不把中间草稿保存为正式文章版本。
- 第一阶段不要求 WebSocket。
- 第一阶段不要求 Redis queue；可以先用本进程 async runner 过渡。

## 流式层级

### 第 1 层：Run 事件流

用于计划条、对话状态和任务进度。

```text
run.created
run.started
step.started
step.completed
decision.required
decision.submitted
artifact.created
run.completed
run.failed
```

这是第一阶段必须实现的层级。

### 第 2 层：文章块流

用于临时手机预览草稿。

```text
article.title.updated
article.block.created
article.block.updated
article.preview.updated
```

文章块流只能作为临时预览，不是最终事实源。

### 第 3 层：token 流

暂不实现。token 流不适合作为公众号文章事实源，只能作为“正在写作”的临时动效。

## 技术选择

第一阶段使用 SSE（Server-Sent Events）。

选择原因：

- 服务端到浏览器单向推送足够。
- 浏览器原生支持 `EventSource`。
- 实现和运维复杂度低于 WebSocket。
- 与 run 进度、步骤事件和 artifact 通知天然匹配。

## 数据模型

新增表：

```text
run_events
  id
  run_id
  event_no
  type
  payload_json
  created_at
```

规则：

- `event_no` 在单个 run 内递增。
- SSE 的 `id` 使用 `event_no`。
- 断线恢复使用 `Last-Event-ID` 或 `?after=event_no`。
- 事件是可恢复展示记录，不替代 `runs`、`artifacts`、`article_versions`。

## 事件类型

```ts
type RunEvent =
  | { type: "run.created"; runId: string; status: RunStatus }
  | { type: "run.started"; runId: string; status: RunStatus }
  | { type: "step.started"; runId: string; stepId: string; title: string }
  | { type: "step.completed"; runId: string; stepId: string; summary: string }
  | { type: "decision.required"; runId: string; waitingFor: RunWaitingFor }
  | { type: "decision.submitted"; runId: string; decision: string }
  | { type: "artifact.created"; runId: string; artifactId: string; artifactType: ArtifactType }
  | { type: "run.completed"; runId: string; artifactId?: string }
  | { type: "run.failed"; runId: string; message: string };
```

事件 payload 必须脱敏，不包含密钥、完整 prompt、模型原始思维链或未过滤 raw output。

## API

```text
POST /conversations（首次 Turn 内创建 Run）
POST /conversations/:conversationId/turns（后续 Turn 内创建 Run）
GET /runs/:runId/events
POST /runs/:runId/clarifications
GET /runs/:runId
```

### SSE 输出格式

```text
id: 12
event: step.started
data: {"runId":"run_1","stepId":"step_1","title":"理解需求"}

id: 13
event: step.completed
data: {"runId":"run_1","stepId":"step_1","summary":"已整理主题和目标读者"}
```

### 断线恢复

客户端可以使用：

```http
GET /runs/:runId/events?after=12
```

或：

```http
Last-Event-ID: 12
```

服务端必须先补发未读取事件，再继续挂起连接等待新事件。

## 执行模型

当前同步模型：

```text
POST /runs/:id/decisions
→ 后端同步执行完整任务
→ 返回 completed run
```

流式目标模型：

```text
POST /conversations 或 POST /conversations/:id/turns
→ 保存 run=queued
→ 写 run.created
→ 启动 async runner
→ 立即返回 run
→ 前端打开 /runs/:id/events
```

用户确认：

```text
decision.required
→ 前端展示确认
→ POST /runs/:id/decisions
→ 写 decision.submitted
→ async runner 继续推进
```

第一阶段可以使用本进程 runner：

```ts
void runOrchestrator.start(runId)
```

产品化阶段替换为 Redis queue / worker。

## 前端映射

| 事件 | 前端行为 |
| --- | --- |
| `run.created` | 创建运行状态，显示计划条。 |
| `step.started` | 当前步骤高亮。 |
| `step.completed` | 步骤标记完成，展示摘要。 |
| `decision.required` | 展示确认按钮或追问选项。 |
| `artifact.created` | 拉取 artifact 并更新手机预览。 |
| `run.completed` | 收起计划，结果成为主视图。 |
| `run.failed` | 展示失败摘要和重试入口。 |

前端建议新增 hook：

```text
useRunEvents(runId)
```

职责：

- 打开 EventSource。
- 按事件更新 RunViewState。
- 记录 `lastEventId`。
- 断线重连。
- completed / failed 后关闭连接。

## 一致性原则

- Run 事件流不是事实源替代。
- `runs` 是任务事实源。
- `artifacts` 是结果索引。
- `article_versions.content_json` 是公众号文章事实源。
- 中间流式预览可以丢弃，最终以 artifact 为准。
- 只有通过 schema 校验的 `ArticleDocument` 才能创建 artifact。

## 分阶段落地

### 阶段 1：Run 事件流

- contracts 新增 `RunEvent` 类型。
- service 新增 `run_events` store。
- 创建 run 时写 `run.created`。
- Orchestrator 每步写 `step.started` / `step.completed`。
- `GET /runs/:id/events` 返回 SSE。
- 前端监听事件更新计划条。

### 阶段 2：异步执行

- 创建 run 后立即返回。
- 本进程 async runner 推进。
- decision 后继续 runner。
- 前端不等待 POST 返回完整结果。

### 阶段 3：Artifact 通知

- run 完成后创建 artifact。
- 写 `artifact.created`。
- 前端收到后 `GET /artifacts/:id` 更新手机预览。

### 阶段 4：文章块流

- writer 生成结构化 block 草稿。
- 推送 `article.block.created` / `article.block.updated`。
- 前端临时预览 draft。
- completed 后用正式 artifact 覆盖。

## 验收标准

- 前端创建 run 后可以通过 SSE 收到 `run.created`。
- run 执行过程中能收到 step 事件。
- 等待用户确认时收到 `decision.required` 并暂停。
- 提交 decision 后收到 `decision.submitted` 并继续执行。
- run 完成时收到 `artifact.created` 和 `run.completed`。
- 刷新或断线后可以通过 `after` 补发遗漏事件。
- 事件 payload 不包含模型原始思维链、密钥或未脱敏 prompt。
- 最终手机预览以 artifact 为准，不以中间 token 为准。

## 文档路由

- 模块：`docs/modules/conversations/README.md`
- API：`docs/api/conversations.md`
- 测试：`docs/testing/plans/conversations.md`、`docs/testing/cases/conversations.md`
- 实施计划：`.plan/20260727-conversation-first-backend.md`

# 模块：创作会话与任务

## 模块定位

`Conversation` 是用户可见的创作空间、历史记录、当前 AI 上下文边界和最小删除单元。后端不存在默认 Conversation，也不保存未发送的空窗口。

## 职责边界

### 负责

- 首次用户 Turn 原子创建 Conversation、首条 Message、资源关系、Run 和 dispatch outbox。
- 后续 Turn 原子追加 Message、绑定资源、更新交互时间并创建 Run。
- 按最后一次成功用户交互时间返回真实历史列表。
- 保存不可变用户消息和 Assistant 可见消息。
- 保存 Run、RunEvent、追问、Artifact 和文章关联。
- 通过删除 Outbox 删除整个 Conversation 聚合。
- 保证 Run 只读取当前 Conversation 上下文。

### 不负责

- 未发送空窗口的持久化。
- 图片二进制上传和预览图生成。
- 机构或品牌资料管理。
- 具体模型供应商调用。
- 微信 HTML renderer 内部实现。

## 领域对象

| 对象 | 说明 |
| --- | --- |
| Conversation | 用户可见创作空间和删除聚合根。 |
| ConversationMessage | 只追加的用户或 Assistant 可见消息。 |
| MessageResource | Message 与 Resource 的不可变关系。 |
| Run | 一次 AI 执行任务。 |
| RunEvent | 可恢复 SSE 事件流。 |
| Artifact | Run 的结构化产物。 |
| ConversationDeletionOutbox | 可靠清理 PostgreSQL 聚合和对象存储的任务。 |

## 不变量

- Conversation 必须和首条用户消息在同一事务创建。
- `title` 保存首条用户 prompt 原文。
- `created_at` 使用首次请求的服务端事务时间。
- `last_interaction_at` 只在成功用户 Turn 后更新。
- AI 消息、Run、Worker 和 Artifact 更新不得改变历史排序。
- Message 创建后不允许修改或单独删除。
- 已发送 Resource 不允许从 Message 单独解绑或删除。
- Conversation 是最小删除单元。

## 状态

### Conversation

```text
active
deleting
```

`deleting` 会话立即从历史列表隐藏，不允许继续写入，等待 Worker 完成对象和数据库聚合清理。

### Run

```text
queued
building_brief
waiting_clarification
running
completed
failed
cancelled
```

用户不确认内部计划。只有缺少会显著改变文章方向的信息时才进入 `waiting_clarification`。

## 主流程

### 首次发送

```text
前端本地空会话
→ POST /conversations（首次 Turn）
→ transaction:
  Conversation + UserMessage + MessageResources
  + queued Run + dispatch outbox
→ 历史列表出现真实 Conversation
→ Worker 执行 LangGraph
→ SSE 推送 Assistant 消息和任务卡
```

事务失败时不得产生空 Conversation。暂存资源保留，可用同一幂等键重试。

### 后续发送

```text
POST /conversations/:id/turns
→ 追加 UserMessage
→ 绑定本次 Resource
→ context_version + 1
→ last_interaction_at = 当前事务时间
→ 创建 Run 和 outbox
```

后续发送不得把历史用户消息拼接成当前 Run 的原始指令。RunContext 必须区分最新 `currentInstruction`、本轮 `currentResourceIds` 和用户显式选择的 `inheritedResourceIds`。服务端根据 `creationMode` 区分重新创作、局部修改和继续扩写；重新创作必须清空旧 brief、标题、提纲、正文摘要、LayoutPlan 和 `lastArtifactId`。

### 历史恢复

页面加载历史列表但默认保持本地空会话。用户点击历史项后调用 `GET /conversations/:id`，恢复消息、资源、active Run 和最新 Artifact。

### 删除

```text
DELETE /conversations/:id
→ status = deleting + deletion outbox
→ 立即从历史隐藏
→ Worker 删除 MinIO 对象
→ 硬删除 Conversation 聚合
```

删除任务失败时保持隐藏并重试，不恢复到 active。

## 数据归属

| 数据 | 归属 |
| --- | --- |
| Conversation、Message、Run、RunEvent、Artifact | PostgreSQL |
| MessageResource | PostgreSQL |
| 删除 object key 快照 | PostgreSQL deletion outbox |
| 图片、HTML、prompt 和输出快照 | MinIO / S3 |
| Run 队列、锁和删除任务 | Redis / BullMQ，非事实源 |

## API 与测试

- API：`docs/api/conversations.md`
- 测试方案：`docs/testing/plans/conversations.md`
- 测试用例：`docs/testing/cases/conversations.md`
- 生命周期规格：`docs/specs/007-conversation-lifecycle-and-resource-ownership.md`
- 会话级上下文管理规格：`docs/specs/013-conversation-session-memory.md`

## 会话级上下文管理

`Conversation` 是公众号创作的上下文边界。系统不保存跨会话长期记忆；同一会话内通过 Working Memory 管理当前创作状态，并在创建 Run 时冻结为 `graph_runs.context_json`。

会话工作记忆包含当前 brief、标题、提纲摘要、素材摘要、用户约束、修改意图和最新 `Artifact` 引用。原始消息、资源绑定和 Artifact 仍然是 PostgreSQL 中的事实源，Working Memory 只是面向后续 Run 的可更新摘要。

后续用户 Turn 创建 Run 时，`conversations` 模块负责读取 Working Memory、识别 Turn 意图、组装本次 `CreationRunContext`，并保证已经创建的 Run 不受后续消息影响。Conversation 删除时，关联 Working Memory 必须随 Conversation 聚合一起清理。

用户可以使用 `creationMode=auto|new|revise|continue` 表达意图。用户显式选择优先于服务端推断；`auto` 只分析最新 Turn，不读取拼接后的历史文本。新创作默认只使用本轮资源，旧资源只有在用户明确继承时才能进入新 Run。

## 风险

- 禁止把用户 prompt 直接当文章标题；它只作为历史 Conversation 标题。
- 禁止把所有历史 Conversation 注入当前模型上下文。
- 禁止把同一 Conversation 的多条历史用户消息拼接为当前 Turn。
- 禁止新创作自动继承旧 Artifact、旧 LayoutPlan 或会话内全部旧资源。
- 禁止展示模型原始思维链。
- SSE 断线必须通过持久化 RunEvent 补发。
- 删除 Outbox 必须先固化 object keys，再删除数据库聚合。
- 目标行为和契约见 `docs/specs/015-multi-agent-content-and-layout-quality.md`。

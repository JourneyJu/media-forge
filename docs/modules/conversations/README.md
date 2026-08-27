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

后续发送不得把历史用户消息拼接成当前 Run 的原始指令。所有入口必须通过同一个 Creation Context Assembler 生成冻结上下文：V2 上下文以 `ResolvedCreationRequest` 作为唯一执行请求，区分本轮 `currentInstruction`、规范化操作、修改范围、约束来源和资源边界。显式 `creationMode` 优先；`auto` 下，完整且自洽的新需求建立全新创作，明确的修改要求按范围修订，只有短操作指令才可继承成功基线，歧义请求必须追问。新创作必须清空旧 brief、标题、提纲、正文摘要、LayoutPlan 和 `lastArtifactId`。

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

会话工作记忆包含当前 brief、标题、提纲摘要、素材摘要、用户约束、修改意图和最新 `Artifact` 引用。V2 将状态进一步拆为 `successfulBaseline` 和 `lastAttempt`：只有成功 Run 可以替换基线，失败 Run 只记录结构化失败与冻结请求，不能污染下一轮默认上下文。原始消息、资源绑定和 Artifact 仍然是 PostgreSQL 中的事实源，Working Memory 只是面向后续 Run 的可更新摘要。

面向模型的历史上下文与前端展示分离。前端恢复 Conversation 时仍展示完整消息历史；创建 Run 时由 IntentResolver 产出结构化 `ResolvedCreationRequest`，Context Rebuild 只为允许继承的继续或修订请求生成 `instructionMemory`。最新 Turn 只作为一次 `currentInstruction` 输入，不能再次进入历史摘要；完整新需求的历史记忆必须为空。“继续任务”“重新生成”“再来一次”“往下写”等短指令是操作意图，只有存在成功基线或冻结的失败请求时才能恢复，不能被当成文章主题。

资源上下文不做文本式压缩。图片、文件、二维码、海报等原始资源继续以 `Resource` 和对象存储为事实源；RunContext 只冻结 `resourceContext`，包含 `currentResourceIds`、用户显式继承的 `inheritedResourceIds`、上一版 Artifact 使用的 `artifactResourceIds` 以及 `materialSummary` 派生摘要。Context Rebuild Agent 只能引用已有 `resourceId`，不能伪造资源、跨 Conversation 继承资源，也不能把 OCR 或视觉摘要当作原始资源替代。

后续用户 Turn 创建 Run 时，`conversations` 模块负责读取 Working Memory、解析最新 Artifact 的 `creationSnapshot`、调用 IntentResolver，并通过唯一 Context Assembler 组装本次 `CreationRunContext`。已经创建的 Run 不受后续消息影响。上一轮失败后，只有“重试”等明确操作可以复用 `lastAttempt.resolvedRequest`；新的完整需求必须建立新请求。`lastArtifactId` 和 `creationSnapshot` 共同决定能否安全执行定向修改，缺少快照的旧 Artifact 自动退回完整 V1 路径，不能伪造局部修订前提。Conversation 删除时，关联 Working Memory 必须随 Conversation 聚合一起清理。

用户可以使用 `creationMode=auto|new|revise|continue` 表达意图。用户显式选择优先于服务端推断；`auto` 只读取最新 Turn、成功基线、最后失败尝试、Artifact 快照和必要元数据，不读取拼接后的历史文本。新创作默认只使用本轮资源；旧资源只有在用户明确继承或修改上一版 Artifact 时才能进入新 Run。V1/V2 由 `CREATION_CONTEXT_V2_MODE=off|shadow|explicit|all` 和稳定的 Conversation 百分比分桶控制，shadow 只记录解析结果、不改变执行路径。

## 风险

- 禁止把用户 prompt 直接当文章标题；它只作为历史 Conversation 标题。
- 禁止把所有历史 Conversation 注入当前模型上下文。
- 禁止把同一 Conversation 的多条历史用户消息拼接为当前 Turn。
- 禁止新创作自动继承旧 Artifact、旧 LayoutPlan 或会话内全部旧资源。
- 禁止展示模型原始思维链。
- SSE 断线必须通过持久化 RunEvent 补发。
- Agent 流式过程继续使用持久化 RunEvent 和 `Last-Event-ID`；Redis 通知不能作为唯一事实源。
- `run.heartbeat` 只表达任务存活、阶段和耗时，不包含模型文本。
- 用户事件只允许安全推理摘要，不允许原始思维链、prompt、Skill 完整指令或 raw model output。
- Conversation 删除时，Agent 增量事件和最终摘要随 Run 聚合一起清理。
- 删除 Outbox 必须先固化 object keys，再删除数据库聚合。
- 目标行为和契约见 `docs/specs/015-multi-agent-content-and-layout-quality.md`。

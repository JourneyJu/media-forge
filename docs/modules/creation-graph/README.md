# 模块：Creation Graph 多 Agent 编排

## 模块定位

Creation Graph 模块负责公众号创作任务的多 Agent 编排。它使用 LangGraph.js 描述和执行创作图，并由 BullMQ Worker 在后台推进。该模块不直接面向浏览器暴露 API，而是被 `conversations` 模块通过 Run 调用。

## 当前实现状态

当前主链路已经实现：

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| LangGraph StateGraph | 已实现 | 结构化执行 Brief、标题、提纲、写作、配图、审校和修订 |
| BullMQ Queue / Worker | 已实现 | Conversation Run 通过 Outbox 入队，由独立 `apps/worker` 消费 |
| Redis Docker 配置 | 已实现 | 本地容器已启动并验证 `PONG` |
| Worker 上下文 | 已实现 | 按 `runId` 和 `contextVersion` 从 PostgreSQL 加载 |
| AgentTask / AgentOutput | 已实现 | 节点执行期间持久化 |
| RunEvent | 已实现 | PostgreSQL 递增事件号、SSE 回放和定时补查 |
| Artifact Builder Guard | 已实现 | 阻止原始提示词和过程文本污染最终正文 |
| Clarification resume | 已实现 | 同一 Run 使用版本化上下文恢复；原生 LangGraph checkpoint 待增强 |
| 真实生产 Agent 门禁 | 已实现 | production 仅允许显式 `MODEL_MODE=gateway`，服务和 Worker 启动时共同校验。 |
| 当前 Turn 与历史隔离 | 已实现 | Run 只接收当前指令、当前资源和显式继承资源。 |
| 结构化 ContentPlan / ArticleDraft | 已实现 | ContentPlan 和按章节 ArticleDraft 驱动内容与图片映射。 |
| LayoutPlan 与主题化排版 | 已实现 | 受控 LayoutPlan 驱动可信 Renderer，前端直接展示 Renderer 产物。 |
| 图片视觉分析 | 已实现 | Worker 从对象存储读取本轮图片，经多模态路由生成描述、OCR 和用途建议；失败时标记低质量素材。 |
| Skill 品牌资源解析 | 已实现 | ImagePlan 只引用 `assetKey`，Artifact Builder 校验冻结版本并解析 Logo、二维码和 GIF。 |

旧同步 `agent-runs` 只保留兼容代码，不再承担 Conversation 新 Run 的主链路。

## 职责

- 定义 `CreationGraphState`。
- 定义多 Agent 节点和节点之间的路由。
- 调用 Model Gateway 执行结构化生成。
- 将 LangGraph 节点状态转换为 `RunEvent`。
- 写入 `AgentTask` 和 `AgentOutput`。
- 在需要用户补充信息时进入 `waiting_clarification`。
- 在完成后调用 Artifact Builder 保存最终公众号产物。
- 保证每个用户可见步骤对应真实 AgentTask 和 AgentOutput，不生成伪步骤。
- 根据 Reviewer 的问题类型回退 Brief、Planner、Writer、ImagePlan 或 Layout 节点。

## 不负责

- 不保存用户会话权限。
- 不直接提供浏览器 API。
- 不直接读取或展示前端 UI。
- 不把 checkpoint 当业务事实源。
- 不把任一 Agent 的自然语言输出直接写入最终公众号正文。

## 依赖

| 依赖 | 用途 |
| --- | --- |
| `conversations` | 获取 Run、消息、资源和写 RunEvent。 |
| `ai-generation` | 复用内容 schema、模型输出校验和生成能力。 |
| `articles` | 保存最终 ArticleVersion。 |
| `assets` | 读取素材摘要和图片引用。 |
| `layout-skills` | 获取 Skill 约束。 |
| Model Gateway | 调用模型供应商。 |
| PostgreSQL | 保存 graph runs、agent tasks、outputs、checkpoints。 |
| Redis / BullMQ | 承载后台任务队列。 |
| MinIO / S3 | 保存快照和对象资源。 |

## 建议目录

```text
apps/service/src/creation-graph/
  graph.ts
  state.ts
  schemas.ts
  events.ts
  artifact-builder.ts
  nodes/
    brief-node.ts
    clarification-node.ts
    title-node.ts
    outline-node.ts
    writer-node.ts
    image-plan-node.ts
    reviewer-node.ts
    revision-node.ts
    renderer-node.ts
  persistence/
    graph-run-store.ts
    agent-task-store.ts
    checkpoint.ts

apps/worker/
  src/
    queues/creation-run-worker.ts
    runner.ts
```

## Agent 节点

| 节点 | Agent | 说明 |
| --- | --- | --- |
| `brief` | Brief Agent | 将用户输入、资源和 Skill 转为 `CreativeBrief`。 |
| `material` | Material Agent | 提取图片、GIF、文档和品牌资源的场景、OCR、质量与建议用途。 |
| `planner` | Content Planner Agent | 生成叙事主线、章节目标、要求覆盖和素材映射。 |
| `clarification` | Clarification Agent | 判断是否需要向用户追问。 |
| `title` | Title Agent | 生成标题、备选标题和副标题。 |
| `outline` | Outline Agent | 生成文章结构和章节目标。 |
| `writer` | Writer Agent | 生成结构化正文草稿。 |
| `image_plan` | Image Planner Agent | 规划封面、正文图、组图和素材使用。 |
| `layout` | Layout Agent | 根据主题、正文、素材和 Skill 生成受控 `LayoutPlan`。 |
| `review` | Reviewer Agent | 检查故事性、商业表达、事实风险和微信阅读体验。 |
| `revision` | Revision Agent | 根据审阅报告修订草稿。 |
| `render` | Trusted WeChat Renderer | 将受控 `LayoutPlan` 映射为微信兼容 HTML；它不是自由文本 Agent。 |
| `artifact` | Artifact Builder | 校验并保存 Artifact 和 ArticleVersion。 |

## 标题来源一致性

Title Agent 是文章标题的唯一生产者。最终 `ArticleDraft.title` 必须等于 `TitleCandidates.selectedId` 指向的候选标题，Artifact Builder 必须在保存前执行该校验，失败时返回 `ARTIFACT_VALIDATION_FAILED:TITLE_SOURCE_INVALID`，不得生成可发布预览。

Revision Agent 默认不得修改标题、副标题或标题候选集合。Reviewer 如果发现正文、图片、结构或版式问题，Graph 只允许对应节点或 Revision 修订相关内容，并在修订后继续沿用 Title Agent 选中的标题。Reviewer 如果明确发现标题问题，Graph 必须回退到 Title Agent 重新生成和选择标题，再继续后续 Outline、ImagePlan、Writer、Layout 和 Review；不得由 Revision Agent 绕过标题候选集合直接改写标题。

该规则用于同时保证两个边界：

- 用户原始 prompt 不得被当作标题。
- 审校后的自然修订不得让最终标题脱离 Title Agent 的 `selectedId`。

## 会话记忆输入

Creation Graph 不维护跨会话长期记忆。它只消费 `conversations` 模块在 Run 创建时冻结的 `CreationRunContext`，其中可包含当前会话的 Working Memory 摘要。

Working Memory 可以提供 brief、上一版标题、提纲摘要、素材摘要、用户约束、修改意图和 `lastArtifactId`。Graph 节点必须按职责读取必要片段，不能把完整历史消息或所有上下文字段无差别传给每个 Agent。

当 Run 完成后，Worker 通过 `AgentOutput` 和 `Artifact` 产出可用于更新 Working Memory 的结构化结果。最终公众号正文仍以 `Artifact` / `ArticleDocument` 为事实源，Working Memory 不得替代最终正文。

最新 Turn 必须作为本轮唯一原始指令。历史消息不得拼接为本轮 prompt；历史只通过 Working Memory 摘要和显式继承资源进入 Run。`new` 模式清空旧创作状态，`revise` 模式才允许读取 `lastArtifactId`。

详细方案见 `docs/specs/013-conversation-session-memory.md` 和 `docs/specs/015-multi-agent-content-and-layout-quality.md`。

## 状态流

```text
queued
→ running
→ waiting_clarification（可选）
→ running
→ completed
```

失败状态：

```text
failed
cancelled
```

## 事件转换

Creation Graph 不直接把 LangGraph 内部事件暴露给前端，而是写入产品事件：

```text
run.created
step.started
step.completed
task.card.updated
assistant.message.created
assistant.message.delta
assistant.message.completed
clarification.required
clarification.submitted
artifact.created
run.completed
run.failed
```

`clarification.required` 只用于必要追问，不用于确认执行计划。`decision.required` 仅作为旧客户端迁移期间的兼容事件，目标实现不再产生。

规格 016 增加 Agent 模型调用期间的产品事件：

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

这些事件只包含安全推理摘要、真实执行阶段、耗时和重试状态。Creation Graph 不得把模型原始思维链、raw output、系统 prompt、Skill 完整指令或模型调用参数写入 `RunEvent`。模型 `content` 分片只在 Worker 内部缓冲，完整 JSON 通过 Zod 后才能成为 `AgentOutput`。

Worker 不持久化供应商原始 reasoning；每个 Agent 首次收到 reasoning 信号时只写一条平台生成的安全业务摘要。没有新增量时每 5 秒写 `run.heartbeat`；完成、失败、取消或等待追问后停止 heartbeat。超过运行阈值且没有 Worker 活动的 Run 必须由恢复机制进入明确终态，不能永久停留在 running。

## 数据写入规则

- 每个节点开始时写 `AgentTask(status=running)`。
- 每个节点完成时写 `AgentTask(status=succeeded)` 和 `AgentOutput`。
- 每个用户可见节点状态写 `RunEvent`。
- 每个失败节点写 `AgentTask(status=failed)` 和 `run.failed` 或 retry event。
- Artifact Builder 成功后写 `Artifact`、`ArticleVersion` 和 `artifact.created`。

以上规则已在当前 Worker 主链路中实现。

## 内容安全边界

Artifact Builder 必须阻止以下内容进入最终公众号正文：

- 用户原始 prompt。
- Agent 执行计划。
- 模型思考过程。
- 审阅报告。
- 内部 prompt。
- 未经 schema 校验的自然语言草稿。
- 模型生成的任意 HTML、CSS、JavaScript 或事件属性。
- 未通过 owner、version、asset type 和用途校验的 Skill 资源。
- 未来源于 Title Agent `selectedId` 的最终标题。

## 与前端交互的关系

前端只通过 `conversations` API 和 `RunEvent` 观察 Creation Graph：

```text
POST /conversations（首次 Turn 内创建 Run）
POST /conversations/:id/turns（后续 Turn 内创建 Run）
GET /runs/:id/events
GET /artifacts/:id
POST /runs/:id/clarifications
```

前端不知道 LangGraph checkpoint、node 名称、内部 tool call 和 raw model output。

旧 `POST /conversations/:id/runs` 只在迁移期兼容，不作为前端主链路。Conversation 删除时，关联的 graph run、agent task、agent output、checkpoint 和脱敏快照由 Conversation deletion outbox 统一清理。

## 验证重点

- Graph 节点顺序符合规格。
- 信息不足时只进入 `waiting_clarification`，不进入计划确认。
- RunEvent 可恢复。
- Worker 重试不会重复创建 Artifact。
- 最终公众号正文不混入过程信息。
- 最终标题始终来自 Title Agent `selectedId`；Revision 不得在非标题问题中改写标题。
- 新主题不继承旧主题、旧素材或旧 LayoutPlan。
- 生产模型不可用时明确失败，不返回 Demo 文章。
- Reviewer 未通过时不创建 Artifact，并回退到对应问题节点。
- 模型长调用期间持续产生安全进度或 heartbeat，不出现无反馈等待。
- 所有异常路径产生唯一 Run 终态，不静默结束。

## 实施路由

- 初始规格：`docs/specs/004-langgraph-multi-agent-creation-system.md`
- 生产化补全规格：`docs/specs/006-langgraph-multi-agent-production-completion.md`
- 流式过程反馈规格：`docs/specs/016-streaming-agent-progress.md`
- 会话级上下文管理规格：`docs/specs/013-conversation-session-memory.md`
- 内容与排版质量重构：`docs/specs/015-multi-agent-content-and-layout-quality.md`
- 结构化渲染决策：`docs/adr/010-structured-content-and-layout-plan.md`
- 当前 L 级计划：`.plan/20260727-langgraph-multi-agent-production-completion.md`

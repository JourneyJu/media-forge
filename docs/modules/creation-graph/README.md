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

旧同步 `agent-runs` 只保留兼容代码，不再承担 Conversation 新 Run 的主链路。

## 职责

- 定义 `CreationGraphState`。
- 定义多 Agent 节点和节点之间的路由。
- 调用 Model Gateway 执行结构化生成。
- 将 LangGraph 节点状态转换为 `RunEvent`。
- 写入 `AgentTask` 和 `AgentOutput`。
- 在需要用户补充信息时进入 `waiting_clarification`。
- 在完成后调用 Artifact Builder 保存最终公众号产物。

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
| `clarification` | Clarification Agent | 判断是否需要向用户追问。 |
| `title` | Title Agent | 生成标题、备选标题和副标题。 |
| `outline` | Outline Agent | 生成文章结构和章节目标。 |
| `writer` | Writer Agent | 生成结构化正文草稿。 |
| `image_plan` | Image Planner Agent | 规划封面、正文图、组图和素材使用。 |
| `review` | Reviewer Agent | 检查故事性、商业表达、事实风险和微信阅读体验。 |
| `revision` | Revision Agent | 根据审阅报告修订草稿。 |
| `render` | WeChat Renderer Agent | 生成微信兼容内容结构和 HTML。 |
| `artifact` | Artifact Builder | 校验并保存 Artifact 和 ArticleVersion。 |

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

## 实施路由

- 初始规格：`docs/specs/004-langgraph-multi-agent-creation-system.md`
- 生产化补全规格：`docs/specs/006-langgraph-multi-agent-production-completion.md`
- 当前 L 级计划：`.plan/20260727-langgraph-multi-agent-production-completion.md`

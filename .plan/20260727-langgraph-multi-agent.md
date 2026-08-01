# L 级改动计划：LangGraph + BullMQ 多 Agent 架构

## 背景

用户确认面向商用选择 B 方案：`LangGraph.js + BullMQ Worker`。系统需要从单 Agent 自动执行升级为多 Agent 后台编排，并把前端中间区域升级为聊天流和任务卡。

## 需求分级

L 级。

原因：

- 新增 `apps/worker` 服务。
- 新增 Redis / BullMQ 队列依赖。
- 新增 LangGraph 编排框架。
- 新增数据库表和 checkpoint schema。
- 改变公众号创作主链路。
- 改变前端核心交互。

## 目标

- 引入 LangGraph.js 多 Agent 编排。
- 引入 BullMQ Worker 执行长任务。
- 保持 `apps/service` 作为业务 API 和 SSE 入口。
- 任务进度通过 RunEvent 流式进入前端对话任务卡。
- 最终公众号内容只由 Artifact Builder 保存。

## 非目标

- 不引入 LangGraph Agent Server / Platform。
- 不直接接入微信公众号发布。
- 不做 token 级最终正文流。
- 不开放任意外部工具调用。

## 影响范围

| 范围 | 影响 |
| --- | --- |
| `apps/web` | 中间区域改为对话流、任务卡、追问卡。 |
| `apps/service` | Run API 入队、SSE、Artifact 查询、追问恢复。 |
| `apps/worker` | 新服务，消费 BullMQ 并执行 LangGraph。 |
| `packages/contracts` | 新增 Graph State、AgentOutput、Clarification schema。 |
| PostgreSQL | 新增 graph_runs、agent_tasks、agent_outputs、run_events、checkpoint 表。 |
| Redis | 新增 BullMQ 队列和重试状态。 |
| 文档 | 架构、模块、API、测试和 ADR 已新增。 |

## 目标数据库表

```text
graph_runs
agent_tasks
agent_outputs
run_events
langgraph.checkpoints
langgraph.checkpoint_writes
langgraph.checkpoint_blobs
```

## 实施阶段

### 阶段 1：契约和内存 Graph

- 新增 contracts：
  - `CreationGraphState`
  - `CreativeBrief`
  - `ClarificationRequest`
  - `TitleCandidate`
  - `ArticleOutline`
  - `ArticleDraft`
  - `ImagePlan`
  - `ReviewReport`
  - `AgentTask`
  - `AgentOutput`
- 在 `apps/service/src/creation-graph` 实现内存版 graph runner。
- 不新增生产依赖前先确认 LangGraph 版本和引入方式。

验证：

```bash
pnpm --filter @mediaforge/contracts typecheck
pnpm --filter @mediaforge/service typecheck
pnpm --filter @mediaforge/service test
```

### 阶段 2：RunEvent 投影

- 将 graph node 事件转换为 RunEvent。
- 任务卡可显示多 Agent 节点进度。
- `decision.required` 仅用于 clarification。

验证：

- SSE 收到 step 和 artifact 事件。
- 不出现计划确认事件。

### 阶段 3：Worker 和 BullMQ

- 新增 `apps/worker`。
- 引入 Redis / BullMQ。
- `POST /runs` 创建 Run 后立即返回 queued。
- Worker 消费 `creation-run` job。

验证：

```bash
pnpm --filter @mediaforge/worker typecheck
pnpm --filter @mediaforge/worker test
```

### 阶段 4：PostgreSQL 持久化

- 新增迁移。
- 保存 graph_runs、agent_tasks、agent_outputs、run_events。
- 接入 LangGraph Postgres checkpointer。
- 页面刷新可恢复 Run、任务卡和 Artifact。

验证：

- 数据库迁移测试。
- 断线续传测试。
- Worker 重启恢复测试。

### 阶段 5：前端聊天流

- 中间区域改为消息列表。
- 用户发送后插入用户气泡。
- Agent 可见回复流式显示。
- 任务卡嵌入消息流。
- 追问卡支持快捷选项和自由输入。
- 右侧手机预览只绑定 Artifact。

验证：

- Playwright 截图检查桌面布局。
- 输入、上传、发送、任务卡、预览更新可用。

### 阶段 6：Artifact Guard

- Artifact Builder 增加 schema guard。
- 拦截用户 prompt、执行计划、AI 过程、审阅说明进入正文。
- 失败时进入 revision 或 failed。

验证：

- 污染文本单测。
- 真实生成冒烟。

## 人工确认点

进入代码实现前需要确认：

1. 是否允许新增生产依赖：`@langchain/langgraph`、`bullmq`、Redis 客户端和 LangGraph Postgres checkpoint 相关包。
2. 是否新增 `apps/worker` 工作区。
3. 是否优先做内存 Graph spike，再接数据库迁移。
4. 前端是否按 `docs/assets/langgraph-multi-agent-chat.png` 的交互方向实现。

## 风险

- LangGraph checkpoint 与业务状态可能不一致。
- Worker 重试可能重复创建 Artifact。
- Agent 输出可能混入过程文本。
- 新增 Redis 后本地开发复杂度上升。
- 前端聊天流与现有布局融合需要细调。

## 回滚策略

- 保留现有 conversation-first API。
- Worker 未接通时可回退到当前同步生成。
- LangGraph graph behind feature flag。
- Artifact Builder 失败时不覆盖已有文章版本。

## 文档路由

- ADR：`docs/adr/004-langgraph-bullmq-multi-agent-architecture.md`
- 规格：`docs/specs/004-langgraph-multi-agent-creation-system.md`
- 模块：`docs/modules/creation-graph/README.md`
- API：`docs/api/creation-graph.md`
- 测试方案：`docs/testing/plans/creation-graph.md`
- 测试用例：`docs/testing/cases/creation-graph.md`

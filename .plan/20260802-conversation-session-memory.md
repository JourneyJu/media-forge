# L 级改动计划：公众号会话级上下文管理

## 需求背景

公众号生成工具需要在同一个 `Conversation` 内支持连续创作、补充和修改。当前 Run 主要保存本次用户输入、资源和 Skill，缺少会话级工作记忆；用户后续说“标题更吸引人一点”“第三段加活动时间”时，系统难以稳定基于上一版 Artifact 和当前创作状态继续执行。

本次实现会话级 Working Memory，并在创建 Run 时冻结到 `graph_runs.context_json`。该变更涉及共享契约、数据库 schema、后端持久化、LangGraph 输入和测试，因此属于 L 级。

## 分级结论

```text
需求分级：L
分级理由：新增 conversation_memories 表，扩展 CreationRunContext 和 CreationGraphState，改变 Run 创建与 Worker 上下文读取主链路。
影响面：contracts、PostgreSQL schema、apps/service creation-graph、conversations、测试和文档。
是否需要人工确认：是
```

## 非目标

- 不做跨会话长期记忆。
- 不做向量检索或 RAG。
- 不接入 LangGraph 原生 checkpoint。
- 不实现前端上下文调试视图。
- 不新增生产依赖。
- 不改变微信公众号 HTML renderer 的输出格式。

## 影响面

| 领域 | 是否影响 | 说明 |
| --- | --- | --- |
| 前端 | 否 | 本次以后端能力为主，前端仍通过现有 Conversation / RunEvent / Artifact 工作。 |
| 后端服务 | 是 | Run 创建、追问恢复、Worker GraphState 需要读取 Working Memory。 |
| 共享契约 | 是 | 增加 ConversationWorkingMemory、CreationRunContext.memory。 |
| 数据库 schema | 是 | 新增 `conversation_memories` 表。 |
| 对象存储 | 否 | 不新增对象路径。 |
| Redis / 队列 | 否 | Job payload 保持 ID 和版本信息。 |
| AI 调用链路 | 是 | Agent 可按职责接收会话记忆摘要和 lastArtifactId。 |
| 权限 / 安全 | 是 | Working Memory 不得跨 Conversation 共享，不得保存密钥或模型思维链。 |
| 部署 / 环境变量 | 否 | 不新增环境变量。 |
| 文档 | 是 | 已同步 specs、architecture、modules、testing。 |

## 方案设计

1. 新增 `conversation_memories` 表，以 `conversation_id` 为主键，保存当前会话 Working Memory JSON 和 `context_version`。
2. 扩展共享契约：
   - `ConversationWorkingMemory`
   - `CreationRunContext`
   - `CreationRunContext.memory`
   - `CreationGraphState.memory`
3. 创建 Run 时读取当前 Working Memory，并冻结到 `graph_runs.context_json`。
4. Worker 执行时只读取该 Run 的 `context_json`，并将 `memory` 注入 GraphState。
5. Run 完成后根据 AgentOutput / final Artifact 更新 Working Memory。
6. Clarification 提交后把补充信息写入 Working Memory 的 `userConstraints` 或 `revisionIntent`，并更新 `context_json`。
7. 修改类请求第一阶段使用规则识别，将 `revisionIntent` 和 `lastArtifactId` 放入 RunContext。

## 契约与数据变更

- 新增 `conversation_memories` 数据表。
- 扩展 `packages/contracts/src/creation-graph.ts`。
- 不新增 API 路由。
- 不新增 RunEvent 类型。
- `graph_runs.context_json` 扩展为包含 `memory` 的版本化上下文，向后兼容旧 context：缺失 memory 时按空 Working Memory 处理。

## allowed_files 草案

```yaml
allowed_files:
  - .plan/20260802-conversation-session-memory.md
  - packages/contracts/src/creation-graph.ts
  - packages/contracts/src/creation-graph.test.ts
  - apps/service/src/creation-graph/persistence.ts
  - apps/service/src/creation-graph/worker.ts
  - apps/service/src/creation-graph/graph.ts
  - apps/service/src/creation-graph/agents.ts
  - apps/service/src/creation-graph/*.test.ts
  - apps/service/src/conversations/conversation-lifecycle.ts
  - apps/service/src/conversations/conversation-store.ts
  - apps/service/src/conversations/conversation-store.test.ts
  - apps/service/migrations/*
  - docs/specs/013-conversation-session-memory.md
  - docs/architecture/overview.md
  - docs/architecture/database.md
  - docs/modules/conversations/README.md
  - docs/modules/creation-graph/README.md
  - docs/testing/plans/conversations.md
  - docs/testing/plans/creation-graph.md
  - docs/testing/cases/conversations.md
  - docs/testing/cases/creation-graph.md
verification:
  - pnpm --filter @mediaforge/contracts typecheck
  - pnpm --filter @mediaforge/service test
  - pnpm --filter @mediaforge/service typecheck
  - pnpm typecheck
  - pnpm test
  - pnpm build
```

## 实施步骤

1. 增加契约类型和契约测试。
2. 增加数据库迁移。
3. 增加 persistence 的 Working Memory 读写方法。
4. 创建 Run 时冻结 memory 到 `graph_runs.context_json`。
5. Worker GraphState 注入 memory。
6. Run 完成和追问提交时更新 Working Memory。
7. 增加 conversation / creation-graph 测试。
8. 本地验证通过后提交、推送，随后执行持续集成和部署。

## 验证方案

- 契约 typecheck 和 schema 单测。
- service 单测覆盖：
  - 首轮 Run 完成后写入 Working Memory。
  - 修改类 Turn 的 RunContext 包含 memory 和 `lastArtifactId`。
  - RunContext 冻结后不受后续 Turn 影响。
  - 新 Conversation 不继承旧 Memory。
  - Clarification 提交更新 contextVersion 和 memory。
- 全量 typecheck、test、build。
- 部署后验证健康接口和一次线上冒烟生成。

## 迁移与回滚

迁移：

- 新增 `conversation_memories` 表。
- 旧 Conversation 没有 memory 时按空 Working Memory 处理。
- 首次新 Run 或 Run 完成后可创建 memory。

回滚：

- 代码回滚后旧代码不读取 `conversation_memories`。
- 如需数据库回滚，可删除 `conversation_memories` 表；该表只保存摘要，不是原始事实源。

## 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| Working Memory 被误当正文事实源 | 文章内容被摘要覆盖 | Artifact / ArticleDocument 仍为最终事实源，测试覆盖。 |
| 修改类请求误识别 | 用户想新写却沿用上一版 | 规则中明确“新主题/重新生成”优先 `new_creation`。 |
| 旧 context_json 缺少 memory | Worker 运行失败 | 契约和 persistence 使用空 memory 默认值。 |
| Run 执行中上下文被后续消息污染 | 结果不可复现 | Run 创建时冻结 context_json，Worker 只读 runId 对应快照。 |
| Memory 保存敏感信息 | 安全风险 | 只保存摘要和引用，不保存密钥、token、模型思维链。 |

## AI 自审

```text
AI 自审结论：通过
分级复核：L 级正确，涉及 schema、契约和主链路。
服务边界：不新增服务，不改变前端直连边界；Worker 仍从 PostgreSQL 读 RunContext。
契约与数据：需要扩展 contracts 和新增 conversation_memories；旧 context 缺失 memory 需兼容。
异常路径：Redis 不可用仍由 outbox 保证；memory 写入失败应随 Run 完成事务失败或明确回滚。
安全风险：Working Memory 不保存密钥、token、思维链；不跨 Conversation 共享。
测试方案：覆盖 contracts、service、Graph、全量 typecheck/test/build。
反方意见：可以只拼接历史消息，但会导致 token 膨胀、不可控污染和难复现。
需要人工重点看的问题：第一阶段规则识别修改意图是否足够；是否接受 conversation_memories 表作为摘要表。
```

## 人工确认

```text
审核结论：已确认
确认人：用户
确认时间：2026-08-02
备注：用户明确要求“开始实施，本地验证通过后再走持续集成和部署”。
```

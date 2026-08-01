# L 级改动计划：LangGraph 多 Agent 生产化补全

## 需求背景

项目已确认采用 ADR 004 的 `LangGraph.js + BullMQ Worker` 方案，但当前公众号创作主链路仍调用旧同步 `agent-runs`。Redis Docker 容器尚未实际启动，Conversation API 未入队，Worker 未读取真实上下文，Graph 节点多数是固定模板，最终文章存在用户原始提示词进入标题和正文的问题。

本计划用于将现有骨架补全为单一、可恢复、可审计的多 Agent 商用主链路。

## 分级结论

```text
需求分级：L
分级理由：修改主执行链路、服务边界、数据库 schema、队列、AI 调用链路和前端实时事件
影响面：apps/web、apps/service、apps/worker、packages/contracts、PostgreSQL、Redis、Model Gateway、文档和测试
是否需要人工确认：是
```

## 非目标

- 不接入微信公众号直接发布。
- 不使用 LangGraph Agent Server / Platform。
- 不展示模型原始思维链。
- 不允许任意外部工具调用。
- 不进行模型微调。
- 不在本阶段实现 token 级最终公众号正文写入预览。

## 影响面

| 领域 | 是否影响 | 说明 |
| --- | --- | --- |
| 前端 | 是 | 真实任务事件、Agent 阶段、追问恢复和断线续传 |
| 后端服务 | 是 | Run 创建、入队、SSE、Artifact 查询和健康检查 |
| Worker | 是 | 新增独立运行单元，消费 BullMQ 并执行 LangGraph |
| 共享契约 | 是 | Brief、标题、草稿、审校、事件和 Job schema |
| 数据库 schema | 是 | graph runs、tasks、outputs、events、outbox、checkpoint |
| 对象存储 | 是 | 保存 HTML 和脱敏模型快照 |
| Redis / 队列 | 是 | BullMQ、锁、重试和事件短期通知 |
| AI 调用链路 | 是 | 多 Agent 结构化调用、审校和 Revision |
| 权限 / 安全 | 是 | Worker 上下文范围、输出脱敏、Artifact Guard |
| 部署 / 环境变量 | 是 | Redis、Worker、Model Gateway 和 engine flag |
| 文档 | 是 | 架构、模块、API、测试、runbook 和 ADR 路由 |

## 方案设计

采用单一目标链路：

```text
apps/web
→ apps/service 创建 queued Run 和 Outbox
→ Redis / BullMQ
→ apps/worker 执行 LangGraph
→ PostgreSQL 保存 AgentTask / AgentOutput / RunEvent
→ Artifact Builder 创建 ArticleVersion
→ apps/service SSE 推送
→ apps/web 更新任务卡和手机预览
```

职责：

- `apps/service`：权限、配额、Run、入队、事件读取、SSE 和 Artifact API。
- `apps/worker`：上下文加载、LangGraph、Model Gateway、Agent 输出、Revision 和 Artifact Builder。
- PostgreSQL：所有不可丢失业务事实。
- Redis：队列、锁、重试和短期事件通知。
- MinIO / S3：素材、HTML 和脱敏快照。

详细规格见 `docs/specs/006-langgraph-multi-agent-production-completion.md`。

## 契约与数据变更

共享契约：

- `CreativeBrief` 分离 `subject`、受众、目标、风格、素材和约束。
- `TitleCandidates` 支持候选、评分和 `selectedId`。
- `ArticleOutline` 描述故事线、商业结构和素材位置。
- `ArticleDraft` 只保存可发布内容。
- `ImagePlan` 描述封面、正文图和组图。
- `ReviewReport` 支持分项评分和定向 Revision。
- `ArtifactValidationResult` 支持污染和结构校验。
- `CreationRunJob` 增加 `contextVersion`。
- RunEvent 增加真实任务、Assistant 和 Clarification 事件。

数据库：

```text
graph_runs
agent_tasks
agent_outputs
run_events
run_dispatch_outbox
langgraph.checkpoints
langgraph.checkpoint_writes
langgraph.checkpoint_blobs
```

数据库迁移必须可回滚；新表先增不删，旧链路在灰度期间保留。

## allowed_files 草案

阶段 1：

```yaml
task: 基础设施和健康检查
allowed_files:
  - infra/docker/docker-compose.yml
  - apps/service/.env.example
  - apps/service/src/health/*
  - apps/worker/*
  - docs/runbooks/local-dev.md
verification:
  - docker compose -f infra/docker/docker-compose.yml config
  - docker exec mediaforge-redis redis-cli ping
```

阶段 2：

```yaml
task: 契约和数据库
allowed_files:
  - packages/contracts/src/creation-graph.ts
  - packages/contracts/src/conversations.ts
  - packages/contracts/src/articles.ts
  - apps/service/src/persistence/*
  - apps/service/migrations/*
  - docs/architecture/database.md
verification:
  - pnpm --filter @mediaforge/contracts typecheck
  - pnpm --filter @mediaforge/service typecheck
```

阶段 3：

```yaml
task: Run 入队和 Worker 主链路
allowed_files:
  - apps/service/src/conversations/*
  - apps/service/src/http.ts
  - apps/service/src/queues/*
  - apps/worker/*
  - apps/service/package.json
  - package.json
verification:
  - pnpm --filter @mediaforge/service test
  - pnpm --filter @mediaforge/worker test
```

阶段 4：

```yaml
task: 前端实时任务和恢复
allowed_files:
  - apps/web/app/page.tsx
  - apps/web/app/globals.css
  - apps/web/src/*
  - packages/contracts/src/conversations.ts
verification:
  - pnpm --filter @mediaforge/web typecheck
  - Playwright 对话任务流验证
```

如果实施中需要修改未声明文件，必须先更新本计划的对应阶段。

## 实施步骤

1. 启动 Docker 基础设施，验证 Redis、PostgreSQL 和 MinIO。
2. 更新共享契约，禁止原始用户消息直接成为主题、标题或正文。
3. 新增数据库迁移、repository、Outbox 和 checkpoint。
4. 将 Conversation Run API 从旧同步执行切换为 queued Run + BullMQ。
5. 创建独立 `apps/worker`，从 PostgreSQL 加载真实 Conversation 上下文。
6. 实现 Brief、Title、Outline、Writer、Image、Review、Revision 节点。
7. 实现 Artifact Builder 和污染 Guard。
8. 实现 PostgreSQL 事件回放、Redis 通知和 SSE 实时推送。
9. 接通前端任务卡、Assistant 消息、Clarification 和页面恢复。
10. 使用 feature flag 灰度，验收后删除 legacy 链路。

## 验证方案

类型检查：

```bash
pnpm --filter @mediaforge/contracts typecheck
pnpm --filter @mediaforge/service typecheck
pnpm --filter @mediaforge/worker typecheck
pnpm --filter @mediaforge/web typecheck
```

自动化测试：

```bash
pnpm --filter @mediaforge/service test
pnpm --filter @mediaforge/worker test
pnpm --filter @mediaforge/web test
pnpm test
```

集成验证：

- API 创建 Run 后立即返回 `queued`。
- BullMQ 中存在以 `runId` 为 jobId 的任务。
- Worker 能读取真实 Conversation 消息和资源。
- Agent 节点在执行期间产生 RunEvent。
- Redis 通知丢失时可从 PostgreSQL 补回。
- SSE 使用 `Last-Event-ID` 断线续传。
- Worker 重试不会重复创建 Artifact。

内容验证：

- 标题不等于用户完整输入。
- 标题至少来自三个候选之一。
- 正文不包含“帮我写一篇”“要求如下”等用户指令。
- 正文不包含执行计划、审校报告和 AI 过程。
- Review 不通过时进入 Revision，最多两轮。
- Guard 失败时不创建 ArticleVersion。

UI 验证：

- 用户消息立即出现。
- 任务卡显示真实七阶段进度。
- Assistant 可见消息流式显示。
- 追问卡提交后恢复任务。
- Artifact 创建后更新手机预览。
- 任务完成后任务卡收起。

## 迁移与回滚

迁移：

- 新表先增不删，不修改旧数据。
- 新 Run 通过 `CREATION_ENGINE` 选择引擎。
- `langgraph` Run 和 `legacy` Run 使用同一 Artifact 幂等边界。
- 默认不自动从 `langgraph` 回退到 `legacy`。

回滚：

- 灰度异常时将 `CREATION_ENGINE=legacy`，仅影响后续新 Run。
- 已进入 LangGraph 的 Run 保持原状态，不由 legacy 接管。
- 数据库新表保留，避免破坏审计和恢复数据。
- Artifact Builder 不覆盖已有 ArticleVersion。

## 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| Redis 未启动 | Run 无法入队 | 健康检查、明确 503、Outbox 重派 |
| Worker 未运行 | Run 长期 queued | Worker 健康监控和 queued 超时告警 |
| 数据库提交后入队失败 | 任务丢失 | Transactional Outbox |
| Worker 重复消费 | 重复 Artifact | runId、AgentTask 和 Artifact 幂等 |
| Graph checkpoint 与 Run 不一致 | 无法恢复 | PostgreSQL Run 为事实源，checkpoint 只用于执行恢复 |
| 模型输出不符合 schema | 节点失败 | 严格解析、有限修复和明确错误码 |
| 用户提示词进入正文 | 发布污染 | Brief 隔离、Writer 输入边界、Artifact Guard |
| SSE 通知丢失 | 前端进度缺失 | RunEvent 持久化、Last-Event-ID 回放 |
| Demo 被误认为正式结果 | 质量误判 | 显式 MODEL_MODE，生产禁止 Demo |
| Revision 无限循环 | 成本失控 | policy 限制最多两轮 |

## AI 自审

```text
AI 自审结论：通过
分级复核：L 级，涉及主链路、服务、schema、基础设施和 AI 编排。
服务边界：apps/service 与 apps/worker 职责已分离；前端不访问 Redis、数据库或模型。
契约与数据：原始输入、Brief、标题、草稿、审校和 Artifact 已分层；PostgreSQL 是事实源。
异常路径：覆盖 Redis、Worker、入队、模型、SSE、重复消费和 Guard 失败。
安全风险：不展示思维链；不把密钥、完整 prompt 或 raw output进入事件和正文。
测试方案：覆盖 contract、unit、integration、SSE、故障恢复、内容污染和 UI。
反方意见：先只修标题更快，但会保留双链路和伪多 Agent，后续仍需重构主链路。
需要人工重点看的问题：确认创建独立 apps/worker；确认生产环境禁止自动 Demo 回退。
```

## 人工确认

```text
审核结论：已确认并实施
确认人：用户
确认时间：2026-07-27
备注：用户明确要求“开始实施”。主链路、追问恢复、刷新恢复和独立 Worker 已完成；原生 PostgreSQL checkpoint、Redis Pub/Sub 与 MinIO 脱敏快照列为后续增强。
```

## 实施结果

- PostgreSQL、Redis、MinIO 容器已启动并验证。
- 共享契约、数据库迁移、Transactional Outbox、BullMQ Queue 和独立 Worker 已落地。
- 多 Agent 结构化生成、Review / Revision 与 Artifact Guard 已落地。
- 对话 SSE、任务卡、追问恢复、刷新恢复和手机预览已通过真实浏览器验证。
- `pnpm typecheck`、串行 `pnpm test` 和 `pnpm build` 已通过。

# L 级改动计划：多 Agent 流式过程反馈

## 需求背景

用户在模型长时间执行期间只能看到一条 Assistant 提示，无法判断系统是否仍在工作；部分失败路径还会让页面在没有结果的情况下结束。目标是在对话任务卡中流式展示安全推理摘要、阶段、耗时、校验和重试，完成后全部收起。

## 分级结论

```text
需求分级：L
分级理由：修改模型调用方式、Worker 事件链路、共享事件契约、SSE 投影和前端状态模型。
影响面：contracts、Service、Worker、PostgreSQL RunEvent、SSE、Web UI、测试和文档。
是否需要人工确认：是
```

## 非目标

- 不展示模型原始思维链。
- 不让浏览器直连模型供应商。
- 不把流式草稿作为文章事实源。
- 不引入 WebSocket、新消息队列或新生产依赖。
- 不改变现有多 Agent 节点职责和 Artifact schema。

## 影响面

| 领域 | 是否影响 | 说明 |
| --- | --- | --- |
| 前端 | 是 | Agent 过程面板、流式 reducer、超时提示和自动折叠 |
| 后端服务 | 是 | RunEvent SSE 兼容新增事件 |
| 共享契约 | 是 | 新增 Agent progress/reasoning/heartbeat 事件 payload |
| 数据库 schema | 否（首选） | 复用 `run_events` JSON；实施时确认索引和容量 |
| 对象存储 | 否 | 不保存流式文本对象 |
| Redis / 队列 | 是 | Worker 生命周期和恢复扫描；Redis 不作为事件事实源 |
| AI 调用链路 | 是 | OpenAI-compatible stream、缓冲、校验和回退 |
| 权限 / 安全 | 是 | 推理摘要脱敏、限长和禁止项 |
| 部署 / 环境变量 | 是 | 新增超时、heartbeat、事件限长配置 |
| 文档 | 是 | ADR、规格、模块、API 和测试文档 |

## 方案设计

采用“模型流 → Worker 安全转换 → PostgreSQL RunEvent → SSE → Agent 过程面板”。模型 `content` 在服务端缓冲为完整 JSON；`reasoning_content` 只作为模型活跃信号，由 Worker 映射为 Agent 业务摘要。不支持 reasoning 的模型发送真实阶段状态和 heartbeat。

任务完成后前端折叠全部 Agent；失败 Agent 保持展开。只有业务终态事件可以结束 UI 等待状态。

## 契约与数据变更

- 扩展 `RunEventType`：`agent.started`、`agent.progress`、`agent.reasoning.delta`、`agent.reasoning.completed`、`agent.output.validating`、`agent.retry.started`、`agent.completed`、`agent.failed`、`run.heartbeat`。
- 新增 `AgentProgressPayload` schema。
- 保持 `GET /runs/:runId/events` 和 `Last-Event-ID` 兼容。
- 首选不改数据库 schema；复用 `run_events.payload_json`。
- 每个 Agent 只持久化平台生成的阶段和业务摘要，不保存供应商原始 reasoning 增量。

## allowed_files 草案

```yaml
allowed_files:
  - packages/contracts/src/conversations.ts
  - packages/contracts/src/creation-graph.ts
  - packages/contracts/src/*.test.ts
  - apps/service/src/model-gateway.ts
  - apps/service/src/model-gateway.test.ts
  - apps/service/src/creation-graph/worker.ts
  - apps/service/src/creation-graph/worker.test.ts
  - apps/service/src/creation-graph/persistence.ts
  - apps/service/src/creation-graph/persistence.test.ts
  - apps/service/src/http.ts
  - apps/web/app/page.tsx
  - apps/web/app/globals.css
  - apps/web/app/lib/conversations-api.ts
  - docs/specs/016-streaming-agent-progress.md
  - docs/adr/011-safe-agent-reasoning-stream.md
  - docs/modules/creation-graph/README.md
  - docs/modules/conversations/README.md
  - docs/modules/chat-workspace/README.md
  - docs/api/creation-graph.md
  - docs/api/conversations.md
  - docs/testing/plans/creation-graph.md
  - docs/testing/plans/chat-workspace.md
  - docs/testing/cases/creation-graph.md
  - docs/testing/cases/chat-workspace.md
verification:
  - pnpm --filter @mediaforge/contracts typecheck
  - pnpm --filter @mediaforge/service typecheck
  - pnpm --filter @mediaforge/web typecheck
  - pnpm --filter @mediaforge/service test
  - pnpm test
  - pnpm build
```

如果实施中需要数据库迁移、引入依赖或修改其他文件，必须先更新本计划并重新确认。

## 实施步骤

1. 扩展共享事件 schema 和兼容测试。
2. 为 Model Gateway 增加流式 chunk 解析、结构化内容缓冲和非流式回退。
3. 为 Worker 增加阶段回调、安全摘要映射、heartbeat 和终态兜底。
4. 更新 RunEvent SSE 映射和断线回放。
5. 在 Chat Workspace 增加 Agent 过程面板、增量归并、停滞提示和自动折叠。
6. 增加运行超时与失联 Run 恢复扫描；若需要新调度机制，先回到计划确认。
7. 完成单测、集成测试、Playwright 和生产模型冒烟验证。

## 验证方案

- Contract：新增事件和 payload 正反例。
- Gateway：reasoning/content 分片、非法 chunk、非流式回退、schema 重试和 token 汇总。
- Worker：安全摘要映射、heartbeat、限长、唯一终态和异常退出。
- SSE：顺序、`Last-Event-ID`、断线重连、未知事件兼容。
- UI：当前 Agent 自动展开、20 秒等待提示、完成全收起、失败保持展开。
- E2E：正常生成、长推理、schema 重试、模型超时、SSE 断线、Worker 重启和页面刷新。
- 安全：事件和日志不包含 prompt、Skill 完整指令、密钥、raw JSON 或原始思维链。

## 迁移与回滚

- 新事件为向后兼容扩展，旧客户端忽略未知事件。
- 新前端没有收到新事件时回退到现有任务卡。
- 通过 feature flag 分阶段开启模型流式和前端过程面板。
- 回滚时关闭流式 flag，继续使用现有非流式网关与节点事件。
- 不改变 Artifact 和 ArticleVersion，可独立回滚 UI 和事件生产。

## 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| reasoning 泄露敏感信息 | 安全事故 | 不透传原始内容；脱敏、限长、allowlist 和测试门禁 |
| RunEvent 写放大 | PostgreSQL 压力 | 每 Agent 仅写一次推理摘要，阶段变化和心跳单独限频 |
| 模型流协议不一致 | 某供应商失败 | 能力声明和适配器；失败回退非流式阶段事件 |
| JSON 分片被前端误用 | 半成品污染 | content 只在服务端缓冲，完整校验后进入 AgentOutput |
| Worker 中断 | Run 永久 running | heartbeat、租约检查、超时扫描和唯一终态 |
| SSE 重连重复摘要 | UI 重复文本 | Run event_no + step sequence 双重去重 |
| 长文本影响体验 | 对话区膨胀 | 当前节点限高滚动，完成后自动折叠 |

## AI 自审

```text
AI 自审结论：通过
分级复核：L，AI 调用链路、事件契约和前端状态均发生系统级变化。
服务边界：保持 Browser → Web → Service → Worker/Model Gateway，不新增直连。
契约与数据：扩展 RunEvent；首选不改 schema，实施时需验证容量和索引。
异常路径：覆盖模型超时、无 reasoning、非法 chunk、schema 重试、Worker 中断和 SSE 断线。
安全风险：明确禁止原始思维链、prompt、Skill 指令和凭据进入用户事件。
测试方案：包含 contract、unit、integration、SSE、UI、E2E 和生产冒烟。
反方意见：只加 loading 文案成本更低，但无法证明任务存活或解释校验与失败阶段。
需要人工重点看的问题：事件保留周期、默认超时和 feature flag 发布节奏。
```

## 人工确认

```text
审核结论：已确认
确认人：用户
确认时间：2026-08-03
备注：用户明确要求“落地”，同意按本计划进入代码实施。
```

## 实施结果

```text
实施状态：已实现并于 2026-08-03 部署，应用提交 041a8c8
契约：新增 agent.* 与 run.heartbeat 事件及 Agent 进度字段
后端：完成模型流解析、非流式回退、结构校验重试、安全业务摘要映射、心跳和 Run 超时
前端：完成当前 Agent 自动展开、增量摘要、耗时/重试显示、成功自动收起和失败保留展开
数据库迁移：无
新增生产依赖：无
验证：workspace typecheck、test、build 均通过
部署验证：/health、/auth/password-key、/login 均返回 200，应用容器运行且重启次数为 0
未验证：登录态浏览器 E2E 与部署环境真实模型生成流程，留待人工验收
```

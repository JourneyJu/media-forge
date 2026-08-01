# L 级改动计划：Conversation-first 后端重构

> 生命周期修订：会话创建、资源归属、历史排序和删除边界已由 `.plan/20260727-conversation-lifecycle-resource-ownership.md` 接管。本文仅保留早期 Conversation / Run / Artifact 分层背景，不再作为这些能力的实施依据。

## 需求背景

当前前端交互已经确定为工作空间侧栏、中央对话输入、右侧手机预览和计划条确认。现有后端以 `AgentRun` 内存 store 和单次生成请求为主，无法系统性支撑真实会话、当前上下文、资源绑定、刷新恢复、文章产物和后续追问。需要按 conversation-first 架构重构后端。

## 分级结论

```text
需求分级：L
分级理由：涉及共享契约、后端主链路、数据库 schema、AI 编排、API 形态和前端调用迁移。
影响面：apps/web、apps/service、packages/contracts、docs、PostgreSQL、MinIO/S3、后续 Redis/队列。
是否需要人工确认：是
```

## 非目标

- 本计划确认前不进入编码实现。
- 第一阶段不接入微信公众号发布。
- 第一阶段不做 token 级流式；Run 事件流阶段使用 SSE。
- 第一阶段不实现多人协作。
- 第一阶段不删除旧 `agent-runs` 兼容接口。

## 影响面

| 领域 | 是否影响 | 说明 |
| --- | --- | --- |
| 前端 | 是 | 调用 conversation-first API，恢复 run 和 artifact。 |
| 后端服务 | 是 | 新增 conversations/runs/artifacts 模块和 orchestrator。 |
| 共享契约 | 是 | 新增 conversations、runs、artifacts 类型。 |
| 数据库 schema | 是 | 新增 conversations、messages、resources、runs、steps、decisions、artifacts。 |
| 对象存储 | 是 | 保存 HTML、prompt、raw output 快照。 |
| Redis / 队列 | 后续 | 异步 runner 第一阶段可用本进程，产品化后切 Redis queue。 |
| AI 调用链路 | 是 | Brief、追问、计划、写作、审阅、渲染分阶段。 |
| 权限 / 安全 | 是 | conversation/run/artifact 权限、幂等和密钥隔离。 |
| 部署 / 环境变量 | 否 | 第一阶段不新增模型环境变量。 |
| 文档 | 是 | 新增规格、模块、API、测试文档。 |

## 方案设计

采用 `Conversation-first + Run Orchestrator + Artifact 输出`。

```text
Workspace
→ Conversation
  → Message / Resource
  → Run
    → Plan / Step / Decision
    → Artifact
      → ArticleVersion
```

核心原则：

- Conversation 是当前上下文边界。
- Run 是任务边界。
- Artifact 是结果边界。
- ArticleVersion 是可恢复边界。
- WorkspaceMemory 是长期偏好边界，不自动污染所有对话。

## 契约与数据变更

目标 contracts：

- `packages/contracts/src/conversations.ts`
- `packages/contracts/src/runs.ts`
- `packages/contracts/src/artifacts.ts`

目标数据库表：

- `conversations`
- `conversation_messages`
- `conversation_resources`
- `runs`
- `run_steps`
- `run_decisions`
- `artifacts`
- `run_events`

迁移前必须同步 `docs/architecture/database.md` 并补回滚方案。

## allowed_files 草案

```yaml
allowed_files:
  - packages/contracts/src/conversations.ts
  - packages/contracts/src/runs.ts
  - packages/contracts/src/artifacts.ts
  - packages/contracts/src/index.ts
  - apps/service/src/conversations/**
  - apps/service/src/runs/**
  - apps/service/src/artifacts/**
  - apps/service/src/http.ts
  - apps/web/app/page.tsx
  - apps/web/app/lib/**
  - docs/**
verification:
  - pnpm --filter @mediaforge/contracts typecheck
  - pnpm --filter @mediaforge/service typecheck
  - pnpm --filter @mediaforge/web typecheck
  - pnpm test
```

## 实施步骤

1. contracts：新增 Conversation、Message、Resource、Run、RunStep、RunDecision、Artifact 类型和 schema。
2. service：新增 repository 接口，先用内存实现保持开发速度，再切 PostgreSQL。
3. service：新增 conversation API，支持创建、读取、追加消息、绑定资源。
4. service：新增 run API，迁移现有 AgentRun 计划和确认逻辑。
5. service：新增 artifact service，run 完成后保存 artifact 并关联 article version。
6. web：把当前发送按钮改为创建 conversation/message/run。
7. web：计划条读取 run，手机预览读取 artifact。
8. 数据库：设计迁移和回滚，替换内存 repository。
9. 新增 run_events 和 `GET /runs/:id/events` SSE。
10. 将 run 执行从同步返回改为 async runner，事件驱动前端计划条。
11. 后续：接入追问、资源识别、Redis worker。

## 验证方案

- contracts typecheck 和 schema 单测。
- service 单测覆盖状态机、幂等、权限和 artifact 创建。
- web typecheck。
- 集成测试覆盖创建会话、发送消息、创建 run、确认计划、生成 artifact。
- 手动验证刷新恢复、无假会话、手机预览真实产物。
- SSE 验证 run.created、step.started、step.completed、decision.required、artifact.created、run.completed。
- 断线后通过 `after` 补发遗漏事件。

## 迁移与回滚

- 第一阶段保留旧 `POST /agent-runs`，新增 API 并行。
- 前端切换到新 API 后观察一轮，再标记旧 API deprecated。
- 数据库迁移使用新增表，不破坏现有文章表。
- 回滚时前端可临时切回旧 agent-run API。

## 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 一次改动过大 | 代码堆叠、回归困难 | 按阶段拆分，先 contracts 和 repository 边界。 |
| 状态机复杂 | run 卡死或重复执行 | 显式状态、lockVersion、幂等键、单测覆盖。 |
| 上下文污染 | 生成结果不符合当前对话 | Conversation 只读取自身消息和资源。 |
| 模型输出不可信 | 保存坏版本 | schema 校验失败不创建 artifact。 |
| 长任务超时 | 用户体验差 | 先引入 SSE + async runner，后续切 Redis worker。 |
| 事件丢失 | 前端状态不一致 | run_events 入库，SSE 支持 after/Last-Event-ID 续传。 |
| 流式泄密 | 安全风险 | 事件 payload 只允许展示摘要，不包含 raw prompt/output。 |

## AI 自审

```text
AI 自审结论：通过
分级复核：L 级，涉及契约、schema、后端主链路和 AI 编排。
服务边界：仍保持 apps/web → apps/service → PostgreSQL/MinIO/Redis/Model Gateway。
契约与数据：需新增 contracts 和数据库表，旧 AgentRun 保留兼容期。
异常路径：覆盖版本冲突、幂等重复、模型输出非法、任务失败、越权访问。
安全风险：前端不得传模型密钥；prompt/raw output 需脱敏后入对象存储。
测试方案：有单测、集成、手动和回归范围。
反方意见：方案比继续补 AgentRun 更重；但能避免后续会话、资源、产物逻辑堆叠。
需要人工重点看的问题：第一阶段是否允许先用内存 repository 过渡，还是直接上 PostgreSQL。
```

## 人工确认

```text
审核结论：待确认
确认人：
确认时间：
备注：
```

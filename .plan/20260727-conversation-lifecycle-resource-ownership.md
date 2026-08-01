# L 级改动计划：会话生命周期与资源归属重构

## 需求背景

当前实现和文档把用户可见的“工作空间”、机构级 `Workspace`、创作 `Conversation` 混在一起，并要求前端先创建一个空 Conversation。该设计会产生默认工作空间、空历史记录、资源无法归属、删除边界不完整和多段 API 部分成功等问题。

目标产品行为已经明确：

- 用户每次进入创作页都看到一个前端本地空会话，不自动创建后端数据，也不自动打开最近历史。
- 只有首次请求成功进入后端后，才创建 Conversation 并出现在历史列表。
- 用户可见的“创作空间”就是 Conversation；会话是消息、资源、Run、产物和文章数据的最小删除单元。
- 首条用户 prompt 原文作为历史标题；列表按最后一次成功接收用户请求的时间倒序。
- 上传资源立即持久化到对象存储，发送后资源随用户消息展示并永久归属当前 Conversation。
- 消息一旦发送不可单独修改或删除，只能删除整个 Conversation。

## 分级结论

```text
需求分级：L
分级理由：修改核心会话创建链路、API、数据库 schema、对象存储布局、删除语义和前端恢复行为。
影响面：apps/web、apps/service、apps/worker、packages/contracts、PostgreSQL、MinIO、Redis 队列、文档和测试。
是否需要人工确认：是
```

## 非目标

- 不在本次实现机构、门店或品牌资料管理后台。
- 不允许消息级删除、消息级编辑或已发送资源解绑。
- 不实现跨 Conversation 共享同一个 Asset 业务记录。
- 不把 MinIO bucket 设为公开，不让浏览器持有对象存储凭据。
- 不改变 LangGraph 多 Agent 节点结构和文章内容生成策略。
- 不把 AI 原始思维链写入消息或事件。

## 影响面

| 领域 | 是否影响 | 说明 |
| --- | --- | --- |
| 前端 | 是 | 本地空会话、历史列表、首次发送、资源缩略图、删除会话 |
| 后端服务 | 是 | UploadSession、Turn 原子写入、历史排序、会话聚合删除 |
| Worker | 是 | 会话删除任务、对象清理和幂等重试 |
| 共享契约 | 是 | Conversation、Turn、Resource、UploadSession 和错误码 |
| 数据库 schema | 是 | 会话归属、消息资源关系、上传暂存、删除 Outbox |
| 对象存储 | 是 | 资源原图和预览图的稳定 key、会话删除清理 |
| Redis / 队列 | 是 | 删除任务和暂存资源清理调度，不保存业务事实 |
| AI 调用链路 | 间接影响 | Run 从原子写入后的 Conversation 上下文读取 |
| 权限 / 安全 | 是 | 用户归属、资源越权、文件校验、删除授权 |
| 部署 / 环境变量 | 是 | 复用现有 MinIO / S3 配置 |
| 文档 | 是 | 架构、ADR、模块、API、数据库和测试 |

## 方案设计

### 领域边界

用户界面中的“创作空间”和“历史会话”统一映射为 `Conversation`。机构级品牌上下文不出现在历史列表，也不能通过创建默认 Conversation 实现。

```text
前端本地空会话（无 ID，不持久化）
  └─ 首次发送成功
      └─ Conversation（用户可见创作空间、删除聚合根）
          ├─ ConversationMessage（只追加）
          ├─ Resource / MessageResource
          ├─ Run / RunEvent / AgentTask / AgentOutput
          ├─ Artifact
          └─ Article / ArticleVersion
```

### 页面进入

1. 前端初始化 `conversationId = null`、空消息和空输入。
2. 后台加载历史 Conversation 列表，但不自动激活任何一条。
3. 用户点击历史记录时才加载对应 Conversation。
4. 用户点击“新建创作”只重置前端本地状态，不调用后端创建接口。

### 上传暂存

资源可能先于 Conversation 存在，因此使用用户级 `UploadSession`：

```text
POST /upload-sessions
→ POST /upload-sessions/:id/resources
→ Service 校验并流式写入 MinIO
→ PostgreSQL 保存 staged Resource
→ 前端显示本地/服务端缩略图
```

UploadSession 不进入历史列表。未发送的暂存资源默认保留 24 小时，过期后由清理任务删除对象和记录。

### 首次发送

`POST /conversations` 不再创建空壳，而是接收首次 Turn：

```text
验证 idempotencyKey、prompt 和 staged resources
→ 单个 PostgreSQL transaction
  → 创建 Conversation
  → title = 首条 prompt 原文
  → created_at = last_interaction_at = 首次请求接收时间
  → 创建不可变 user Message
  → 将 staged Resources 绑定到 Conversation 和 Message
  → context_version + 1
  → 创建 queued Run 和 dispatch outbox
  → UploadSession 标记 consumed
→ 返回 Conversation、Message、Resources 和 Run
```

对象已经在 MinIO 中，因此数据库事务失败时资源仍保持 staged，可使用同一幂等键重试，不产生空 Conversation。

### 后续发送

`POST /conversations/:conversationId/turns` 在一个事务中追加用户消息、绑定本次资源、递增上下文版本、创建 Run / Outbox，并只在成功后更新 `last_interaction_at`。Worker 输出、AI 消息、预览刷新和后台任务不得改变历史排序。

### 消息和资源展示

- 用户消息展示 prompt 和本次绑定资源。
- 缩略图固定 `44 × 44`，最多展示 4 张，超过后显示 `+N`。
- 点击缩略图或 `+N` 打开资源查看层。
- 发送前资源可移除；发送成功后消息和资源关系不可编辑。
- Assistant 可见消息在 SSE 中流式输出，完成后保存为不可变 `ConversationMessage`。
- RunEvent 保存可恢复增量，不替代最终 Message 事实。

### 会话删除

删除采用“立即从列表隐藏、后台可靠清理、最终硬删除”：

```text
DELETE /conversations/:id
→ transaction:
  → Conversation status = deleting
  → 记录 conversation_deletion_outbox 和全部 object keys
→ API 返回 202，列表不再返回该会话
→ Worker 幂等删除 MinIO 对象
→ transaction 硬删除整个 Conversation 聚合
```

清理失败时保持 `deleting` 并重试，不把已删除会话重新展示给用户。消息和资源不提供独立 DELETE API。

## 契约与数据变更

### Conversation

```text
id
ownerId
title
status: active | deleting
contextVersion
createdAt
lastInteractionAt
```

`title` 保存首条 prompt 原文；前端只做单行省略显示，不覆盖存储值。`lastInteractionAt` 只在成功接收用户 Turn 时更新。

### 新增或调整表

```text
conversations
conversation_messages
upload_sessions
resources
message_resources
conversation_deletion_outbox
```

关键约束：

- 历史列表中的 Conversation 必须至少存在一条 `role=user` 消息。
- `conversations.created_at` 与首条用户消息的 `created_at` 使用同一事务时间。
- `message_resources(message_id, resource_id)` 唯一。
- attached Resource 只能属于一个 Conversation。
- Conversation 删除时级联删除其 PostgreSQL 聚合数据。
- `conversation_deletion_outbox.conversation_id` 唯一，删除任务幂等。

### 对象存储路径

上传时 Conversation 尚不存在，对象 key 不依赖 Conversation：

```text
tenants/{tenantId}/users/{userId}/resources/{resourceId}/original
tenants/{tenantId}/users/{userId}/resources/{resourceId}/preview
```

Service 生成并校验 key。浏览器通过鉴权后的 `/resources/:id/content` 和 `/resources/:id/preview` 读取，不直接访问管理凭据。

### 目标 API

```text
POST   /upload-sessions
POST   /upload-sessions/:uploadSessionId/resources
DELETE /upload-sessions/:uploadSessionId/resources/:resourceId

POST   /conversations
GET    /conversations
GET    /conversations/:conversationId
PATCH  /conversations/:conversationId
DELETE /conversations/:conversationId
POST   /conversations/:conversationId/turns

GET    /resources/:resourceId/content
GET    /resources/:resourceId/preview
GET    /runs/:runId/events
```

所有写接口使用 `idempotencyKey`。废弃“先创建空 Conversation、再单独写消息、再单独绑资源、再单独建 Run”的前端主链路。

## 依赖选型

目标实现建议在 `apps/service` 新增 `@aws-sdk/client-s3`：

- 原因：MinIO 与正式 S3 兼容，支持流式 PutObject/GetObject/DeleteObjects。
- 替代方案：`minio` SDK 更直接，但迁移到云 S3 时耦合更高。
- 不采用：手写 AWS Signature V4，安全和维护成本不可接受。
- 不新增 multipart parser；单资源上传使用原始二进制请求体。

新增生产依赖必须在实施前由人工确认。

## allowed_files 草案

```yaml
allowed_files:
  - packages/contracts/src/conversations.ts
  - packages/contracts/src/assets.ts
  - packages/contracts/src/articles.ts
  - packages/contracts/src/*.test.ts
  - apps/service/package.json
  - apps/service/src/migrate.ts
  - apps/service/src/maintenance-worker.ts
  - apps/service/src/main.ts
  - apps/service/migrations/*
  - apps/service/src/conversations/*
  - apps/service/src/assets/*
  - apps/service/src/creation-graph/artifact-builder.ts
  - apps/service/src/creation-graph/artifact-builder.test.ts
  - apps/service/src/queues/*
  - apps/service/src/http.ts
  - apps/worker/src/*
  - apps/web/app/page.tsx
  - apps/web/app/globals.css
  - apps/web/next.config.ts
  - apps/web/app/lib/*
  - docs/architecture/overview.md
  - docs/architecture/database.md
  - docs/modules/conversations/README.md
  - docs/modules/assets/README.md
  - docs/modules/chat-workspace/README.md
  - docs/modules/workspaces/README.md
  - docs/modules/articles/README.md
  - docs/api/conversations.md
  - docs/api/assets.md
  - docs/api/workspaces.md
  - docs/api/articles.md
  - docs/testing/plans/conversations.md
  - docs/testing/cases/conversations.md
  - docs/testing/plans/assets.md
  - docs/testing/cases/assets.md
  - docs/testing/plans/chat-workspace.md
  - docs/testing/cases/chat-workspace.md
  - docs/testing/plans/articles.md
  - docs/testing/cases/articles.md
  - docs/specs/007-conversation-lifecycle-and-resource-ownership.md
  - docs/adr/005-conversation-as-creation-workspace.md
  - docs/runbooks/local-dev.md
  - CONTEXT.md
  - package.json
  - pnpm-lock.yaml
verification:
  - pnpm --filter @mediaforge/contracts typecheck
  - pnpm --filter @mediaforge/service test
  - pnpm --filter @mediaforge/worker test
  - pnpm --filter @mediaforge/web test
  - pnpm typecheck
  - pnpm test
  - pnpm build
```

## 实施步骤

1. 先修改共享契约和幂等错误码，禁止创建无首条消息的 Conversation。
2. 新增可回滚数据库迁移和数据访问层。
3. 接入 S3 Client、UploadSession、Resource 上传与鉴权读取。
4. 实现首次 Turn 和后续 Turn 的事务服务与 Outbox。
5. 实现 Conversation 历史列表、标题、排序、读取和删除。
6. 实现删除 Outbox Worker 和暂存资源过期清理。
7. 前端改为本地空会话、真实历史加载、资源紧凑展示和删除交互。
8. 迁移旧 `workspaceId=default-workspace` 数据，移除产品主链路硬编码。
9. 完成契约、数据库、MinIO、Worker、SSE 和 Playwright 验证。

## 验证方案

- 契约：首次发送必含 prompt、幂等键和合法资源引用。
- 数据库：没有空 Conversation；创建时间与首条消息时间一致。
- 排序：只有成功用户 Turn 更新 `last_interaction_at`。
- 幂等：首次发送、后续发送、资源上传和删除重复请求不产生重复数据。
- 对象存储：上传后对象立即存在；重新进入页面仍为空会话；staged 对象按 TTL 清理；删除会话后 attached 对象最终不存在。
- 权限：不能读取、绑定或删除其他用户的 Resource / Conversation。
- 前端：重新进入始终显示新的本地空会话；历史列表真实且按时间排序。
- UI：1、4、5、10 张资源时显示前 4 张和准确 `+N`。
- 回归：SSE、多 Agent、追问恢复、Artifact 和手机预览不受影响。

## 迁移与回滚

- 先增新表和新字段，不立即删除旧 `conversation_resources` 和旧 API。
- 对已有非空 Conversation 回填 `last_interaction_at` 为最后一条用户消息时间。
- 清理无用户消息的默认/空 Conversation；执行前输出数量并保留数据库备份。
- 旧临时资源没有对象存储内容时只保留消息文字，不伪造可用图片。
- 兼容期采用服务端单写新模型，禁止新旧资源关系双写成为两个事实源。
- 回滚时切回旧读路径，保留新表和 MinIO 对象，不自动删除用户数据。

## 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 首次发送并发重试 | 重复会话和 Run | `owner_id + idempotency_key` 唯一 |
| 对象成功、数据库事务失败 | staged 孤儿资源 | UploadSession TTL 与清理 Worker |
| 数据库删除先于对象删除 | 无法定位对象 | 删除 Outbox 先固化 object keys |
| MinIO 删除失败 | 对象残留 | deleting 状态、幂等重试和告警 |
| Worker 更新 `updated_at` | 历史列表乱序 | 独立 `last_interaction_at`，仅 Turn Service 可写 |
| 资源跨会话复用 | 删除语义不确定 | 第一阶段禁止一个 Resource 归属多个 Conversation |
| 长 prompt 作为标题 | 列表布局溢出 | 原文保存，前端单行省略，不修改数据 |
| 老数据依赖默认 workspace | 迁移中断 | 盘点、备份、分阶段读切换和回滚开关 |

## AI 自审

```text
AI 自审结论：通过
分级复核：L 级，涉及主链路、schema、对象存储、删除和生产依赖。
服务边界：浏览器只访问 apps/service；PostgreSQL 保存事实，MinIO 保存二进制，Redis 只做任务。
契约与数据：首次 Turn 原子创建会话、消息、资源关系、Run 和 Outbox；不存在默认或空持久化会话。
异常路径：覆盖重试、对象孤儿、删除失败、SSE 恢复、资源越权和老数据迁移。
安全风险：Service 生成 object key，校验 MIME、文件签名、大小和用户归属，不公开 bucket。
测试方案：覆盖 contract、transaction、PostgreSQL/MinIO integration、Worker 和前端端到端。
反方意见：选择文件后才在发送时上传实现更简单，但不满足“上传后立即保存”，且会把上传耗时和失败集中到发送动作。
需要人工重点看的问题：确认新增 @aws-sdk/client-s3；确认暂存资源 TTL 为 24 小时；确认 Conversation 删除为最终硬删除。
```

## 人工确认

```text
审核结论：已确认
确认人：用户
确认时间：2026-07-27
备注：用户在当前对话明确要求“开始实施”，按本计划进入正式实现。
```

## 实施结果

```text
实施状态：已完成
完成时间：2026-07-27
契约：首个 Turn、后续 Turn、UploadSession、Resource、历史列表和聚合删除契约已落地。
数据库：002 迁移和 schema_migrations 执行器已落地，pnpm db:migrate 验证通过。
对象存储：资源原文件写入 MinIO / S3，浏览器通过 Service 鉴权读取。
删除：Conversation 立即从列表隐藏，Maintenance Worker 删除对象后硬删除 PostgreSQL 聚合。
前端：首次进入为空会话，不自动打开历史；真实历史按 lastInteractionAt 排序；资源最多显示 4 张缩略图和 +N。
产物防线：简短主题可以被标题 Agent 重新组织使用，但用户原始输入不得原样成为文章标题；指令型 Prompt 仍禁止进入成稿。
验证：类型检查、单元测试、构建、真实 API 生命周期、MinIO 上传读取删除、桌面浏览器截图均通过。
```

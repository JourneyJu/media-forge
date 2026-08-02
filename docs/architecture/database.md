# 数据库设计

## 原则

- PostgreSQL 保存可查询、可编辑、可关联的业务事实。
- MinIO / S3 保存大文件和不可变快照。
- Redis 不保存不可丢失的数据。
- 不持久化未发送的空会话；Conversation 必须与首条用户消息在同一事务创建。
- Conversation 是消息、资源、Run、Artifact、Article 和对象快照的删除聚合根。
- 历史排序使用 `last_interaction_at`，只允许用户 Turn Service 更新。

## 主要表

| 表 | 说明 | 模块文档 |
| --- | --- | --- |
| `tenants` | 兼容迁移保留表，不再承载产品租户概念 | `docs/modules/auth/README.md` |
| `users` | 用户 | `docs/modules/auth/README.md` |
| `tenant_memberships` | 兼容迁移保留的旧成员关系 | `docs/modules/auth/README.md` |
| `roles` / `permissions` / `role_permissions` | 兼容迁移保留的旧 RBAC 表 | `docs/modules/auth/README.md` |
| `auth_sessions` | 登录会话 | `docs/modules/auth/README.md` |
| `oauth_clients` | OAuth / OIDC 客户端配置，第一阶段用于自有 Web 客户端 | `docs/modules/auth/README.md` |
| `oauth_authorization_codes` | 授权码，后续 OIDC 标准流程使用 | `docs/modules/auth/README.md` |
| `oauth_refresh_tokens` | refresh token hash、轮换状态和失效时间 | `docs/modules/auth/README.md` |
| `workspaces` | 过渡期品牌上下文配置，不是用户历史会话 | `docs/modules/workspaces/README.md` |
| `conversations` | 创作会话，当前创作上下文边界 | `docs/modules/conversations/README.md` |
| `conversation_messages` | 会话内用户和系统可展示消息 | `docs/modules/conversations/README.md` |
| `conversation_memories` | 规划中的会话级 Working Memory；当前 Conversation 的创作状态摘要 | `docs/modules/conversations/README.md` |
| `upload_sessions` | Conversation 创建前的用户级资源暂存会话 | `docs/modules/assets/README.md` |
| `resources` | 上传资源元数据、对象 key、暂存与绑定状态 | `docs/modules/assets/README.md` |
| `message_resources` | 消息与资源不可变绑定关系 | `docs/modules/conversations/README.md` |
| `conversation_deletion_outbox` | 会话聚合和对象存储可靠删除任务 | `docs/modules/conversations/README.md` |
| `runs` | 会话内 AI 执行任务、状态和计划 | `docs/modules/conversations/README.md` |
| `run_steps` | Run 用户可见步骤投影；多 Agent 事实以 `agent_tasks` 为准 | `docs/modules/conversations/README.md` |
| `run_events` | Run 可恢复事件流，支持 SSE 断线续传 | `docs/modules/conversations/README.md` |
| `run_clarifications` | 用户在等待节点提交的追问答案和幂等键 | `docs/modules/conversations/README.md` |
| `graph_runs` | 产品 Run 与 LangGraph 执行实例的关系 | `docs/modules/creation-graph/README.md` |
| `agent_tasks` | 多 Agent 节点执行、重试和错误事实 | `docs/modules/creation-graph/README.md` |
| `agent_outputs` | Agent 版本化结构化输出 | `docs/modules/creation-graph/README.md` |
| `run_dispatch_outbox` | Run 创建后可靠投递 BullMQ 的 Outbox | `docs/modules/creation-graph/README.md` |
| `langgraph.checkpoints` | 规划中的 LangGraph 原生 checkpoint，不作为产品事实源 | `docs/modules/creation-graph/README.md` |
| `artifacts` | Run 输出产物，关联文章版本或其他结果 | `docs/modules/conversations/README.md` |
| `assets` | 过渡期素材表，迁移后由 `resources` 统一承载 | `docs/modules/assets/README.md` |
| `articles` | 文章 | `docs/modules/articles/README.md` |
| `article_versions` | 文章版本，包含结构化 JSON 和快照 key | `docs/modules/articles/README.md` |
| `layout_skill_packs` | 排版 skill 包元数据 | `docs/modules/layout-skills/README.md` |
| `workspace_memories` | 工作区长期记忆 | `docs/modules/workspaces/README.md` |
| `generation_usage_events` | 用户维度的生成次数事实，每个 accepted Run 一条 | `docs/modules/admin/README.md` |
| `model_usage_logs` | 每次真实模型调用、状态、延迟和供应商 token | `docs/modules/admin/README.md` |
| `quotas` | 配额 | `docs/modules/admin/README.md` |
| `generation_jobs` | AI 生成任务和最终状态 | `docs/modules/ai-generation/README.md` |
| `model_connections` | 模型协议连接、Base URL 和 AES-256-GCM 加密凭据 | `docs/modules/admin/README.md` |
| `model_configs` | 具体模型、模态、能力和运行参数 | `docs/modules/admin/README.md` |
| `model_routes` | 系统能力到默认模型的版本化映射 | `docs/modules/admin/README.md` |
| `audit_events` | 认证、权限和管理类高风险变更审计 | `docs/modules/auth/README.md`、`docs/modules/admin/README.md` |
| `agent_runs` | 过渡期旧 AgentRun 表，后续迁移到 `runs` | `docs/modules/ai-generation/README.md` |
| `agent_steps` | 过渡期旧 AgentStep 表，后续迁移到 `run_steps` | `docs/modules/ai-generation/README.md` |
| `agent_decisions` | 过渡期旧 AgentDecision 表，后续迁移到 `run_decisions` | `docs/modules/ai-generation/README.md` |

## 存储分工

| 数据 | PostgreSQL | MinIO / S3 |
| --- | --- | --- |
| 文章结构 | `article_versions.content_json` | 不存主状态 |
| 历史 HTML | 快照 key | HTML 文件 |
| Prompt 快照 | 快照 key | JSON 文件 |
| 上传图片 | 元数据、识别结果 | 原图、预览图 |
| Skill 包 | 元数据、版本 | skill JSON、prompt 模板 |

## 认证与权限相关表

### `users`

| 字段 | 说明 |
| --- | --- |
| `id` | 用户 ID |
| `account` | 兼容旧客户端的登录字段，值与 `username` 同步 |
| `username` / `username_normalized` | 用户名和小写标准化值，后者全局唯一 |
| `email` / `phone` | 可选联系方式 |
| `display_name` | 展示名 |
| `role` | 固定为 `admin` 或 `user` |
| `status` | `active`、`disabled` |
| `password_hash` | Argon2id 哈希结果 |
| `password_hash_algorithm` | 固定为 `argon2id`，后续迁移时保留算法标记 |
| `password_hash_params` | 哈希参数 JSON，不包含明文密码 |
| `must_change_password` | 是否必须修改初始密码 |
| `last_login_at` | 最近成功登录时间 |
| `failed_login_count` / `locked_until` | 登录失败计数和临时锁定时间 |
| `password_updated_at` | 最近一次密码更新时间 |
| `created_at` / `updated_at` | 生命周期时间 |

约束：

- 不保存明文密码。
- 不保存 RSA 加密后的可逆密码。
- 普通用户由管理员创建，临时密码为 `12345678`，必须首次改密。
- 生产环境 bootstrap admin 初始密码仍必须来自部署秘密，不得硬编码。
- `username` 只允许 3-32 位英文字母、数字和下划线，按 `username_normalized` 唯一。

### 兼容迁移表

`tenants`、`tenant_memberships`、`roles`、`permissions` 和 `role_permissions` 只为旧数据及发布窗口兼容保留。新认证、授权和管理写路径不再读写这些表；确认没有旧 token 和历史引用后另立清理迁移。

### `auth_sessions`

| 字段 | 说明 |
| --- | --- |
| `id` | 会话 ID |
| `user_id` | 所属用户 |
| `tenant_id` | 兼容旧会话，可为空，新会话不再写入 |
| `session_hash` | 会话标识 hash |
| `created_at` / `expires_at` / `revoked_at` | 生命周期时间 |

### `oauth_refresh_tokens`

| 字段 | 说明 |
| --- | --- |
| `id` | refresh token ID |
| `client_id` | OAuth client |
| `user_id` | 所属用户 |
| `tenant_id` | 兼容旧 token，可为空 |
| `session_id` | 所属登录会话 |
| `token_hash` | refresh token hash |
| `family_id` | 轮换 token family |
| `status` | `active`、`rotated`、`revoked`、`reused` |
| `created_at` / `expires_at` / `rotated_at` / `revoked_at` | 生命周期时间 |

refresh token 明文只返回给客户端一次，数据库只保存 hash。检测到已轮换 token 被再次使用时，必须撤销整个 token family。

### `audit_events`

| 字段 | 说明 |
| --- | --- |
| `id` | 审计事件 ID |
| `tenant_id` | 兼容旧审计事件，新事件为空 |
| `actor_user_id` | 操作人 |
| `action` | 操作类型 |
| `target_type` / `target_id` | 目标对象 |
| `metadata_json` | 脱敏后的扩展信息 |
| `created_at` | 创建时间 |

`metadata_json` 不得包含密码、token、API Key、完整敏感 prompt 或真实密钥。

## 微信公众号生成相关表

### `conversations`

保存一次创作上下文。关键字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 会话 ID |
| `owner_id` | 所属用户或鉴权主体 |
| `title` | 首条用户 prompt 原文 |
| `status` | `active`、`deleting` |
| `context_version` | 当前上下文版本 |
| `created_at` | 首次用户请求事务时间 |
| `last_interaction_at` | 最后一次成功用户 Turn 时间，历史排序字段 |

约束：

- 不允许创建没有用户消息的 Conversation。
- `created_at` 与首条用户消息使用同一事务时间。
- `last_interaction_at` 只由首次或后续 Turn Service 更新。
- 历史列表按 `last_interaction_at DESC, id DESC` 排序，只返回 `active`。

### `conversation_messages`

| 字段 | 说明 |
| --- | --- |
| `id` | 消息 ID |
| `conversation_id` | 所属会话 |
| `role` | `user`、`assistant`、`system` |
| `content` | 可展示文本 |
| `metadata_json` | 追问回答、展示类型等扩展信息，不作为资源关系事实源 |
| `created_at` | 创建时间 |

消息只追加，不提供消息级 UPDATE 或 DELETE。

### `conversation_memories`

目标表。保存同一 Conversation 内的工作记忆摘要，不保存跨会话长期记忆。

| 字段 | 说明 |
| --- | --- |
| `conversation_id` | Conversation ID，主键，随 Conversation 删除 |
| `context_version` | Working Memory 对应的会话上下文版本 |
| `memory_json` | 当前 brief、标题、提纲摘要、素材摘要、用户约束、修改意图和最新 Artifact 引用 |
| `created_at` / `updated_at` | 生命周期时间 |

约束：

- `memory_json` 不替代 `conversation_messages`、`resources` 或 `artifacts` 等原始事实。
- 不允许跨 Conversation 共享 Working Memory。
- 创建 Run 时可读取 Working Memory 并冻结到 `graph_runs.context_json`。
- Run 创建后，后续用户 Turn 不得修改该 Run 已冻结的 `context_json`。
- Conversation 删除时必须随聚合清理。

### `upload_sessions`

| 字段 | 说明 |
| --- | --- |
| `id` / `owner_id` | 暂存会话和所属用户 |
| `status` | `active`、`consumed`、`expired` |
| `expires_at` | 未发送资源清理时间，默认创建后 24 小时 |
| `created_at` / `consumed_at` | 生命周期时间 |

### `resources`

| 字段 | 说明 |
| --- | --- |
| `id` / `owner_id` | Resource 和所属用户 |
| `upload_session_id` | 暂存阶段所属 UploadSession |
| `conversation_id` | 发送成功后所属 Conversation，暂存时为空 |
| `status` | `uploading`、`staged`、`attached`、`failed`、`deleting` |
| `source` | `upload`、`paste`、`link`、`library` |
| `original_name` / `content_type` / `size_bytes` | 文件元数据 |
| `original_object_key` / `preview_object_key` | MinIO / S3 对象 key |
| `sha256` / `etag` | 完整性和对象标识 |
| `created_at` / `updated_at` | 生命周期时间 |

attached Resource 只能属于一个 Conversation。

### `message_resources`

| 字段 | 说明 |
| --- | --- |
| `message_id` | 用户消息 ID |
| `resource_id` | Resource ID |
| `display_order` | 消息气泡内顺序 |
| `created_at` | 绑定时间 |

约束：

- `(message_id, resource_id)` 唯一。
- Message 和 Resource 必须属于同一 Conversation。
- 发送成功后不提供解绑或单独删除。

### `conversation_deletion_outbox`

| 字段 | 说明 |
| --- | --- |
| `id` / `conversation_id` | 删除任务和目标 Conversation；Conversation 唯一 |
| `object_keys_json` | 状态改为 deleting 时固化的全部对象 key |
| `status` | `pending`、`processing`、`completed`、`failed` |
| `attempt_count` / `next_attempt_at` | 重试控制 |
| `last_error` | 安全错误摘要 |
| `created_at` / `updated_at` | 生命周期时间 |

删除 Worker 先幂等删除对象，再硬删除 Conversation 聚合。对象删除失败时 Conversation 保持 `deleting` 且不返回历史列表。

### `runs`

| 字段 | 说明 |
| --- | --- |
| `id` | Run ID |
| `conversation_id` | 所属会话 |
| `type` | `wechat_article_generation` 等任务类型 |
| `status` | Run 状态机 |
| `current_step` | 当前步骤类型 |
| `plan_json` | 结构化执行计划 |
| `waiting_for_json` | 必要追问点；不用于计划确认 |
| `result_artifact_id` | 成功后的主产物 |
| `lock_version` | 追问提交和状态推进的乐观锁 |
| `created_at` / `updated_at` / `completed_at` | 生命周期时间 |

### `run_steps`

| 字段 | 说明 |
| --- | --- |
| `id` / `run_id` | 步骤和所属 run |
| `step_no` / `step_type` | 顺序和步骤类型 |
| `status` | `queued`、`running`、`waiting_user`、`succeeded`、`failed`、`skipped` |
| `title` / `summary` | 前端可展示摘要 |
| `score` | 审阅评分，可选 |
| `prompt_snapshot_key` / `raw_output_snapshot_key` | 脱敏快照 |
| `created_at` | 创建时间 |

### `run_events`

| 字段 | 说明 |
| --- | --- |
| `id` | 事件 ID |
| `run_id` | 所属 run |
| `event_no` | run 内递增序号，SSE `id` 使用该值 |
| `type` | `run.created`、`step.started`、`artifact.created` 等事件类型 |
| `payload_json` | 可展示、脱敏后的事件内容 |
| `created_at` | 创建时间 |

约束：

- `(run_id, event_no)` 唯一。
- 同一 run 内 `event_no` 单调递增。
- payload 不得包含模型原始思维链、密钥、完整 prompt 或未脱敏 raw output。

### `run_clarifications`

保存 `run_id`、`answers_json`、`idempotency_key` 和 `created_at`。只用于必要追问，不用于批准内部执行计划。`(run_id, idempotency_key)` 唯一，重复提交返回同一 Run 状态。

### `graph_runs`

| 字段 | 说明 |
| --- | --- |
| `id` | Graph Run ID |
| `run_id` | 产品 Run ID，唯一 |
| `graph_name` / `graph_version` | Graph 标识和版本 |
| `context_version` | 本次执行读取的 Conversation 上下文版本 |
| `context_json` | 版本化执行上下文和会话 Working Memory 快照，用于当前 Run 执行和追问恢复 |
| `status` | `queued`、`running`、`waiting_clarification`、`completed`、`failed`、`cancelled` |
| `created_at` / `updated_at` / `completed_at` | 生命周期时间 |

### `agent_tasks`

| 字段 | 说明 |
| --- | --- |
| `id` / `run_id` | 任务和所属 Run |
| `agent_name` / `node_name` | Agent 和 LangGraph 节点 |
| `status` | `queued`、`running`、`succeeded`、`failed`、`skipped` |
| `attempt_no` | 节点执行或重试次数 |
| `input_ref` / `output_ref` | 结构化输入输出引用 |
| `error_code` / `error_message` | 安全错误摘要 |
| `started_at` / `completed_at` / `created_at` | 生命周期时间 |

### `agent_outputs`

| 字段 | 说明 |
| --- | --- |
| `id` / `run_id` / `agent_task_id` | 输出及来源 |
| `type` | `creative_brief`、`title_candidates`、`article_outline`、`article_draft`、`image_plan`、`review_report`、`render_result` |
| `schema_version` | 输出契约版本 |
| `payload_json` | 通过 schema 校验的结构化结果 |
| `snapshot_key` | 可选的脱敏原始输出快照 |
| `created_at` | 创建时间 |

`payload_json` 不保存模型思维链。Writer 的自然语言输出不得绕过 Artifact Builder 直接成为 ArticleVersion。

### `run_dispatch_outbox`

| 字段 | 说明 |
| --- | --- |
| `id` / `run_id` | Outbox 和目标 Run；`run_id` 唯一 |
| `queue_name` | 固定为 `creation-run` |
| `payload_json` | 只包含 ID 和版本信息的 Job payload |
| `status` | `pending`、`dispatching`、`dispatched`、`failed` |
| `attempt_count` / `next_attempt_at` | 重派控制 |
| `last_error` | 安全错误摘要 |
| `created_at` / `updated_at` / `dispatched_at` | 生命周期时间 |

Run 和 Outbox 必须在同一 PostgreSQL transaction 中创建。Redis 不可用时保留 `pending`，恢复后使用 `run_id` 作为 BullMQ `jobId` 幂等重派。

### LangGraph checkpoint

目标表：

```text
langgraph.checkpoints
langgraph.checkpoint_writes
langgraph.checkpoint_blobs
```

Checkpoint 只用于 Graph 中断和恢复。产品状态、用户可见事件和最终 Artifact 仍以 `runs`、`run_events`、`agent_tasks`、`agent_outputs` 和 `artifacts` 为准。

### `artifacts`

| 字段 | 说明 |
| --- | --- |
| `id` | 产物 ID |
| `conversation_id` | 所属会话 |
| `run_id` | 来源 run |
| `type` | `wechat_article`、`title_candidates`、`image_plan` |
| `title` | 产物标题 |
| `payload_json` | 产物扩展内容 |
| `article_id` / `article_version_id` | 文章产物关联版本 |
| `created_at` | 创建时间 |

### `articles`

保存文章主记录。关键字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 文章 ID |
| `conversation_id` | 所属 Conversation；会话删除时级联删除 |
| `workspace_id` | 所属工作区 |
| `title` | 当前标题 |
| `status` | `draft`、`exported`、`archived` |
| `current_version_id` | 当前版本 |
| `created_at` / `updated_at` | 创建和更新时间 |

### `article_versions`

保存每次 AI 生成、AI 修订、手动保存或恢复形成的正式版本。关键字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 版本 ID |
| `article_id` | 所属文章 |
| `version_no` | 文章内递增版本号 |
| `source` | `ai`、`manual`、`restore`、`import` |
| `content_json` | 结构化 `ArticleDocument`，可编辑事实源 |
| `html_snapshot_key` | 微信 HTML 快照对象存储 key |
| `prompt_snapshot_key` | prompt 上下文快照对象存储 key |
| `renderer_version` | renderer 版本 |
| `skill_pack_id` / `skill_pack_version` | 使用的排版 skill |
| `created_at` | 创建时间 |

### `resources` 与过渡期 `assets`

`resources` 保存当前会话模型下的素材元数据。原图、预览图和视频文件不进入数据库，只保存对象存储 key。旧 `assets` 在兼容迁移期保留，不能与 `resources` 长期双写成为两个事实源。

### `generation_jobs`

保存生成任务最终状态，Redis 只允许保存短期进度。关键字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 任务 ID |
| `workspace_id` | 所属工作区 |
| `article_id` | 可选，关联文章 |
| `status` | `queued`、`running`、`succeeded`、`failed`、`cancelled` |
| `input_summary` | 非敏感输入摘要 |
| `error_type` / `error_message` | 失败分类和安全错误信息 |
| `result_version_id` | 成功后关联版本 |

### 模型配置与路由

`model_connections` 保存 adapter、Base URL、AES-256-GCM ciphertext、nonce、auth tag 和密钥版本；API 只返回 `secretConfigured`。

`model_configs` 保存具体模型 ID、`text/multimodal` 模态、文本/图片输入能力、结构化输出、上下文窗口、超时、状态和乐观锁版本。

`model_routes` 保存 `text_generation`、`multimodal_generation` 到 active 模型的唯一映射。业务模型不再读取 `MODEL_GATEWAY_*` 环境变量。

### 使用监控

`generation_usage_events` 按 `run_id` 唯一，每个被接受的 Run 记录一次用户生成。`model_usage_logs` 在供应商请求前写入，每次真实调用一条，记录模型、路由、状态、延迟和供应商返回 token；token 缺失时不估算。

### `agent_runs`

| 字段 | 说明 |
| --- | --- |
| `id` | Agent 运行 ID |
| `workspace_id` / `article_id` | 工作区和目标文章 |
| `status` | 状态机当前状态 |
| `plan_json` | 结构化 AgentPlan |
| `current_step_no` | 当前步骤序号 |
| `revision_count` / `restructure_count` | 局部修订和结构重构次数 |
| `best_version_id` | 当前评分最高的文章版本 |
| `last_review_score` | 最近一次审阅评分 |
| `lock_version` | 用户决定和状态推进的乐观锁 |
| `created_at` / `updated_at` / `completed_at` | 生命周期时间 |

### `agent_steps`

| 字段 | 说明 |
| --- | --- |
| `id` / `agent_run_id` | 步骤和所属运行 |
| `step_no` / `step_type` | 顺序和步骤类型 |
| `status` | `queued`、`running`、`waiting_user`、`succeeded`、`failed`、`skipped` |
| `idempotency_key` | 重试去重键 |
| `input_summary_json` / `output_summary_json` | 可展示的脱敏摘要 |
| `prompt_snapshot_key` / `raw_output_snapshot_key` | 对象存储快照 |
| `input_version_id` / `result_version_id` | 输入和产出的文章版本 |
| `model_provider` / `model_name` | 实际调用模型 |
| `token_input` / `token_output` / `duration_ms` | 用量和耗时 |
| `error_type` / `error_message` | 安全错误信息 |

### `agent_decisions`

保存 `step_id`、`decision_type`、`decision_payload_json`、`instruction`、`decided_by`、`created_at`。同一步只允许一个生效决定，重复请求通过幂等键返回原结果。

## 对象存储路径

```text
users/{userId}/resources/{resourceId}/original
users/{userId}/resources/{resourceId}/preview
users/{userId}/conversations/{conversationId}/articles/{articleId}/versions/{versionId}/wechat.html
users/{userId}/conversations/{conversationId}/articles/{articleId}/versions/{versionId}/prompt.json
users/{userId}/conversations/{conversationId}/runs/{runId}/steps/{stepId}/output.json
```

schema 变更属于 L 级变更，必须先补迁移和回滚方案。

新 Resource 使用不依赖 Conversation 的用户级 key，因为文件上传时 Conversation 可能尚未创建。新文章和 Run 快照使用包含 Conversation 的用户级路径，便于聚合删除；旧 tenant/workspace 路径仅用于兼容读取，不再用于新写入。

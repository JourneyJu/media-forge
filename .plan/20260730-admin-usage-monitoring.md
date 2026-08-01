# L 级改动计划：控制台使用监控

## 需求背景

MediaForge 需要让管理员查看用户生成次数、Token 消耗和模型使用情况。一次用户生成可能触发多个 Agent、多个模型调用和重试，因此“用户生成次数”和“模型调用次数”必须作为两类独立事实记录，否则会造成用户活跃度和模型成本统计失真。

当前代码尚未实现持久化用量事实表。本次目标是建立用户生成事件、模型调用日志、管理员查询 API 和监控页面，并与模型配置的 `model_config_id`、`route_key` 建立稳定关联。

本需求属于 L 级改动，因为会新增用量 schema、写入链路、对账机制、管理 API、保留策略，并影响 AI 生成和模型调用主链路。

## 分级结论

```text
需求分级：L
分级理由：新增用量事实 schema，并修改 Run 创建、模型调用、重试和监控查询链路。
影响面：apps/web、apps/service、packages/contracts、PostgreSQL、AI 调用链路、权限、隐私和文档。
是否需要人工确认：是
下一步：评审计划、功能规格和 ADR，确认后同步事实文档、契约并实现。
```

## 非目标

- 本阶段不实现费用估算、预算、配额扣减或账单。
- 不监控 prompt、文章内容、图片内容或模型原始输出。
- 不统计上传、导出和存储用量。
- 不向普通用户开放个人用量页面。
- 第一阶段不实现 CSV 导出。
- 第一阶段不实现实时推送，页面按请求查询。
- 第一阶段不依赖 Redis 保存用量事实。
- 第一阶段不创建日汇总表，不执行原始数据自动删除。

## 影响面

| 领域 | 是否影响 | 说明 |
| --- | --- | --- |
| 前端 | 是 | 新增使用监控页面、时间筛选、趋势、排行和用户详情。 |
| 后端服务 | 是 | 新增用量写入、查询、对账和管理 API。 |
| 共享契约 | 是 | 新增指标、趋势、用户、模型和错误码契约。 |
| 数据库 schema | 是 | 新增 `generation_usage_events` 和 `model_usage_logs`。 |
| 对象存储 | 否 | 用量记录不保存内容快照。 |
| Redis / 队列 | 否 | 不作为事实源；后续汇总任务可使用现有队列。 |
| AI 调用链路 | 是 | Run 创建和每次供应商调用都需要写用量事实。 |
| 权限 / 隐私 | 是 | 仅 `admin` 可读，用户内容不得进入监控数据。 |
| 模型配置 | 是 | 模型用量关联 `model_config_id` 和 `route_key`。 |
| 文档 | 是 | 新增规格和 ADR，确认后同步架构、模块、API 和测试文档。 |

## 推荐方案

### 生成事件

`generation_usage_events` 一条记录代表一次被系统成功接受并持久化的用户生成请求。

计数规则：

- Run 与 dispatch outbox 创建成功后计为一次生成。
- 请求校验失败、未创建 Run 时不计数。
- 内部 Agent 步骤和模型重试不增加生成次数。
- 同一 `generation_id` 或幂等键只记录一次。
- 成功、失败和取消分别统计。
- 成功率为 `succeeded / (succeeded + failed)`，取消不进入分母。

生成类型至少区分：

```text
wechat_article_generation
article_revision
```

后续生成类型通过受控枚举扩展。

### 模型调用日志

`model_usage_logs` 一条记录代表一次真实供应商调用尝试。

计数规则：

- 每个实际 attempt 都记录，包括重试。
- 重试产生的 Token 属于真实消耗。
- 供应商返回 Token 时按返回值记录。
- 供应商未返回 Token 时标记 `token_status=unavailable`，不自行估算。
- 连接测试和模型能力验证不进入生产用量统计，只写管理审计。
- 日志不保存 prompt、输出、API Key、Authorization header 或完整供应商错误。

### 关联关系

```text
User
  → GenerationUsageEvent
      → ModelUsageLog attempt 1
      → ModelUsageLog attempt 2
      → ModelUsageLog attempt N
```

同一次生成可以有零到多条模型调用记录。生成在模型调用前失败时仍可以存在生成事件，但没有模型用量。

## 写入可靠性

### 生成事件

Run、dispatch outbox 和 `generation_usage_events` 在同一个 PostgreSQL transaction 中创建。`generation_id` 唯一，重试创建返回原记录。

Run 完成、失败或取消时更新生成事件最终状态和 `completed_at`。

### 模型调用

```text
解析模型配置
  → 创建 running model_usage_log
  → 调用供应商
  → finally 更新 Token、耗时、状态和错误码
```

- 创建调用日志失败时不发送供应商请求，避免产生不可计量调用。
- 每次调用使用稳定 `call_id`。
- 唯一约束使用 `generation_id + step_id + attempt_no`。
- 最终更新失败时保留 `running` 记录，由对账任务根据 Run、Step 和安全日志修复。
- Redis 不保存不可丢失用量事实。

### 对账

定期扫描超过阈值仍为 `running` 的生成事件和模型调用：

- 根据 Run/Step 最终状态修正状态。
- 无法确定 Token 时保留 `token_status=unavailable`。
- 不根据文本长度推测 Token。
- 对账操作记录修复数量和错误摘要，不记录业务内容。

## 数据模型

### `generation_usage_events`

```text
id
user_id
generation_id
run_id
idempotency_key
generation_type
status
model_call_count
started_at
completed_at
created_at
updated_at
```

### `model_usage_logs`

```text
id
call_id
user_id
generation_event_id
generation_id
run_id
step_id
attempt_no
model_config_id
route_key
provider
model_id
input_tokens
output_tokens
total_tokens
token_status
duration_ms
status
error_code
started_at
completed_at
created_at
updated_at
```

`provider` 和 `model_id` 是调用时快照，用于模型被重命名或归档后仍可解释历史数据；统计关联以 `model_config_id` 为准。

## 统计维度

### 用户生成

```text
user_id + date
generation_count
success_count
failed_count
cancelled_count
```

### 用户模型用量

```text
user_id + model_config_id + date
model_call_count
input_tokens
output_tokens
total_tokens
success_count
failed_count
average_duration_ms
```

### 模型总体用量

```text
model_config_id + date
model_call_count
active_user_count
input_tokens
output_tokens
total_tokens
success_count
failed_count
average_duration_ms
```

总体指标由原始事实聚合，不重复写一份系统总量事实。

## 查询与汇总策略

第一阶段：

- 对原始事实表执行 PostgreSQL 聚合。
- 支持最近 7 天、30 天和不超过 180 天的自定义范围。
- 为时间、用户、模型、状态和组合查询建立索引。
- 数据库存 UTC，页面按 `Asia/Shanghai` 分桶和展示。

第二阶段在原始表规模或查询延迟需要优化时增加：

```text
usage_daily_user_stats
usage_daily_user_model_stats
usage_daily_model_stats
```

日汇总可重建，原始日志在保留期内仍是事实源。

## 目标 API

```text
GET /admin/usage/overview
GET /admin/usage/trends
GET /admin/usage/users
GET /admin/usage/users/:userId
GET /admin/usage/users/:userId/models
GET /admin/usage/models
GET /admin/usage/models/:modelConfigId
GET /admin/usage/models/:modelConfigId/users
```

所有接口只允许 `admin` 调用。`user_id` 归属只来自服务端 `AuthContext` 和 Run 事实，写入 API 不接受客户端指定统计用户。

## allowed_files 草案

```yaml
allowed_files:
  - .plan/20260730-admin-usage-monitoring.md
  - docs/specs/011-admin-usage-monitoring.md
  - docs/adr/009-generation-and-model-usage-metering.md
  - docs/adr/README.md
  - docs/architecture/overview.md
  - docs/architecture/database.md
  - docs/modules/admin/README.md
  - docs/modules/ai-generation/README.md
  - docs/modules/conversations/README.md
  - docs/api/admin.md
  - docs/api/ai-generation.md
  - docs/testing/plans/admin.md
  - docs/testing/cases/admin.md
  - docs/testing/plans/ai-generation.md
  - docs/testing/cases/ai-generation.md
  - packages/contracts/src/admin.ts
  - packages/contracts/src/ai-generation.ts
  - packages/contracts/src/index.ts
  - apps/service/migrations/**
  - apps/service/src/usage/**
  - apps/service/src/model-gateway.ts
  - apps/service/src/ai-generation.ts
  - apps/service/src/conversations/**
  - apps/service/src/creation-graph/**
  - apps/service/test/**
  - apps/web/app/admin/**
  - apps/web/app/lib/**
verification:
  - pnpm --filter @mediaforge/contracts typecheck
  - pnpm --filter @mediaforge/service typecheck
  - pnpm --filter @mediaforge/service test
  - pnpm --filter @mediaforge/web typecheck
  - pnpm test
```

正式实现时按生成事件、模型调用、查询 API、对账和前端页面拆分垂直切片，并为每个切片重新锁定 `allowed_files`。

## 实施步骤

1. 评审并确认计划、规格和 ADR。
2. 同步架构、数据库、admin/ai-generation/conversations 模块、API 和测试文档。
3. 在 `packages/contracts` 定义用量事件、指标、查询和错误码。
4. 新增数据库迁移、唯一约束和查询索引。
5. 将生成事件写入 Run 创建和状态终结事务。
6. 将模型调用日志接入 Model Gateway 的每个 attempt。
7. 实现超时 `running` 记录对账。
8. 实现总体、趋势、用户和模型查询 API。
9. 实现使用监控页面和管理员路由守卫。
10. 补齐并发、重试、失败、Token 缺失和隐私测试。
11. 观察查询性能，再决定是否实施日汇总。

## 验证方案

- 契约：时间范围、分页、指标、趋势、用户和模型响应。
- 生成计数：一次 Run 只计一次，内部步骤和重试不增加。
- 模型计量：每个 attempt 独立记录，Token 正确累计。
- 幂等：重复 Run 创建和调用重试不产生重复事实。
- 失败路径：Run 失败、取消、供应商超时、Token 缺失和最终更新失败。
- 对账：超时 running 记录可修复，无法获取 Token 时不估算。
- 权限：普通用户调用监控接口返回 403。
- 隐私：数据库、API、日志和审计不包含 prompt、输出和凭据。
- 查询：7 天、30 天、用户排行、模型总体和用户模型详情。
- 时区：UTC 边界在 `Asia/Shanghai` 日期分桶下结果正确。

## 迁移与回滚

迁移：

1. 新增两张事实表和索引，不修改已有 Run/Step 数据。
2. 先接入生成事件，再接入模型调用日志。
3. 通过灰度环境核对 Run 数、调用数和 Token。
4. 启用管理查询和页面。
5. 第一阶段不回填历史数据，页面从功能启用时间开始统计。

回滚：

- 停止新用量写入和监控页面，不删除事实表。
- 用量写入代码必须可独立关闭，不能影响读取历史记录。
- 已写入数据保持只读，不执行反向删除。
- 生成结果不能因监控页面回滚而丢失。
- 若模型调用日志创建失败导致生成受阻，可回滚到上一版本，但必须记录不可计量风险窗口。

## 保留策略

- 第一阶段不自动删除原始记录，避免在日汇总尚未实现时丢失历史。
- 日汇总上线并验证可重建后，目标保留期为：原始模型调用 180 天，日汇总 24 个月。
- 审计记录按安全策略单独保留。
- 清理任务必须分批、可暂停、可重试，不能长事务锁表。
- 保留期是服务端运维配置，不开放给普通管理员修改。

## 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 把模型调用当生成次数 | 用户使用量虚高 | 分离两类事实，generation ID 唯一。 |
| 重试重复或漏计 | Token 统计失真 | attempt 唯一键，每次真实调用单独记录。 |
| 用量日志写入失败 | 产生不可计量成本 | 供应商调用前创建日志，失败时不发起调用。 |
| 供应商不返回 Token | 总量不完整 | 标记 unavailable，不静默估算。 |
| running 记录长期未终结 | 成功率和耗时失真 | 定期对账并保留修复记录。 |
| 查询原始表变慢 | 管理页面延迟 | 索引、范围限制，达到阈值后增加日汇总。 |
| 监控数据泄露内容 | 用户隐私风险 | 只记录指标和安全错误码，admin 鉴权。 |
| 原始数据过早清理 | 历史统计丢失 | 日汇总验证前禁用自动清理。 |

## AI 自审

```text
AI 自审结论：通过，需人工确认后实施
分级复核：新增 schema 并修改 Run 和模型调用主链路，属于 L 级。
服务边界：apps/service 写用量事实并提供管理查询，前端不直连数据库。
契约与数据：生成事件和模型调用两类事实、维度和 API 已定义。
异常路径：覆盖重试、Token 缺失、写入失败、取消和对账。
安全风险：监控不保存内容或凭据，仅 admin 可读。
测试方案：覆盖计数、幂等、重试、时区、权限、隐私和查询。
反方意见：直接从 Run/Step 聚合表更少，但无法稳定表达实际供应商 attempt 和 Token 缺失状态。
需要人工重点看的问题：调用日志失败时是否接受 fail closed；原始数据和日汇总保留期。
```

## 人工确认

```text
审核结论：已确认
确认人：用户
确认时间：2026-07-30
备注：用户明确要求“开始对3个模块进行实施”。
```

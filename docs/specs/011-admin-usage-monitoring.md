# 规格 011：控制台使用监控

## 状态

Proposed

## 目标

为管理员提供用户生成次数、Token 消耗和模型使用情况。监控同时支持用户维度和系统总体维度，并能够从用户下钻到具体模型、从模型下钻到使用用户。

本规格只统计 AI 生成和模型调用，不统计上传、导出、存储、费用或配额。

## 权限与隐私

- 只有 `admin` 可以进入 `/admin/usage`。
- 普通 `user` 不显示系统设置入口。
- 普通用户直接访问页面时返回客户端首页。
- 任一监控 API 都必须在后端再次校验 `role == "admin"`。
- 未登录返回 `UNAUTHORIZED`，非管理员返回 `PERMISSION_REQUIRED`。
- 监控数据不保存或返回 prompt、文章内容、图片内容和模型原始输出。
- `user_id` 必须来自服务端认证上下文和 Run 事实，不接受客户端指定归属。
- 用户详情查询属于敏感管理操作，需要记录 actor、target user 和时间，不记录查询结果内容。

## 指标定义

### 生成次数

一次生成是一个被服务端成功持久化并进入执行流程的用户请求。

计入：

- 公众号文章生成；
- 用户主动发起的文章修订；
- 后续加入枚举的用户主动生成类型。

不计入：

- 请求参数校验失败；
- 未创建 Run 的请求；
- Agent 内部步骤；
- 模型调用；
- 自动重试；
- 连接测试和模型能力验证。

同一 `generation_id` 只计一次。

### 生成状态

| 状态 | 说明 |
| --- | --- |
| `running` | 已接受，尚未结束。 |
| `succeeded` | 生成完成并保存结果。 |
| `failed` | 生成失败。 |
| `cancelled` | 用户或系统取消。 |

```text
generation_count = running + succeeded + failed + cancelled
success_rate = succeeded / (succeeded + failed)
```

当成功与失败均为 0 时，成功率返回 `null`，页面显示 `—`。取消不进入成功率分母。

### 模型调用次数

每一次真实供应商调用 attempt 计为一次模型调用。一次生成可以产生多次模型调用。

- 重试独立计数。
- 供应商调用失败也计为 attempt。
- 调用前因本地校验失败而未发送供应商请求，不计模型调用。
- 每个 attempt 使用稳定 `call_id`。

### Token

```text
total_tokens = input_tokens + output_tokens
```

- 以供应商响应为准。
- 不使用字符数或 tokenizer 静默估算。
- 供应商未返回 Token 时，`tokenStatus=unavailable`。
- 聚合结果同时返回已知 Token 和 Token 缺失调用数。
- Token 缺失调用不计入 Token 总量，但不能从调用次数中移除。

### 活跃用户

所选时间范围内至少有一条生成事件的去重用户数。只有模型调用而没有生成事件的系统任务不计入普通活跃用户。

### 平均耗时

只对具有完成时间的模型调用计算：

```text
average_duration_ms = sum(duration_ms) / completed_call_count
```

## 原始事实

### `generation_usage_events`

| 字段 | 说明 |
| --- | --- |
| `id` | 事件 ID。 |
| `user_id` | 发起用户，来自认证上下文。 |
| `generation_id` | 生成业务 ID，全局唯一。 |
| `run_id` | 关联 Run。 |
| `idempotency_key` | 请求幂等键。 |
| `generation_type` | `wechat_article_generation`、`article_revision` 等受控枚举。 |
| `status` | `running`、`succeeded`、`failed`、`cancelled`。 |
| `model_call_count` | 当前关联模型调用数，作为便捷字段，可由日志重算。 |
| `started_at` | 开始时间。 |
| `completed_at` | 最终完成时间。 |
| `created_at` / `updated_at` | 生命周期时间。 |

约束：

- `generation_id` 唯一。
- `run_id` 唯一。
- `model_call_count` 不作为 Token 事实源。
- 状态更新遵循 Run 状态机，不允许从最终状态回到 `running`。

### `model_usage_logs`

| 字段 | 说明 |
| --- | --- |
| `id` | 日志 ID。 |
| `call_id` | 模型调用 ID，全局唯一。 |
| `user_id` | 触发调用的用户。 |
| `generation_event_id` | 所属生成事件。 |
| `generation_id` / `run_id` | 业务关联。 |
| `step_id` | Agent 或生成步骤。 |
| `attempt_no` | 当前步骤调用尝试序号。 |
| `model_config_id` | 实际模型配置。 |
| `route_key` | `text_generation` 或 `multimodal_generation`。 |
| `provider` | 调用时供应商快照。 |
| `model_id` | 调用时模型标识快照。 |
| `input_tokens` | 输入 Token，可为空。 |
| `output_tokens` | 输出 Token，可为空。 |
| `total_tokens` | 总 Token，可为空。 |
| `token_status` | `reported` 或 `unavailable`。 |
| `duration_ms` | 调用耗时。 |
| `status` | `running`、`succeeded`、`failed`。 |
| `error_code` | 安全错误码。 |
| `started_at` / `completed_at` | 调用时间。 |
| `created_at` / `updated_at` | 生命周期时间。 |

唯一约束：

```text
call_id
generation_id + step_id + attempt_no
```

不保存：

- prompt 和模型输出；
- API Key、Authorization header 和密文；
- 完整供应商请求或响应；
- 包含用户内容的错误信息。

## 写入流程

### 生成

```text
接收用户请求
  → 校验通过
  → transaction:
      创建 Run
      创建 dispatch outbox
      创建 generation_usage_event
  → 返回 accepted
```

重复幂等键返回原 Run 和原生成事件。

Run 进入最终状态时，同步更新生成事件。更新失败时由对账任务修复。

### 模型调用

```text
解析模型和路由
  → 创建 running model_usage_log
  → 调用供应商
  → 读取供应商 usage
  → finally 更新状态、Token 和耗时
```

创建模型调用日志失败时不发送供应商请求，避免不可计量调用。

模型最终日志更新失败时：

- 不伪造 Token；
- 保留 `running`；
- 记录安全基础设施错误；
- 由对账任务根据 Run/Step 状态修正。

## 对账

对账任务处理超过配置阈值仍为 `running` 的记录：

- Run 已完成：将生成事件修正为对应最终状态。
- Step 明确失败：将模型调用修正为 `failed`。
- 无法还原 Token：设置 `token_status=unavailable`。
- 无法判断状态：保留并产生运维告警。

对账必须幂等。对账不读取对象存储中的 prompt 或模型原始输出。

## 聚合维度

### 用户生成

```text
date
user_id
generation_count
success_count
failed_count
cancelled_count
```

### 用户模型

```text
date
user_id
model_config_id
model_call_count
input_tokens
output_tokens
total_tokens
token_unavailable_count
success_count
failed_count
average_duration_ms
```

### 模型总体

```text
date
model_config_id
model_call_count
active_user_count
input_tokens
output_tokens
total_tokens
token_unavailable_count
success_count
failed_count
average_duration_ms
```

总体指标通过所有用户事实聚合，不单独维护可漂移的系统总量记录。

## 查询策略

第一阶段直接查询原始事实：

- 默认最近 7 天；
- 支持最近 30 天；
- 自定义范围最长 180 天；
- PostgreSQL 存储 UTC；
- 第一阶段固定按 `Asia/Shanghai` 分桶和展示；
- 为 `created_at`、`user_id`、`model_config_id`、`status` 和常用组合建立索引。

第二阶段按性能需要增加：

```text
usage_daily_user_stats
usage_daily_user_model_stats
usage_daily_model_stats
```

日汇总必须可以从原始事实重建，不能成为无法校验的唯一事实源。

## 页面设计

页面路由为 `/admin/usage`，延续客户端视觉体系。

### 总体指标

- 生成次数；
- 活跃用户；
- Token 总量，同时显示输入和输出；
- 生成成功率，同时显示失败次数。

### 使用趋势

- 生成次数趋势；
- Token 趋势；
- 最近 7 天、30 天和自定义范围；
- 按天展示。

### 用户使用排行

| 字段 | 说明 |
| --- | --- |
| 用户 | 显示名称和用户名。 |
| 生成次数 | 所选范围内生成事件数。 |
| Token 用量 | 用户全部模型调用的已知 Token。 |
| 成功率 | 用户生成成功率。 |

支持按用户名或显示名称搜索、分页和选择用户。

### 模型总体使用

| 字段 | 说明 |
| --- | --- |
| 模型 | 当前显示名称和调用时模型标识。 |
| 调用次数 | 实际供应商 attempt 数。 |
| Token | 已知 Token 总量及占比。 |
| 活跃用户 | 使用该模型的去重用户数。 |
| 成功率 | 模型调用成功率。 |
| 平均耗时 | 已完成调用的平均耗时。 |

### 用户详情

- 用户生成次数和成功、失败、取消数；
- Token 总量和平均每次生成的已知 Token；
- 该用户不同模型的调用与 Token 分布；
- 最近生成记录，只显示类型、状态、时间和指标，不显示内容。

## 目标接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/admin/usage/overview` | 总体指标。 |
| `GET` | `/admin/usage/trends` | 生成或 Token 趋势。 |
| `GET` | `/admin/usage/users` | 用户使用排行。 |
| `GET` | `/admin/usage/users/:userId` | 用户用量详情。 |
| `GET` | `/admin/usage/users/:userId/models` | 用户模型分布。 |
| `GET` | `/admin/usage/models` | 模型总体排行。 |
| `GET` | `/admin/usage/models/:modelConfigId` | 模型详情。 |
| `GET` | `/admin/usage/models/:modelConfigId/users` | 模型用户分布。 |

公共查询参数：

```text
from
to
page
pageSize
```

趋势接口额外接受：

```text
metric=generation_count|total_tokens
interval=day
```

### 总体响应示例

```json
{
  "range": {
    "from": "2026-07-24T00:00:00+08:00",
    "to": "2026-07-31T00:00:00+08:00",
    "timezone": "Asia/Shanghai"
  },
  "generation": {
    "count": 1284,
    "successCount": 1263,
    "failedCount": 17,
    "cancelledCount": 4,
    "successRate": 0.9867
  },
  "activeUsers": 42,
  "tokens": {
    "input": 5210000,
    "output": 3250000,
    "total": 8460000,
    "unavailableCallCount": 3
  }
}
```

## 错误码

| 错误码 | HTTP | 说明 |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | 未登录或会话无效。 |
| `PERMISSION_REQUIRED` | 403 | 当前用户不是管理员。 |
| `USAGE_RANGE_INVALID` | 422 | 时间范围无效。 |
| `USAGE_RANGE_TOO_LARGE` | 422 | 查询超过第一阶段 180 天限制。 |
| `USAGE_USER_NOT_FOUND` | 404 | 用户不存在。 |
| `USAGE_MODEL_NOT_FOUND` | 404 | 模型配置不存在。 |
| `USAGE_METRIC_INVALID` | 422 | 趋势指标不支持。 |
| `USAGE_DATA_UNAVAILABLE` | 503 | 用量数据暂时无法查询。 |

错误响应不得包含用户内容、prompt、模型输出或供应商原始错误。

## 保留策略

第一阶段：

- 不自动删除原始记录；
- 不创建日汇总；
- 从功能启用时间开始统计，不回填无法可靠还原的历史数据。

第二阶段：

- 原始模型调用保留 180 天；
- 日汇总保留 24 个月；
- 日汇总验证可重建后才能启用原始数据清理；
- 清理分批、可暂停、可重试，不使用长事务锁表。

审计记录使用独立安全保留策略。

## 验收标准

- 一次 Run 只增加一次生成次数。
- 多 Agent 步骤和重试不增加生成次数。
- 每次真实模型 attempt 独立记录调用和 Token。
- 供应商不返回 Token 时标记 unavailable，不估算。
- 管理员可以查看总体、趋势、用户排行和模型排行。
- 可以从用户下钻模型，也可以从模型下钻用户。
- 普通用户不能访问监控页面或 API。
- 用量数据不包含 prompt、文章内容、图片内容、模型输出或密钥。
- 所有日期按 UTC 保存、按 `Asia/Shanghai` 展示。
- 模型被禁用或归档后，历史统计仍可关联。
- 第一阶段查询范围不超过 180 天。
- 超时 running 记录可以通过幂等对账修复。

## 已确认设计

- 用户生成次数和模型调用次数是两类独立事实。
- 生成次数按用户维度统计。
- 模型使用同时支持用户维度和总体维度。
- 重试产生的真实 Token 必须计入。
- 第一阶段查询原始事实，后续按性能增加日汇总。
- 第一阶段不提供费用、配额、导出和普通用户个人页面。

## 关联文档

- `.plan/20260730-admin-usage-monitoring.md`
- `docs/adr/009-generation-and-model-usage-metering.md`
- `docs/specs/010-admin-model-configuration.md`
- `docs/modules/admin/README.md`
- `docs/modules/ai-generation/README.md`

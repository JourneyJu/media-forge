# 模块：系统设置

## 模块定位

系统设置包含用户管理、模型配置和使用监控。用户管理 API 由 `apps/auth` 承载；模型配置、能力路由和用量聚合由 `apps/service` 承载；`apps/web/app/admin` 提供统一管理界面。

## 模型配置

PostgreSQL 是模型业务配置的唯一事实源，旧 `MODEL_GATEWAY_*` 环境变量不再参与运行时解析。

三层数据：

1. `model_connections`：OpenAI Compatible 协议、Base URL 和加密 API Key。
2. `model_configs`：模型 ID、文本/多模态能力、结构化输出和运行参数。
3. `model_routes`：`text_generation`、`multimodal_generation` 到默认模型的唯一映射。

多模态表示文本加图片输入、文本或 JSON 输出，不表示图片生成。文本路由可选择文本或多模态模型；多模态路由只允许已启用且 `supports_image_input=true` 的多模态模型。

API Key 使用 AES-256-GCM 加密，每条记录使用随机 nonce。根密钥来自 `MODEL_CONFIG_ENCRYPTION_KEY`，必须是 32 字节 Base64，不进入数据库、API 或日志。生产 Base URL 必须使用 HTTPS；私网地址默认禁止，可由受控部署显式设置 `MODEL_CONFIG_ALLOW_PRIVATE_NETWORK=true`。

连接测试成功后进入 `active`，模型验证成功后进入 `active`。只有 active 模型可以绑定路由；被路由引用的连接或模型不能禁用。第一阶段不自动跨模型重试或回退。

## 使用监控

监控使用两个事实表：

- `generation_usage_events`：每个被系统接受的 Run 记一次生成，不因多 Agent 或重试增加。
- `model_usage_logs`：每次真实供应商请求记一次，包括失败和重试。

模型调用前必须先写入 `running` 日志；写入失败时不调用供应商。完成后记录状态、延迟、供应商 request id 和供应商返回的 token。供应商没有返回 token 时设置 `tokens_available=false`，不估算。

监控提供 7 天、30 天和最长 180 天范围，显示总体汇总、每日趋势、用户维度和模型总体维度。时间以 UTC 存储，按 Asia/Shanghai 日历日聚合。超过 15 分钟仍为 `running` 的调用在查询时标记为 `STALE_RUNNING_RECONCILED`。

## 前端访问

- 管理端路由：`/admin/users`、`/admin/models`、`/admin/usage`。
- 客户端账号菜单只对 admin 显示“系统设置”。
- 普通用户直接访问管理路由时，角色守卫返回 `/`；管理 API 仍独立返回 403。

## 路由

- API：`docs/api/admin.md`
- 规格：`docs/specs/009-admin-user-management.md`、`010-admin-model-configuration.md`、`011-admin-usage-monitoring.md`
- ADR：`007`、`008`、`009`
- 测试：`docs/testing/plans/admin.md`、`docs/testing/cases/admin.md`

# API：系统设置

全部接口要求有效 access token 且 `role=admin`。响应永不返回 API Key 明文、密文、nonce 或 auth tag。

## 模型连接

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/admin/model-connections` | 连接列表，只返回 `secretConfigured`。 |
| POST | `/admin/model-connections` | 创建 OpenAI Compatible 连接。 |
| PATCH | `/admin/model-connections/:id` | 更新连接，可替换密钥。 |
| POST | `/admin/model-connections/:id/test` | 调用供应商 `/models` 测试。 |
| POST | `/admin/model-connections/:id/disable` | 禁用未被路由使用的连接。 |

## 模型

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/admin/model-configs` | 模型列表。 |
| POST | `/admin/model-configs` | 创建模型能力配置。 |
| PATCH | `/admin/model-configs/:id` | 更新并回到待验证状态。 |
| POST | `/admin/model-configs/:id/validate` | 发起最小 chat completion 验证。 |
| POST | `/admin/model-configs/:id/disable` | 禁用未被路由使用的模型。 |

`modality` 为 `text` 或 `multimodal`。`text` 模型不能设置 `supportsImageInput=true`。

## 默认路由

- `GET /admin/model-routes`
- `PATCH /admin/model-routes/:routeKey`

更新请求包含 `modelConfigId` 与当前 `version`，版本不匹配返回 `MODEL_CONFIG_CONFLICT`。`multimodal_generation` 只接受已验证的图片输入模型。

## 使用监控

`GET /admin/usage?from=2026-07-01&to=2026-07-30`

返回：

- `summary`：生成次数、模型调用次数、输入/输出/总 token 和 token 不可用调用数。
- `trend`：按 Asia/Shanghai 日历日聚合。
- `users`：用户生成次数和模型 token。
- `models`：系统模型调用次数和 token。

范围必须有效且不超过 180 天。

## 主要错误码

| 错误码 | HTTP | 说明 |
| --- | --- | --- |
| `PERMISSION_REQUIRED` | 403 | 非管理员。 |
| `MODEL_ENCRYPTION_KEY_REQUIRED` | 503 | 未配置根密钥。 |
| `MODEL_BASE_URL_HTTPS_REQUIRED` | 400 | 生产连接未使用 HTTPS。 |
| `MODEL_BASE_URL_PRIVATE_FORBIDDEN` | 400 | 私网模型地址未获部署许可。 |
| `MODEL_CONNECTION_IN_USE` | 409 | 连接仍被默认路由使用。 |
| `MODEL_CONFIG_IN_USE` | 409 | 模型仍被默认路由使用。 |
| `MODEL_CAPABILITY_MISMATCH` | 422 | 模型不满足路由能力。 |
| `GENERATION_MODEL_UNAVAILABLE` | 503 | 生成所需路由或配置不可用。 |
| `USAGE_RANGE_INVALID` | 400 | 查询时间范围无效或超过 180 天。 |

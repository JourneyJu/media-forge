# 规格 010：控制台模型配置

## 状态

Proposed

## 目标

由管理员统一管理模型供应商连接、具体模型和默认能力路由。模型配置加密保存到 PostgreSQL，替换当前由 `MODEL_GATEWAY_*` 环境变量提供业务模型配置的方式。

完成后，管理员可以：

- 创建和测试供应商连接；
- 创建纯文本或多模态模型；
- 验证模型能力；
- 设置文本生成和多模态生成的默认模型；
- 禁用不再使用的连接或模型；
- 查看最近验证状态，但不能读取 API Key。

## 权限

- 只有 `admin` 可以进入 `/admin/models`。
- 普通 `user` 不显示系统设置入口。
- 普通用户直接访问页面时返回客户端首页。
- 任一模型管理 API 都必须在后端再次校验 `role == "admin"`。
- 未登录返回 `UNAUTHORIZED`，非管理员返回 `PERMISSION_REQUIRED`。

## 核心概念

### 模型连接

`ModelConnection` 表示一组供应商协议、base URL 和凭据。多个模型可以共用同一个连接。

第一阶段 adapter：

| `adapterType` | 说明 |
| --- | --- |
| `openai_compatible` | 使用 OpenAI 风格 `/chat/completions` 协议。 |

OpenAI、DeepSeek 或其他服务只有在协议兼容时才能使用该 adapter。Anthropic、Gemini 原生协议需要后续新增专用 adapter。

### 模型配置

`ModelConfig` 表示供应商连接下的一个具体模型及其能力。

模态：

| `modality` | 输入 | 输出 |
| --- | --- | --- |
| `text` | 文本 | 文本或结构化 JSON |
| `multimodal` | 文本、图片 | 文本或结构化 JSON |

多模态不包含图片生成。未来的图片生成模型使用独立类型和路由。

### 模型路由

`ModelRoute` 表示系统能力当前使用的默认模型。

| `routeKey` | 触发条件 | 模型约束 |
| --- | --- | --- |
| `text_generation` | 生成请求不包含图片 | `text` 或 `multimodal` |
| `multimodal_generation` | 请求包含图片或明确要求视觉能力 | `multimodal` 且支持图片输入 |

同一个多模态模型可以同时被两条路由引用。

## 数据模型

### `model_connections`

| 字段 | 说明 |
| --- | --- |
| `id` | 连接 ID。 |
| `name` | 管理员可读名称，全局唯一。 |
| `adapter_type` | 第一阶段固定为 `openai_compatible`。 |
| `base_url` | 供应商 API 基础地址，不包含尾部斜杠。 |
| `api_key_ciphertext` | AES-256-GCM 密文。 |
| `api_key_nonce` | 独立随机 nonce。 |
| `api_key_auth_tag` | GCM 认证标签。 |
| `encryption_key_version` | 加密根密钥版本。 |
| `status` | `draft`、`active`、`disabled`。 |
| `last_tested_at` | 最近测试时间。 |
| `last_test_status` | `unknown`、`passed`、`failed`。 |
| `last_error_code` | 最近一次安全错误码，不保存供应商完整响应。 |
| `created_by` / `updated_by` | 管理员用户 ID。 |
| `created_at` / `updated_at` | 生命周期时间。 |
| `version` | 乐观锁版本。 |

### `model_configs`

| 字段 | 说明 |
| --- | --- |
| `id` | 模型配置 ID。 |
| `connection_id` | 所属连接。 |
| `display_name` | 管理员可读名称。 |
| `model_id` | 发送给供应商的模型标识。 |
| `modality` | `text` 或 `multimodal`。 |
| `supports_text_input` | 是否支持文本输入，第一阶段必须为 `true`。 |
| `supports_image_input` | 是否支持图片输入。 |
| `supports_structured_output` | 是否支持结构化 JSON 输出。 |
| `context_window` | 上下文窗口提示值。 |
| `max_output_tokens` | 默认最大输出 Token。 |
| `temperature_default` | 默认 temperature。 |
| `timeout_ms` | 单次请求超时。 |
| `status` | `draft`、`active`、`disabled`。 |
| `last_validated_at` | 最近能力验证时间。 |
| `last_validation_status` | `unknown`、`passed`、`failed`。 |
| `last_error_code` | 最近一次安全错误码。 |
| `created_by` / `updated_by` | 管理员用户 ID。 |
| `created_at` / `updated_at` | 生命周期时间。 |
| `version` | 乐观锁版本。 |

约束：

- `modality=text` 时，`supports_image_input` 必须为 `false`。
- `modality=multimodal` 时，`supports_image_input` 必须为 `true`。
- 同一连接下 `model_id` 唯一。
- `timeout_ms`、Token 参数和 temperature 必须位于契约允许范围。

### `model_routes`

| 字段 | 说明 |
| --- | --- |
| `route_key` | 能力路由，全局唯一。 |
| `model_config_id` | 当前默认模型。 |
| `updated_by` | 修改管理员。 |
| `updated_at` | 修改时间。 |
| `version` | 乐观锁版本。 |

## 密钥管理

### 加密

- 使用 AES-256-GCM。
- 每次写入或替换密钥都生成新 nonce。
- 根密钥由部署环境或 Secret Manager 提供。
- 根密钥不得保存到 PostgreSQL。
- 通过 `encryption_key_version` 支持后续轮换。
- 解密失败必须返回安全错误，不能把密文、nonce、tag 或根密钥写入日志。

### API 表现

创建或替换连接时请求可以包含 `apiKey`。后续读取只返回：

```json
{
  "secretConfigured": true
}
```

不得返回：

- API Key 明文；
- API Key 密文；
- 可用于识别真实密钥的尾号；
- nonce、auth tag 或加密根密钥版本的内部细节。

更新请求未提供 `apiKey` 时保持原密钥；提供新值时替换；清空密钥使用明确的单独操作，不能用空字符串表达。

## 生命周期与操作

### 创建连接

1. 管理员输入名称、adapter、base URL 和 API Key。
2. 服务端校验 URL 和字段。
3. 加密 API Key。
4. 创建 `draft` 连接。
5. 写入 `model_connection.created` 审计事件。

### 测试连接

连接测试验证：

- base URL 可访问；
- API Key 有效；
- adapter 协议匹配；
- 服务返回可解析响应；
- 请求在配置超时时间内完成。

测试不得保存完整供应商请求和响应。成功后更新 `last_test_status=passed`，管理员才可启用连接。

### 创建和验证模型

1. 选择连接并填写模型 ID、模态和参数。
2. 创建 `draft` 模型。
3. 执行纯文本响应验证。
4. 开启结构化输出时执行 JSON 验证。
5. 多模态模型额外使用系统受控测试图片验证图片输入。
6. 全部必需验证通过后才能启用。

### 设置默认路由

- 路由变更必须在事务中完成。
- 请求携带当前 `version`，冲突返回 `MODEL_ROUTE_VERSION_CONFLICT`。
- 服务端校验连接、模型、状态、验证结果和模态。
- 成功后写入 `model_route.updated` 审计事件。
- 新请求使用新路由，执行中的请求保持原配置快照。

### 禁用

- 被任一路由引用的模型不能直接禁用。
- 存在启用模型的连接不能直接禁用。
- 管理员必须先切换路由或禁用关联模型。
- 禁用不删除历史记录、用量关联和审计。

## 路由解析

```text
接收生成请求
  → request.hasImageInput
      → true: multimodal_generation
      → false: text_generation
  → 读取 route
  → 读取 model config 和 connection
  → 校验 active、验证状态和能力
  → 解密凭据
  → 生成不可变调用快照
  → 调用 adapter
```

调用快照至少包含：

```text
model_config_id
model_route_key
adapter_type
base_url
model_id
timeout_ms
temperature
max_output_tokens
```

API Key 仅在内存调用上下文中存在，不进入快照、事件、日志或 usage record。

第一阶段不自动跨模型 fallback 或重试。缺少路由、模型被禁用、连接测试失败或能力不匹配时返回 `GENERATION_MODEL_UNAVAILABLE`。

## 页面设计

页面路由为 `/admin/models`，结构与客户端视觉体系一致：

- 左侧系统设置导航，“模型配置”为当前项。
- 中间顶部展示 `text_generation` 和 `multimodal_generation` 默认路由。
- 中间列表展示模型、供应商连接、模态、状态、默认用途和最近验证。
- 支持按名称搜索，按纯文本、多模态和状态筛选。
- 右侧展示选中模型详情、连接、能力、上下文窗口和输出参数。
- API Key 字段只支持替换，不显示真实内容。
- 提供“测试连接”“验证能力”“保存更改”和“设置为默认”操作。

路由切换必须是独立确认操作，不能因普通参数编辑而隐式改变生产默认模型。

## 目标接口

### 连接

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/admin/model-connections` | 查询连接列表。 |
| `POST` | `/admin/model-connections` | 创建连接并加密凭据。 |
| `PATCH` | `/admin/model-connections/:connectionId` | 更新名称、地址、状态或替换凭据。 |
| `POST` | `/admin/model-connections/:connectionId/test` | 测试连接。 |
| `POST` | `/admin/model-connections/:connectionId/disable` | 禁用未被使用的连接。 |

### 模型

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/admin/model-configs` | 查询模型列表。 |
| `POST` | `/admin/model-configs` | 创建模型配置。 |
| `GET` | `/admin/model-configs/:modelConfigId` | 获取模型详情。 |
| `PATCH` | `/admin/model-configs/:modelConfigId` | 更新模型能力和参数。 |
| `POST` | `/admin/model-configs/:modelConfigId/validate` | 验证模型能力。 |
| `POST` | `/admin/model-configs/:modelConfigId/disable` | 禁用未被路由引用的模型。 |

### 路由

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/admin/model-routes` | 查询默认能力路由。 |
| `PATCH` | `/admin/model-routes/:routeKey` | 原子切换默认模型。 |

## 错误码

| 错误码 | HTTP | 说明 |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | 未登录或会话无效。 |
| `PERMISSION_REQUIRED` | 403 | 当前用户不是管理员。 |
| `MODEL_CONNECTION_NOT_FOUND` | 404 | 连接不存在。 |
| `MODEL_CONFIG_NOT_FOUND` | 404 | 模型不存在。 |
| `MODEL_ROUTE_NOT_FOUND` | 404 | 路由不存在。 |
| `MODEL_CONNECTION_INVALID` | 422 | 连接字段或协议不合法。 |
| `MODEL_CONFIG_INVALID` | 422 | 模型字段、能力或参数不合法。 |
| `MODEL_CONNECTION_TEST_FAILED` | 422 | 连接测试失败。 |
| `MODEL_CAPABILITY_VALIDATION_FAILED` | 422 | 模型能力验证失败。 |
| `MODEL_SECRET_ENCRYPTION_FAILED` | 500 | 密钥加密失败。 |
| `MODEL_SECRET_DECRYPTION_FAILED` | 500 | 密钥解密失败。 |
| `MODEL_ROUTE_CAPABILITY_MISMATCH` | 422 | 模型能力不满足路由要求。 |
| `MODEL_ROUTE_VERSION_CONFLICT` | 409 | 路由已被其他管理员修改。 |
| `MODEL_ROUTE_IN_USE` | 409 | 模型或连接仍被默认路由引用。 |
| `GENERATION_MODEL_UNAVAILABLE` | 503 | 当前请求没有可用默认模型。 |

错误响应不得包含供应商原始响应、API Key、请求 header 或敏感 URL query。

## 审计

至少记录：

```text
model_connection.created
model_connection.updated
model_connection.secret_replaced
model_connection.tested
model_connection.disabled
model_config.created
model_config.updated
model_config.validated
model_config.disabled
model_route.updated
```

审计 metadata 可以记录配置 ID、状态、route key 和错误码，不记录 API Key、密文或完整供应商响应。

## 环境变量迁移

当前实现读取：

```text
MODEL_GATEWAY_PROVIDER
MODEL_GATEWAY_BASE_URL
MODEL_GATEWAY_API_KEY
MODEL_GATEWAY_DEFAULT_MODEL
MODEL_GATEWAY_TIMEOUT_MS
```

迁移步骤：

1. 先上线数据库表、管理 API 和页面。
2. 管理员手工添加连接和模型。
3. 完成连接测试和能力验证。
4. 设置两条默认路由。
5. 将生成链路切换到数据库路由。
6. 完成文本、多模态和 Creation Graph 冒烟测试。
7. 观察期内旧环境变量只用于旧版本回滚，新代码不读取。
8. 验收后删除旧业务模型环境变量。

最终没有环境变量 fallback。数据库没有有效路由时，生成请求明确失败，不静默使用其他模型。

加密根密钥仍由部署环境或 Secret Manager 管理，不属于被移除的业务模型配置。

## 与用量监控的关系

每次模型调用写入：

```text
user_id
model_config_id
route_key
provider
model_id
input_tokens
output_tokens
total_tokens
duration_ms
status
error_code
created_at
```

模型被禁用或归档后仍保留 ID，确保历史用量可以按用户和模型统计。

## 验收标准

- 普通用户不能查看或修改任何模型配置。
- 管理员可以创建连接，但 API 不回显密钥。
- 密钥以 AES-256-GCM 加密保存，日志和审计无敏感信息。
- 未测试连接、未验证模型不能被设置为默认。
- 文本请求使用 `text_generation`。
- 图片输入使用 `multimodal_generation`，且不能指向纯文本模型。
- 同一多模态模型可以同时承担两条路由。
- 路由切换具备事务和版本冲突保护。
- 被路由引用的模型或连接不能直接禁用。
- 缺少有效模型时返回 `GENERATION_MODEL_UNAVAILABLE`，不读取旧业务环境变量。
- 用量记录包含实际 `model_config_id` 和 `route_key`。

## 已确认设计

- PostgreSQL 是模型业务配置唯一事实源。
- 采用连接、模型、路由三层结构。
- 第一阶段区分纯文本和多模态输入，不包含图片生成。
- 第一阶段只实现 `openai_compatible` adapter。
- API Key 写入型管理、AES-256-GCM 加密、响应不回显。
- 功能上线后由管理员手工添加配置，不自动导入环境变量。
- 第一阶段不自动跨模型 fallback 或重试。

## 关联文档

- `.plan/20260730-admin-model-configuration.md`
- `docs/adr/008-database-model-configuration-and-capability-routing.md`
- `docs/modules/admin/README.md`
- `docs/modules/ai-generation/README.md`
- `docs/api/admin.md`

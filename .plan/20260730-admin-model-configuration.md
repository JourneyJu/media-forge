# L 级改动计划：控制台模型配置

## 需求背景

MediaForge 当前通过 `MODEL_GATEWAY_*` 环境变量配置单一 OpenAI 兼容模型。该方式适合本地开发，但部署后不便于管理员维护、区分纯文本与多模态能力，也无法安全地切换默认模型。

目标是由管理员在系统设置中维护供应商连接、具体模型和默认能力路由。模型业务配置以 PostgreSQL 为唯一事实源，API Key 加密保存。功能完成后由管理员手工添加配置，不自动导入旧环境变量。

本需求属于 L 级改动，因为会新增数据库 schema、管理 API、密钥加密方案，并改变 AI 模型解析和调用主链路。

## 分级结论

```text
需求分级：L
分级理由：新增模型配置 schema、加密凭据、管理 API，并替换环境变量模型调用主链路。
影响面：apps/web、apps/service、packages/contracts、PostgreSQL、AI 调用链路、安全、部署和文档。
是否需要人工确认：是
下一步：评审计划、功能规格和 ADR，确认后同步事实文档、契约并实现。
```

## 非目标

- 本阶段不实现用户管理和使用监控页面。
- 第一阶段不实现图片生成、语音、视频、embedding 或 rerank 模型。
- 第一阶段不实现自动模型选择、基于价格的动态路由或跨模型自动重试。
- 第一阶段只实现 `openai_compatible` adapter，不承诺支持 Anthropic、Gemini 等原生协议。
- 不把加密根密钥存入 PostgreSQL。
- 不自动读取或导入旧 `MODEL_GATEWAY_*` 环境变量。
- 不允许普通用户选择、查看或覆盖系统模型。

## 影响面

| 领域 | 是否影响 | 说明 |
| --- | --- | --- |
| 前端 | 是 | 新增模型配置页面、连接测试、能力验证和默认路由切换。 |
| 后端服务 | 是 | 新增配置仓储、密钥加解密、管理 API 和模型解析器。 |
| 共享契约 | 是 | 新增连接、模型、路由、验证结果和错误码契约。 |
| 数据库 schema | 是 | 新增 `model_connections`、扩展 `model_configs`、新增 `model_routes`。 |
| 对象存储 | 否 | 模型配置和密钥不进入对象存储。 |
| Redis / 队列 | 否 | 第一阶段不依赖配置缓存；后续可增加短期缓存。 |
| AI 调用链路 | 是 | 从环境变量读取改为按请求能力读取数据库路由。 |
| 权限 / 安全 | 是 | 只有 `admin` 可管理；API Key 使用 AES-256-GCM 加密。 |
| 部署 / 环境变量 | 是 | 业务模型环境变量退出；仅保留加密根密钥等部署秘密。 |
| 文档 | 是 | 新增规格和 ADR，确认后同步架构、模块、API 和测试文档。 |

## 推荐方案

### 三层模型

模型配置拆分为：

1. `model_connections`：供应商协议、base URL 和加密凭据。
2. `model_configs`：具体模型、模态、能力和运行参数。
3. `model_routes`：系统能力到默认模型的唯一映射。

该结构避免多个模型重复保存相同 API Key，也使默认模型切换不需要修改模型记录或业务代码。

### 能力定义

第一阶段模型模态：

| `modality` | 说明 |
| --- | --- |
| `text` | 只接受文本输入。 |
| `multimodal` | 接受文本和图片输入，输出文本或结构化 JSON。 |

第一阶段路由：

| `route_key` | 选择条件 | 可选模型 |
| --- | --- | --- |
| `text_generation` | 请求不包含图片输入 | `text` 或 `multimodal` |
| `multimodal_generation` | 请求包含图片，或业务节点明确要求视觉能力 | 仅 `multimodal` 且 `supports_image_input=true` |

多模态不等于图片生成。未来图片生成使用独立的 `image_generation` 路由和契约。

### 路由流程

```text
生成请求
  → 识别是否包含图片输入
  → 解析 route_key
  → 读取 model_routes
  → 加载 active model_config
  → 加载 active model_connection
  → 校验能力和验证状态
  → 解密 API Key
  → 调用 adapter
  → 写 usage_logs
```

第一阶段不自动跨模型重试。模型、连接或路由不可用时返回稳定错误，避免重复计费和生成行为漂移。

### 生命周期

连接：

```text
draft → 测试成功 → active → disabled
```

模型：

```text
draft → 能力验证成功 → active → disabled
```

约束：

- 未测试成功的连接不能启用。
- 未验证成功的模型不能设为默认路由。
- 被默认路由引用的模型和连接不能直接禁用。
- 路由切换使用数据库事务和乐观锁。
- 切换后新请求使用新路由；执行中的请求继续使用开始时的配置快照。
- 历史配置优先禁用或归档，不物理删除，避免破坏用量和审计记录。

## 密钥安全

- API Key 使用 AES-256-GCM 加密。
- 每条密钥使用独立随机 nonce。
- 数据库保存 ciphertext、nonce、auth tag 和 `encryption_key_version`。
- 加密根密钥由部署环境或 Secret Manager 管理，不写入数据库、代码、文档或日志。
- API Key 只允许创建、替换或清空，不提供读取接口。
- API 响应只返回 `secretConfigured`，不返回密钥明文、密文或真实尾号。
- 加解密只发生在服务端内存中，使用后不进入业务日志。
- 所有密钥更新、连接测试、模型验证和路由切换写审计事件。

模型配置退出环境变量不代表系统不再需要部署秘密。加密根密钥、数据库连接和服务凭证仍属于部署安全配置。

## 契约与数据变更

### `model_connections`

```text
id
name
adapter_type
base_url
api_key_ciphertext
api_key_nonce
api_key_auth_tag
encryption_key_version
status
last_tested_at
last_test_status
last_error_code
created_by
updated_by
created_at
updated_at
version
```

### `model_configs`

```text
id
connection_id
display_name
model_id
modality
supports_text_input
supports_image_input
supports_structured_output
context_window
max_output_tokens
temperature_default
timeout_ms
status
last_validated_at
last_validation_status
last_error_code
created_by
updated_by
created_at
updated_at
version
```

### `model_routes`

```text
route_key
model_config_id
updated_by
updated_at
version
```

### 目标 API

```text
GET    /admin/model-connections
POST   /admin/model-connections
PATCH  /admin/model-connections/:connectionId
POST   /admin/model-connections/:connectionId/test
POST   /admin/model-connections/:connectionId/disable

GET    /admin/model-configs
POST   /admin/model-configs
GET    /admin/model-configs/:modelConfigId
PATCH  /admin/model-configs/:modelConfigId
POST   /admin/model-configs/:modelConfigId/validate
POST   /admin/model-configs/:modelConfigId/disable

GET    /admin/model-routes
PATCH  /admin/model-routes/:routeKey
```

## allowed_files 草案

```yaml
allowed_files:
  - .plan/20260730-admin-model-configuration.md
  - docs/specs/010-admin-model-configuration.md
  - docs/adr/008-database-model-configuration-and-capability-routing.md
  - docs/adr/README.md
  - docs/architecture/overview.md
  - docs/architecture/database.md
  - docs/modules/admin/README.md
  - docs/modules/ai-generation/README.md
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
  - apps/service/src/model-config/**
  - apps/service/src/model-gateway.ts
  - apps/service/src/ai-generation.ts
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

正式实现时按数据库基础、连接管理、模型管理、路由接入和前端页面拆成独立垂直切片，并为每个切片重新锁定 `allowed_files`。

## 实施步骤

1. 评审并确认计划、规格和 ADR。
2. 同步架构、数据库、admin/ai-generation 模块、API 和测试文档。
3. 在 `packages/contracts` 定义连接、模型、路由和错误码。
4. 新增数据库迁移和唯一性、外键、状态约束。
5. 实现 AES-256-GCM 凭据服务和密钥轮换版本字段。
6. 实现连接管理、写入脱敏和连接测试。
7. 实现模型管理、纯文本验证和多模态能力验证。
8. 实现事务化默认路由切换和路由解析器。
9. 将 `model-gateway.ts`、AI 生成和 Creation Graph 从环境变量迁移到路由解析器。
10. 实现管理页面并接入管理员路由守卫。
11. 手工添加生产模型配置，完成文本和多模态冒烟测试。
12. 观察期结束后删除业务模型环境变量和兼容代码。

## 验证方案

- 契约测试：状态、模态、路由、分页、写入脱敏和错误码。
- 加密测试：不同 nonce、认证标签校验、错误根密钥、密文篡改和 key version。
- 仓储测试：外键、唯一性、乐观锁和路由事务。
- 权限测试：普通用户调用任一管理接口返回 403。
- 连接测试：凭据错误、base URL 错误、超时和协议不兼容。
- 能力测试：纯文本、结构化输出和受控图片输入。
- 路由测试：文本请求、多模态请求、缺失路由、禁用模型和配置切换。
- 安全测试：响应、日志、错误、审计和快照不包含密钥。
- 手动测试：添加连接、测试、添加模型、验证、切换路由并完成真实生成。

## 迁移与回滚

迁移：

1. 部署 schema、管理 API 和页面，新代码暂不切换模型解析器。
2. 管理员手工创建连接和模型，完成测试与验证。
3. 配置 `text_generation` 和 `multimodal_generation`。
4. 切换模型解析器到 PostgreSQL 路由。
5. 完成文本、多模态和 Creation Graph 冒烟测试。
6. 观察期内保留旧环境变量仅用于旧版本回滚，新代码不得读取。
7. 验收后删除 `MODEL_GATEWAY_PROVIDER`、`MODEL_GATEWAY_BASE_URL`、`MODEL_GATEWAY_API_KEY`、`MODEL_GATEWAY_DEFAULT_MODEL` 和 `MODEL_GATEWAY_TIMEOUT_MS`。

目标态不存在环境变量业务模型 fallback。没有有效路由时返回 `GENERATION_MODEL_UNAVAILABLE`。

回滚：

- 数据库迁移先保留新表，不删除已录入配置。
- 代码可回滚到仍读取旧环境变量的上一版本。
- 路由切换和配置变更通过审计记录恢复到前一版本。
- 已写入的用量记录继续引用原 `model_config_id`。
- 不在回滚过程中导出或解密 API Key。

## 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| API Key 泄露 | 供应商账户和成本风险 | AES-256-GCM、写入型 API、日志脱敏、最小权限和审计。 |
| 根密钥丢失 | 已存 API Key 无法解密 | Secret Manager 备份、key version 和轮换演练。 |
| 错误模态路由 | 图片请求调用纯文本模型 | 数据库约束、service policy 和路由集成测试。 |
| 路由切换并发冲突 | 默认模型状态不确定 | 事务、行锁或乐观锁、版本冲突返回 409。 |
| 自动重试重复计费 | 成本增加和重复产物 | 第一阶段不做跨模型自动重试。 |
| 环境变量退出过早 | 生产生成不可用 | 先手工配置和冒烟，保留旧版本回滚窗口。 |
| 配置物理删除 | 历史用量引用丢失 | 第一阶段只禁用或归档。 |

## AI 自审

```text
AI 自审结论：通过，需人工确认后实施
分级复核：涉及 schema、加密凭据和 AI 调用主链路，属于 L 级。
服务边界：前端只调用 apps/service；模型供应商仍由 Model Gateway adapter 访问。
契约与数据：连接、模型和路由三层结构及目标 API 已定义。
异常路径：覆盖密钥错误、连接失败、能力不匹配、路由缺失、并发冲突和禁用引用。
安全风险：根密钥与业务配置分离，API Key 不回显，敏感操作可审计。
测试方案：覆盖加密、仓储、权限、能力、路由、迁移和真实冒烟。
反方意见：单表实现更快，但会重复密钥并耦合连接与模型，不利于多模型切换。
需要人工重点看的问题：根密钥托管方式、生产切换窗口和第一阶段 adapter 范围。
```

## 人工确认

```text
审核结论：已确认
确认人：用户
确认时间：2026-07-30
备注：用户明确要求“开始对3个模块进行实施”。
```

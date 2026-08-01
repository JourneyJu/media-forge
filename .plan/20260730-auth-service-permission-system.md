# L 级改动计划：独立认证与权限系统

## 需求背景

平台基础创作能力已经具备，需要补齐用户系统和权限系统，并为后续控制台、配额、模型配置和审计提供安全边界。认证与权限独立为 `apps/auth` 服务，第一阶段只开放账号密码登录，并默认引导出一个 `admin` 管理账户。

该需求属于 L 级改动，因为会新增服务边界，变更登录鉴权主链路，新增认证权限相关数据库 schema，并影响 `apps/web`、`apps/service`、`apps/worker` 和 `packages/contracts` 的请求上下文。

## 分级结论

```text
需求分级：L
分级理由：新增独立 auth 服务、认证链路、权限模型、schema、契约和服务边界。
影响面：前端、后端服务、Worker、共享契约、数据库 schema、权限安全、部署环境变量、文档。
是否需要人工确认：是
```

## 非目标

- 第一阶段不接入第三方社交登录、企业 SSO、二维码登录或短信验证码登录。
- 第一阶段不开放用户自助注册；新增用户由管理员创建或邀请。
- 第一阶段不做完整 IAM 平台，不提供自定义策略语言。
- 第一阶段不把模型配置、配额和控制台业务迁入 `apps/auth`。
- 不在代码、文档或日志中写入默认明文密码。

## 影响面

| 领域 | 是否影响 | 说明 |
| --- | --- | --- |
| 前端 | 是 | 新增登录页、会话保持、鉴权态和 401/403 处理。 |
| 后端服务 | 是 | `apps/service` 需要校验 token/session 并生成 `AuthContext`。 |
| Worker | 是 | Worker 需要使用服务凭证或可信上下文执行后台任务。 |
| 共享契约 | 是 | 新增 auth、user、tenant、membership、permission、error code 契约。 |
| 数据库 schema | 是 | 新增用户、租户、成员、角色、权限、会话、refresh token、审计等表。 |
| 对象存储 | 否 | 对象 key 仍按 tenant/user/conversation 路径；权限不依赖对象 key。 |
| Redis / 队列 | 是 | 可用于短期登录限流、会话缓存、权限版本缓存，不保存不可丢失事实。 |
| AI 调用链路 | 间接影响 | AI 业务 API 必须带租户和用户上下文，配额后续基于该上下文。 |
| 权限 / 安全 | 是 | 新增登录、密码哈希、默认 admin、RBAC、租户隔离和审计。 |
| 部署 / 环境变量 | 是 | 新增 auth 服务端口、JWT/JWKS、bootstrap admin、密码哈希参数等配置。 |
| 文档 | 是 | 新增 auth 模块、API、测试方案、ADR，并更新架构和数据库设计。 |

## 方案设计

推荐新增独立服务 `apps/auth`，负责认证、用户、租户成员、角色、权限和认证审计。`apps/service` 只消费身份上下文，不保存密码、不签发用户 token。

```text
Browser
  → apps/web
    → apps/auth      账号密码登录、会话、用户、租户、角色、权限
    → apps/service   业务 API、AI、素材、文章、Conversation
      → PostgreSQL / MinIO / Redis / Model Gateway

apps/worker
  → PostgreSQL / Redis / MinIO / Model Gateway
  → apps/auth JWKS 或服务凭证校验
```

第一阶段登录方式：

- 只支持账号和密码。
- 密码传输依赖 HTTPS / TLS。
- 密码存储使用 Argon2id 不可逆哈希，不使用 RSA 加密保存密码。
- access token 使用非对称签名，`apps/service` 通过 JWKS 校验。
- refresh token 使用高熵随机值，数据库只保存 hash，并启用轮换和重放检测。
- `apps/web` 优先使用 HttpOnly、Secure、SameSite Cookie 维护登录态。

默认 `admin` 账户：

- `apps/auth` 首次启动时，如果不存在任何 `users` 和 `tenant_memberships`，进入 bootstrap 流程。
- 默认创建系统租户和 `admin` 账户，并授予 `owner` 角色。
- `admin` 账户登录名固定为 `admin` 或由 `AUTH_BOOTSTRAP_ADMIN_ACCOUNT` 覆盖。
- 初始密码必须来自 `AUTH_BOOTSTRAP_ADMIN_PASSWORD`；生产环境缺失该变量时启动失败。
- 本地开发环境可生成一次性临时密码并只输出到本地控制台；该密码不写入文档、代码或持久日志。
- 首次登录后必须要求管理员修改密码，完成后清除 `must_change_password` 标记。

权限模型：

- 使用 RBAC，第一阶段内置 `owner`、`admin`、`editor`、`viewer`。
- 权限点以字符串表示，例如 `conversation.read`、`asset.upload`、`tenant.member.manage`。
- 业务资源必须同时校验权限和资源归属；不能只靠资源 ID 或对象存储 key。
- 高风险操作必须写入 `audit_events`。

## 契约与数据变更

计划新增或调整：

- `packages/contracts/src/auth.ts`
- `apps/auth`
- `users`
- `tenants`
- `tenant_memberships`
- `roles`
- `permissions`
- `role_permissions`
- `auth_sessions`
- `oauth_clients`
- `oauth_authorization_codes`
- `oauth_refresh_tokens`
- `audit_events`

主要错误码：

- `UNAUTHORIZED`
- `FORBIDDEN`
- `AUTH_INVALID_CREDENTIALS`
- `AUTH_PASSWORD_CHANGE_REQUIRED`
- `AUTH_SESSION_EXPIRED`
- `AUTH_REFRESH_TOKEN_REUSED`
- `TENANT_MEMBER_REQUIRED`
- `PERMISSION_REQUIRED`

## allowed_files

```yaml
allowed_files:
  - .plan/20260730-auth-service-permission-system.md
  - package.json
  - pnpm-lock.yaml
  - apps/auth/**
  - apps/web/app/login/page.tsx
  - apps/web/app/lib/auth-api.ts
  - apps/web/app/globals.css
  - apps/web/public/login-background.png
  - packages/contracts/src/auth.ts
  - packages/contracts/src/index.ts
  - docs/architecture/overview.md
  - docs/architecture/database.md
  - docs/modules/README.md
  - docs/modules/auth/README.md
  - docs/modules/admin/README.md
  - docs/api/README.md
  - docs/api/auth.md
  - docs/testing/plans/auth.md
  - docs/testing/cases/auth.md
  - docs/adr/006-independent-auth-service-and-rbac.md
  - docs/adr/README.md
verification:
  - pnpm --filter @mediaforge/contracts typecheck
  - pnpm --filter @mediaforge/auth typecheck
  - pnpm --filter @mediaforge/auth test
  - pnpm --filter @mediaforge/web typecheck
  - 手动检查文档路由、模块边界、API、测试方案、ADR 和实现范围是否一致
```

用户已在对话中确认“开始实施包括登录页面”，本计划进入实施状态。

## 实施步骤

1. 完成本文档计划和人工确认。
2. 更新架构、模块、API、测试方案和 ADR。
3. 新增 `packages/contracts/src/auth.ts` 契约。
4. 新增 `apps/auth` 服务骨架、健康检查和配置加载。
5. 实现 bootstrap admin、密码哈希和账号密码登录。
6. 实现 session、access token、refresh token、JWKS。
7. 实现 RBAC、租户成员和权限校验 API。
8. `apps/service` 接入 `AuthContext`，替换 `LOCAL_USER_ID`。
9. `apps/web` 接入登录页和登录态。
10. 补齐测试、迁移和回滚说明。

## 验证方案

- 契约类型检查：`pnpm --filter @mediaforge/contracts typecheck`
- auth 服务类型检查：`pnpm --filter @mediaforge/auth typecheck`
- service 类型检查：`pnpm --filter @mediaforge/service typecheck`
- web 类型检查：`pnpm --filter @mediaforge/web typecheck`
- 全量类型检查：`pnpm typecheck`
- 单元测试覆盖密码哈希、默认 admin、登录失败、token 轮换、权限判断。
- 集成测试覆盖 401、403、租户隔离、资源归属校验和审计写入。

## 迁移与回滚

- 数据迁移新增 auth 表，不破坏已有业务表。
- `LOCAL_USER_ID` 在迁移期只允许本地开发 fallback，生产环境必须禁用。
- 回滚时可停用 auth 接入开关，恢复本地开发假用户，但不得删除已创建的 auth 数据。
- 生产启用前必须完成默认 admin 密码变更和登录链路冒烟测试。

## 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 默认 admin 密码泄露 | 全站接管风险 | 生产必须从环境变量提供初始密码，首次登录强制修改。 |
| 密码存储不当 | 数据库泄露后密码可还原 | 使用 Argon2id + per-user salt，可选 pepper。 |
| 权限只校验角色不校验归属 | 跨租户数据泄露 | 所有业务查询同时带 `tenantId` 和 `ownerId` / membership 校验。 |
| token 撤销延迟 | 被禁用用户短时间仍可访问 | access token 短有效期，refresh token 轮换，权限版本校验。 |
| 服务边界过早复杂化 | 实现周期变长 | 第一阶段只做账号密码、内置 RBAC 和必要 auth API。 |

## AI 自审

```text
AI 自审结论：通过
分级复核：新增服务边界和 schema，属于 L 级。
服务边界：apps/auth 管身份权限，apps/service 管业务，边界清晰。
契约与数据：需要新增 auth 契约和 auth 表，计划中已列出。
异常路径：覆盖登录失败、密码修改、token 重放、禁用用户、权限不足。
安全风险：默认 admin、密码哈希、token 存储和跨租户隔离是重点风险，已列应对。
测试方案：需要 auth 单测、service 集成测试和前端登录冒烟。
反方意见：如果早期只有单用户，可暂缓独立 auth 服务；但控制台、配额和多租户即将需要权限底座，提前抽离更稳。
需要人工重点看的问题：默认 admin bootstrap 策略、是否第一阶段启用 OIDC 标准端点、是否允许本地开发临时密码输出。
```

## 人工确认

```text
审核结论：已确认实施
确认人：用户
确认时间：2026-07-30
备注：用户要求“开始实施包括登录页面”。
```

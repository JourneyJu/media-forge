# L 级改动计划：控制台用户管理

## 需求背景

MediaForge 已具备账号密码登录和独立 `apps/auth` 服务，但当前认证模型按租户、成员关系和多角色 RBAC 设计。产品目标已明确为单系统模式，不存在租户概念，只保留 `admin` 和 `user` 两类用户，并由管理员在控制台管理账号。

本次先完成用户管理设计文档，不进入代码实现。该需求属于 L 级改动，因为会调整认证与权限 schema、`AuthContext`、登录响应、管理 API、前端路由守卫和已有数据迁移策略。

## 分级结论

```text
需求分级：L
分级理由：移除产品租户模型，调整角色、权限、认证契约和数据库 schema。
影响面：apps/auth、apps/service、apps/web、packages/contracts、PostgreSQL、认证安全和文档。
是否需要人工确认：是
下一步：评审用户管理规格和 ADR，确认后再同步契约与事实文档并实现。
```

## 非目标

- 本阶段不实现模型配置和使用监控。
- 不支持用户自助注册、邀请注册、邮箱验证、手机号登录或第三方登录。
- 不支持自定义角色、自定义权限和多级管理员。
- 不提供管理员查看用户当前密码的能力。
- 不删除历史审计数据。
- 不在本轮文档阶段修改生产代码或数据库。

## 影响面

| 领域 | 是否影响 | 说明 |
| --- | --- | --- |
| 前端 | 是 | 新增管理控制台入口、用户管理页面、路由守卫和 401/403 回退。 |
| 后端服务 | 是 | 管理接口要求 `admin`，业务接口继续使用登录用户身份。 |
| `apps/auth` | 是 | 用户创建、列表、更新、禁用、重置密码和单系统角色。 |
| 共享契约 | 是 | `AuthRole`、`AuthContext`、登录响应和用户管理契约需要调整。 |
| 数据库 schema | 是 | 用户字段扩展，租户成员和 RBAC 表进入兼容迁移。 |
| 对象存储 | 间接影响 | 旧对象 key 保持可读；后续新写入不再暴露租户概念。 |
| Redis / 队列 | 否 | 不新增不可丢失状态；可继续用于会话缓存和登录限流。 |
| AI 调用链路 | 间接影响 | 调用归属从 `tenantId + userId` 收敛为 `userId`。 |
| 权限 / 安全 | 是 | 固定临时密码、强制改密、管理员越权和禁用会话是重点风险。 |
| 部署 / 环境变量 | 是 | bootstrap admin 仍使用部署密钥；普通用户初始密码按产品规则生成。 |
| 文档 | 是 | 新增规格和 ADR，确认后同步架构、模块、API 和测试文档。 |

## 推荐方案

### 用户与角色

- 系统仅有 `admin` 和 `user` 两种角色。
- `admin` 可以进入 `/admin/*`，并调用用户管理接口。
- `user` 只能使用客户端创作功能。
- 系统允许存在多个 `admin`，避免单一管理员账号失效后无法管理系统。
- 角色和权限以后端认证上下文为准，前端隐藏入口不构成安全边界。

### 用户字段

| 字段 | 规则 |
| --- | --- |
| `username` | 全局唯一；3-32 个字符；只允许英文字母、数字和下划线；登录时大小写不敏感。 |
| `display_name` | 必填；1-32 个 Unicode 字符；允许中文、英文、数字和常用标点；去除首尾空白。 |
| `role` | `admin` 或 `user`。 |
| `status` | `active` 或 `disabled`。 |
| `must_change_password` | 使用临时密码创建或重置后为 `true`。 |

用户名校验正则：

```text
^[A-Za-z0-9_]{3,32}$
```

数据库使用标准化字段 `username_normalized = lower(username)` 建立唯一索引，避免 `Alice` 和 `alice` 同时存在。

### 密码

- 当前产品要求普通用户初始临时密码为 `12345678`。
- 临时密码只允许在管理员创建用户或重置密码时使用。
- 密码只保存 Argon2id hash，不保存明文或可逆密文。
- 使用临时密码的用户必须标记 `must_change_password=true`。
- 用户登录成功后，在完成改密前只允许访问 `GET /auth/me`、退出和改密相关接口。
- 正式密码长度至少 9 位，且大写字母、小写字母、数字、特殊字符四类中至少包含三类。
- 正式密码不得等于临时密码，也不得与用户名忽略大小写后相同。
- 管理员不能查看、复制或恢复用户的当前密码。

固定临时密码具有撞库和批量接管风险。当前按已确认产品规则采用 `12345678`，实现时必须同时启用强制改密、登录限流、失败锁定和审计；后续可通过新规格迁移为随机一次性临时密码。

### 控制台访问

```text
用户登录
  → GET /auth/me
  → role == admin
      → 客户端账号菜单显示“系统设置”
      → 允许进入 /admin/users
  → role == user
      → 不显示“系统设置”
      → 直接访问 /admin/* 时返回客户端首页
```

后端规则：

- `/admin/*` API 必须再次校验 `role == admin`。
- 未登录返回 `401 UNAUTHORIZED`。
- 已登录但不是管理员返回 `403 PERMISSION_REQUIRED`。
- 前端收到管理接口 401 时进入登录流程；收到 403 时清理管理页面状态并返回客户端首页。
- 禁止只依赖 Next.js 路由或菜单可见性做权限控制。

### 用户管理操作

- 列表：按用户名或显示名搜索，按状态筛选，默认按创建时间倒序。
- 创建：输入用户名、显示名和角色；第一阶段默认角色为 `user`。
- 编辑：允许修改显示名、角色和状态；不允许直接修改用户名。
- 禁用：撤销用户所有活动会话，禁止继续刷新 token。
- 启用：恢复登录资格，不自动恢复旧会话。
- 重置密码：写入临时密码 hash，设置 `must_change_password=true`，撤销全部会话。
- 审计：创建、角色变更、禁用、启用和重置密码必须记录 actor、target、action、结果和时间。

管理员不得禁用自己的当前账号，也不得将系统中最后一个有效管理员降级为普通用户。

## 契约与数据变更

目标 `AuthContext`：

```ts
type AuthContext = {
  userId: string;
  role: "admin" | "user";
  sessionId: string;
  mustChangePassword: boolean;
};
```

目标用户摘要：

```ts
type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
  status: "active" | "disabled";
  mustChangePassword: boolean;
};
```

目标 API：

```text
GET    /auth/me
POST   /auth/password/change
GET    /auth/admin/users
POST   /auth/admin/users
GET    /auth/admin/users/:userId
PATCH  /auth/admin/users/:userId
POST   /auth/admin/users/:userId/reset-password
POST   /auth/admin/users/:userId/disable
POST   /auth/admin/users/:userId/enable
```

计划调整的表：

- `users`：增加或统一 `username`、`username_normalized`、`display_name`、`role`、`status`、`must_change_password`。
- `auth_sessions` 和 refresh token 表：继续保留，并支持按 `user_id` 批量撤销。
- `audit_events`：继续保留，去除新事件对 `tenant_id` 的强制依赖。
- `tenants`、`tenant_memberships`、`roles`、`permissions`、`role_permissions`：先停止新写入，再迁移引用，最后删除或归档。

## allowed_files 草案

```yaml
allowed_files:
  - .plan/20260730-admin-user-management.md
  - docs/specs/009-admin-user-management.md
  - docs/adr/007-single-system-user-and-admin-role.md
  - docs/adr/README.md
  - docs/architecture/overview.md
  - docs/architecture/database.md
  - docs/modules/auth/README.md
  - docs/modules/admin/README.md
  - docs/api/auth.md
  - docs/api/admin.md
  - docs/testing/plans/auth.md
  - docs/testing/cases/auth.md
  - docs/testing/plans/admin.md
  - docs/testing/cases/admin.md
  - packages/contracts/src/auth.ts
  - packages/contracts/src/admin.ts
  - packages/contracts/src/index.ts
  - apps/auth/migrations/**
  - apps/auth/src/**
  - apps/auth/test/**
  - apps/service/src/auth.ts
  - apps/service/test/**
  - apps/web/middleware.ts
  - apps/web/app/**
verification:
  - pnpm --filter @mediaforge/contracts typecheck
  - pnpm --filter @mediaforge/auth typecheck
  - pnpm --filter @mediaforge/auth test
  - pnpm --filter @mediaforge/service typecheck
  - pnpm --filter @mediaforge/service test
  - pnpm --filter @mediaforge/web typecheck
  - pnpm test
```

正式实现前按垂直切片拆分任务，每个任务重新锁定不超过约 5 个文件的 `allowed_files`。

## 实施步骤

1. 评审并确认本计划、功能规格和 ADR。
2. 同步架构、数据库、auth/admin 模块、API 和测试文档。
3. 先修改 `packages/contracts`，定义单系统认证与用户管理契约。
4. 编写数据库迁移，补齐用户字段并准备租户兼容映射。
5. 在 `apps/auth` 实现用户管理 service、policy 和 API。
6. 调整 token 和 `AuthContext`，移除新请求对租户成员关系的依赖。
7. 在 `apps/service` 接入新的身份上下文。
8. 在 `apps/web` 实现管理员入口、路由守卫和用户管理页面。
9. 补齐自动化测试、手动冒烟和迁移验证。
10. 确认生产数据迁移完成后，再删除不再使用的租户/RBAC 表和兼容代码。

## 验证方案

- 契约：用户名、显示名、角色、状态、分页和错误码 schema 测试。
- auth 单测：创建、唯一性、密码策略、自保规则、最后管理员保护、禁用和重置密码。
- auth 集成：401、403、强制改密、会话撤销和审计。
- service 集成：新 `AuthContext` 可访问本人资源，不能伪造用户身份。
- web：普通用户看不到入口，直接访问管理路由会返回客户端首页。
- 手动验证：管理员完成搜索、创建、编辑、禁用、启用和重置密码闭环。
- 安全检查：API、日志、审计和页面均不出现密码明文或 hash。

## 迁移与回滚

迁移分三阶段：

1. 兼容阶段：从现有 membership 计算用户角色，`owner/admin` 映射为 `admin`，`editor/viewer` 映射为 `user`。
2. 切换阶段：token 同时兼容旧、新 claims；新代码只写用户角色，不再新增租户成员关系。
3. 清理阶段：确认无旧 token、无租户查询和无外键引用后，删除租户/RBAC 表及字段。

对象存储旧 key 不批量移动，保持兼容读取；对象路径调整另立计划。

回滚时：

- 数据迁移必须保留角色映射备份，不删除旧租户/RBAC 表。
- 可切回旧 token claims 和 membership 查询。
- 已创建或已修改的用户记录不得删除。
- 禁用和重置密码产生的会话撤销不回滚。

## 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 固定临时密码公开 | 新用户在首次登录前被接管 | 强制改密、限流、失败锁定、审计；优先评审随机临时密码替代方案。 |
| 删除租户字段过早 | 旧 token 或业务查询失效 | 双读兼容、分阶段迁移、延后物理删除。 |
| 最后管理员被禁用或降级 | 系统失去管理入口 | policy 层阻止操作，并使用事务锁保证并发安全。 |
| 前端隐藏入口被绕过 | 普通用户访问管理数据 | 后端每个管理接口强制校验 admin。 |
| 用户名大小写重复 | 登录歧义 | `username_normalized` 唯一索引。 |
| 禁用后 token 仍有效 | 被禁用用户短期继续访问 | 撤销 refresh token，短 access token，有条件时校验 session/version。 |

## AI 自审

```text
AI 自审结论：通过，需人工确认高风险项
分级复核：涉及认证 schema、权限主链路和迁移，属于 L 级。
服务边界：apps/auth 继续管理身份，apps/service 只消费 AuthContext，未打破边界。
契约与数据：目标 AuthContext、用户字段、管理 API 和分阶段迁移已说明。
异常路径：覆盖用户名冲突、自我禁用、最后管理员、禁用会话和强制改密。
安全风险：固定临时密码是最大风险，文档未将其视为普通正式密码。
测试方案：包含契约、单测、集成、前端路由和安全验证。
反方意见：保留单例 tenant 可减少迁移，但会长期保留无产品语义的复杂度；推荐分阶段彻底移除。
需要人工重点看的问题：固定临时密码的风险控制是否完整；租户兼容迁移窗口是否可接受。
```

## 人工确认

```text
审核结论：已确认
确认人：用户
确认时间：2026-07-30
备注：用户明确要求“开始对3个模块进行实施”。
```

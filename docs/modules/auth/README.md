# 模块：认证与用户管理

## 模块定位

`apps/auth` 负责单系统用户、登录会话、密码和用户管理。产品层没有租户概念，角色固定为 `admin` 与 `user`；旧租户和 RBAC 表仅在兼容迁移窗口保留，不再作为新请求的权限事实源。

## 用户规则

- `username` 全局唯一，登录时大小写不敏感，只允许 3-32 位英文字母、数字和下划线。
- `display_name` 必填，1-32 个 Unicode 字符，允许中英文混合。
- 管理员创建或重置用户后，初始密码固定为 `12345678`，并设置 `must_change_password=true`。
- 正式密码至少 9 位，大写、小写、数字、特殊字符四类中至少三类。
- 正式密码不能是临时密码，也不能与用户名忽略大小写后相同。
- 连续 5 次失败登录后锁定 15 分钟；成功登录清零失败计数。

## 权限和路由

```text
apps/web 获取 GET /auth/me
  → admin：显示系统设置并允许进入 /admin/*
  → user：不显示系统设置，直接访问管理路由时返回客户端首页

管理 API
  → 校验 access token
  → 重新读取当前用户状态和角色
  → role != admin 返回 403 PERMISSION_REQUIRED
```

前端隐藏入口不是安全边界。`apps/auth` 的用户管理 API 和 `apps/service` 的模型、监控 API 都必须执行后端管理员校验。

## AuthContext

```ts
type AuthContext = {
  userId: string;
  role: "admin" | "user";
  sessionId: string;
  mustChangePassword: boolean;
};
```

业务服务验证 JWT 的 `RS256` 签名、`iss`、`aud` 和 `exp`。`mustChangePassword=true` 时只允许认证服务的用户信息、退出和改密接口，业务 API 返回 `AUTH_PASSWORD_CHANGE_REQUIRED`。

## 会话和安全

- access token 只保存在浏览器内存，默认有效期 15 分钟。
- refresh token 通过 HttpOnly Cookie 传递，数据库仅保存 SHA-256 hash。
- refresh token 每次刷新必须轮换；检测重放时撤销整个 family。
- 禁用用户和重置密码会撤销该用户全部 session 与活动 refresh token。
- 密码请求使用 RSA-OAEP-256 二次封装，存储使用 Argon2id。
- 管理员不能禁用或降级自己，也不能禁用或降级最后一个有效管理员。
- 创建、更新、禁用、启用和重置密码写入 `audit_events`，不记录密码或 hash。

## 前端会话失效处理

- `apps/web` 的 middleware 只能用 `mediaforge_refresh` Cookie 判断是否需要把受保护页面快速导向 `/login`，不能把 Cookie 存在等同于会话有效。
- `/login` 必须始终放行；即使浏览器保留失效的 `mediaforge_refresh` Cookie，也不能自动重定向回 `/`。
- access token 缺失或业务请求返回 401 时，客户端最多触发一次 refresh 并重试一次原请求。
- refresh 失败后，客户端清理内存 access token，并跳转到 `/login?next=<current-path>`。
- 停留在 `/login` 后，不应继续触发首页的用户信息或业务数据请求，避免 `refresh`、`me`、`conversations` 401 循环。

## 数据迁移

`002_single_system_users.sql` 为 `users` 增加 `username`、`username_normalized`、`role`、登录时间和失败锁定字段。旧 `owner/admin` 映射为 `admin`，旧 `editor/viewer` 映射为 `user`。旧租户/RBAC 表延后物理删除，以兼容历史数据和发布窗口内的旧 token。

## API 与测试

- API：`docs/api/auth.md`
- 规格：`docs/specs/012-expired-auth-session-redirect.md`
- 规格：`docs/specs/009-admin-user-management.md`
- ADR：`docs/adr/007-single-system-user-and-admin-role.md`
- 测试：`docs/testing/plans/auth.md`、`docs/testing/cases/auth.md`

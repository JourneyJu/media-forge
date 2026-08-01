# 测试用例：认证与用户管理

| ID | 场景 | 预期 |
| --- | --- | --- |
| AUTH-001 | 空数据库 bootstrap | 创建 `admin` 角色用户并要求首次改密。 |
| AUTH-002 | 用户名含中文或连字符 | 返回 `VALIDATION_ERROR`。 |
| AUTH-003 | `Alice` 与 `alice` 重复 | 第二次创建返回 `USERNAME_CONFLICT`。 |
| AUTH-004 | 正确密码登录 | 返回用户摘要和 access token，设置 refresh cookie。 |
| AUTH-005 | 连续 5 次错误密码 | 账号锁定 15 分钟，返回 `AUTH_LOGIN_LOCKED`。 |
| AUTH-006 | 临时密码登录后调用业务 API | 返回 `AUTH_PASSWORD_CHANGE_REQUIRED`。 |
| AUTH-007 | 新密码只有两类字符 | 返回 `AUTH_PASSWORD_POLICY_VIOLATION`。 |
| AUTH-008 | 新密码符合三类且超过 8 位 | 改密成功并清除 `mustChangePassword`。 |
| AUTH-009 | refresh token 正常轮换 | 旧 token 标记 rotated，新 token 可用。 |
| AUTH-010 | 重放已轮换 token | 撤销 token family，返回 `AUTH_REFRESH_TOKEN_REUSED`。 |
| AUTH-011 | 普通用户调用管理 API | 返回 `PERMISSION_REQUIRED`。 |
| AUTH-012 | 管理员禁用自己 | 返回 `SELF_ADMIN_CHANGE_FORBIDDEN`。 |
| AUTH-013 | 移除最后管理员 | 返回 `LAST_ADMIN_REQUIRED`。 |
| AUTH-014 | 禁用或重置用户 | 该用户所有 session 与活动 refresh token 被撤销。 |
| AUTH-015 | 查看审计记录 | metadata 不包含密码、hash 或 token。 |
| AUTH-016 | 浏览器保留失效 `mediaforge_refresh` Cookie 时访问 `/login` | 登录页正常展示，不被 middleware 重定向到 `/`。 |
| AUTH-017 | 浏览器保留失效 `mediaforge_refresh` Cookie 时访问 `/` | 客户端最多完成有限次 refresh 与原请求重试，随后跳转并停留在 `/login?next=/`。 |
| AUTH-018 | 停留在 `/login` 后观察 Network | 不再持续发起首页的 `GET /auth/me` 或业务服务 `GET /conversations`。 |

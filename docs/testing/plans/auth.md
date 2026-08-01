# 测试方案：认证与用户管理

## 范围

- bootstrap admin、登录、退出、刷新和 JWKS。
- RSA-OAEP 请求加密与 Argon2id 存储。
- 用户名校验、大小写不敏感唯一性和登录失败锁定。
- 临时密码、正式密码策略和强制改密。
- `admin/user` 权限、最后管理员、自我保护和会话撤销。
- 管理事件审计及敏感字段脱敏。
- 失效 refresh cookie 下的前端跳转收敛，避免 `/` 与 `/login` 循环。

## 自动验证

```bash
pnpm --filter @mediaforge/contracts typecheck
pnpm --filter @mediaforge/auth typecheck
pnpm --filter @mediaforge/auth test
pnpm --filter @mediaforge/service typecheck
pnpm --filter @mediaforge/web typecheck
```

## 集成验证

1. 空数据库执行迁移并启动 auth，确认创建 bootstrap admin。
2. 创建普通用户，使用临时密码登录并验证业务接口被阻止。
3. 修改为符合策略的密码，刷新 token 后访问业务接口。
4. 禁用或重置用户，确认活动 refresh token 失效。
5. 以普通用户调用用户管理接口，确认返回 403。
6. 并发尝试移除最后一个管理员，确认至少保留一个有效管理员。
7. 保留浏览器中的失效 `mediaforge_refresh` Cookie 访问 `/`，确认只发生有限次 refresh 尝试并最终停留在 `/login?next=/`。
8. 在失效 Cookie 仍存在时直接访问 `/login`，确认 middleware 不会跳回 `/`。

## 未自动化项

PostgreSQL 并发锁、HTTP Cookie 全链路、浏览器刷新恢复、管理路由跳转和失效 Cookie 跳转收敛仍需端到端测试覆盖。

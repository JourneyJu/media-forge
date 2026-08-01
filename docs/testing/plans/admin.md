# 测试方案：系统设置

## 范围

覆盖用户管理、模型配置、能力路由、模型调用计量和管理端路由守卫。

| 风险 | 验证重点 |
| --- | --- |
| 越权 | 普通用户无入口，管理 API 返回 403，直接访问页面回到 `/`。 |
| 用户安全 | 用户名唯一、临时密码、强制改密、最后管理员和会话撤销。 |
| 密钥泄露 | 数据库只存 AES-256-GCM 密文；API、日志和错误不回显密钥。 |
| 错误路由 | 多模态路由拒绝纯文本模型；乐观锁冲突返回 409。 |
| 重复计量 | Run 按 `run_id` 唯一；模型每次真实请求单独记录。 |
| token 失真 | 只使用供应商 usage，缺失时标记 unavailable。 |

## 自动验证

```bash
pnpm --filter @mediaforge/contracts typecheck
pnpm --filter @mediaforge/auth typecheck
pnpm --filter @mediaforge/auth test
pnpm --filter @mediaforge/service typecheck
pnpm --filter @mediaforge/service test
pnpm --filter @mediaforge/web typecheck
pnpm typecheck
pnpm test
```

## 集成验证

1. 执行 auth 与 service 数据库迁移。
2. 使用 admin 创建用户、重置密码、禁用和启用。
3. 创建连接，确认响应只有 `secretConfigured`，测试后进入 active。
4. 创建文本与多模态模型，验证后分别绑定路由。
5. 发起 Run，确认 generation 一条、每次模型请求一条日志。
6. 打开监控页，核对总量、用户、模型和日趋势。

## 尚需持续补充

当前自动测试覆盖原有服务回归与类型契约。管理仓储的 PostgreSQL 事务并发测试、API 端到端权限测试和浏览器截图回归应在后续测试切片补齐。

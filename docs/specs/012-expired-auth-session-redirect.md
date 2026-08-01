# 规格：失效登录会话的跳转与重试收敛

## 背景

浏览器可能保留 `mediaforge_refresh` HttpOnly Cookie，但该 refresh token 已经过期、被轮换后重放、被禁用用户或重置密码操作撤销。当前前端路由守卫只判断 Cookie 是否存在：

```text
存在 mediaforge_refresh Cookie
  -> 允许访问 /
  -> 首页请求 /auth/refresh、/auth/me、/conversations
  -> 认证服务或业务服务返回 401
  -> 客户端跳转 /login
  -> middleware 因 Cookie 存在又跳回 /
  -> 重复请求与跳转
```

该问题表现为 Network 面板中 `refresh`、`me`、`conversations` 等登录相关请求持续返回 401，并在首页与登录页之间反复跳转。

## 目标

- 失效 refresh token 不得造成 `/` 与 `/login` 之间的重定向循环。
- 访问 `/login` 时，即使浏览器存在 `mediaforge_refresh` Cookie，也必须允许用户看到登录页。
- 受保护业务请求在 access token 缺失或失效时只做一次 refresh 尝试。
- refresh 失败后清理前端内存中的 access token，并进入登录页。
- 进入登录页后不再继续触发首页的 `GET /auth/me` 或业务服务 `GET /conversations` 请求。

## 非目标

- 不修改 auth API 路径、请求字段、响应字段或错误码。
- 不改变 refresh token 的 HttpOnly Cookie 存储方式。
- 不在 Next.js middleware 中调用认证服务做远程校验。
- 不新增生产依赖。
- 不改变后端 JWT、refresh token rotation 或 session revoke 规则。

## 推荐方案

### 路由守卫

`apps/web/middleware.ts` 继续用 `mediaforge_refresh` Cookie 作为未登录访问受保护页面的快速提示，但不得把 Cookie 存在等同于会话有效。

```text
无 mediaforge_refresh Cookie 且访问非公开路径
  -> 重定向 /login?next=...

访问 /login
  -> 始终放行

其他路径
  -> 放行，由客户端和后端接口完成真实认证判断
```

### 客户端请求

`apps/web` 的 auth/service fetch 封装必须收敛 401 重试：

1. 请求前没有 access token 时，最多调用一次 `POST /auth/refresh`。
2. 原请求返回 401 时，最多再调用一次 `POST /auth/refresh` 并重试原请求。
3. refresh 返回 401、403 或网络失败时，清理内存 access token。
4. 浏览器环境中跳转到 `/login?next=<current-path>`。
5. 对同一批并发请求共享同一个 refresh promise，避免并发刷新风暴。

### Cookie 清理边界

refresh token 是 HttpOnly Cookie，前端 JavaScript 不能直接删除。失效 Cookie 的最终清理由下次成功登录覆盖，或由用户触发 `POST /auth/logout` 完成。前端修复目标是停止循环和重复请求，不把 Cookie 可见性当作会话有效性的唯一事实源。

## 验收标准

- 携带失效 `mediaforge_refresh` Cookie 访问 `/login` 时，页面停留在登录页，不跳回 `/`。
- 携带失效 `mediaforge_refresh` Cookie 访问 `/` 时，最多出现一轮 `refresh`、`me` 或业务请求失败，随后进入 `/login?next=/`。
- 停留在 `/login` 后，不再继续发起首页的 `GET /auth/me` 或 `GET /conversations`。
- 正常登录成功后仍跳转到 `next` 指定的站内路径。
- 正常 refresh 成功后，业务请求可继续携带新的 access token 完成。

## 验证方式

```bash
pnpm --filter @mediaforge/web typecheck
```

手动验证：

1. 登录后在数据库或认证服务中撤销当前 refresh token，保留浏览器 Cookie。
2. 打开 `http://localhost:3000/`。
3. 确认页面最终停留在 `/login?next=/`。
4. 打开浏览器 Network，确认 `refresh`、`me`、`conversations` 不再持续循环。
5. 使用正确账号密码重新登录，确认回到 `next` 指向的页面。

## 文档同步

- 模块事实源：`docs/modules/auth/README.md`
- 测试方案：`docs/testing/plans/auth.md`
- 测试用例：`docs/testing/cases/auth.md`
- API 文档：无需更新，接口契约不变。

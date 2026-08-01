# API：认证与用户管理

## 通用约定

- 密码字段使用 `GET /auth/password-key` 返回的 RSA-OAEP-256 公钥加密。
- refresh token 只通过 HttpOnly Cookie 返回，JSON 不返回 refresh token。
- 用户管理接口只允许 `admin`，普通用户返回 `403 PERMISSION_REQUIRED`。
- 用户管理响应不包含密码、密码 hash、session 或 token。

## 登录与会话

### `POST /auth/login`

请求兼容发布窗口内的 `account` 字段，新客户端使用 `username`：

```json
{
  "username": "admin",
  "password": {
    "alg": "RSA-OAEP-256",
    "kid": "password-key-id",
    "ciphertext": "base64url-ciphertext"
  }
}
```

响应：

```json
{
  "user": {
    "id": "user_admin",
    "username": "admin",
    "displayName": "管理员",
    "role": "admin",
    "status": "active",
    "mustChangePassword": true
  },
  "accessToken": "jwt-access-token",
  "expiresIn": 900
}
```

### 其他认证接口

- `GET /auth/password-key`：密码请求加密公钥。
- `GET /auth/jwks.json`：access token 验签公钥。
- `GET /auth/me`：当前用户摘要。
- `POST /auth/refresh`：轮换 refresh token 并签发新 access token。
- `POST /auth/logout`：撤销当前 refresh token。
- `POST /auth/password/change`：校验正式密码策略后更新密码。

## 用户管理

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/auth/admin/users` | 搜索、状态筛选和分页。 |
| POST | `/auth/admin/users` | 创建用户，临时密码为 `12345678`。 |
| GET | `/auth/admin/users/:userId` | 查询用户。 |
| PATCH | `/auth/admin/users/:userId` | 修改显示名、角色或状态。 |
| POST | `/auth/admin/users/:userId/reset-password` | 重置临时密码并撤销全部会话。 |
| POST | `/auth/admin/users/:userId/disable` | 禁用用户并撤销全部会话。 |
| POST | `/auth/admin/users/:userId/enable` | 启用用户，不恢复旧会话。 |

创建请求：

```json
{
  "username": "editor_01",
  "displayName": "内容编辑",
  "role": "user"
}
```

列表参数：`search`、`status=active|disabled`、`page`、`pageSize`。

## 主要错误码

| 错误码 | HTTP | 说明 |
| --- | --- | --- |
| `AUTH_INVALID_CREDENTIALS` | 401 | 用户名或密码错误。 |
| `AUTH_LOGIN_LOCKED` | 429 | 连续失败后临时锁定。 |
| `AUTH_PASSWORD_CHANGE_REQUIRED` | 403 | 必须先修改临时密码。 |
| `AUTH_PASSWORD_POLICY_VIOLATION` | 400 | 正式密码不符合策略。 |
| `PERMISSION_REQUIRED` | 403 | 当前用户不是管理员。 |
| `USERNAME_CONFLICT` | 409 | 用户名忽略大小写后重复。 |
| `SELF_ADMIN_CHANGE_FORBIDDEN` | 409 | 管理员尝试禁用或降级自己。 |
| `LAST_ADMIN_REQUIRED` | 409 | 操作会移除最后一个有效管理员。 |

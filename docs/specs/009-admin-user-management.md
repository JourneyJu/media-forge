# 规格 009：控制台用户管理

## 状态

Proposed

## 目标

为 MediaForge 提供单系统用户管理能力。只有 `admin` 可以进入系统设置并管理用户；普通 `user` 只能使用创作客户端。系统不提供租户、团队或成员关系概念。

## 用户角色

| 角色 | 能力 |
| --- | --- |
| `admin` | 使用创作客户端；进入系统设置；管理用户；后续管理模型配置和查看使用监控。 |
| `user` | 使用创作客户端；查看和管理本人可访问的业务资源。 |

第一阶段不支持自定义角色和权限。管理权限必须由后端根据认证上下文判断，不能依赖前端菜单是否显示。

## 用户数据

### 用户名

- API 字段为 `username`，替代当前容易产生歧义的 `account`。
- 必填，全局唯一，登录时大小写不敏感。
- 长度为 3-32 个字符。
- 只允许英文字母、数字和下划线。
- 英文字母、数字和下划线可以出现在任意位置。
- 创建后不可修改。

```text
^[A-Za-z0-9_]{3,32}$
```

示例：

| 输入 | 结果 | 原因 |
| --- | --- | --- |
| `lin_xiaoyu` | 通过 | 包含英文字母和下划线。 |
| `chen2026` | 通过 | 包含英文字母和数字。 |
| `Admin` | 通过格式校验 | 唯一性按 `admin` 判断。 |
| `2026_user` | 通过 | 数字可以出现在开头。 |
| `123_456` | 通过 | 只包含数字和下划线。 |
| `林晓雨` | 不通过 | 用户名不允许中文。 |
| `lin-xiaoyu` | 不通过 | 不允许连字符。 |

### 显示名称

- API 字段为 `displayName`，数据库字段为 `display_name`。
- 必填，去除首尾空白后长度为 1-32 个 Unicode 字符。
- 允许中文、英文、数字、空格和常用标点混合。
- 管理员后续可以修改。

### 状态

| 状态 | 说明 |
| --- | --- |
| `active` | 可以登录和使用系统。 |
| `disabled` | 不能登录、刷新 token 或调用需要登录的接口。 |

## 密码策略

### 临时密码

当前产品要求管理员创建用户或重置密码后，临时密码为 `12345678`。

临时密码是正式密码策略的受控例外：

- 只在创建用户和重置密码时由服务端设置。
- 数据库只保存 Argon2id hash。
- 设置后必须将 `mustChangePassword` 标记为 `true`。
- 管理员页面可以提示临时密码规则，但接口不得返回密码 hash。
- 用户使用临时密码登录后，只能查看本人摘要、退出和修改密码。
- 完成改密后才可进入创作客户端或管理控制台。

### 正式密码

- 长度至少 9 位。
- 以下四类字符至少包含三类：
  - 大写英文字母；
  - 小写英文字母；
  - 数字；
  - 特殊字符。
- 不得等于 `12345678`。
- 不得与用户名忽略大小写后相同。
- 请求体中的密码继续使用 auth 服务提供的 RSA-OAEP-256 公钥加密。
- 数据库继续使用 Argon2id 不可逆哈希。

## 页面与交互

### 控制台入口

- `admin` 登录后，客户端账号菜单显示“系统设置”。
- `user` 不显示“系统设置”。
- 控制台用户管理路由为 `/admin/users`。
- 普通用户直接输入 `/admin/users` 时，前端读取 `GET /auth/me`，确认不是管理员后返回客户端首页 `/`。
- 管理页面请求返回 403 时，页面停止加载管理数据并返回客户端首页。

### 页面结构

页面延续客户端现有视觉语言：

- 顶部保留 MediaForge 品牌栏和管理员账号胶囊。
- 左侧为系统设置导航，“用户管理”为当前项。
- 中间为用户搜索、筛选和列表。
- 右侧为当前选中用户详情与安全操作。

### 列表

列表字段：

| 字段 | 说明 |
| --- | --- |
| 用户 | 显示名称和头像首字。 |
| 用户名 | 全局唯一登录名。 |
| 角色 | `管理员` 或 `普通用户`。 |
| 状态 | `启用` 或 `禁用`。 |
| 密码状态 | `待修改` 或 `已修改`。 |
| 最近登录 | 最近一次成功登录时间；从未登录显示 `—`。 |
| 操作 | 编辑、禁用/启用、重置密码。 |

支持：

- 按用户名或显示名称模糊搜索。
- 按 `全部`、`启用`、`禁用`筛选。
- 分页读取；默认每页 20 条。
- 默认按 `created_at desc` 排序。

### 新建用户

管理员输入：

- 用户名；
- 显示名称；
- 角色，默认 `user`。

提交成功后：

- 用户状态为 `active`；
- 服务端设置临时密码；
- `mustChangePassword=true`；
- 写入用户创建审计事件；
- 列表新增该用户。

用户名冲突时保留表单内容，并在用户名字段显示“用户名已存在”。

### 编辑用户

允许修改：

- 显示名称；
- 角色；
- 状态。

不允许修改：

- 用户 ID；
- 用户名；
- 密码 hash；
- 创建时间。

约束：

- 管理员不能禁用自己的当前账号。
- 管理员不能将自己的当前账号降级为 `user`。
- 系统中必须始终至少存在一个 `active admin`。
- 角色或状态变更必须在事务内完成并写审计。

### 重置密码

- 操作前显示确认对话框。
- 成功后设置临时密码 hash 和 `mustChangePassword=true`。
- 撤销目标用户的全部登录会话和 refresh token。
- 不在 API 响应中返回密码 hash、salt 或密钥参数。
- 写入 `user.password.reset` 审计事件。

### 禁用与启用

禁用：

- 设置 `status=disabled`；
- 撤销全部会话；
- 后续登录和 refresh 返回 `USER_DISABLED`。

启用：

- 设置 `status=active`；
- 不恢复历史会话；
- 用户需要重新登录。

## 权限与路由守卫

权限判断顺序：

```text
是否有有效会话
  → 否：401 UNAUTHORIZED
  → 是：是否 role == admin
      → 否：403 PERMISSION_REQUIRED
      → 是：执行用户管理策略
```

前端权限负责体验，后端权限负责安全：

- 菜单隐藏不能替代 API 鉴权。
- middleware 只可用于快速跳转，不能作为唯一权限判断。
- 页面加载后必须使用 `GET /auth/me` 的服务端事实。
- 所有用户管理写接口都必须在 `apps/auth` 内执行 admin policy。

## 目标接口

| 方法 | 路径 | 用途 | 权限 |
| --- | --- | --- | --- |
| `GET` | `/auth/me` | 获取当前用户和角色 | 已登录 |
| `GET` | `/auth/admin/users` | 分页查询用户 | `admin` |
| `POST` | `/auth/admin/users` | 创建用户 | `admin` |
| `GET` | `/auth/admin/users/:userId` | 获取用户详情 | `admin` |
| `PATCH` | `/auth/admin/users/:userId` | 修改显示名、角色或状态 | `admin` |
| `POST` | `/auth/admin/users/:userId/reset-password` | 重置临时密码并撤销会话 | `admin` |
| `POST` | `/auth/admin/users/:userId/disable` | 禁用用户 | `admin` |
| `POST` | `/auth/admin/users/:userId/enable` | 启用用户 | `admin` |

### 列表查询

```text
GET /auth/admin/users?query=lin&status=active&page=1&pageSize=20
```

响应目标：

```json
{
  "items": [
    {
      "id": "user_1",
      "username": "lin_xiaoyu",
      "displayName": "林晓雨",
      "role": "user",
      "status": "active",
      "mustChangePassword": false,
      "lastLoginAt": "2026-07-30T01:42:00.000Z",
      "createdAt": "2026-07-12T08:00:00.000Z"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1
}
```

### 创建用户

```json
{
  "username": "lin_xiaoyu",
  "displayName": "林晓雨",
  "role": "user"
}
```

响应只返回用户摘要和 `temporaryPasswordAssigned: true`，不返回密码 hash。

### 更新用户

```json
{
  "displayName": "林晓雨",
  "role": "user",
  "status": "active"
}
```

只提交需要修改的字段。用户名不属于可更新字段。

## 错误码

| 错误码 | HTTP | 说明 |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | 未登录或会话无效。 |
| `PERMISSION_REQUIRED` | 403 | 当前用户不是管理员。 |
| `AUTH_PASSWORD_CHANGE_REQUIRED` | 403 | 必须先修改临时密码。 |
| `USER_NOT_FOUND` | 404 | 用户不存在。 |
| `USER_DISABLED` | 403 | 用户已禁用。 |
| `USERNAME_INVALID` | 422 | 用户名格式不符合规则。 |
| `USERNAME_ALREADY_EXISTS` | 409 | 标准化后的用户名已存在。 |
| `DISPLAY_NAME_INVALID` | 422 | 显示名称不符合规则。 |
| `PASSWORD_POLICY_VIOLATION` | 422 | 正式密码不符合强度要求。 |
| `CANNOT_MODIFY_SELF_ROLE` | 409 | 管理员不能降级自己的当前账号。 |
| `CANNOT_DISABLE_SELF` | 409 | 管理员不能禁用自己的当前账号。 |
| `LAST_ADMIN_REQUIRED` | 409 | 操作会导致系统没有有效管理员。 |

## 数据与审计

用户表至少保存：

```text
id
username
username_normalized
display_name
role
status
password_hash
password_hash_algorithm
password_hash_params
must_change_password
last_login_at
password_changed_at
created_at
updated_at
```

审计操作：

```text
user.created
user.display_name.updated
user.role.updated
user.disabled
user.enabled
user.password.reset
```

审计不得记录：

- 临时密码；
- 密码明文或 hash；
- refresh token 或 access token；
- RSA 密文。

## 验收标准

- 普通用户看不到系统设置，直接访问管理路由会返回客户端首页。
- 普通用户调用任一用户管理接口均返回 403。
- 管理员可以搜索、创建、编辑、禁用、启用和重置用户密码。
- 用户名只接受约定字符，并且大小写不敏感地全局唯一。
- 显示名称支持中英文混合。
- 新用户和被重置密码的用户必须先改密。
- 正式密码满足至少 9 位和四类字符至少三类。
- 禁用或重置密码后，目标用户所有会话失效。
- 最后一个有效管理员不能被禁用或降级。
- 页面、接口、日志和审计中不出现密码明文、hash 或 token。

## 已确认设计

- 系统不提供租户概念，只保留 `admin` 和 `user`。
- 用户名允许英文字母、数字和下划线，大小写不敏感地全局唯一。
- 显示名称允许中英文混合。
- 创建用户和重置密码使用临时密码 `12345678`，并强制首次改密。
- 系统允许存在多个管理员，但必须始终至少保留一个有效管理员。

## 关联文档

- `.plan/20260730-admin-user-management.md`
- `docs/adr/007-single-system-user-and-admin-role.md`
- `docs/modules/auth/README.md`
- `docs/api/auth.md`

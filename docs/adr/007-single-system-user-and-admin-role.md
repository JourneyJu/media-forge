# ADR 007：单系统用户模型与双角色权限

## 状态

Accepted

## 日期

2026-07-30

## 背景

MediaForge 当前认证设计采用独立 `apps/auth` 服务、租户成员关系和 `owner/admin/editor/viewer` 多角色 RBAC。产品范围现已明确：系统没有租户、组织或团队概念，只区分系统管理员和普通用户。

如果继续让业务 API、token、对象归属和管理页面依赖 `tenantId`、membership 和权限点，会保留没有产品语义的复杂度，并增加用户管理、模型配置和用量监控的实现与测试成本。

独立认证服务、密码安全、会话、token 轮换和审计仍然有价值，不应因权限模型简化而合并回业务服务。

## 决策

保留独立 `apps/auth` 服务，权限模型收敛为单系统双角色：

- `admin`：可以使用创作客户端并进入系统设置。
- `user`：只能使用创作客户端。

目标 `AuthContext` 不再包含 `tenantId`、`membershipId`、`permissionVersion` 和权限字符串数组，只包含用户、角色和会话身份：

```ts
type AuthContext = {
  userId: string;
  role: "admin" | "user";
  sessionId: string;
};
```

管理接口统一要求 `role == "admin"`。业务资源继续按 `userId` 和领域归属规则鉴权。

产品 API 和页面不再暴露租户、成员、角色管理和权限点管理概念。旧租户/RBAC 数据采用分阶段兼容迁移，不立即物理删除。

## 角色映射

现有角色迁移规则：

| 现有角色 | 目标角色 |
| --- | --- |
| `owner` | `admin` |
| `admin` | `admin` |
| `editor` | `user` |
| `viewer` | `user` |

若一个用户存在多个历史 membership，任一有效 membership 为 `owner/admin` 时映射为 `admin`，否则映射为 `user`。迁移前必须确认当前系统只有产品认可的数据范围。

## 备选方案

### 保留单例租户

做法：页面隐藏租户概念，数据库和 token 永久保留一个默认租户。

优点：

- 改动较小。
- 旧业务查询和对象 key 无需立即迁移。

缺点：

- 长期保留 membership、角色和权限点的无效复杂度。
- 新功能仍需携带没有业务含义的 `tenantId`。
- 容易让后续代码继续误用多租户抽象。

结论：仅作为迁移阶段兼容方式，不作为目标架构。

### 将认证并回 `apps/service`

优点：

- 部署组件减少。

缺点：

- 密码、会话、token 和业务逻辑重新耦合。
- 不能减少认证本身的安全复杂度。
- 与当前已实现的独立服务边界相冲突。

结论：拒绝。

### 保留通用 RBAC，只内置两个角色

优点：

- 后续扩展自定义角色更容易。

缺点：

- 当前产品没有自定义权限需求。
- 角色表、权限表、缓存版本和管理 API 增加维护与测试成本。

结论：第一阶段拒绝。未来出现真实的细粒度权限需求时重新提交 ADR。

## 安全约束

- 前端隐藏系统设置仅改善体验，不作为安全边界。
- 每个管理接口必须在 `apps/auth` 或对应服务的 policy 层校验 `admin`。
- 管理员不能禁用或降级自己的当前账号。
- 系统必须始终至少保留一个 `active admin`。
- 禁用用户和重置密码必须撤销全部会话。
- 所有高风险用户操作必须写审计事件。
- 固定临时密码只能作为受控初始凭据，不能绕过首次改密。

## 迁移

1. 为 `users` 增加目标角色和标准化用户名字段。
2. 从有效 membership 回填 `users.role`。
3. token 暂时兼容旧、新 claims。
4. 业务查询从 `tenantId + userId` 迁移为用户和领域资源归属。
5. 停止创建 tenant、membership 和角色权限记录。
6. 等旧 token 全部过期、外键引用清理和回归验证完成后，再删除旧表。

旧对象存储 key 不在本 ADR 中批量迁移。读取兼容和新路径策略另行设计，避免认证迁移与对象迁移同时扩大风险。

## 后果

正向影响：

- 产品和技术模型一致，控制台权限判断更直接。
- 登录响应、`AuthContext`、业务查询和测试矩阵更简单。
- 用户、模型和用量数据都可以直接按 `userId` 归属。

负向影响：

- 需要修改现有 contracts、token claims、auth schema 和部分业务查询。
- 需要兼容旧 token、历史 tenant 数据和对象 key。
- 未来若重新引入组织或团队，需要新的 schema 和 ADR，不能直接恢复旧抽象。

## 与 ADR 006 的关系

本 ADR 接受 ADR 006 中“独立认证服务、Argon2id、非对称 access token、refresh token 轮换和认证审计”的决策。

本 ADR 取代 ADR 006 中“租户、membership、`owner/admin/editor/viewer` RBAC 和租户权限点作为第一阶段产品模型”的部分。ADR 006 在本 ADR 被接受后应标记为“部分被 ADR 007 取代”。

## 关联文档

- `.plan/20260730-admin-user-management.md`
- `docs/specs/009-admin-user-management.md`
- `docs/adr/006-independent-auth-service-and-rbac.md`

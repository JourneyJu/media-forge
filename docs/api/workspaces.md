# API：品牌上下文（过渡期 Workspace）

## 模块文档

- `docs/modules/workspaces/README.md`

## 定位

旧 `Workspace` 契约只用于机构、校区或门店的品牌资料和长期偏好，不用于创建历史会话，不代表用户可见创作空间。

用户可见创作空间和历史列表统一使用 `docs/api/conversations.md`。

## 兼容接口

```text
POST /workspaces
GET  /workspaces/:workspaceId
PATCH /workspaces/:workspaceId
```

这些接口不能：

- 创建默认 Conversation。
- 向历史列表插入记录。
- 影响 Conversation `lastInteractionAt`。
- 成为用户首次发送的前置条件。

`GET /workspaces/:workspaceId/conversations` 进入弃用期，目标历史接口为 `GET /conversations`。

## 后续

数据库和共享契约仍暂时沿用 `Workspace` 名称。是否重命名为 `BrandContext` 需要单独的数据迁移计划，避免与会话生命周期改造同时扩大范围。

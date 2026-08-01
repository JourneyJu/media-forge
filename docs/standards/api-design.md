# API 设计规范

本规范适用于 `apps/service` 暴露给 `apps/web` 的业务 API。

## 契约优先

- 新增或修改 API 前，先更新 `packages/contracts` 中的请求、响应、枚举和错误码。
- API 文档同步到 `docs/api/` 对应模块。
- 模块行为同步到 `docs/modules/`，测试方案同步到 `docs/testing/`。

## 路由

- 路由使用资源名词，避免动词堆叠。
- 集合资源使用复数，例如 `/workspaces`、`/assets`、`/articles`。
- 动作用子资源表达，例如 `/articles/{articleId}/versions`、`/exports/{exportId}`。
- 内部管理 API 必须和用户侧 API 在路径或权限上有清晰边界。

## 请求

- 所有写请求必须校验 body、params、query。
- 文件上传使用后端签名或后端接收后转存，不允许前端直接构造任意对象 key。
- 需要幂等的写操作必须有幂等键或业务唯一约束。
- 分页参数统一使用 `page_size` / `cursor` 或项目既定形式，不在不同 API 中混用。

## 响应

- 响应字段使用英文 snake_case 或 camelCase 时必须全项目统一；当前 TypeScript 契约优先使用 camelCase。
- 列表响应必须包含数据数组和分页信息。
- 时间字段使用 ISO 8601 字符串。
- 金额、token、用量、配额等数值必须明确单位。

## 错误

- 错误响应必须包含稳定 `code`、可读 `message` 和可选 `details`。
- `message` 面向用户或前端展示，不能暴露 SQL、内部路径、密钥、完整 prompt。
- 常见错误分类：`VALIDATION_ERROR`、`UNAUTHORIZED`、`FORBIDDEN`、`NOT_FOUND`、`CONFLICT`、`QUOTA_EXCEEDED`、`EXTERNAL_SERVICE_ERROR`、`INTERNAL_ERROR`。

## 兼容性

- 删除字段、改变字段含义、改变错误码属于破坏性变更，最低按 M 级处理。
- 新增可选字段通常可兼容，但仍需同步契约和 API 文档。
- 已发布 API 的行为变化必须说明迁移影响。

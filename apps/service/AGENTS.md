# 后端服务协作规则

本目录是 MediaForge 后端服务，负责业务 API、文章版本、素材、配额、AI 编排入口和基础管理能力。

## 边界

- 可以访问 PostgreSQL、MinIO、Redis 和 Model Gateway。
- 不直接承载前端展示逻辑。
- 不把复杂业务规则写在 HTTP 入口中，业务规则放 service / policy。
- 不把上传文件写入数据库，数据库只保存元数据和对象存储 key。
- 不明文记录模型 API Key、用户隐私或完整敏感 prompt。

## 必须优先使用

- 共享类型来自 `packages/contracts`。
- 对象存储路径遵循架构、模块和数据库设计文档。
- 正式文章版本必须同时保存 `content_json` 和 HTML 快照 key。

## 必须遵守

- 通用开发规范：`../../docs/standards/coding-general.md`
- TypeScript 规范：`../../docs/standards/typescript.md`
- 注释规范：`../../docs/standards/comments.md`
- 后端服务规范：`../../docs/standards/backend-service.md`
- API 设计规范：`../../docs/standards/api-design.md`
- 日志规范：`../../docs/standards/logging.md`
- SQL 与数据库规范：`../../docs/standards/sql.md`
- 测试规范：`../../docs/standards/testing.md`
- 安全规范：`../../docs/standards/security.md`

## 分层

- controller 只做 HTTP 入口、上下文注入、请求校验和响应映射。
- service 负责业务编排、事务、AI 调用、对象存储和配额。
- policy 负责权限、配额、状态机和业务规则。
- repository 负责数据库读写。
- adapter 负责 MinIO、Redis、模型供应商等外部系统访问。

## 验证

```bash
pnpm --filter @mediaforge/service typecheck
pnpm --filter @mediaforge/service test
```

## 需要人工确认

- 数据库 schema 变化。
- 新增或修改 API。
- 修改 AI 调用链路。
- 修改上传、导出、快照存储策略。
- 新增运行时依赖。

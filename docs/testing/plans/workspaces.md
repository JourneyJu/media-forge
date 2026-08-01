# 测试方案：工作区

## 模块文档

- `docs/modules/workspaces/README.md`

## 当前状态

已建立第一条工程竖切样板：`packages/contracts` 的 Zod schema、`apps/service` 的创建工作区逻辑、`apps/web` 的 API client。

## 测试范围

- 契约测试：创建工作区请求默认值、必填字段和枚举校验。
- 后端单测：已校验输入转换为工作区 profile。
- 前端后续测试：API client 的请求构造、响应校验和错误映射。
- 集成测试后续补充：`POST /workspaces` 真实 HTTP 请求、数据库写入和租户归属校验。

## 验证命令

```bash
pnpm --filter @mediaforge/contracts test
pnpm --filter @mediaforge/service test
pnpm typecheck
pnpm test
```

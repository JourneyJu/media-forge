# 共享契约协作规则

本目录保存前后端共享的领域类型、API 数据形状和结构化文章契约。

## 边界

- 不依赖 `apps/web` 或 `apps/service` 的实现。
- 不写业务逻辑。
- 不保存运行时配置或密钥。
- 契约变更属于至少 M 级需求，需要说明兼容性影响。

## 变更顺序

涉及接口或数据结构变化时，先改本目录，再改前端和后端实现。

## 命名

- TypeScript 类型使用英文。
- 枚举值使用稳定英文小写或 snake_case。
- 与数据库字段有关的语义必须能映射到 `CONTEXT.md` 术语。

## 验证

```bash
pnpm --filter @mediaforge/contracts typecheck
```


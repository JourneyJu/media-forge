# 测试规范

## 测试目标

测试不是为了追求数量，而是为了验证本次改动的主要风险。

## 分层

| 层级 | 关注点 |
| --- | --- |
| 契约类型检查 | 共享类型、文章结构、API 数据形状 |
| 后端单测 | service、policy、renderer、存储适配 |
| 后端集成测试 | PostgreSQL、MinIO、Redis、异步任务 |
| 前端组件测试 | 工作区、编辑器、AI 对话、导出入口 |
| E2E | 创建工作区、上传图片、生成文章、复制导出 |

## 默认验证命令

```bash
pnpm --filter @mediaforge/contracts typecheck
pnpm --filter @mediaforge/service typecheck
pnpm --filter @mediaforge/web typecheck
pnpm typecheck
pnpm test
pnpm build
```

## 失败处理

- 代码问题：修代码并重跑相关验证。
- 测试问题：只有确认测试与需求或契约不一致时才改测试。
- 契约问题：先同步 `packages/contracts` 和对应 API / 模块文档，再重跑验证。
- 方案问题：暂停 Coding，回到 `.plan/` 或设计确认点，不继续硬改实现。
- 环境问题：记录命令、目录、错误和未验证风险。
- 同类问题连续 3 次失败：暂停，输出失败分类和建议路径。

失败分流遵循 `.workflow/coding-flow.md`，不要为了让测试通过而改变已确认的业务语义。

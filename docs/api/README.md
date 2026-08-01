# API 文档

API 文档按模块维护，文件名与模块名一致。接口变更必须先同步契约和文档，再进入实现。

## 当前 API 文档

| 模块 | API 文档 |
| --- | --- |
| 工作空间 | `workspaces.md` |
| 中间对话工作区 | `chat-workspace.md` |
| 创作会话与任务 | `conversations.md` |
| Creation Graph 多 Agent 编排 | `creation-graph.md` |
| 素材 | `assets.md` |
| 文章与版本 | `articles.md` |
| 排版 Skills | `layout-skills.md` |
| AI 生成 | `ai-generation.md` |
| 认证与权限 | `auth.md` |
| 管理与配额 | `admin.md` |

## 规则

- 新增或修改 API 属于至少 M 级变更。
- API 文档先于实现更新。
- API 文档必须和 `packages/contracts` 保持一致。
- 修改 API 时，同步模块文档和测试文档。

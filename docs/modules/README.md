# 模块文档

模块文档是单模块事实源。每个模块一个目录，目录内至少包含 `README.md`。

## 当前模块

| 模块 | 文档 | API 文档 | 测试方案 | 测试用例 |
| --- | --- | --- | --- | --- |
| 工作空间 | `workspaces/README.md` | `../api/workspaces.md` | `../testing/plans/workspaces.md` | `../testing/cases/workspaces.md` |
| 中间对话工作区 | `chat-workspace/README.md` | `../api/chat-workspace.md` | `../testing/plans/chat-workspace.md` | `../testing/cases/chat-workspace.md` |
| 创作会话与任务 | `conversations/README.md` | `../api/conversations.md` | `../testing/plans/conversations.md` | `../testing/cases/conversations.md` |
| Creation Graph 多 Agent 编排 | `creation-graph/README.md` | `../api/creation-graph.md` | `../testing/plans/creation-graph.md` | `../testing/cases/creation-graph.md` |
| 素材 | `assets/README.md` | `../api/assets.md` | `../testing/plans/assets.md` | `../testing/cases/assets.md` |
| 文章与版本 | `articles/README.md` | `../api/articles.md` | `../testing/plans/articles.md` | `../testing/cases/articles.md` |
| 排版 Skills | `layout-skills/README.md` | `../api/layout-skills.md` | `../testing/plans/layout-skills.md` | `../testing/cases/layout-skills.md` |
| AI 生成 | `ai-generation/README.md` | `../api/ai-generation.md` | `../testing/plans/ai-generation.md` | `../testing/cases/ai-generation.md` |
| 认证与权限 | `auth/README.md` | `../api/auth.md` | `../testing/plans/auth.md` | `../testing/cases/auth.md` |
| 管理与配额 | `admin/README.md` | `../api/admin.md` | `../testing/plans/admin.md` | `../testing/cases/admin.md` |

## 变更规则

修改模块职责、数据、流程、权限、API 或错误码时，必须同步：

1. 当前模块文档。
2. 对应 API 文档。
3. 对应测试方案。
4. 对应测试用例。
5. 必要时同步共享契约和 ADR。

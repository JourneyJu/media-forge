# MediaForge 项目 AI 协作规范

本文件是 Codex、Claude Code 以及其他 AI 编程工具在本项目内工作的主规则和路由入口。项目事实以本文件、`CONTEXT.md`、`.workflow/`、`docs/`、`docs/adr/`、`docs/standards/` 和代码事实为准。

## 基本规则

- 默认使用中文沟通，文档统一使用中文。
- 代码标识符、接口字段、数据库字段使用英文。
- 先理解现有结构，再修改代码。
- 先说明需求分级、影响范围、验证方式，再实现。
- 不做无关重构，不修改无关文件。
- 不新增生产依赖，除非先说明原因、替代方案、影响范围，并获得确认。
- 涉及接口、schema、架构、安全、数据迁移、上传、AI 调用链路时，先同步契约和文档，再实现。

## 执行优先级

遇到规则冲突或信息不完整时，按下面顺序处理：

1. 优先完成用户当前明确需求，但不得跳过人工确认闸门。
2. 任何时候不得打破服务边界。
3. 高风险变更必须先同步契约和文档，再进入实现。
4. 测试按风险选择最小充分集；公共逻辑、接口/schema、跨模块变更需要更完整验证。
5. 不确定项先查代码、契约、文档和测试；仍影响关键决策时，再一次性问人。

## 项目结构

```text
apps/
  web/          前端 Web 应用
  service/      后端服务

packages/
  contracts/    前后端共享契约、领域类型、Schema

docs/
  architecture/ 架构文档和模块路由
  modules/      模块事实源
  api/          API 文档
  testing/      测试方案和测试用例
  specs/        功能或工程规格
  standards/    工程标准
  runbooks/     本地开发、部署、排障
  adr/          架构决策记录

.plan/           L 级改动计划和人工确认记录
.workflow/       开发流程、任务模板、人工确认闸门

infra/
  docker/       本地 PostgreSQL、MinIO、Redis
```

## 服务边界

```text
浏览器 → apps/web → apps/service → PostgreSQL / MinIO / Redis / Model Gateway
```

| 服务 | 端口 | 职责 | 启动命令 | 验证命令 |
| --- | --- | --- | --- | --- |
| `apps/web` | 3000 | 用户界面，只调用后端服务 | `pnpm --filter @mediaforge/web dev` | `pnpm --filter @mediaforge/web typecheck` |
| `apps/service` | 4000 | 业务 API、AI 编排入口、文章版本、素材、配额 | `pnpm --filter @mediaforge/service dev` | `pnpm --filter @mediaforge/service typecheck` |
| `packages/contracts` | - | 共享契约和领域类型 | - | `pnpm --filter @mediaforge/contracts typecheck` |

边界规则：

- 前端不得直接访问 PostgreSQL、MinIO、Redis 或模型供应商。
- 后端 controller 不直接写复杂业务规则，业务规则放 service / policy。
- 共享类型优先来自 `packages/contracts`，不在前后端重复手写。
- PostgreSQL 是业务事实数据源。
- MinIO / S3 只保存图片、快照、导出文件、prompt 快照、skill 包等对象。
- Redis 只用于缓存、限流、锁、队列和短期状态，不保存不可丢失的业务事实。

## 规范读取策略

- 开发流程：`.workflow/development-flow.md`
- Coding 流程：`.workflow/coding-flow.md`
- 任务模板：`.workflow/task-template.md`
- L 级计划模板：`.plan/plan-template.md`
- 项目上下文和术语：`CONTEXT.md`
- docs 局部规则：`docs/AGENTS.md`
- 文档分级和路由：`docs/README.md`
- 最小改动：`docs/standards/minimal-change.md`
- 通用开发规范：`docs/standards/coding-general.md`
- TypeScript 规范：`docs/standards/typescript.md`
- 注释规范：`docs/standards/comments.md`
- API 设计规范：`docs/standards/api-design.md`
- 日志规范：`docs/standards/logging.md`
- SQL 与数据库规范：`docs/standards/sql.md`
- 前端服务规范：`docs/standards/frontend-nextjs.md`
- 后端服务规范：`docs/standards/backend-service.md`
- 测试规范：`docs/standards/testing.md`
- 安全规范：`docs/standards/security.md`
- 模块文档规范：`docs/standards/module-documentation.md`
- 服务地图：`docs/service-map.md`
- 架构总览：`docs/architecture/overview.md`
- 数据库设计：`docs/architecture/database.md`
- 本地开发：`docs/runbooks/local-dev.md`
- 功能规格：`docs/specs/`
- 架构决策：`docs/adr/`

不要一次性读取所有规范文件。按任务读取相关文件。

## 工作流摘要

- 需求分级、人工确认闸门、AI 自审、`allowed_files` 文件边界、实施流和失败分流统一维护在 `.workflow/development-flow.md`。
- 实际编码和测试失败 Loop 维护在 `.workflow/coding-flow.md`。
- 单任务记录使用 `.workflow/task-template.md`。
- 识别为 L 级改动时，必须先在 `.plan/` 创建计划文件并等待人工确认。
- `AGENTS.md` 不承载完整流程细则，只保留必须长期稳定的项目规则和文档路由。

## 文档更新规则

- 外部 PRD 变化：不把 PRD 原文落入仓库，先拆解到架构、模块、API、测试和 ADR。
- 架构文档变化：先更新 `docs/architecture/`，再按架构路由同步 `docs/modules/`。
- 模块文档变化：同步对应 `docs/api/`、`docs/testing/plans/` 和 `docs/testing/cases/`。
- 接口变更：先更新 `packages/contracts`。
- schema 变更：先更新数据库设计文档和迁移方案。
- 服务职责或链路变化：更新架构文档，必要时写 ADR。
- 本地开发命令变化：更新 README 和相关 runbook。
- 纯内部实现、无行为变化的小修，不强制更新派生文档。

## 验证命令

```bash
pnpm --filter @mediaforge/contracts typecheck
pnpm --filter @mediaforge/service typecheck
pnpm --filter @mediaforge/web typecheck
pnpm typecheck
pnpm test
pnpm build
```

## 禁止事项

- 不提交密钥、token、真实用户数据。
- 不把模型 API Key 写入代码、文档或日志。
- 不把 AI 生成 HTML 当作文章唯一事实源。
- 不把对象存储当作可编辑文章状态的唯一来源。
- 不绕过契约直接在前后端各写一套类型。
- 不为了测试方便修改业务行为。
- 不把临时调试代码、样例密钥、一次性脚本混入正式代码。

## 完成标准摘要

完整完成标准见 `.workflow/development-flow.md`。任务完成时至少说明：

1. 改动摘要。
2. 关键文件。
3. 设计取舍。
4. 验证结果。
5. 未验证项或风险。
6. 是否需要更新 `CONTEXT.md`、ADR、架构、模块、API、测试或 standards。

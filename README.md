# MediaForge

面向培训机构和本地门店的 AI 公众号内容生成与排版平台。

## 当前阶段

当前仓库处于工程骨架阶段。正式开发前，以 `AGENTS.md`、`CONTEXT.md`、`.workflow/` 和 `docs/` 为准。

## 本地基础设施

第一版工程方案使用：

- PostgreSQL：业务数据、文章结构、版本元数据、配额、工作区记忆。
- MinIO：图片、HTML 快照、Markdown 导出、prompt 快照、排版 skill 包。
- Redis：队列、缓存、限流、任务状态。

启动本地基础设施：

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

复制环境变量示例：

```bash
cp .env.example .env
cp apps/service/.env.example apps/service/.env
cp apps/web/.env.example apps/web/.env
```

## 项目结构

```text
apps/
  service/             后端服务
  web/                 前端 Web 应用
packages/
  contracts/           前后端共享契约
docs/
  README.md            文档分级和路由规则
  architecture/        架构文档和模块路由
  modules/             模块事实源
  api/                 API 文档
  testing/             测试方案和测试用例
  specs/               功能或工程规格
  standards/           工程规范
  runbooks/            本地开发、部署、排障
  adr/                 架构决策记录
.plan/
  plan-template.md     L 级改动计划模板
.workflow/
  development-flow.md  开发流程和闸门
  coding-flow.md       Coding 实施流程
  task-template.md     任务模板
infra/
  docker/              本地 PostgreSQL、MinIO、Redis
```

## 开发流程

详见 [.workflow/development-flow.md](.workflow/development-flow.md)。

简版流程：

1. 设计流：需求进入、需求分流、文档更新、AI 自审、人工确认。
2. 文档 Loop：AI 自审文档不通过，回到文档修改和撰写。
3. Coding Loop：测试不通过先分类，实现问题回到编码，方案问题回到人工确认。
4. 实施流：锁定 `allowed_files`、编码实现、运行测试、失败分流、实施报告、人工评审。
5. 契约优先：涉及接口或数据形状时，先更新共享契约。
6. 文件边界：每个任务在改代码前声明 `allowed_files`。
7. 测试门禁：没有验证结果，不算完成。
8. 人工签字：高风险或不明确变更必须显式确认。
9. L 级计划：识别为 L 级改动时，先在 `.plan/` 写计划并确认。

## 工程规范

通用规范位于 `docs/standards/`，包括通用开发、TypeScript、注释、API、日志、SQL、安全和测试规范。

服务专属规范：

- 前端：`docs/standards/frontend-nextjs.md`
- 后端：`docs/standards/backend-service.md`

## 需求文档

PRD 不作为仓库长期文档资源。外部 PRD 或需求文档进入项目时，只把结论拆解到 `docs/architecture/`、`docs/modules/`、`docs/api/`、`docs/testing/` 和 `docs/adr/`。

# MediaForge 文档目录

本目录按“架构 → 模块 → API → 测试 → 运行和标准”分级维护。不要把所有内容塞进一个文档。

PRD 不作为仓库长期文档资源。PRD 在外部系统中维护和版本化，进入仓库时只作为输入材料，被拆解到架构、模块、API、测试和 ADR 文档中。

## 目录分级

```text
docs/
  README.md                     文档分级和路由规则
  architecture/                 架构总览、数据库、存储、部署、架构路由
  modules/                      模块文档，一个模块一个目录
  api/                          API 文档，按模块维护
  testing/                      测试方案和测试用例，按模块维护
  standards/                    工程标准
  runbooks/                     本地开发、部署、排障
  adr/                          架构决策记录
  specs/                        功能或工程规格
```

## 文档职责

| 层级 | 职责 | 不做什么 |
| --- | --- | --- |
| architecture | 描述系统边界、数据归属、关键链路，并路由到模块 | 不展开单模块 API 和测试细节 |
| modules | 描述模块职责、领域对象、状态、流程、依赖和边界 | 不重复全局架构 |
| api | 描述请求、响应、错误码、兼容性和权限 | 不解释产品背景 |
| testing | 描述测试方案、测试用例、回归范围 | 不替代自动化测试代码 |
| standards | 描述长期通用规则 | 不记录一次性方案 |
| runbooks | 描述环境、部署、排障步骤 | 不记录产品需求 |
| adr | 记录重要架构决策和取舍 | 不作为任务计划 |
| specs | 记录功能或工程规格 | 不替代模块长期文档 |

## 规范分层

通用规范适用于整个项目：

- `docs/standards/coding-general.md`
- `docs/standards/typescript.md`
- `docs/standards/comments.md`
- `docs/standards/api-design.md`
- `docs/standards/logging.md`
- `docs/standards/sql.md`
- `docs/standards/testing.md`
- `docs/standards/security.md`
- `docs/standards/minimal-change.md`

服务专属规范按目录生效：

- `docs/standards/frontend-nextjs.md`：适用于 `apps/web`
- `docs/standards/backend-service.md`：适用于 `apps/service`

## 架构到模块的路由规则

涉及架构文档改动时，必须先判断是否影响具体模块：

```text
架构文档变化
→ 更新 architecture 路由或总览
→ 找到受影响 modules/*
→ 更新模块文档
→ 根据模块文档同步 api/*
→ 根据模块文档同步 testing/plans/*
→ 根据测试方案同步 testing/cases/*
```

如果只改全局原则，不影响具体模块，可以只改 `architecture/` 和必要 ADR。

如果影响模块职责、数据、流程、权限、API、错误码或测试范围，必须同步模块文档。

## 外部 PRD 拆解规则

外部 PRD 或需求文档进入仓库时，不保存原文，不维护 PRD 版本副本。只把可执行、可验证、可长期维护的事实拆解到：

1. 架构文档：`docs/architecture/`
2. 模块文档：`docs/modules/{module}/README.md`
3. API 文档：`docs/api/{module}.md`
4. 测试方案：`docs/testing/plans/{module}.md`
5. 测试用例：`docs/testing/cases/{module}.md`
6. 架构决策：`docs/adr/`

需求变化再次进入时，按同样流程更新派生文档，而不是新增 PRD 副本。

## 模块文档同步规则

模块文档是单模块事实源。模块文档变更后，检查并同步：

1. API 文档：`docs/api/{module}.md`
2. 测试方案：`docs/testing/plans/{module}.md`
3. 测试用例：`docs/testing/cases/{module}.md`
4. 共享契约：`packages/contracts`
5. 必要时补 ADR：`docs/adr/`

## 命名规则

- 模块目录使用英文小写 kebab-case，例如 `docs/modules/workspaces/`。
- API 文档使用同名文件，例如 `docs/api/workspaces.md`。
- 测试方案使用同名文件，例如 `docs/testing/plans/workspaces.md`。
- 测试用例使用同名文件，例如 `docs/testing/cases/workspaces.md`。

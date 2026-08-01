# docs 目录 AI 协作规范

本文件是 `docs/` 目录的局部规则。修改 `docs/` 下任何文档前，先读根目录 `AGENTS.md`，再读本文件和 `docs/README.md`。

## 基本规则

- 文档统一使用中文。
- 技术名词、目录名、接口字段、数据库字段保留英文。
- 文档只记录事实、决策、边界、流程和验证方式，不写空泛描述。
- 不把同一份细节重复维护在多个目录。
- 架构文档只做系统级说明和路由，模块细节落到 `docs/modules/`。

## 文档分级

```text
docs/
  product/        产品行为和验收标准
  architecture/   系统边界、数据归属、关键链路、模块路由
  modules/        单模块事实源
  api/            请求、响应、错误码、权限、兼容性
  testing/        测试方案和测试用例
  standards/      长期通用工程标准
  runbooks/       本地开发、部署、排障
  adr/            长期架构决策
  specs/          功能或工程规格
```

## 文档路由

文档变更按下面顺序判断：

```text
外部 PRD / 需求文档 → 拆解 → docs/architecture / docs/modules / docs/api / docs/testing / docs/adr
架构边界 → docs/architecture → docs/modules
模块职责 → docs/modules
接口契约 → packages/contracts + docs/api
测试策略 → docs/testing/plans
测试用例 → docs/testing/cases
长期决策 → docs/adr
运行排障 → docs/runbooks
```

## 架构文档变更规则

如果修改 `docs/architecture/`，必须判断是否影响具体模块。

影响模块时，继续同步：

1. `docs/modules/{module}/README.md`
2. `docs/api/{module}.md`
3. `docs/testing/plans/{module}.md`
4. `docs/testing/cases/{module}.md`

如果只影响全局原则、服务边界或长期取舍，不影响具体模块，更新 `docs/architecture/` 后根据需要补 `docs/adr/`。

## 外部 PRD 拆解规则

PRD 不作为仓库长期文档资源。PRD 在外部系统中维护和版本化，进入仓库时只作为输入材料。

处理外部 PRD 时：

1. 不复制 PRD 原文到仓库。
2. 先识别影响面和需求等级。
3. 架构变化写入 `docs/architecture/`，必要时补 `docs/adr/`。
4. 模块职责、状态、流程、数据归属写入 `docs/modules/{module}/README.md`。
5. 接口变化写入 `packages/contracts` 和 `docs/api/{module}.md`。
6. 验证策略写入 `docs/testing/plans/{module}.md`。
7. 具体测试场景写入 `docs/testing/cases/{module}.md`。
8. L 级改动先在 `.plan/` 写计划并等待人工确认。

## 模块文档变更规则

`docs/modules/{module}/README.md` 是该模块事实源。

修改模块职责、领域对象、状态、流程、权限、数据归属、API 或错误码时，必须检查并同步：

- API 文档：`docs/api/{module}.md`
- 测试方案：`docs/testing/plans/{module}.md`
- 测试用例：`docs/testing/cases/{module}.md`
- 共享契约：`packages/contracts`
- 必要时补 ADR：`docs/adr/`

## API 文档规则

- 新增或修改 API 属于至少 M 级变更。
- API 文档必须和 `packages/contracts` 保持一致。
- API 文档不解释产品背景，只记录接口事实。
- 修改请求、响应、错误码或权限时，必须同步测试方案和测试用例。

## 测试文档规则

- 测试方案放 `docs/testing/plans/{module}.md`。
- 测试用例放 `docs/testing/cases/{module}.md`。
- L 级改动必须先在 `.plan/` 说明测试方案，再落到 `docs/testing/`。
- 测试文档描述验证意图和场景，不替代测试代码。

## 禁止事项

- 不把外部需求原文写进架构文档。
- 不把外部 PRD 原文或版本副本放进仓库。
- 不把 API 细节写进架构总览。
- 不把测试用例散落在模块文档里。
- 不在 `docs/` 记录密钥、token、真实用户隐私或真实 API Key。
- 不复制粘贴一份文档到多个位置造成双写。

## 完成检查

修改 docs 后至少检查：

1. 是否符合 `docs/README.md` 的分级。
2. 是否需要同步模块、API、测试方案、测试用例。
3. 是否需要更新 `AGENTS.md`、`CONTEXT.md`、`.workflow/`、`.plan/` 或 ADR。
4. 是否存在断开的文档路由。

# L 级改动计划：用户私有公众号 Skill 包

## 需求背景

普通用户拥有自己的公众号风格，并希望通过 Codex 或其他 Agent 把风格、结构规则、企业 logo、二维码等品牌资源整理成 Skill 包，安装到 MediaForge 后在生成公众号文案时通过 `@` 引用。该能力涉及用户级数据写入、对象存储、API 契约、权限校验和 AI 生成链路，因此属于 L 级改动。

## 分级结论

```text
需求分级：L
分级理由：新增用户私有 Skill、Skill 版本、Skill 资源和安装关系；影响数据库 schema、对象存储、前后端 API、权限和 AI 调用链路。
影响面：前端、后端服务、共享契约、数据库 schema、对象存储、AI 调用链路、权限 / 安全、文档。
是否需要人工确认：是
```

## 非目标

- 不执行用户上传的 JS、Python、Shell 或任意插件代码。
- 不允许 Skill 携带模型 API Key、cookie、token 或外部服务密钥。
- 第一版不做公开 Skill 市场和跨用户共享。
- 第一版不做多主 Skill 混合编排。

## 影响面

| 领域 | 是否影响 | 说明 |
| --- | --- | --- |
| 前端 | 是 | 增加 Skill 管理页、上传导入、`@` 选择和生成引用。 |
| 后端服务 | 是 | 增加导入、校验、安装、查询和生成时校验。 |
| 共享契约 | 是 | 增加 manifest、asset、mention 和 API schema。 |
| 数据库 schema | 是 | 增加用户私有 Skill、版本、资源和安装关系表。 |
| 对象存储 | 是 | 保存原始 Skill 包、logo、二维码、预览图。 |
| Redis / 队列 | 待定 | 清理上传失败对象可复用现有 outbox 或后台任务。 |
| AI 调用链路 | 是 | Run 创建时冻结 Skill 上下文，Creation Graph 使用 Skill 约束。 |
| 权限 / 安全 | 是 | 校验 Skill 归属、资源归属、安全扫描和 prompt 注入风险。 |
| 部署 / 环境变量 | 否 | 第一版不需要新增外部服务密钥。 |
| 文档 | 是 | 已新增规格并同步模块、API、测试和数据库设计。 |

## 方案设计

采用“用户私有声明式 Skill 包”方案。Skill 包由 `manifest.json` 和可选资源文件组成。MediaForge 只读取声明式 JSON 和图片资源，不执行上传包中的代码。生成时前端发送结构化 `skillMentions`，后端重新校验当前用户是否拥有或安装该 Skill，并在 Run 创建时冻结 Skill version 和资源引用。

## 契约与数据变更

目标数据表：

- `user_skills`
- `user_skill_versions`
- `user_skill_assets`
- `user_installed_skills`

目标对象存储路径：

```text
users/{userId}/skills/{skillId}/versions/{versionId}/package.zip
users/{userId}/skills/{skillId}/versions/{versionId}/assets/{assetId}/original
users/{userId}/skills/{skillId}/versions/{versionId}/assets/{assetId}/preview
```

契约需覆盖：

- Skill manifest schema。
- Skill asset schema。
- Skill import / install / list / detail API。
- Conversation turn 或 Run 创建请求中的 `skillMentions`。
- Creation Graph 上下文中的 `selectedSkills` 和 `skillAssets`。

## allowed_files 草案

```yaml
allowed_files:
  - docs/specs/014-user-private-skill-pack.md
  - docs/modules/layout-skills/README.md
  - docs/api/layout-skills.md
  - docs/testing/plans/layout-skills.md
  - docs/testing/cases/layout-skills.md
  - docs/architecture/database.md
  - .plan/20260803-user-private-skill-pack.md
verification:
  - 文档自审
```

## 实施步骤

1. 确认规格和 schema 方案。
2. 更新 contracts 和 API 文档。
3. 增加数据库迁移和对象存储写入逻辑。
4. 增加 service 导入、安装、查询、禁用和生成校验。
5. 增加 web Skill 管理页和 `@` 选择交互。
6. 接入 Creation Graph 上下文冻结和 Artifact Builder 资源解析。
7. 补充权限、安全、生成链路和回归测试。

## 验证方案

- contracts typecheck。
- service typecheck 和单测。
- web typecheck 和 `@` 交互测试。
- Skill manifest schema 校验测试。
- Skill asset 上传、解码、尺寸和类型校验测试。
- 跨用户引用私有 Skill 拒绝测试。
- Run 创建后 Skill 更新不影响已冻结上下文测试。
- 二维码、logo 只进入允许区域的 Artifact Builder 测试。

## 迁移与回滚

新增表以空表方式上线，不迁移历史数据。回滚时先禁用 Skill 导入和 `@` 入口，再保留已创建表和对象用于历史文章复现。对象清理必须通过安全清理任务执行，不直接删除仍被版本引用的资源。

## 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| Skill 注入系统指令 | 生成越权或污染正文 | manifest 受控字段、后端安全扫描、Artifact Builder Guard。 |
| 用户上传密钥或隐私 | 数据泄露 | 导入扫描、禁止 prompt 快照保存原始包和图片内容。 |
| 跨用户资源引用 | 权限越界 | 所有 Skill 和 asset 查询按 `owner_user_id` 校验。 |
| Skill 更新影响历史文章 | 结果不可复现 | Run 创建时冻结 version，文章保存 HTML 快照。 |
| 二维码乱插入正文 | 公众号体验差 | asset type 和 role 白名单，renderer 限制出现区域。 |

## AI 自审

```text
AI 自审结论：通过
分级复核：L 级，涉及 schema、对象存储、权限和 AI 调用链路。
服务边界：前端只调用 service；service 负责校验、存储、生成上下文；不新增外部执行服务。
契约与数据：需要后续同步 packages/contracts 和迁移，本次只落方案文档。
异常路径：导入失败、资源校验失败、Skill 禁用、跨用户引用、Run 冻结后版本变更均有处理要求。
安全风险：主要是 prompt 注入、密钥上传和资源越权，方案使用声明式 manifest、扫描和后端强校验控制。
测试方案：覆盖 manifest、asset、权限、@ mention、Run 冻结和 Artifact Builder。
反方意见：第一版范围仍偏大，可以先只支持 logo、qrcode 和单主 Skill。
需要人工重点看的问题：是否接受第一版只支持私有 Skill，不做市场和共享；是否把 `article_versions` 扩展为多 Skill 引用。
```

## 人工确认

```text
审核结论：已确认
确认人：用户
确认时间：2026-08-03
备注：用户明确要求“开始实施”。第一轮实现采用 JSON manifest 导入 + assetKey 单独上传，zip 解包作为后续兼容扩展。
```

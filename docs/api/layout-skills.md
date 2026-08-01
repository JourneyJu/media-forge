# API：排版 Skills

## 模块文档

- `docs/modules/layout-skills/README.md`

## 接口列表

新增或修改接口时，先同步 `packages/contracts/src/layout-skills.ts`。

## `GET /layout-skills`

按行业、场景和状态查询可用排版 skill。

### 查询参数

| 参数 | 说明 |
| --- | --- |
| `industry` | 工作区行业。 |
| `scenario` | 内容场景。 |
| `status` | `active` 或 `disabled`。 |

## `GET /layout-skills/:skillPackId`

返回 skill 详情，包括结构模块、视觉约束、`rendererKey`、`wechatHtmlRenderer` 和 `promptTemplateKey`。

## 微信 renderer 兼容性

接口返回的 renderer 信息只用于选择和展示。实际微信 HTML 渲染由 `apps/service` 内 renderer 执行，文章版本必须记录 `rendererVersion` 和 `skillPackVersion`。

## Agent 使用

`POST /agent-runs` 可通过 `layoutSkillId` 选择内置 Skill：

| 值 | 说明 |
| --- | --- |
| `auto` | 根据文章结构使用默认 renderer。 |
| `youth-growth-listicle` | 使用少儿成长清单的内容约束与微信排版。 |

选中的 Skill 同时影响 Agent 执行计划、内容结构约束和最终预览，模型不得把 Skill 指令或审阅过程输出到文章正文。

## 错误码

| 错误码 | HTTP | 说明 |
| --- | --- | --- |
| `LAYOUT_SKILL_NOT_FOUND` | 404 | Skill 不存在或不可用。 |
| `LAYOUT_SKILL_DISABLED` | 409 | Skill 已禁用，不能用于新生成。 |

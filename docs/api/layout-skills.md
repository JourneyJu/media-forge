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

## 用户私有 Skill API

用户私有 Skill API 面向普通用户。所有接口必须按当前登录用户校验归属，不允许跨用户读取、安装或引用私有 Skill。

### `GET /user-skills`

返回当前用户的私有 Skill 和安装状态。用于 Skill 管理页和输入框 `@` 菜单。

Skill 管理页使用该接口渲染账号级“我的 Skills”列表、概览统计和未启用分组。输入框 `@` 菜单只能从该结果中过滤当前用户已安装且 `active` 的 Skill。

### `POST /user-skills/import`

上传或粘贴 `manifest.json` 并导入用户私有 Skill。后端必须校验 manifest schema 和安全风险。导入成功后创建 `user_skills`、`user_skill_versions` 和 `user_skill_assets` 占位记录，第一版资源文件通过 asset 上传接口按 `assetKey` 补齐。后续可扩展为 `.mediaforge-skill.zip` 一次性导入。

前端账号级“我的 Skills”页面第一版通过文本输入提交 manifest；后续支持 zip 包或拖拽上传时，可继续复用该导入语义或新增包上传接口。

### `POST /user-skills/:skillId/versions/:versionId/assets/:assetKey`

上传 Skill 包中的 logo、二维码、品牌图等资源文件。请求体为图片二进制，`content-type` 必须是受支持的图片类型，`x-file-name` 传原始文件名。后端按当前用户、`skillId`、`versionId` 和 `assetKey` 校验归属。

Skill 管理页按 manifest 中声明的 `assetKey` 展示资源位，例如 logo、二维码、封面、分隔图、固定 CTA 图和示例图；资源上传完成后必须刷新详情或列表状态。

### `GET /user-skills/:skillId`

返回当前用户有权访问的 Skill 详情，包括当前版本、manifest 摘要、资源列表、安装状态和校验结果摘要。

### `POST /user-skills/:skillId/install`

安装或启用指定 Skill version。请求可包含 `alias`，用于 `@` 菜单展示。

### `POST /user-skills/:skillId/disable`

禁用当前用户的 Skill。禁用后不能用于新生成，但不得影响历史文章版本和 HTML 快照。

### `DELETE /user-skills/:skillId`

删除或标记删除当前用户的私有 Skill。若存在历史版本引用，必须保留复现所需快照或通过生命周期策略延迟清理对象资源。

## 微信 renderer 兼容性

接口返回的 renderer 信息只用于选择和展示。实际微信 HTML 渲染由 `apps/service` 内 renderer 执行，文章版本必须记录 `rendererVersion` 和 `skillPackVersion`。

## Agent 使用

`POST /agent-runs` 可通过 `layoutSkillId` 选择内置 Skill：

| 值 | 说明 |
| --- | --- |
| `auto` | 根据文章结构使用默认 renderer。 |
| `youth-growth-listicle` | 使用少儿成长清单的内容约束与微信排版。 |

选中的 Skill 同时影响 Agent 执行计划、内容结构约束和最终预览，模型不得把 Skill 指令或审阅过程输出到文章正文。

Conversation-first 主链路应通过消息或 Turn 请求中的结构化 `skillMentions` 引用用户私有 Skill：

```json
{
  "content": "写一篇秋季招生公众号，重点讲入园适应",
  "skillMentions": [
    {
      "skillId": "skill_123",
      "versionId": "skill_version_456",
      "alias": "高端托育园温暖风"
    }
  ]
}
```

后端必须重新校验 `skillId`、`versionId` 和当前用户安装关系，不得仅凭 `content` 中的 `@名称` 选择 Skill。Run 创建时必须冻结 Skill version 和 Skill asset 引用。

## 错误码

| 错误码 | HTTP | 说明 |
| --- | --- | --- |
| `LAYOUT_SKILL_NOT_FOUND` | 404 | Skill 不存在或不可用。 |
| `LAYOUT_SKILL_DISABLED` | 409 | Skill 已禁用，不能用于新生成。 |
| `USER_SKILL_IMPORT_INVALID` | 422 | Skill 包 manifest、资源或安全校验失败。 |
| `USER_SKILL_FORBIDDEN` | 403 | 当前用户无权访问或安装该 Skill。 |
| `USER_SKILL_ASSET_INVALID` | 422 | Skill 资源类型、大小、尺寸或图片解码校验失败。 |
| `USER_SKILL_VERSION_CONFLICT` | 409 | 请求引用的 Skill version 已不是可用版本。 |

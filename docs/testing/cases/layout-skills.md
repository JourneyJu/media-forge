# 测试用例：排版 Skills

## 模块文档

- `docs/modules/layout-skills/README.md`

## 当前状态

## 用例

| ID | 场景 | 步骤 | 预期 |
| --- | --- | --- | --- |
| LSK-001 | 查询可用 skill | 按行业和场景查询 | 返回 active skill 列表。 |
| LSK-002 | 禁用 skill | 使用 disabled skill 生成 | 返回 `LAYOUT_SKILL_DISABLED`。 |
| LSK-003 | 版本写入 | 使用 skill 生成文章 | 文章版本记录 `skillPackVersion`。 |
| LSK-004 | Renderer 版本 | 渲染微信 HTML | 文章版本记录 `rendererVersion`。 |
| LSK-005 | 样式白名单 | 渲染复杂文章 | HTML 不包含脚本、事件属性、外部 CSS。 |
| LSK-006 | 视频降级 | 渲染视频块 | 输出占位和 warning。 |
| LSK-007 | 导入用户 Skill | 上传包含 `manifest.json`、logo 和二维码的 Skill 包 | 创建 Skill、版本和资源元数据，资源写入对象存储。 |
| LSK-008 | 拒绝无效 Skill | 上传缺少 manifest、包含可执行代码或密钥的 Skill 包 | 返回 `USER_SKILL_IMPORT_INVALID`，不创建 active Skill。 |
| LSK-009 | 跨用户引用 | 用户 A 请求使用用户 B 的私有 Skill | 返回 `USER_SKILL_FORBIDDEN`。 |
| LSK-010 | `@` 结构化引用 | 消息文本包含 `@名称` 但未传 `skillMentions` | 后端不把纯文本 `@名称` 当作已授权 Skill。 |
| LSK-011 | Skill 资源引用 | 生成结果引用二维码 | ArticleDocument 只包含受控 `assetKey`，renderer 解析为当前用户有权访问的 HTTPS URL。 |
| LSK-012 | 二维码使用区域 | Skill 包含 `type=qrcode` 资源 | 二维码只出现在 CTA 或结尾区域。 |
| LSK-013 | 版本冻结 | Run 创建后用户更新 Skill logo | 运行中的 Run 和历史文章继续使用创建时冻结的 Skill version。 |

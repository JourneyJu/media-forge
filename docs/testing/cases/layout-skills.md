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

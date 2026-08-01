# 测试方案：排版 Skills

## 模块文档

- `docs/modules/layout-skills/README.md`

## 当前状态

微信公众号生成第一版实现前，必须覆盖 skill 匹配、prompt template、renderer 版本和微信兼容规则。

## 测试范围

| 范围 | 目标 |
| --- | --- |
| Skill 匹配 | 按行业和场景返回 active skill。 |
| 版本记录 | 文章版本保存 `skillPackVersion` 和 `rendererVersion`。 |
| Renderer 白名单 | 输出不包含脚本、事件属性、外部 CSS、CSS 变量。 |
| 视频降级 | 视频块输出占位和 warning。 |
| 样式兼容 | 标题、段落、图片、二维码、CTA 使用内联样式。 |

## 验证命令

```bash
pnpm --filter @mediaforge/contracts typecheck
pnpm --filter @mediaforge/service test
```

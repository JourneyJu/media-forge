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
| 用户 Skill 导入 | 校验 manifest、资源文件、图片类型、大小、尺寸和安全扫描。 |
| 用户 Skill 权限 | 当前用户只能查询、安装和引用自己的私有 Skill。 |
| 用户 Skill 管理 UI | “我的 Skills”入口位于账号下拉，管理页不依赖当前 workspace，输入区不放管理按钮。 |
| `@` 引用 | 前端传结构化 mention，后端重新校验 Skill 和 version。 |
| Skill 资源使用 | logo、二维码和品牌图只能通过 `assetKey` 进入结构化文章。 |
| Skill 资源位展示 | 管理页展示 logo、二维码、封面和示例图等资源完整度，必需资源缺失时不可用于新生成。 |
| 版本冻结 | Run 创建后 Skill 更新不影响已冻结上下文和历史文章。 |

## 验证命令

```bash
pnpm --filter @mediaforge/contracts typecheck
pnpm --filter @mediaforge/service test
pnpm --filter @mediaforge/web typecheck
```

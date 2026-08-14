# 测试方案：文章与版本

## 模块文档

- `docs/modules/articles/README.md`

## 当前状态

微信公众号生成第一版实现前，必须覆盖文章创建、版本保存、微信 HTML 快照、复制导出和恢复流程。

## 测试范围

| 范围 | 目标 |
| --- | --- |
| 契约测试 | `ArticleDocument`、块类型、版本摘要和渲染结果结构正确。 |
| Renderer 单测 | 微信 HTML 使用保守标签、内联样式并过滤危险内容。 |
| Service 集成 | 保存版本时同时写入 `content_json` 和 HTML 快照 key。 |
| 富文本剪贴板 | 同一次用户操作写入语义一致的 `text/html` 与 `text/plain`，并覆盖能力不足、权限拒绝和复制失败。 |
| 复制导出 | 仅在剪贴板写入成功后记录事件，富文本复制与纯文本降级可区分。 |
| 图片兼容 | HTTPS 图片保留原顺序；本地、`blob:`、`data:` 和非 HTTPS URL 产生 warning。 |
| 右侧预览交互 | 保持现有工作台布局，只更新复制按钮、紧凑状态条和成功 Toast。 |
| 恢复版本 | 恢复历史版本必须创建新版本。 |
| Conversation 归属 | Article 必须绑定 Conversation，越权检查沿 Conversation 执行。 |
| 聚合删除 | 删除 Conversation 后 Article、Version、导出事件和对象快照最终清理。 |

## 验证命令

```bash
pnpm --filter @mediaforge/contracts typecheck
pnpm --filter @mediaforge/service test
pnpm --filter @mediaforge/service typecheck
pnpm --filter @mediaforge/web test
pnpm --filter @mediaforge/web typecheck
```

## 自动化验证重点

- Renderer 输出正文 fragment，不包含 `html`、`head`、`body`、`script`、事件属性和外部样式表。
- 常用块类型只生成保守标签和内联样式；图片包含块级、自适应尺寸约束。
- `ArticleDocument` 到 `text/plain` 的转换保留段落、列表顺序和可读换行，不输出 `**` 等 Markdown 样式标记。
- 支持 `ClipboardItem` 时，一次 `navigator.clipboard.write` 同时包含 `text/html` 和 `text/plain`。
- 不支持富文本剪贴板、权限被拒绝或写入失败时，界面不显示完整复制成功；纯文本降级必须由用户明确触发或确认。
- 剪贴板成功后才提交导出事件；失败不提交，纯文本降级使用独立导出类型。
- 复制结果统计中的段落数和图片数来自当前文章版本，不受 HTML 展示标签数量影响。
- 右侧状态条随当前版本更新段落数、图片数和 warning 数；无 warning 时显示“可复制”。
- 富文本复制成功才显示“正文已复制”Toast，失败或纯文本降级不显示富文本成功提示。
- 复制执行期间按钮不可重复触发，完成后恢复可操作状态。
- 状态条问题入口复用现有 warning 展示能力，不引入新的常驻面板或默认弹窗。

## 手动验证

- 在 Chrome 和 Edge 各生成一篇包含标题、居中正文、粗体、日程、HTTPS 图片、二维码和 CTA 的文章。
- 点击“复制到公众号”，粘贴到真实微信公众号后台正文编辑器，不通过源码编辑或 `.html` 文件中转。
- 检查文字没有出现 `**` 等 Markdown 标记，段落、粗体、居中、分隔符、二维码和 CTA 可见。
- 检查图片数量和顺序；记录微信清洗或转存后的差异，不以站内预览代替平台结果。
- 检查状态条包含段落数、图片数，成功 Toast 包含标题、摘要和封面需单独设置的说明。
- 对比改动前工作台，确认左侧记录栏、中间对话区、底部输入区、右侧栏宽度和手机预览尺寸没有变化。
- 检查右侧按钮显示“复制到公众号”，手机预览下方状态条显示当前版本统计与问题入口。
- 成功复制后检查 Toast 位于右侧栏底部且不遮挡手机预览和复制按钮，并能自动消失。
- 禁用或拒绝剪贴板权限，确认显示失败原因且可以复制纯文本。
- 确认视频块展示发布前 warning。

真实公众号手工验收属于第一阶段发布闸门。自动化测试通过但未完成该项时，只能标记为“代码验证通过、平台兼容性未验证”。

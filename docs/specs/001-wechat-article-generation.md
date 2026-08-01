# 规格：微信公众号生成功能

## 背景

MediaForge 第一版面向培训机构、本地门店和兼职运营人员，帮助普通用户生成可复制到微信公众号后台的图文内容。该功能不直接发布到微信公众号，而是提供结构化编辑、AI 生成、微信兼容 HTML、历史版本和复制导出能力。

## 目标用户

| 用户 | 场景 |
| --- | --- |
| 培训机构校区负责人 | 招生宣传、公开课、课程介绍、学员案例。 |
| 课程顾问或教务 | 家长沟通、活动通知、报名引导。 |
| 门店老板或店长 | 促销活动、新品推荐、会员福利、门店介绍。 |
| 兼职运营人员 | 快速产出公众号图文并复制发布。 |

## 产品范围

### 第一版必须支持

- 在工作区内创建公众号文章草稿。
- 输入主题、受众、卖点、CTA、语气、风格和补充说明。
- 上传图片、二维码、海报和视频素材。
- 使用 AI 生成结构化 `ArticleDocument`。
- 使用微信兼容 renderer 生成 HTML。
- 保存文章版本，包含 `content_json`、HTML 快照 key、prompt 快照 key、renderer 版本。
- 手机比例预览、源码查看、复制 HTML。
- 通过对话修订文章内容。
- 在当前会话中展示 Agent 执行计划、步骤进度、审阅问题和用户确认；前端可用计划条或对话消息承载，不再要求独立 Agent 控制台。
- 按“素材理解 → 计划 → 排版 → 扩充 → 审阅 → 重构/修订 → 终审”执行可恢复工作流。
- 显示微信兼容性 warning。

### 第一版不支持

- 不直接发布到微信公众号。
- 不接入微信素材库。
- 不保证视频复制到微信后台后保留播放能力。
- 不支持多人协同。

## 工作台信息架构

| 区域 | 内容 |
| --- | --- |
| 工作区侧边栏 | 工作区入口、新建工作区、真实会话入口。没有真实数据时不展示假会话。 |
| 对话创作区 | 用户自然语言输入、素材上传、`@ Skill`、发送按钮、追问回答和继续调整。 |
| 计划区 | 执行计划、等待确认、完成摘要。任务完成后计划可以收起。 |
| 手机预览区 | 手机比例公众号预览、微信 HTML 源码、复制、兼容性 warning。 |

## 核心流程

### 生成初版

```text
选择工作区
→ 填写主题和生成参数
→ 上传或选择素材
→ 选择排版 skill
→ 创建生成任务
→ AI 返回结构化文章
→ schema 校验
→ 渲染微信 HTML
→ 保存文章版本
→ 前端展示预览和复制入口
```

### Agent 编排生成

```text
上传或选择素材
→ 素材理解 Agent 生成描述、OCR、类型、质量和位置建议
→ 策划 Agent 生成结构化执行计划
→ 当前会话展示计划，前端可用计划条承载
→ 命中确认策略时进入 waiting_user
→ 用户确认或修改计划
→ 排版 Agent 先生成 ArticleOutline，不扩写长正文
→ 内容 Agent 按骨架扩充 ArticleDocument
→ 审阅 Agent 输出 ReviewReport
→ 局部问题进入 revise，结构问题进入 restructure
→ 重构后重新扩充和审阅
→ 终审通过后渲染微信 HTML 并保存正式版本
```

Agent 循环必须有界：

- 局部修订最多 2 次，结构重构最多 2 次，总步骤最多 12 步。
- 连续两次审阅评分没有提升时进入 `waiting_user`。
- 达到循环上限时暂停并保留当前最佳版本，不得无限自动执行。
- 每个产生文章变化的步骤保存可恢复版本；失败步骤不得覆盖当前正式版本。

### 用户确认

以下情况必须在当前会话内暂停并请求用户确认：

- 品牌故事与成交转化方向无法同时满足。
- 需要删除用户明确要求保留的内容。
- 重构预计改变超过 30% 的文章结构。
- 素材识别结果与用户描述冲突。
- 多张相似素材需要用户决定保留范围。
- 达到循环上限或连续两次评分未提升。

### 对话修订

```text
用户输入修改指令
→ 后端带入当前 content_json、素材元数据、工作区记忆和历史摘要
→ AI 返回 patch 或完整结构
→ schema 校验
→ 渲染并保存新版本
→ 前端刷新预览
```

### 复制发布

```text
用户点击复制
→ 后端或前端使用当前版本 wechatHtml
→ 检查资源 URL 和兼容性 warning
→ 写入导出事件
→ 用户粘贴到微信公众号后台
```

## 微信兼容性要求

- HTML 必须使用保守标签和内联样式。
- 不允许脚本、事件属性、外部 CSS、CSS 变量、动画和复杂定位。
- 图片必须使用 HTTPS 可访问 URL。
- 视频块第一版输出发布前 warning，并可渲染为封面图、标题、说明和手动替换提示。
- 预览必须说明是模拟效果，复制结果以微信后台实测为准。

## 模型配置

第一版模型配置放在 `apps/service/.env`，由后端 Model Gateway adapter 读取。前端不接收、不展示、不保存模型 API Key。

建议环境变量：

```text
MODEL_GATEWAY_PROVIDER=
MODEL_GATEWAY_BASE_URL=
MODEL_GATEWAY_API_KEY=
MODEL_GATEWAY_DEFAULT_MODEL=
MODEL_GATEWAY_TIMEOUT_MS=
```

正式产品形态由管理与配额模块维护 `model_configs`，API Key 加密保存，按工作区、场景或租户路由模型。

## 验收标准

- 用户能从空工作区生成一篇包含文字和图片的公众号文章。
- 生成完成后存在文章主记录和至少一个文章版本。
- 版本同时保存结构化 `content_json` 和 HTML 快照 key。
- 复制出的 HTML 不包含脚本、事件属性和外部 CSS。
- 模型返回非法结构时不会保存坏版本。
- 图片素材原文件在对象存储中，数据库只保存元数据和 key。
- 前端不出现模型 API Key 输入框。
- 视频素材会产生明确的发布前 warning。
- 用户可以查看 Agent 计划和每一步执行结果，并在 `waiting_user` 状态提交选择。
- Agent 先生成排版骨架，再扩充正文；内容 Agent 不得自行改变章节结构。
- 审阅发现结构问题时能重构、重新扩充并再次审阅，且循环次数受限。
- 每次结构或内容变化都生成可恢复版本。

## 文档路由

- 架构：`docs/architecture/overview.md`、`docs/architecture/database.md`
- 模块：`docs/modules/articles/README.md`、`docs/modules/assets/README.md`、`docs/modules/ai-generation/README.md`、`docs/modules/layout-skills/README.md`、`docs/modules/admin/README.md`
- API：`docs/api/articles.md`、`docs/api/assets.md`、`docs/api/ai-generation.md`、`docs/api/layout-skills.md`、`docs/api/admin.md`
- 测试：`docs/testing/plans/*.md`、`docs/testing/cases/*.md`
- 决策：`docs/adr/001-wechat-copy-html-and-model-gateway.md`、`docs/adr/002-agent-orchestration-and-review-loop.md`

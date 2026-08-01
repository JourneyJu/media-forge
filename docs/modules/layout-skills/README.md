# 模块：排版 Skills

## 模块定位

排版 Skills 负责沉淀公众号样例的行业、场景、结构、视觉和 prompt 规则，让 AI 按规则生成结构化文章。

## 职责边界

### 负责

- Skill 包元数据。
- Skill 版本管理。
- 场景匹配。
- renderer 和 prompt template 关联。
- 微信兼容 renderer 版本关联。
- 结构模块清单和视觉约束定义。

### 不负责

- 实际模型调用。
- 用户上传素材管理。
- 文章版本保存。

## 领域对象

| 对象 | 说明 |
| --- | --- |
| LayoutSkillPack | 面向行业和场景的排版技能包。 |
| PromptTemplate | 生成结构化文章的 prompt 模板。 |
| RendererDefinition | 微信 HTML renderer key、版本和兼容规则。 |
| LayoutModule | 标题、正文、金句、图片、二维码、CTA 等结构模块。 |

## 内置 Skill

### 少儿成长清单 `youth-growth-listicle@1.0.0`

适用于少儿教育、兴趣培养、成长记录等面向家长的清单型文章。该 Skill 参考行业优秀文章的视觉节奏进行抽象，不保存或复用参考文章的原文与图片。

- 柔和引言面板承担开篇导读。
- 首图使用绿色强调边框，建立第一视觉焦点。
- 正文使用两位数编号、短标题和中等长度段落。
- 图片按内容单元穿插，避免素材集中堆放。
- 品牌分隔条和结尾短句形成完整阅读闭环。
- 禁止把执行计划、审阅意见、占位提示写入文章正文。

当前定义位于 `packages/contracts/src/layout-skills.ts`，微信 HTML renderer key 为 `youth-growth-listicle@1`。后续接入持久化后，定义快照进入对象存储，版本元数据进入 PostgreSQL。

## 微信 renderer 规则

- 使用 `section`、`p`、`span`、`img`、`br` 等保守标签。
- 所有样式内联，不依赖 class、外部 CSS、CSS 变量或脚本。
- 不使用动画、复杂定位、表单、事件属性。
- 图片必须渲染为 HTTPS 可访问 URL。
- 视频第一版渲染为封面、说明和发布前 warning。
- renderer 必须有 `renderer_version`，文章版本保存该版本。

## 数据归属

| 数据 | 归属 | 说明 |
| --- | --- | --- |
| layout_skill_packs | PostgreSQL | skill 元数据和版本 |
| skill JSON / prompt template | MinIO / S3 | skill 文件和模板 |
| renderer 规则 | 代码 / 对象存储元数据 | 代码实现为准，版本写入文章版本 |

## API 路由

- `docs/api/layout-skills.md`

## 测试路由

- `docs/testing/plans/layout-skills.md`
- `docs/testing/cases/layout-skills.md`

## 风险

- Skill 修改会影响后续生成效果，必须版本化。
- Renderer 修改可能改变复制结果，必须通过兼容性测试并记录版本。

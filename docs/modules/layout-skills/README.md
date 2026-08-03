# 模块：排版 Skills

## 模块定位

排版 Skills 负责沉淀公众号样例的行业、场景、结构、视觉和 prompt 规则，让 AI 按规则生成结构化文章。

用户私有公众号 Skill 是本模块的扩展方向。普通用户可以通过 Codex 或其他 Agent 生成声明式 Skill 包，上传并安装到平台，在公众号生成输入框中通过 `@` 引用。用户私有 Skill 可以包含风格规则、结构规则、禁忌规则、示例摘要和品牌资源，但不得包含可执行代码。

## 职责边界

### 负责

- Skill 包元数据。
- Skill 版本管理。
- 场景匹配。
- renderer 和 prompt template 关联。
- 微信兼容 renderer 版本关联。
- 结构模块清单和视觉约束定义。
- 用户私有 Skill 的 manifest、版本、安装关系和资源引用。
- Skill 包中 logo、二维码、品牌封面图、分隔图和固定 CTA 图的元数据管理。

### 不负责

- 实际模型调用。
- 普通会话素材管理。
- 文章版本保存。
- 执行用户上传的任意代码或第三方插件。

## 领域对象

| 对象 | 说明 |
| --- | --- |
| LayoutSkillPack | 面向行业和场景的排版技能包。 |
| PromptTemplate | 生成结构化文章的 prompt 模板。 |
| RendererDefinition | 微信 HTML renderer key、版本和兼容规则。 |
| LayoutModule | 标题、正文、金句、图片、二维码、CTA 等结构模块。 |
| UserSkill | 用户私有的公众号风格 Skill 主记录。 |
| UserSkillVersion | 用户私有 Skill 的 manifest 和资源引用版本。 |
| UserSkillAsset | Skill 包内的 logo、二维码、品牌图片等资源元数据。 |
| UserInstalledSkill | 用户已安装 Skill 关系，用于 `@` 菜单和生成权限校验。 |

## 用户私有 Skill 包

用户私有 Skill 包使用声明式格式，不执行代码。目标上传格式为 `.mediaforge-skill.zip`，第一版可以先导入 `manifest.json`，再按 `assetKey` 单独上传资源文件：

```text
my-brand-style.mediaforge-skill.zip
  manifest.json
  assets/
    logo.png
    qrcode-service.png
    brand-cover.jpg
    brand-divider.png
  examples/
    enrollment-article.json
```

`manifest.json` 只保存风格、结构、禁忌和资源引用，不内联 base64 图片。资源文件在导入时拆分写入对象存储，数据库保存 owner、类型、尺寸、hash 和对象 key。

第一版用户私有 Skill 只允许一个 Run 选择一个主 Skill。后续可以扩展为主 Skill 加辅助 Skill 的组合模式。

## 用户级管理入口

用户私有 Skill 跟随用户账号，不跟随 workspace 或 conversation。前端入口放在右上角账号下拉菜单的“我的 Skills”中，创作输入区只保留本次生成使用的 `@ Skill` / 私有 Skill 选择控件。

“我的 Skills”管理页面负责展示和操作当前登录用户的私有 Skill：

- 概览：已安装数量、可用数量、当前使用数量。
- 已安装列表：名称、别名、分类、状态、logo / 二维码 / 封面等资源完整度和操作入口。
- 导入区：粘贴 `manifest.json`，后续扩展 zip 包或拖拽上传。
- 资源区：按 `assetKey` 上传或检查 logo、二维码、封面、分隔图、固定 CTA 图和示例图。
- 未启用列表：展示 disabled、removed、待补齐资源或未安装的 Skill，但不能用于新生成。

管理页不得依赖当前 workspace。页面选择的“当前使用”只影响当前前端生成参数或用户偏好；后端仍以 Turn 请求中的结构化 `skillMentions` 和当前用户安装关系为准。

## `@` 引用规则

- `@` 菜单只展示当前用户已安装且 active 的 Skill。
- 前端发送结构化 `skillMentions`，后端不能只信任消息文本里的 `@名称`。
- 后端必须校验 Skill 属于当前用户或当前用户已安装，且 version 仍可用。
- Run 创建时冻结 Skill version、manifest 摘要和资源引用到 `graph_runs.context_json`。
- Skill 被禁用或删除后不能用于新生成，但不得破坏历史文章版本和 HTML 快照。

## 多 Agent 阶段规则

私有 Skill 不能只作为 Brief 的附加文字。冻结后的 manifest 和资源必须按最小必要原则裁剪给不同节点：

| 阶段 | 可读取内容 |
| --- | --- |
| Brief | 品牌定位、受众、语气、禁用表达。 |
| Planner | 固定栏目、叙事顺序、CTA 和内容模块。 |
| Writer | 标题风格、段落长度、用词、示例和禁忌。 |
| Layout | 品牌色、允许模块、Logo、二维码、GIF、分隔图和 CTA 图。 |
| Reviewer | 品牌一致性、禁用规则和资源位置约束。 |

模型只能输出 `assetKey` 或 `resourceId`，不能得到对象存储凭据，也不能自己拼接对象 URL。解析后的 Skill 资源包含稳定 `assetId`，服务端负责校验 owner、Skill version、asset type 和 usage 后生成 `/user-skills/assets/:assetId/preview`。二维码只能进入结尾 CTA 区域，Logo 使用品牌资源尺寸，GIF 保留动画原件并使用预览参与管理和素材理解。

Skill 可以约束 `LayoutPlan`，但不能提供 raw HTML、CSS、JavaScript、外部脚本或可执行 renderer。平台可信 Renderer 是 HTML 唯一生产者。

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
| user_skills | PostgreSQL | 用户私有 Skill 主记录 |
| user_skill_versions | PostgreSQL | 用户私有 Skill manifest 和版本 |
| user_skill_assets | PostgreSQL | Skill 包资源元数据 |
| user_installed_skills | PostgreSQL | 用户安装关系和 `@` 展示别名 |
| skill JSON / prompt template | MinIO / S3 | skill 文件和模板 |
| Skill package / logo / qrcode / brand image | MinIO / S3 | 用户上传 Skill 原始包、拆分资源和预览图 |
| renderer 规则 | 代码 / 对象存储元数据 | 代码实现为准，版本写入文章版本 |

## API 路由

- `docs/api/layout-skills.md`

## 测试路由

- `docs/testing/plans/layout-skills.md`
- `docs/testing/cases/layout-skills.md`

## 风险

- Skill 修改会影响后续生成效果，必须版本化。
- Renderer 修改可能改变复制结果，必须通过兼容性测试并记录版本。
- 用户私有 Skill 存在 prompt 注入、密钥上传和跨用户资源引用风险，必须使用声明式 manifest、导入扫描和后端权限校验。
- 二维码和 logo 必须按 asset type 和 role 限制使用区域，避免被模型随机插入正文。
- Skill 规则未真正进入 Planner、Writer、Layout 和 Reviewer 时，不得把该 Run 标记为已应用 Skill。

## 规格路由

- `docs/specs/014-user-private-skill-pack.md`
- `docs/specs/015-multi-agent-content-and-layout-quality.md`
- `docs/adr/010-structured-content-and-layout-plan.md`

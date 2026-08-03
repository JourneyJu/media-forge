# 规格：用户私有公众号 Skill 包

## 背景

普通用户可能拥有多个公众号风格，例如招生转化风格、品牌故事风格、活动回顾风格或门店促销风格。用户可以通过 Codex 或其他 Agent 把自己的公众号风格整理成 MediaForge 可识别的 Skill 包，上传并安装到平台。生成公众号文案时，用户在输入框通过 `@` 引用对应 Skill，本次生成按该 Skill 的风格、结构、品牌资源和禁忌规则执行。

该能力不是执行第三方代码的插件系统，而是用户私有的声明式 Skill 包系统。

## 目标

- 普通用户可以安装和管理自己的私有公众号 Skill。
- Skill 可以包含文案风格、结构规则、禁忌规则、示例摘要和品牌资源。
- 品牌资源支持企业 logo、二维码、品牌封面图、分隔图和固定 CTA 图。
- 用户在生成时通过 `@` 引用已安装 Skill。
- 后端在 Run 创建时冻结 Skill 版本和资源引用，保证历史文章可复现。
- Skill 内容只能影响公众号生成的风格、结构和资源选择，不允许改变系统权限、模型配置或服务边界。

## 非目标

- 第一版不执行用户上传的 JavaScript、Python、Shell 或任意插件代码。
- 第一版不允许 Skill 直接携带模型 API Key、cookie、token 或外部服务密钥。
- 第一版不开放公开市场和跨用户共享。
- 第一版不允许 Skill 绕过 Artifact Builder Guard 或直接写入最终文章版本。
- 第一版不要求一个 Run 同时组合多个主 Skill。

## Skill 包格式

目标形态支持上传 `.mediaforge-skill.zip` 或等价的文件包。第一版实现可先支持上传或粘贴 `manifest.json`，再按 `assetKey` 单独上传 logo、二维码和品牌图片；后续补充 zip 解包导入时不改变核心数据模型。

推荐包结构：

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

`manifest.json` 保存声明式规则和资源引用，不内联 base64 图片。

```json
{
  "manifestVersion": "1.0",
  "name": "高端托育园温暖风",
  "description": "适合托育园招生、活动回顾、家长沟通类公众号",
  "category": "wechat_article_style",
  "style": {
    "tone": "温暖、专业、有信任感",
    "audience": "0-3岁儿童家长",
    "paragraphLength": "medium",
    "titleStyle": "克制、有画面感、不夸张",
    "primaryColor": "#6B8F71"
  },
  "writingRules": [
    "开头先进入家长熟悉的生活场景",
    "正文避免强促销，先建立照护专业感",
    "每篇文章必须自然引导预约参观"
  ],
  "forbiddenRules": [
    "不要使用焦虑营销",
    "不要出现夸大承诺",
    "不要出现 AI 执行过程"
  ],
  "assets": [
    {
      "key": "brand_logo",
      "file": "assets/logo.png",
      "type": "logo",
      "required": true,
      "usage": "文章结尾品牌露出"
    },
    {
      "key": "consult_qrcode",
      "file": "assets/qrcode-service.png",
      "type": "qrcode",
      "required": true,
      "usage": "CTA 引导扫码咨询"
    }
  ],
  "examples": [
    {
      "title": "把孩子交给我们之前，家长最在意的三件事",
      "summary": "用家长视角切入托育安全感、照护细节和老师沟通"
    }
  ]
}
```

## 数据模型

目标表：

| 表 | 说明 |
| --- | --- |
| `user_skills` | 用户私有 Skill 主记录。 |
| `user_skill_versions` | Skill 版本和 manifest 快照。 |
| `user_skill_assets` | Skill 版本内的 logo、二维码和品牌图片等资源元数据。 |
| `user_installed_skills` | 用户已安装 Skill 关系，第一版主要用于私有 Skill 激活和后续共享兼容。 |

建议字段：

### `user_skills`

| 字段 | 说明 |
| --- | --- |
| `id` | Skill ID。 |
| `owner_user_id` | 所属用户。 |
| `name` / `description` | 展示名称和说明。 |
| `category` | `wechat_article_style` 等受控分类。 |
| `status` | `draft`、`active`、`disabled`、`rejected`。 |
| `current_version_id` | 当前启用版本。 |
| `created_at` / `updated_at` | 生命周期时间。 |

### `user_skill_versions`

| 字段 | 说明 |
| --- | --- |
| `id` | Skill version ID。 |
| `skill_id` | 所属 Skill。 |
| `version` | 版本号。 |
| `manifest_json` | 通过 schema 校验的声明式 manifest。 |
| `source_object_key` | 原始上传包对象存储 key。 |
| `validation_result_json` | 导入校验、资源校验和安全扫描结果。 |
| `created_at` | 创建时间。 |

### `user_skill_assets`

| 字段 | 说明 |
| --- | --- |
| `id` | Skill asset ID。 |
| `skill_id` / `skill_version_id` | 所属 Skill 和版本。 |
| `owner_user_id` | 所属用户，用于权限校验和对象路径。 |
| `asset_key` | manifest 中的稳定引用 key，例如 `brand_logo`。 |
| `type` | `logo`、`qrcode`、`cover`、`divider`、`cta_image`、`example_image`。 |
| `original_name` / `content_type` / `size_bytes` | 文件元数据。 |
| `object_key` / `preview_object_key` | 原图和预览图对象存储 key。 |
| `sha256` / `width` / `height` | 完整性和尺寸信息。 |
| `status` | `active`、`blocked`、`deleted`。 |
| `created_at` | 创建时间。 |

### `user_installed_skills`

| 字段 | 说明 |
| --- | --- |
| `user_id` | 安装用户。 |
| `skill_id` / `skill_version_id` | 安装的 Skill 和版本。 |
| `alias` | 用户可编辑别名，用于 `@` 展示。 |
| `status` | `active`、`disabled`、`removed`。 |
| `installed_at` | 安装时间。 |

## 对象存储路径

Skill 上传包和拆分后的资源保存到对象存储：

```text
users/{userId}/skills/{skillId}/versions/{versionId}/package.zip
users/{userId}/skills/{skillId}/versions/{versionId}/assets/{assetId}/original
users/{userId}/skills/{skillId}/versions/{versionId}/assets/{assetId}/preview
```

PostgreSQL 保存可查询元数据和业务事实；MinIO / S3 保存原始包、图片和预览图。

## 导入流程

1. 用户上传 Skill 包，或在第一版粘贴 `manifest.json`。
2. 后端解包并读取 `manifest.json`。
3. 后端按共享契约校验 manifest schema。
4. 后端校验资源文件存在、类型、大小、尺寸和图片解码结果；第一版单独上传资源时，按 manifest 中的 `assetKey` 逐个补齐。
5. 后端进行安全扫描，阻止密钥、token、越权指令、可执行代码和不支持的外部引用。
6. 校验通过后写入 `user_skills`、`user_skill_versions` 和 `user_skill_assets`。
7. 用户确认安装后写入或更新 `user_installed_skills`。
8. 安装完成的 Skill 出现在输入框 `@` 菜单中。

导入失败时不得创建 active Skill；已上传对象通过 outbox 或清理任务删除。

## Skills 管理页面

Skills 是用户级能力，不属于单个 workspace、conversation 或素材输入区。前端入口放在右上角账号下拉菜单中，菜单项命名为“我的 Skills”。创作输入区只保留本次生成使用的 `@ Skill` / 私有 Skill 选择，不放“管理 Skills”按钮。

管理页面第一版采用账号级面板或独立页面，两种承载形态必须保持同一信息架构：

```text
顶部账号菜单
  ├─ 账号安全
  ├─ 我的 Skills
  ├─ 权限范围
  └─ 系统设置

我的 Skills
  ├─ 概览：已安装、可用、当前使用
  ├─ 已安装 Skills：名称、别名、分类、状态、资源完整度、操作
  ├─ 导入 Skill：manifest 输入、资源上传入口、导入按钮
  └─ 未启用：已导入但 disabled / 未安装的 Skill
```

页面行为：

- 账号下拉点击“我的 Skills”后打开管理页面，并关闭账号下拉。
- “已安装 Skills”只展示当前用户已安装且 `active` 的 Skill，支持选择为本次生成默认私有 Skill、停用和刷新。
- “导入 Skill”第一版支持粘贴 `manifest.json`；后续支持 `.mediaforge-skill.zip` 或拖拽上传时，不改变页面主结构。
- 导入成功后停留在管理页面，刷新列表并展示新 Skill，方便用户继续检查资源完整度或选择使用。
- “未启用”展示当前用户已导入但未启用、已停用或待补齐资源的 Skill，不允许直接被生成引用。
- 页面可展示 Skill 资源位状态，至少包括 logo、二维码、封面和示例图；缺失必需资源时应标记为未就绪。
- Skill 管理页是用户级管理，不读取或切换当前 workspace；生成时的 `skillMentions` 仍从当前用户已安装 Skill 中选择。

UI 风格应和当前 MediaForge 工作台保持一致：浅色背景、薄边框、薄荷绿状态、珊瑚橙主按钮、紧凑 SaaS 信息密度。页面不做营销式 hero，不使用大面积装饰图。

## 生成流程

用户输入：

```text
@高端托育园温暖风 写一篇秋季招生公众号，重点讲入园适应
```

前端发送结构化引用：

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

后端必须重新校验：

- Skill 属于当前用户或当前用户已安装。
- Skill version 是 active 且未被禁用。
- Skill category 允许用于公众号生成。
- Skill 资源属于当前用户，不允许跨用户引用。
- Skill manifest 仍通过安全校验。

Run 创建时冻结：

- `graph_runs.context_json.selectedSkills`
- Skill version 的 manifest 摘要
- Skill asset 的 `asset_key`、`type`、`usage` 和对象引用
- prompt snapshot 中的脱敏 Skill 上下文
- `article_versions.skill_pack_id` / `skill_pack_version` 或后续扩展字段

## Skill 资源参与文章

模型不直接接收任意图片文件，也不直接决定外部图片 URL。Creation Graph 只接收受控 Skill asset 摘要：

```json
{
  "skillAssets": [
    {
      "key": "brand_logo",
      "type": "logo",
      "usage": "文章结尾品牌露出"
    },
    {
      "key": "consult_qrcode",
      "type": "qrcode",
      "usage": "CTA 引导扫码咨询"
    }
  ]
}
```

Agent 输出只能引用 `assetKey`：

```json
{
  "type": "image",
  "attrs": {
    "assetKey": "consult_qrcode",
    "role": "cta_qrcode"
  }
}
```

Artifact Builder 或 renderer 负责把 `assetKey` 解析成当前用户有权访问、导出时可用的 HTTPS 图片 URL。二维码默认只允许出现在 CTA 或结尾区域；logo 默认只允许用于品牌露出，不作为正文配图随机插入。

Skill 必须按 Brief、Planner、Writer、Layout 和 Reviewer 的职责分别裁剪输入，不能只在 Brief 中附加几句文案规则。Skill 的视觉规则进入受控 `LayoutPlan`，但 Skill 和模型均不得提供 raw HTML、CSS、脚本或可执行 renderer。完整链路与验收见 `docs/specs/015-multi-agent-content-and-layout-quality.md`。

## 安全边界

- Skill 包不得包含可执行代码。
- Skill 包不得包含密钥、token、cookie、真实用户隐私或模型 API Key。
- Skill 不得要求绕过系统 prompt、安全策略、权限校验、配额或模型路由。
- Skill 不得声明读取其他用户数据、跨 workspace 数据或未授权资源。
- Skill 只能作为风格、结构、品牌资源和内容禁忌的输入。
- 最终公众号正文仍以 Artifact / ArticleVersion 为事实源，必须经过 Artifact Builder Guard。
- prompt 快照不得保存图片原文件或未脱敏原始上传包内容。

## `@` 交互规则

- `@` 菜单只展示当前用户已安装且 active 的 Skill。
- 第一版一个 Run 只允许一个主 Skill。
- 前端显示 alias，后端使用 `skillId` 和 `versionId` 校验。
- 如果用户输入纯文本 `@名称` 但未选择结构化 mention，后端不应信任该文本为 Skill 引用。
- Skill 被禁用或删除后，不能用于新生成，但历史文章版本仍可查看和复制。

## 版本与历史复现

- 每次修改 manifest 或资源都创建新 `user_skill_versions`。
- 旧文章版本继续引用创建时冻结的 Skill version。
- 删除或禁用 Skill 不删除历史 `ArticleVersion` 的 HTML 快照。
- 如果对象资源需要清理，必须先确认没有历史快照复现依赖；历史 HTML 快照已经包含可复制结果时，可按生命周期策略清理源资源。

## 验证重点

- 用户不能安装无效 manifest。
- 用户不能引用其他用户私有 Skill。
- 用户不能通过 Skill 上传可执行代码或密钥。
- `@` 解析结果必须由后端重新校验。
- Skill asset 只能通过 `assetKey` 进入结构化文章，不把任意 URL 直接写入正文。
- 二维码和 logo 只出现在允许区域。
- Run 创建后 Skill 更新不影响已冻结的生成上下文。
- 历史文章版本可继续复制微信 HTML。

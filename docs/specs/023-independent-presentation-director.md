# 023：独立内容呈现策划与 Presentation Director

## 状态

核心链路已实施并通过自动化验证；品牌硬约束冲突澄清、仅风格修改的专用短路由和生产灰度待后续完成。

## 背景

当前公众号创作链路由 Layout Agent 同时判断呈现风格并生成 `LayoutPlan`。用户提示词中明确指定的颜色、装饰、图片展示方式和品牌露出要求可能在 Brief、内容策划、正文和图片规划之间被弱化；用户没有指定颜色时，Layout Agent 又容易选择相同的安全模板，导致不同文章的最终视觉趋同。

本规格将“内容呈现策划”从 Layout Agent 中拆为独立阶段。Presentation Director 根据用户要求、完整内容、图片语义和 Skill 生成可审计的 `PresentationStyleDecision`；Layout Agent 只将该决策转换为受控版式。

## 目标

- 将内容创作风格与内容呈现风格分开建模。
- 将视觉、色彩装饰、图片呈现和品牌呈现作为独立结构化输出。
- 用户明确指定颜色时，以用户颜色为锚点并结合内容补齐完整视觉系统。
- 用户没有指定颜色时，根据主题、目标、受众、正文、图片和 Skill 推断呈现风格。
- 支持只修改风格而不重写正文、章节结构和图片语义归属。
- 让 Reviewer 能区分呈现决策错误与 LayoutPlan 编译错误。
- 保持模型只输出受控决策，最终 HTML 仍由可信 Renderer 生成。

## 非目标

- 不允许模型输出任意 HTML、CSS、JavaScript 或事件属性。
- 不实现拖拽排版、局部可视化编辑或完整设计工具。
- 不同时生成多套预览供用户挑选。
- 不默认阻断 Run 等待用户确认呈现风格。
- 不新增数据库表或外部模型 SDK。
- 不改变 `apps/web → apps/service → PostgreSQL / MinIO / Redis / Model Gateway` 服务边界。

## 需求分级和影响面

本需求为 M 级：新增 AI 节点、共享契约、Graph 状态、回退路径和用户可见步骤，但不改变服务边界、不修改数据库 schema、不新增生产依赖。

影响范围：

- `creation-graph`：新增 Presentation Director、状态、路由和结构校验。
- `layout-skills`：品牌色、Logo、二维码、固定模块和禁忌进入呈现决策。
- `articles` / Renderer：LayoutPlan 继续作为唯一渲染输入。
- `conversations`：风格修改意图和最新 Turn 呈现约束。
- `web`：新增“内容呈现策划”步骤和安全摘要。
- `contracts`：新增目标契约和 Review target。

## 目标链路

```text
当前 Turn 与资源
→ Material Analysis
→ Creative Brief
→ Content Plan / Title / Outline
→ Image Plan
→ Structured Writer
→ Presentation Director
→ Layout Agent
→ Content + Presentation + Layout Review
→ 定向回退或 Revision
→ Artifact Builder
→ Trusted WeChat Renderer
```

Presentation Director 必须在正文和图片计划完成后执行，使其能够看到真实内容密度、章节结构、图片数量和图片语义。Layout Agent 不得跳过该节点自行决定完整风格。

## 输入

Presentation Director 的目标输入包括：

- 最新用户 Turn 原文。
- 服务端提取的 `UserPresentationConstraints`。
- `CreativeBrief`、`ContentPlan` 和 `ArticleDraft`。
- `MaterialAnalysis` 和 `ImagePlan`。
- 冻结版本的 `SelectedSkill` 及按职责裁剪的品牌规则和资源摘要。
- 当前 Run 的 `structureVersion`。
- 风格修订时的上一版 `PresentationStyleDecision`。
- Working Memory 中仍有效的用户呈现约束；不得拼接无关历史原文。

Presentation Director 不读取模型密钥、对象存储内部地址、raw provider response 或历史未选中的 Skill。

## 用户呈现约束提取

服务端在模型调用前从最新 Turn 提取并标准化：

- 颜色名称，例如蓝色、墨绿、米白。
- 明确色值，例如 `#173F37`。
- 模糊颜色意图，例如高级蓝、莫兰迪色、低饱和暖色。
- 明暗、饱和度和对比度要求。
- 禁用要求，例如不要红色、避免红金、不要太花。
- 使用范围，例如标题用蓝色、金色只点缀、背景不要深色。
- 装饰密度、章节标记、图片展示和品牌露出要求。

提取结果必须保留原始片段和标准化约束。服务端提取用于防止要求丢失，不负责用硬编码主题词决定最终风格。

## 决策优先级

```text
安全与可读性硬规则
> 最新 Turn 的明确呈现要求
> 用户主动选择 Skill 的品牌硬约束
> 当前内容和素材推断
> 系统默认
```

具体规则：

1. 用户指定完整颜色方案时，Presentation Director 不得替换主色和禁用色，只能补充可读性所需的正文色、背景色和辅助色。
2. 用户只指定一个颜色时，该颜色是视觉锚点；内容决定色调深浅、辅助色、使用比例和装饰方式。
3. 用户指定“不要某颜色”时，禁止该颜色作为主色、强调色、背景或大面积装饰；极小范围的图片原始颜色不属于 Layout 违规。
4. 用户没有指定颜色时，根据内容目标、受众、正文情绪、信息密度、图片 mood 和品牌规则生成完整色彩意图。
5. 用户要求与主动选择的品牌 Skill 硬约束冲突时进入 `waiting_clarification`，不静默覆盖。
6. 用户颜色导致正文不可读时，保留颜色锚点但调整其使用角色，并返回可解释的安全修正；无法满足时 Run 明确失败。

## PresentationStyleDecision 目标契约

以下字段已作为 `presentation-style-v1` 共享契约实现；生产环境是否启用以部署版本为准。

### 顶层元数据

- `schemaVersion`：呈现决策 schema 版本。
- `structureVersion`：必须与当前 ContentPlan 一致。
- `source`：`user`、`content`、`skill` 或 `mixed`。
- `confidence`：0 到 1 的受控数值。
- `evidence`：面向用户和调试的简短安全依据，不包含思维链。

### visual

- `theme`：编辑杂志、温暖故事、舞台庆典、专业报告、实用指南、品牌宣传或极简纪实等受控主题。
- `hierarchy`：标题、导语、章节、正文和重点信息的层级策略。
- `typography`：字体倾向、字号层级、字重和行高意图，不包含任意 CSS。
- `density`：紧凑、适中或舒展。
- `alignment`：左对齐、居中或受控混合。
- `whitespace`：留白强度和章节间距意图。
- `sectionRhythm`：编号、标签、时间线、极简标题或卡片等章节节奏。

### colorDecoration

- `colorSource`：`user`、`content`、`skill` 或 `mixed`。
- `requestedColors`：用户明确要求的颜色锚点。
- `prohibitedColors`：用户或 Skill 禁止使用的颜色。
- `paletteIntent`：主色、强调色、正文色、背景和表面色的语义意图。
- `brightness`、`saturation`、`contrast`：明暗、饱和度和对比度方向。
- `surfaceTreatment`：无容器、卡片、边框或底色模块。
- `dividerTreatment`：留白、细线、粗线、点线或受控图形。
- `sectionMarker`：编号、标签、圆点、时间线或无标记。
- `ornamentLevel`：极简、适中或丰富。

### imagePresentation

- `heroStrategy`：全宽主图、带边框主图、标题后首图、导语后首图或无首图。
- `sizeStrategy`：全宽、中等、小图或按叙事角色分级。
- `aspectPolicy`：原比例、主体优先裁切或禁止裁切。
- `grouping`：单图、双图、画廊、连续大图或图文交替。
- `frameTreatment`：无边框、细边框、留白画框或受控圆角。
- `captionPolicy`：无说明、简短图注、事实说明或人物说明。
- `rhythm`：每章一图、重点章节多图、均匀分布或开头集中。

Image Planner 仍决定图片语义角色和章节归属；Presentation Director 只能决定展示策略，不能把图片重新分配到其他章节。

### brandPresentation

- `prominence`：隐藏、轻度、标准或强转化。
- `logoPlacement`：无、标题区、结尾或品牌模块。
- `fixedModules`：允许引用的固定品牌模块 key。
- `brandAssets`：允许引用的 Logo、分隔图、二维码和 CTA 资源 key。
- `ctaStyle`：无、轻引导、明确咨询、报名、购买或到店。
- `qrcodePlacement`：无、CTA 或结尾品牌模块。
- `constraints`：品牌呈现硬约束和禁忌。

品牌事实来自冻结 Skill 和品牌配置，Presentation Director 不得虚构品牌色、Logo、二维码或联系方式。

## Layout Agent 目标职责

Layout Agent 输入 `PresentationStyleDecision`、ArticleDraft 和 ImagePlan，输出受控 `LayoutPlan`。

必须满足：

- 原样返回 `structureVersion`。
- 章节和章节图片引用现有 `sectionId`。
- 图片引用来自 ImagePlan。
- 色板覆盖用户颜色锚点并排除禁用色。
- 品牌模块和资源引用来自冻结 Skill。
- 不重新推断主题，不覆盖 Presentation Director 的决策。
- 不输出 raw HTML、CSS、脚本或事件属性。

## Graph 路由与回退

Reviewer 新增 `presentation` 问题目标：

```text
brief          → Brief / Clarification
plan           → Content Planner
title          → Title Agent
body / cta     → Revision
image          → Image Planner
presentation   → Presentation Director
layout         → Layout Agent
```

Presentation Director 重新执行后必须继续执行 Layout 和 Review。Layout 重新执行不允许修改 `PresentationStyleDecision`。

多个问题同时存在时，从最上游受影响节点重跑。达到最大审校次数时继续遵守 ADR-015：如果最后草稿能通过 Artifact Builder 安全校验，可以输出 `qualityStatus=warning`；但 PresentationStyleDecision 或 LayoutPlan 违反安全硬规则时不得生成 Artifact。

## 增量修改

| 修改类型 | 重跑范围 |
| --- | --- |
| 只改颜色、装饰、密度或视觉气质 | Presentation → Layout → Review |
| 正文局部润色且结构、密度未明显变化 | Revision → Review，可保留 Presentation 和 Layout |
| 章节数量、内容类型或信息密度变化 | Writer → Presentation → Layout → Review |
| 图片增加、删除或语义归属变化 | ImagePlan → Writer（必要时）→ Presentation → Layout → Review |
| Skill 或品牌资源变化 | Presentation → Layout → Review |
| 新主题或从头重写 | 按完整新创作链路执行 |

历史 ArticleVersion、Artifact snapshot 和已完成 AgentOutput 不回写。新版本保存自己的呈现决策和 LayoutPlan snapshot。

## AgentOutput、事件和前端

- Presentation 节点写入 `AgentTask(nodeName=presentation, agentName=PresentationDirectorAgent)`。
- 通过 schema 的结果写入新的 `AgentOutput.type=presentation_style_decision`。
- 用户可见步骤名称为“内容呈现策划”。
- `step.completed` 的安全摘要可以包含视觉主题、颜色来源、装饰密度和图片策略，例如“采用克制舞台纪实；用户指定深蓝，内容补充暖金点缀；大图与章节图交替”。
- 事件不得包含原始 prompt、完整 Skill 指令、模型思维链、对象存储地址或未脱敏正文。
- 第一阶段不新增强制确认事件；用户可以通过下一 Turn 单独修改呈现风格。

## 错误语义

目标错误码：

| 错误码 | 说明 |
| --- | --- |
| `PRESENTATION_CONSTRAINT_CONFLICT` | 用户要求与主动选择的品牌硬约束冲突，需要澄清。 |
| `PRESENTATION_STYLE_INVALID` | PresentationStyleDecision 不符合 schema 或包含非法值。 |
| `PRESENTATION_COLOR_UNSAFE` | 无法在保留用户颜色锚点的同时满足可读性和安全规则。 |
| `PRESENTATION_STRUCTURE_STALE` | 呈现决策的 structureVersion 已过期。 |
| `LAYOUT_PRESENTATION_MISMATCH` | LayoutPlan 未落实已确认的呈现决策。 |

上述错误码需在实现时同步 contracts、API 和自动化测试。第一阶段可以统一通过现有 `RUN_OUTPUT_INVALID` 或 `ARTIFACT_VALIDATION_FAILED` 承载，但错误摘要必须保留具体 violation code。

## 可观测性

至少记录：

- prompt/schema version。
- 模型配置 ID、耗时、token 用量和重试次数。
- `source`、`colorSource`、theme、confidence 和安全 evidence。
- Presentation 回退次数和 Reviewer 问题类型。
- 同主题重复生成的主题稳定度和整体风格分布。

不得记录完整 prompt、模型思维链、完整 Skill 内容、密钥、真实用户隐私或未脱敏正文。

## 验收标准

- 用户指定蓝色时，最终决策保留蓝色锚点，内容只补齐辅助色、背景和装饰。
- 用户指定明确色值时，LayoutPlan 不静默替换该色值的语义角色。
- 用户声明“不要红金”时，生成色板和装饰不以红色或金色作为布局颜色。
- 用户未指定颜色时，系统根据内容、受众、图片 mood 和 Skill 生成有依据的呈现决策。
- 舞台获奖、成长故事、专业报告、实用指南和品牌宣传不会全部落到同一视觉主题。
- 图片展示策略不改变 ImagePlan 的章节归属和语义角色。
- 品牌 Logo、二维码和固定模块只来自冻结 Skill。
- 只修改视觉风格时，标题、正文、章节集合和图片语义保持不变。
- Reviewer 能分别回退 Presentation 和 Layout。
- 最终 HTML 只由 Trusted Renderer 生成。
- 不新增生产依赖，不新增数据库表。

## 风险和控制

| 风险 | 影响 | 控制措施 |
| --- | --- | --- |
| 新增模型调用增加延迟和成本 | 中 | 裁剪输入、低温度、独立预算和 prompt version 统计 |
| 风格在相同内容间不稳定 | 中 | 保持颜色锚点和主题家族稳定，测试约束而非固定色值 |
| 用户颜色与品牌 Skill 冲突 | 高 | 进入必要澄清，不静默覆盖 |
| 模型输出不可读配色 | 高 | 服务端对比度和角色校验，无法修正时明确失败 |
| Presentation 越权修改内容或图片语义 | 高 | 契约不提供对应写字段，Structure Guard 和引用校验拦截 |
| Layout Agent 再次自行决定风格 | 中 | 输入和输出契约要求映射 Presentation，Reviewer 检查一致性 |
| 旧 Artifact 缺少呈现决策 | 低 | 历史只读兼容，不回写；新生成使用版本化字段 |

## 实施阶段

1. 已完成：同步 contracts、模块、API 和测试文档。
2. 已完成：实现用户呈现约束提取、服务端颜色锚点闸门和契约校验。
3. 已完成：新增 Presentation Director、Graph 节点、工作记忆和 AgentOutput。
4. 已完成：将 Layout Agent 收敛为受控决策编译器。
5. 已完成：增加 Reviewer 的 `presentation` / `layout` 分流和结构版本校验。
6. 已完成：增加独立前端过程步骤、安全摘要和完整自动化回归。
7. 待后续：品牌 Skill 硬约束冲突澄清、仅风格修改的专用短路由、更细粒度颜色可读性校验和生产灰度。

## 文档路由

- ADR：`docs/adr/016-independent-presentation-director.md`
- 模块：`docs/modules/creation-graph/README.md`
- API：`docs/api/creation-graph.md`
- 测试方案：`docs/testing/plans/creation-graph.md`
- 测试用例：`docs/testing/cases/creation-graph.md`

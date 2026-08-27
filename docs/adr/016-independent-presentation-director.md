# ADR-016：将内容呈现决策拆为独立 Presentation Director

## 状态

Accepted

## 日期

2026-08-27

## 背景

现有 Creation Graph 在 Writer 和 Image Planner 完成后直接调用 Layout Agent。Layout Agent 同时承担两类职责：判断文章应该采用什么呈现风格，以及把风格映射为受控 `LayoutPlan`。虽然模型可以读取 Brief、正文、图片计划和 Skill，但缺少独立、可审计的呈现决策，用户在提示词中给出的颜色、装饰和图片展示要求也可能在多节点传递中被弱化。

这种职责合并会产生以下问题：

- Layout Agent 容易反复选择相同的安全模板，风格多样性不足。
- 无法区分“风格判断不合适”和“LayoutPlan 结构无效”。
- 用户只修改颜色或视觉气质时，系统缺少独立重跑范围。
- Reviewer 只能把呈现问题笼统回退到 Layout，不能回到真正的决策节点。
- Skill 提供的品牌约束、用户明确要求和内容推断之间没有统一优先级。

## 决策

在 Writer 和 Image Planner 完成后、Layout Agent 之前新增独立的 `PresentationDirectorAgent` 和 `presentation_node`。

目标链路为：

```text
Material → Brief → ContentPlan → Title / Outline
→ ImagePlan → Writer
→ Presentation Director
→ Layout
→ Review → Artifact
```

Presentation Director 负责决定“内容应该以什么方式呈现”，输出版本化、结构化的 `PresentationStyleDecision`。Layout Agent 负责把该决策编译为受控 `LayoutPlan`，不得重新决定整体风格。Trusted Renderer 继续只消费白名单布局令牌并生成微信兼容 HTML。

`PresentationStyleDecision` 分为四个领域：

- `visual`：视觉主题、信息层级、字体倾向、密度、对齐、留白和章节节奏。
- `colorDecoration`：颜色来源、用户指定色、禁用色、色彩倾向、背景、容器、分隔、章节标记和装饰密度。
- `imagePresentation`：首图策略、图片尺寸、比例、裁切、组合、边框、图注和图片节奏。
- `brandPresentation`：品牌露出强度、Logo、固定模块、品牌资源、CTA、二维码和品牌禁忌。

模型只输出受控呈现决策，不输出 HTML、CSS、JavaScript、事件属性或可执行 Skill 内容。

## 颜色与约束优先级

服务端在调用 Presentation Director 前，从最新用户 Turn 中提取 `UserPresentationConstraints`。提取结果保留原始要求和标准化约束，包括颜色名称、明确色值、明暗、饱和度、禁用颜色、使用范围、装饰要求、图片呈现要求和品牌露出要求。

决策优先级固定为：

1. Renderer 安全、可读性和微信兼容规则。
2. 用户当前 Turn 中明确提出的呈现要求。
3. 用户主动选择的 Skill 所提供的品牌硬约束。
4. 当前内容主题、目标、受众、正文情绪、信息密度和图片语义。
5. 信息不足时的系统安全默认值。

用户只指定部分颜色时，该颜色成为不可静默替换的锚点，内容负责补齐深浅、辅助色、使用比例、背景和装饰。用户没有指定颜色时，由 Presentation Director 根据内容和素材生成完整色彩意图。

用户要求与主动选择的品牌 Skill 硬约束冲突时，Graph 进入必要澄清，不静默覆盖任一方。可读性或 Renderer 安全规则与用户要求冲突时，Run 明确返回可理解的呈现约束错误，不生成不可读 Artifact。

## 责任边界

### Presentation Director

- 综合用户约束、Brief、ContentPlan、ArticleDraft、MaterialAnalysis、ImagePlan 和冻结 Skill。
- 输出 `PresentationStyleDecision`、安全摘要、来源和置信度。
- 不修改文章标题、正文、章节结构、图片语义归属或品牌事实。

### Layout Agent

- 将 `PresentationStyleDecision` 映射为受控 `LayoutPlan`。
- 保留 `structureVersion`、`sectionId` 和 ImagePlan 的图片语义引用。
- 不重新推断或覆盖颜色锚点、品牌硬约束和整体视觉主题。

### Reviewer

- `target=presentation` 表示风格判断、颜色覆盖、品牌适配或图片呈现策略有问题。
- `target=layout` 表示 LayoutPlan 模块、结构引用或白名单令牌有问题。
- 内容、结构和图片语义问题继续回退原责任节点。

### Trusted Renderer

- 只将受控 `LayoutPlan` 映射为微信兼容 HTML。
- 不读取用户 prompt，不调用模型，不执行模型输出的任意样式或代码。

## 增量修改规则

- 只修改颜色、装饰或视觉气质时，重跑 Presentation、Layout 和 Review。
- 正文局部润色且信息密度和章节结构未变化时，可以保留原呈现决策。
- 章节数量、内容类型或信息密度显著变化时，必须重跑 Presentation。
- 图片集合或图片语义归属变化时，从 ImagePlan 重跑到 Presentation 和 Layout。
- 新主题、Skill 或品牌资源变化时，重新生成所有受影响的下游输出。
- 历史 Artifact 和 ArticleVersion 只读，不回写新呈现决策。

## 备选方案

### 继续增强 Layout Agent

不采用。改动较小且不增加模型调用，但仍混合风格判断与布局编译，无法建立清晰回退边界，也不能可靠证明用户颜色要求已被保留。

### 在 Brief 中加入 VisualIntent

不采用为最终架构。它不增加调用次数，但 Brief 阶段尚未拥有完整正文、图片计划和内容密度，且会扩大 Brief Agent 职责。

### 同时生成多套视觉候选

暂不采用。它能提高多样性，但显著增加调用、验证和 UI 复杂度。第一阶段先生成一套可解释、可修改的呈现决策。

### 生成前强制用户确认

暂不采用为默认行为。默认确认会阻断自动创作流程。第一阶段展示安全摘要并允许后续单独修改风格，未来可增加可选确认模式。

## 影响

- 每个完整新创作增加一次结构化模型调用，增加延迟和模型成本。
- Creation Graph 增加节点、状态、AgentOutput 类型和定向回退路径。
- Reviewer 需要区分 `presentation` 与 `layout` 问题。
- 前端任务步骤增加“内容呈现策划”，但第一阶段不增加强制确认状态。
- `PresentationStyleDecision` 可以进入现有 JSON AgentOutput 和 Artifact snapshot，不新增数据库表。
- 失败时不得在同一 Run 内静默回退旧固定模板；版本回滚以整体 Graph/prompt version 为单位。

## 一致性要求

实施时必须同步：

- `packages/contracts` 中的 Presentation 契约、Review target 和 AgentOutput 类型；
- `docs/specs/023-independent-presentation-director.md`；
- Creation Graph 模块和 API 文档；
- Creation Graph 测试计划和测试用例；
- Worker 事件、前端步骤映射、Graph 路由与 Artifact snapshot；
- prompt/schema version、调用耗时、成本和安全摘要观测。

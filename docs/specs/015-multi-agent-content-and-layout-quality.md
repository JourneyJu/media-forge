# 规格：多 Agent 内容与排版质量重构

## 状态

已确认，待实施。

## 背景

当前公众号创作链路虽然展示 Brief、标题、提纲、正文、配图、审校和渲染等多 Agent 步骤，但生产环境可能因 `MODEL_MODE=demo` 使用硬编码示例。后续 Turn 还会把多条历史用户消息拼接为本轮 `userInput`，并把会话内全部资源带入新 Run，造成旧主题、旧素材和旧版式污染新创作。

现有 `ArticleDraft` 只有扁平 `paragraphs`，Artifact Builder 按段落序号插入旧提纲标题，Renderer 使用固定样式。该结构无法表达章节、素材和版式之间的关系，也无法证明排版 Agent 做过主题相关决策。

## 目标

- 生产环境只运行真实 Model Gateway Agent，不允许静默生成 Demo 文章。
- 最新用户 Turn 是本轮唯一原始指令，历史只通过受控 Working Memory 进入 Run。
- 明确区分重新创作、局部修改和继续扩写，防止旧主题污染新文章。
- 让素材理解、内容策划、正文写作和排版设计分别产生可审计的结构化输出。
- 让用户私有 Skill 同时约束 Brief、策划、写作、排版和审校，而不只是追加几句 prompt。
- 模型只输出受控内容和 `LayoutPlan`；HTML 只能由可信 Renderer 生成。
- 主题、要求覆盖、内容深度、素材匹配和版式适配不合格时，不创建 Artifact。

## 非目标

- 不改变 `apps/web → apps/service → PostgreSQL / MinIO / Redis / Model Gateway` 服务边界。
- 不引入新的模型供应商 SDK、排版框架或外部 Agent 服务。
- 不让模型直接输出或执行任意 HTML、CSS、JavaScript 或 Skill 代码。
- 不建立跨 Conversation 的长期用户画像。
- 本次不修改数据库表结构；结构化输出继续进入现有 JSON、AgentOutput 和 Artifact 数据面。

## 需求分级与影响面

本需求为 M 级：修改 AI 调用链路、共享契约、Turn 行为和用户可见生成结果，但不改变服务边界、不新增生产依赖、不做数据库迁移。

影响模块：

- `conversations`：Turn 意图、资源范围和冻结 RunContext。
- `creation-graph`：Agent 节点、结构化输出、回退路由和质量门禁。
- `layout-skills`：Skill 在各 Agent 阶段的约束及品牌资源使用。
- `articles` / Renderer：结构化正文、LayoutPlan 和安全 HTML。
- `web`：创作模式选择、真实步骤状态和错误呈现。

## 目标链路

```text
当前 Turn
→ Intent / Resource Scope
→ Material Understanding
→ Brief
→ Content Plan / Title / Outline
→ Structured Writer
→ Image Plan
→ Layout Plan
→ Content + Layout Review
→ 定向回退或 Revision
→ Artifact Builder
→ Trusted WeChat Renderer
```

UI 中的步骤只能由真实节点事件驱动。不得在 Run 完成后补播步骤，也不得把 Demo 结果展示为真实模型协作。

## 生产模式门禁

- `NODE_ENV=production` 时，`MODEL_MODE=demo` 必须导致服务启动失败或 Run 明确失败。
- 生产 Compose 不得使用 `${MODEL_MODE:-demo}`；生产配置必须显式给出非 Demo 模式。
- Worker 启动和 Run 执行前检查 `text_generation` 路由是否指向 active connection 和 active model config。
- 模型不可用时返回 `GENERATION_MODEL_UNAVAILABLE`，不得回退硬编码文章。
- Demo Agent 只能由测试显式注入，Demo Artifact 必须标记 `model.mode=local-demo`。

## Turn 意图与上下文

### 创作模式

```ts
type CreationMode = "auto" | "new" | "revise" | "continue";
```

- `new`：新主题或从头重写，清空旧 brief、标题、outline、draft summary、layout plan 和 `lastArtifactId`。
- `revise`：针对已有 Artifact 修改指定标题、章节、正文、图片或风格。
- `continue`：保留当前主题和结构继续扩写。
- `auto`：服务端根据最新 Turn、当前 Artifact 和资源变化推断；用户显式选择优先。

服务端推断只读取最新 Turn。出现“新主题、重新写一篇、换个内容、从头生成”等表达时判定为 `new`；出现明确局部修改目标且存在 Artifact 时判定为 `revise`。较长的新需求、核心实体明显变化或上传全新素材组时，优先判定为 `new`。

### RunContext

目标 `CreationRunContext` 至少区分：

```ts
interface CreationRunContext {
  currentInstruction: string;
  creationMode: Exclude<CreationMode, "auto">;
  currentResourceIds: string[];
  inheritedResourceIds: string[];
  selectedSkills: ResolvedUserSkill[];
  memory: ConversationWorkingMemory;
}
```

规则：

- 不再把最近多条用户消息拼接成 `currentInstruction`。
- `new` 默认只使用本轮资源；旧资源只有被用户明确选择时进入 `inheritedResourceIds`。
- `revise` 可以读取 `lastArtifactId` 及该 Artifact 已使用的资源，再叠加本轮新增资源。
- RunContext 创建后冻结，后续消息不能改变已入队 Run。
- 旧 Artifact 保持不可变；重新创作创建新 Artifact，不覆盖历史版本。

## Agent 职责和结构化输出

| 节点 | 输入 | 输出 | 失败回退 |
| --- | --- | --- | --- |
| Intent | 当前指令、当前资源、会话摘要 | 创作模式、主题候选、资源范围 | 必要时追问 |
| Material | 当前和继承资源 | OCR、场景、主体、品牌元素、质量、建议用途 | 标记不可用素材 |
| Brief | 当前指令、素材摘要、Skill | 主题、目标、受众、事实、限制、要求覆盖清单 | Intent |
| Planner | Brief、素材摘要 | 内容角度、叙事主线、章节目标、素材映射 | Brief |
| Title | Brief、ContentPlan | 3 至 5 个候选与选中项 | Planner |
| Writer | Brief、ContentPlan、Outline | 结构化章节正文 | Planner |
| ImagePlan | 结构化正文、素材摘要 | 封面、章节图、组图、品牌资源映射 | Material / Writer |
| Layout | 正文、图片计划、Skill | 受控 `LayoutPlan` | Planner |
| Reviewer | 当前指令及全部结构化输出 | 分数、问题、回退节点 | 对应问题节点 |

AgentOutput 必须记录 schema version、prompt version、model config ID、耗时和状态；不保存或返回思维链。

Title Agent 是标题候选集合和选中标题的唯一来源。Writer、Reviewer 和 Revision 可以消费选中标题，但不得在非标题问题修订中改写最终标题。Reviewer 如果发现标题本身存在问题，必须把问题路由回 Title Agent 重新生成候选并更新 `selectedId`，而不是交给 Revision Agent 直接改写 `ArticleDraft.title`。

## 结构化正文

正文从扁平 `paragraphs[]` 升级为按章节组织：

```ts
interface ArticleDraft {
  title: string;
  subtitle?: string;
  intro: string;
  sections: Array<{
    heading: string;
    purpose: string;
    paragraphs: string[];
    assetRefs: string[];
    emphasis?: string;
  }>;
  conclusion: string;
  callToAction?: string;
}
```

Artifact Builder 必须按 section 组装 ArticleDocument，不得再按段落下标猜测标题和图片位置。

## LayoutPlan 与安全 Renderer

`LayoutPlan` 只允许白名单设计令牌和模块：

```ts
interface LayoutPlan {
  theme: "editorial" | "celebration" | "story" | "report" | "brand";
  palette: {
    primary: string;
    accent: string;
    text: string;
    surface: string;
  };
  titleTreatment: "centered" | "left-editorial" | "poster";
  introTreatment: "plain" | "quote" | "highlight-panel";
  sectionTreatment: "numbered" | "labelled" | "minimal" | "timeline";
  imageTreatment: "full-width" | "framed" | "gallery";
  blocks: LayoutBlock[];
}
```

- Layout Agent 不得返回 raw HTML、CSS、脚本或事件属性。
- Renderer 是 HTML 唯一生产者，将 LayoutPlan 映射为微信兼容的内联样式。
- `new` 和风格修改必须重新生成 LayoutPlan；普通正文局部修改可保留现有 LayoutPlan。
- Renderer 必须验证颜色、标签、图片 URL、二维码位置和模块白名单。
- Renderer version 和 LayoutPlan snapshot 随 ArticleVersion 保存。

## Skill 与品牌资源

选中的私有 Skill 必须冻结版本，并按阶段裁剪：

- Brief：品牌定位、受众、语气、禁用表达。
- Planner：固定栏目、叙事顺序、CTA 和内容模块。
- Writer：标题风格、段落长度、用词、示例和禁忌。
- Layout：品牌色、允许模块、Logo、二维码、GIF、分隔图和 CTA 图。
- Reviewer：品牌一致性、资源位置和禁用规则。

模型只引用 `assetKey` / `resourceId`。服务端解析对象地址并校验 owner、version、asset type 和用途。二维码默认只能进入 CTA；Logo 只能进入品牌模块；GIF 保留原格式并生成静态预览，不能被当作普通正文图随机插入。

## 质量门禁与回退

Reviewer 至少检查：

- 当前主题与标题、正文、图片的一致性。
- 用户要求覆盖率和每项要求的证据位置。
- 旧主题词、旧品牌、旧资源和旧版式残留。
- 事实、场景、细节、叙事和商业目标是否有足够深度。
- 每个章节是否完成自己的 `purpose`。
- 图片与章节、Skill 资源与指定位置是否匹配。
- LayoutPlan 是否与当前主题、内容密度和 Skill 一致。

主题理解错误回退 Brief；内容结构问题回退 Planner；正文问题回退 Writer；素材问题回退 Material / ImagePlan；版式问题回退 Layout。最多两轮修订，仍不合格则 Run failed 且不创建 Artifact。

发布前 Artifact Builder 必须再次校验最终标题来源：`ArticleDraft.title` 必须严格等于 `TitleCandidates.selectedId` 指向的候选标题。若 Review 后的 Revision 造成标题漂移，应在进入 Artifact 前恢复选中标题；若标题问题需要改变标题，应先回退 Title Agent。违反该规则时返回 `ARTIFACT_VALIDATION_FAILED:TITLE_SOURCE_INVALID`，不得生成可发布预览。

## 可观测性

- 每个真实节点写 `AgentTask`、`AgentOutput`、`step.started` 和 `step.completed`。
- 记录 model mode、model config ID、prompt version、schema version、耗时、重试和错误码。
- 不记录 API Key、完整未脱敏 prompt、raw provider body 或思维链。
- 后台可以按 Run 查看各节点脱敏输入摘要、结构化输出和 Review 回退原因。

## 实施阶段

1. 生产门禁：禁止 Demo、校验模型路由、修复环境默认值。
2. 上下文隔离：最新 Turn、CreationMode、资源范围和新创作清空策略。
3. 内容结构：Material、ContentPlan、结构化 ArticleDraft 和定向回退。
4. 排版结构：LayoutPlan、可信 Renderer 和 Artifact Builder。
5. Skill 贯穿：按阶段裁剪规则、品牌资源解析和位置校验。
6. 质量与观测：Reviewer 门禁、回归集、指标和后台调试信息。

各阶段均不得重新引入自动 Demo 回退。阶段 2 至 5 必须同步 contracts、API、模块和测试文档。

## 验收标准

- 先生成儿童摄影文章，再在同一 Conversation 以新素材生成舞蹈获奖文章；后者不得出现摄影、镜头、家庭成长等旧语义。
- 新文章只使用本轮或显式继承的资源，不得自动使用旧摄影图片。
- 新 Run 产生新的 Brief、ContentPlan、ArticleDraft、ImagePlan、LayoutPlan 和 ReviewReport。
- 舞蹈获奖主题生成庆典、舞台纪实或其他主题适配版式，不得沿用少儿成长编号模板，除非用户明确选择该 Skill。
- 用户局部修改指定章节时，其他章节和版式保持稳定。
- 生产模型缺失时明确失败，不返回硬编码文章。
- Reviewer 未通过时不存在 `artifact.created`。
- Review / Revision 后最终标题仍来自 Title Agent `selectedId`；标题问题会回退 Title Agent，非标题问题不会改写标题。
- 最终 HTML 只由 Renderer 生成，不包含模型输出的任意脚本和样式。

## 文档路由

- ADR：`docs/adr/010-structured-content-and-layout-plan.md`
- 模块：`docs/modules/creation-graph/README.md`、`docs/modules/conversations/README.md`、`docs/modules/layout-skills/README.md`
- API：`docs/api/creation-graph.md`
- 测试：`docs/testing/plans/creation-graph.md`、`docs/testing/cases/creation-graph.md`

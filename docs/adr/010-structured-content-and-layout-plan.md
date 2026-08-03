# ADR 010：结构化内容与 LayoutPlan 驱动公众号渲染

## 状态

Accepted，待实施。

## 日期

2026-08-03

## 背景

现有多 Agent 链路用扁平段落表达正文，并由 Artifact Builder 按下标插入标题。固定 Renderer 无法表达主题相关的版式决策，导致新主题仍可能沿用旧文章结构和视觉模板。让模型直接输出 HTML 虽然灵活，但会引入微信兼容性、样式漂移、脚本注入、不可测试和不可稳定复现等风险。

## 决策

采用“结构化 ArticleDraft + 受控 LayoutPlan + 可信 Renderer”三层模型：

1. Writer 输出按章节组织的 ArticleDraft，显式关联章节目标和素材引用。
2. Layout Agent 输出只包含白名单枚举、设计令牌和模块顺序的 LayoutPlan。
3. Artifact Builder 校验主题、结构、素材和 LayoutPlan 后组装 ArticleDocument。
4. 只有服务端 Renderer 可以生成微信 HTML，模型和用户 Skill 均不得提交可执行代码或任意 HTML/CSS。
5. 新创作必须生成新的 LayoutPlan；局部正文修改可以复用已有 LayoutPlan，除非修改目标包含风格或排版。

Conversation 的最新 Turn 是本轮唯一原始指令。历史内容通过 Working Memory 和显式继承资源进入 Run，不拼接为当前提示词。

生产环境禁止 Demo 自动回退。Model Gateway 不可用时必须明确失败。

## 选择理由

- 结构化章节让策划、写作、配图和排版拥有稳定交接契约。
- LayoutPlan 保留模型设计能力，同时限制安全和兼容性风险。
- Renderer 输出可测试、可版本化、可重复生成，并能满足微信内联样式限制。
- 新创作和局部修改的边界明确，可以避免旧主题与旧版式污染。
- Skill 可以贡献规则和品牌资源，但不能绕过平台安全边界。

## 备选方案

### 模型直接生成完整 HTML

优点是视觉自由度高；缺点是 HTML 不稳定、难以审计、容易出现不兼容 CSS 和注入风险，因此不采用。

### 继续使用固定模板和扁平段落

实现成本低，但无法证明 Layout Agent 做过主题相关决策，也无法稳定映射章节与素材，因此不采用。

### 每个 Skill 实现独立 Renderer 代码

可以高度定制，但用户上传 Skill 将变成代码执行入口，版本和安全治理成本不可接受。用户 Skill 只允许声明式配置；平台内置 Renderer 可按版本扩展。

## 影响

- `packages/contracts` 需要新增 CreationMode、结构化 ArticleDraft、ContentPlan 和 LayoutPlan schema。
- Creation Graph 增加 Material、Planner、Layout 及按问题类型回退的路由。
- Artifact Builder 和 Renderer 改为消费结构化章节与 LayoutPlan。
- Conversation RunContext 区分当前指令、当前资源和显式继承资源。
- 私有 Skill 按 Agent 阶段裁剪，并通过 `assetKey` 引用资源。
- 不新增服务、不新增生产依赖、不修改数据库 schema。

## 风险与应对

- 契约升级影响面较大：使用 schema version，并先补 contract 和 Artifact Builder 测试。
- 模型可能输出非法 LayoutPlan：Zod 校验失败后只重试对应节点，禁止降级为任意 HTML。
- 版式枚举限制创造力：通过版本化增加受控模块，而不是开放 raw CSS。
- 新旧 Artifact 兼容：历史版本继续使用其 renderer version；新版本使用新的结构化 renderer。

## 关联

- `docs/specs/015-multi-agent-content-and-layout-quality.md`
- `docs/adr/004-langgraph-bullmq-multi-agent-architecture.md`
- `docs/adr/001-wechat-copy-html-and-model-gateway.md`

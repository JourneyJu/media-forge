# ADR 013：跨 Agent 章节使用稳定身份而非标题匹配

## 状态

Accepted，已实施。

## 日期

2026-08-12

## 背景

公众号多 Agent 链路在 ContentPlan、Outline、Draft、ImagePlan、LayoutPlan 和 Artifact 之间传递章节结构。现有实现使用章节标题完全相等判断计划与正文是否一致，并使用 `sectionIndex` 关联图片和版式。标题属于可编辑展示文案，索引会随合法结构调整变化，两者都不是可靠身份。

生产中 Writer 仅去掉章节标题的“开场：”前缀，就被 Artifact Builder 判定为 `CONTENT_PLAN_DRIFT`。这说明字符串比较会误伤自然写作，同时不能充分表达真正的结构一致性。

## 决策

1. 由服务端在 ContentPlan 通过 schema 校验后为章节生成稳定 `sectionId`。
2. 使用 `structureVersion` 标识一套相互兼容的结构化输出。
3. 所有下游 Agent 只能引用输入中的章节身份；标题可以修改，身份不可修改。
4. `sectionIndex` 只作为顺序和渲染的派生字段，在兼容期保留，不承担主关联职责。
5. 各结构节点后执行确定性 Structure Guard；模型只在明确错误和允许 ID 列表下做一次格式纠错。
6. 合法增删、拆合或换序章节必须返回 Content Planner，生成新结构版本并使旧下游输出失效。
7. 历史无 ID 输出通过只读适配器映射；无法一一映射时重跑，不使用模型或标题相似度猜测。

## 选择理由

- 身份与展示文案分离后，标题自然润色不再导致结构误判。
- 稳定 ID 可以同时约束正文、图片、版式和最终文档，覆盖范围比标题比较更完整。
- `structureVersion` 能阻止新计划与旧 Draft、ImagePlan 或 LayoutPlan 混用。
- 确定性门禁可解释、可测试、成本低，不依赖模型判断稳定性。
- JSON payload 可以承载新增字段，不需要修改数据库表结构。

## 备选方案

### 标题归一化或模糊匹配

仅适合作为历史兼容和短期止血。它无法可靠区分同义润色、重复标题、章节合并和真实主题漂移，也不能约束图片与版式引用。

### 继续只使用 `sectionIndex`

实现简单，但合法换序后索引含义改变，旧图片和版式可能静默指向错误章节。索引应是派生顺序，不是领域身份。

### 由大模型判断是否同一章节

拒绝。章节身份是系统一致性问题，不应依赖概率判断；模型结果不可稳定复现，也可能把真实结构变化错误合并。

### Artifact Builder 自动修复全部结构差异

拒绝。末端静默修复会掩盖责任节点错误，并可能在错误章节中插图或套用版式。Artifact Builder 只保留最终发布门禁。

## 影响

- 共享契约与 Agent 输出 schema 需要升级版本。
- Agent prompt 和 Demo Agent 都必须贯穿 `sectionId` 与 `structureVersion`。
- Graph 增加阶段 Structure Guard 和按 Review target 的定向回退。
- 新错误码替代含义过宽的 `CONTENT_PLAN_DRIFT`。
- 历史读取增加兼容适配，但不回写历史快照和已发布版本。

## 风险与应对

- 模型漏传 ID：schema 失败后携带允许列表做一次结构纠错。
- 历史输出无法映射：从最早受影响节点重跑，不猜测。
- 结构重规划遗漏下游失效：用 `structureVersion` 强制检查。
- 双字段过渡产生分歧：`sectionId` 为事实，`sectionIndex` 每次由当前顺序派生。
- 日志泄露正文：只记录 ID 集合、版本、节点和错误码。

## 关联

- `docs/specs/020-stable-section-identity-and-structure-guard.md`
- `docs/specs/015-multi-agent-content-and-layout-quality.md`
- `docs/specs/018-image-semantic-planning.md`
- `docs/adr/010-structured-content-and-layout-plan.md`
- `docs/modules/creation-graph/README.md`

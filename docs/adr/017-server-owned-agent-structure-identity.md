# ADR 017：模型创作输出与服务端结构身份解耦

## 状态

Accepted，已实施。

## 日期

2026-08-27

## 背景

ADR 013 确立了 `sectionId` 和 `structureVersion` 是跨 Agent 结构一致性的事实身份，并由服务端在 ContentPlan 通过校验后生成。当前实现虽然由服务端创建身份，却要求 Outline、Writer、Revision、Image Planner、Presentation Director 和 Layout Agent 原样回传这些不可读字符串。

生产中 Outline Agent 曾将一个 `sectionId` 的字符顺序抄错。该值非空且满足字符串 schema，归一化逻辑因此没有补齐；Structure Guard 随后正确识别为 `SECTION_SET_MISMATCH` 并停止生成。保护器避免了正文和图片错位，但这类失败不应由用户承担，因为系统身份本来就不属于模型创作职责。

同时，单纯把模型返回的错误 ID 按位置覆盖也不安全：如果模型真实增删了章节，静默绑定会掩盖结构变化。因此需要在“模型创作内容”和“领域结构身份”之间增加明确的 Canonicalization 边界。

## 决策

1. `sectionId` 和 `structureVersion` 是服务端专属字段，所有新 Run 的模型调用输入和 Raw Schema 均剥离这些字段，不要求模型生成、复制或修复；供应商额外返回的同名字段同样必须被剥离，不能覆盖权威值。
2. Outline、Draft 和 Revision 作为与 ContentPlan 一一对应的有序输出，只返回章节创作字段。服务端必须先校验章节数量，再按当前 ContentPlan 顺序绑定权威 `sectionId`。
3. ImagePlan 和 LayoutPlan 需要主动选择章节时，只能使用本次模型调用内的 `sectionIndex`。服务端校验索引范围后转换成 `sectionId`；Canonical 对象形成后，跨 Agent 关联仍只认 `sectionId`。
4. Presentation 等不直接引用章节的模型输出不返回 `structureVersion`，由服务端在 Canonicalization 阶段注入当前版本。
5. Canonicalizer 负责 Raw Schema 校验、章节基数校验、局部索引校验、权威身份注入和正式领域 Schema 解析。章节数量不一致、索引越界或引用缺失时不得猜测、截断或补造章节。
6. Structure Guard 保留并作用于 Canonical 对象。Canonicalization 后仍发生身份或版本错误时，优先视为服务端缺陷、旧状态混用或版本污染。
7. Raw 输出格式、章节数量或局部索引错误允许当前节点进行一次结构化纠错；纠错不消耗内容 Revision 次数，不触发整条 Graph 重跑，并受 Run deadline 和调用预算限制。
8. Artifact Builder 不承担普通模型输出修复，只保留最终发布门禁。

本决策补充 ADR 013。ADR 013 关于稳定身份、结构版本和确定性门禁的原则继续有效；其中“所有下游 Agent 透传身份”的实现方式被本 ADR 替代为“模型使用局部结构位置，服务端绑定稳定身份”。

## 选择理由

- 消除模型复制 UUID、哈希和版本字符串时的概率性错误。
- 保持系统身份只有一个权威来源，避免模型返回值覆盖 ContentPlan。
- 通过先校验章节基数再绑定，避免把真实增删章静默伪装成合法输出。
- 图片和版式仍能表达章节选择，同时把 `sectionIndex` 限制在单次调用的局部边界内。
- Structure Guard 继续作为确定性安全门禁，不因提高成功率而降低一致性要求。
- 不修改数据库 schema、HTTP API 或已发布 ArticleVersion，回滚只涉及应用代码。

## 备选方案

### 继续要求模型原样复制系统身份

拒绝。Prompt 约束不能保证模型逐字符复制不可读字符串，重试只能降低概率，不能消除职责错位。

### 收到错误 ID 后按位置无条件覆盖

拒绝。该做法可能掩盖模型真实增删章节。只有在 Raw 输出章节数量满足当前 ContentPlan 时，才能进入服务端绑定阶段。

### 使用更短的章节别名

不作为领域身份方案。`S1`、`S2` 等短别名仍是模型需要复制的标记，且跨结构版本容易产生歧义；它们与 `sectionIndex` 一样只能作为单次调用的局部定位信息。

### 删除或放宽 Structure Guard

拒绝。保护器已经阻止了错误身份进入图片规划、正文、版式和 Artifact；移除它会把显式失败变成静默错位。

### 通过标题或语义相似度恢复章节身份

拒绝。标题可以自然润色，语义判断具有概率性，均不适合作为系统身份恢复机制。

## 影响

- Service 增加模型 Raw Schema、Canonicalizer 和节点级纠错包装。
- Agent 接口在模型边界返回 Raw 类型，Graph State、持久化 AgentOutput 和 Artifact 继续使用 Canonical 类型。
- Outline、Writer、Revision、Image Planner、Presentation Director 和 Layout Agent 的 Prompt 与输出合同需要调整。
- Structure Guard 错误语义更清晰：Raw 输出问题属于可纠正的 Agent 合同错误，Canonical Guard 失败属于系统一致性错误。
- 历史 AgentOutput 和已发布版本不回写；历史兼容仍按 ADR 013 的只读适配规则执行。

## 风险与应对

- 模型返回章节数量不一致：不绑定身份，当前节点最多纠错一次，失败后停止。
- 模型在相同数量下交换章节语义：现有 ID 透传也无法确定性发现“内容挂在正确 ID 下但语义交换”的问题；继续由 ContentPlan 约束、Reviewer 和内容一致性校验识别，不把标题相似度升级为身份机制。
- `sectionIndex` 被误持久化为主身份：正式领域 Schema 和 Structure Guard 继续要求 `sectionId`，Canonicalizer 后只把索引作为派生字段。
- 纠错增加延迟和成本：仅对结构性 Raw 错误重试一次，记录额外耗时和成功率，并受 Run deadline 限制。
- 新旧输出混用：Canonicalizer 始终从当前 ContentPlan 注入 `structureVersion`，最终仍执行版本门禁。

## 验证

- 复现生产中的字符转置 ID，确认模型 Raw 输出不再包含该字段，Canonical Outline 使用 ContentPlan 权威 ID。
- 验证 Outline、Draft 和 Revision 缺章、增章时不会按位置静默绑定。
- 验证 ImagePlan 和 LayoutPlan 的合法索引被转换为正确 `sectionId`，越界索引触发一次节点纠错。
- 验证纠错不增加内容 Revision 次数，不触发全 Graph 重跑。
- 验证 Canonical 对象在 Outline、Draft、ImagePlan、LayoutPlan 和 Artifact 全链路保持相同 `structureVersion` 和 `sectionId`。

## 关联

- `docs/adr/013-stable-section-identity.md`
- `docs/specs/020-stable-section-identity-and-structure-guard.md`
- `docs/modules/creation-graph/README.md`
- `docs/testing/plans/creation-graph.md`
- `docs/testing/cases/creation-graph.md`

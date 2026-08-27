# 024：创作上下文与发布校验可靠性

## 状态

已确认，按兼容演进方式实施。

## 背景

同一 Conversation 需要支持新创作、修改现有文章、继续扩写和风格调整。当前实现可能把完整新提示词默认解释为继续，把历史需求多次拼入 Agent 输入，并在 Artifact 末端使用创意主题的字面覆盖率否决语义一致的正文。失败后会话又只保留旧成功状态，用户下一轮容易重复进入同一失败路径。

## 目标

- 建立一次 Run 的单一、结构化、可追溯创作请求。
- 稳定区分 `new`、`revise`、`continue` 和 `clarify`。
- 本轮指令只进入上下文一次，历史信息按字段继承。
- 根据修改范围选择执行子图，风格修改不重写正文。
- 将创意主题和内容校验身份分开。
- 将校验分成完整性硬错误、可修订质量问题和 warning。
- 保留最近成功基线，同时记录最近失败尝试。
- 通过 V1/V2 双读、影子计算和固定会话灰度降低上线风险。

## 非目标

- 不建立跨会话长期记忆。
- 不引入向量检索、Embedding 服务或新生产依赖。
- 不修改服务边界或新增数据库表。
- 不把离题和事实冲突全部降级为可发布 warning。
- 不批量改写历史 Run、Message 或 Artifact。

## 核心契约

### ResolvedCreationRequest

每个 V2 Run 冻结以下结构：

```ts
interface ResolvedCreationRequest {
  schemaVersion: 2;
  operation: "new" | "revise" | "continue" | "clarify";
  decisionSource: "user" | "rule" | "model";
  confidence: "high" | "medium" | "low";
  currentInstruction: string;
  baseArtifactId?: string;
  mutationScope: Array<"content" | "title" | "structure" | "images" | "presentation">;
  inheritance: {
    content: "replace" | "preserve" | "extend";
    presentation: "replace" | "preserve";
    resources: "current_only" | "explicit" | "artifact_used";
  };
  contentIdentity: ContentIdentity;
  provenance: CreationRequestProvenance[];
  clarification?: { reasonCode: string; question: string };
}
```

不变量：

- `currentInstruction` 只出现一次。
- `new` 的 `content=replace`、`resources=current_only|explicit`，且没有 `baseArtifactId`。
- `revise` 必须有 `baseArtifactId` 和非空 `mutationScope`。
- `clarify` 必须提供问题，且不进入正文生成节点。
- `provenance` 的 `sourceId + field` 唯一。

### ContentIdentity

```ts
interface ContentIdentity {
  topicSummary: string;
  namedEntities: string[];
  requiredFacts: string[];
  requiredClaims: string[];
  mustIncludeVerbatim: string[];
  prohibitedClaims: string[];
}
```

`topicSummary` 是语义身份，不要求逐字出现在正文。只有 `mustIncludeVerbatim` 执行原文匹配。

### CreationFailureEnvelope

失败响应包含安全的错误码、阶段、分类、恢复方式、摘要和受控 violation。它不得包含完整 Prompt、模型原始输出或内部思维链。

## 意图状态机

优先级：

```text
用户显式模式
> 明确引用上一版的修改
> 自洽完整的新需求
> 明确追加/继续
> 低置信度时澄清
```

Auto 输入必须比较本轮 `ContentIdentity` 与成功基线：

- 主题、对象和必要事实构成独立任务：`new`。
- 主要引用上一版并指定修改维度：`revise`。
- 明确要求追加、延展或补充：`continue`。
- 新主题和修改信号冲突，或置信度低：`clarify`。

模型不可用时的规则降级必须保守；不确定时追问，不默认继承。

## Context Assembler

Conversations 模块只保留一个 Context Assembler。输入为当前消息、成功基线、最近尝试、显式资源和意图结果；输出为冻结 `CreationRunContextV2`。

Agent 输入由职责投影器产生：

- Brief：内容身份、本轮内容约束和当前资源。
- Writer：确认后的 Brief、内容计划和必要事实。
- Presentation：确认后的正文、呈现约束、图片语义和品牌规则。
- Reviewer：内容身份、修改范围和待审输出。

Agent 不读取完整历史，不追加 Working Memory 原文。

## 执行子图

| 修改范围 | 执行节点 | 保持不变 |
| --- | --- | --- |
| `presentation` | Presentation → Layout → Review → Artifact | 标题、正文、章节 ID、图片语义 |
| `title` | Title → 必要 Layout → Review → Artifact | 正文事实和章节结构 |
| `content` / `structure` | 对应计划或 Writer → 受影响下游 | 未修改约束和来源 |
| `continue` | ContentPlan → Writer → 后续链路 | 成功基线事实和禁止项 |
| `new` | Brief 开始的完整链路 | 只保留显式品牌/Skill 设置 |

修改范围越界属于 Repairable quality，在 Artifact 保存前定向修订或失败。

## 校验政策

### Hard integrity

- Contract/Schema 无效。
- `sectionId`、资源、标题来源或结构版本无效。
- Prompt、过程文本或不安全内容泄漏。
- Renderer 安全规则失败。

### Repairable quality

- 明确离题。
- 必需事实遗漏或矛盾。
- `mustIncludeVerbatim` 遗漏。
- 修改范围越界。

### Warning

- 抽象主题语义置信度不足。
- 轻微风格和表达偏差。
- 达到修订上限但没有明确反向证据。

Reviewer 对每项必要事实和观点输出 `covered/missing/contradicted/uncertain`、正文证据和置信度。Artifact Builder 不再使用创意主题连续双字覆盖率作为硬门禁。

## 状态与恢复

- `successfulBaseline` 只在 Artifact 成功后更新。
- `lastAttempt` 在成功或失败后更新，但不覆盖成功基线。
- “重试”复用失败 Run 的冻结请求。
- “开始新创作”不把失败尝试作为内容来源。
- 并发更新使用 `contextVersion` 条件写入。

## 兼容演进

1. 建立脱敏 Golden Dataset 和生产基线。
2. 发布 V1/V2 双读契约和 Worker。
3. V2 IntentResolver 影子计算，零业务写入。
4. 显式模式先启用 V2 Context Assembler。
5. 按 Presentation、Title、Continue、Body、Auto New 顺序接管。
6. 旧字面校验和新内容身份审校双轨裁决。
7. 按 Conversation 固定分桶执行内部、5%、25%、50%、100% 灰度。
8. 稳定后停止 V1 写入，保留历史只读适配器。

## 验收标准

- 完整新提示词不依赖“新主题”口令即可进入 `new`。
- “换种风格重新实现”进入 `revise(presentation)`，正文哈希、章节 ID 和图片语义不变。
- 新创作不继承旧 Artifact、Brief、LayoutPlan 或未显式资源。
- 抽象主题合理改写不会被字面主题校验误杀。
- 明确离题和事实冲突仍会进入定向修订或可恢复失败。
- 失败后重试不重新拼接历史，切换新提示词不回退旧主题。
- V1 排队任务和历史 RunContext 在 V2 部署后继续可读可执行。
- 影子模式对 Run、Working Memory、Artifact 和用户可见终态零写入。
- 所有诊断信息通过安全长度和敏感内容校验。

## 文档路由

- ADR：`docs/adr/017-canonical-creation-request-and-validation-layers.md`
- 模块：`docs/modules/conversations/README.md`、`docs/modules/creation-graph/README.md`
- API：`docs/api/conversations.md`、`docs/api/creation-graph.md`
- 测试：`docs/testing/plans/conversations.md`、`docs/testing/plans/creation-graph.md`
- L 级计划：`.plan/20260827-creation-context-and-validation-reliability.md`


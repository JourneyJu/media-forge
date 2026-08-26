# 022：审校达到上限后输出最后一次草稿

## 状态

已确认方案，待实施。

## 目标

当公众号创作流程的质量审校连续未通过并达到最大审校/修订次数时，系统仍输出当前最新草稿，生成可预览的 Artifact，并将未解决的审校问题作为质量提醒展示给用户。

本规格解决的是“达到最大次数后没有结果”的问题，不改变正常审校通过和未达到上限时的修订流程。

## 当前问题

Creation Graph 当前在审校未通过且达到上限时进入 `fail_node`。该节点只返回 `status: failed`，不会执行 Artifact Builder，因此不会产生 `artifact.created`、`run.completed` 或可展示的文章预览。

当前 `revisionCount` 在审校报告为 `passed=false` 时递增，实际表示审校失败轮次。第一阶段保留现有计数行为，避免同时改变最大次数边界；后续可单独将其重命名为 `reviewAttemptCount`。

## 业务规则

1. Reviewer 返回 `passed=true` 时，沿用现有流程进入 `artifact_node`，结果为 `qualityStatus=passed`。
2. Reviewer 返回 `passed=false` 且尚未达到上限时，沿用现有定向修订流程。
3. Reviewer 返回 `passed=false` 且达到上限时，不再进入 `fail_node`，改为使用当前 Graph State 中的 `draft` 进入 Artifact Builder。
4. “最后一次草稿”指达到上限判断时 State 中的最新 `draft`。
5. 最大次数输出必须保留最新一次 `ReviewReport` 和未解决的 `issues`。
6. 最大次数输出仍产生 `Artifact`、`artifact.created` 和 `run.completed`。
7. 最大次数输出的 Run 状态为 `completed`，但质量状态为 `warning`，不能伪装成审校通过。
8. 没有可用 `draft`、Artifact Builder 失败或结构无法安全构建时，仍然进入真正的 `run.failed`。

## 状态和契约

```ts
type QualityStatus = "passed" | "warning";

type CompletionReason =
  | "review_passed"
  | "max_revision_reached";
```

新增字段应作为可选字段进入共享契约，以兼容历史 Run 和历史事件。

最大次数完成事件示例：

```json
{
  "runId": "run_123",
  "artifactId": "artifact_123",
  "qualityStatus": "warning",
  "completionReason": "max_revision_reached",
  "unresolvedIssueCount": 2
}
```

Artifact 的质量元数据至少包含：

```ts
{
  qualityStatus: "warning",
  completionReason: "max_revision_reached",
  reviewPassed: false,
  unresolvedIssues: ReviewIssue[]
}
```

应保证 `artifact.created` 先于 `run.completed`，且同一 Run 重试不会重复创建最终 Artifact。优先复用现有 Artifact payload 或事件 payload，不新增数据库表。

## 状态流

```text
review_node
  ├─ passed=true → artifact_node → completed / passed / review_passed
  ├─ 未达到上限 → revision_node → layout_node → review_node
  └─ 已达到上限 → artifact_node → completed / warning / max_revision_reached
```

第一版优先将最大次数分支直接路由到 `artifact_node`；如果需要显式记录状态，可增加只负责写入完成原因和质量状态的 `max_revision_node`。

## 前端行为

前端继续监听现有 `run.completed`，不新增独立的“降级完成”事件。

正常完成显示“创作完成”。最大次数完成显示：

```text
已达到最大审校次数，已输出最后一版结果，请人工确认。
```

任务卡显示：

```text
已完成 · 有质量提醒
```

前端收到 warning 类型的 `run.completed` 后必须关闭生成状态、加载 Artifact、更新预览、添加结果通知、展示未解决问题并关闭 SSE。

## 实施任务

### 阶段一：共享契约

- 在 `packages/contracts` 增加质量状态和完成原因的受控值。
- 新字段设为可选，保持历史事件兼容。
- 增加契约解析测试。

### 阶段二：Creation Graph

- 修改 `routeAfterReview` 的最大次数分支。
- 保留当前 State 中的最后一次 `draft` 和 `ReviewReport`。
- 让 `artifact_node` 支持 `warning` 质量状态。
- 修改任务步骤文案，区分“完成但有提醒”和“真正失败”。

### 阶段三：Worker 和事件

- 最大次数后创建 Artifact。
- 写入 `artifact.created`。
- 更新 Run 为 `completed`。
- 写入带质量元数据的 `run.completed`。
- 保证 Artifact 创建和完成事件的幂等性。

### 阶段四：前端展示

- 识别 `qualityStatus=warning`。
- 显示最后一次结果。
- 展示未解决审校问题。
- 确保收到 `run.completed` 后停止加载状态。

### 阶段五：验证和灰度

- 验证首次审校通过。
- 验证修订后审校通过。
- 验证达到上限后输出最后一次草稿。
- 验证 Artifact Builder 真实失败时仍显示失败。
- 验证历史 Run 恢复和 SSE 重放。

## 验收标准

- 达到最大审校次数后一定有结果或明确的系统失败原因。
- 最大次数场景使用最后一次 `draft` 生成 Artifact。
- 最大次数场景发送 `artifact.created` 和 `run.completed`。
- 最大次数场景不发送 `run.failed`。
- 前端能显示预览、复制结果和质量提醒。
- 最新审校问题没有丢失。
- 产物构建失败仍然进入 `run.failed`。
- 正常审校通过流程行为不变。
- 不新增生产依赖，不新增数据库表。

## 风险和控制

| 风险 | 影响 | 控制措施 |
| --- | --- | --- |
| 用户把 warning 当成审校通过 | 高 | 使用独立 `qualityStatus`，前端显式展示提醒 |
| 最后一版草稿结构不完整 | 高 | Artifact Builder 继续执行结构校验，失败时才真正失败 |
| 事件重复导致重复 Artifact | 高 | 以 `runId` 或现有幂等键约束 Artifact 创建 |
| 新旧前端契约不兼容 | 中 | 新字段全部可选，沿用 `run.completed` |
| 最大次数边界发生变化 | 中 | 第一阶段不重构计数语义，补齐边界测试 |
| 审校问题丢失 | 中 | 在 Artifact 元数据和完成事件中保留最新报告摘要 |

## 后续事项

本规格不包含将 `revisionCount` 重命名为 `reviewAttemptCount`、选择历史版本最佳草稿或新增人工审核工作流。这些事项应单独立项。

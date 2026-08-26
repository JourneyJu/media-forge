# ADR-015：审校达到上限时输出最后一次草稿

## 状态

Accepted

## 日期

2026-08-26

## 背景

公众号多 Agent 创作流程包含 Reviewer Agent 和 Revision Agent。当前审校未通过且达到最大修订次数时，Creation Graph 进入 `fail_node`，直接将 Run 标记为失败。由于失败节点不构建 Artifact，用户无法看到已经生成的最后一版内容。

审校不通过代表质量门禁未通过，不等同于系统无法生成结果。只要当前草稿结构完整且能够通过 Artifact Builder 的安全校验，系统就应该让用户获得可人工确认的候选结果。

## 决策

审校达到最大次数后，使用当前 State 中的最后一次 `draft` 进入 Artifact Builder，并以“完成但有质量提醒”的方式结束 Run。

结果使用以下语义：

```text
run.status       = completed
qualityStatus    = warning
completionReason = max_revision_reached
```

该路径仍然创建 Artifact、写入 `artifact.created`，并发送带 `artifactId` 的 `run.completed`。最新审校报告和未解决问题保存在结果元数据中，供前端展示。

只有在缺少草稿、Artifact Builder 无法构建合法文章、持久化失败或其他不可恢复系统错误时，才进入 `run.failed`。

## 选择理由

- 保留已经产生的用户价值，避免审校门禁失败导致内容完全丢失。
- 复用现有 Artifact Builder、事件流和前端预览路径。
- 用 `qualityStatus` 区分“可用结果”和“审校通过”，避免质量语义被掩盖。
- 允许用户人工判断未解决问题，符合内容生产的实际工作流。
- 采用可选契约字段，降低对历史 Run 和旧前端的兼容风险。

## 备选方案

### 继续失败，不输出结果

不采用。它能严格执行质量门禁，但会丢失最后一版草稿，直接造成当前用户问题。

### 新增独立降级 Artifact 节点

保留为后续演进方向。独立节点的语义更清晰，但第一版需要新增图节点、契约和前端分支；当前需求可以通过复用 `artifact_node` 以更小改动实现。

### 从所有版本中选择评分最高的版本

暂不采用。它需要完整保存每轮版本并引入版本选择规则，且“评分最高”不一定是用户最后一次明确要求对应的版本。

## 影响

最大审校次数场景可以得到可预览结果，但输出内容可能仍有质量问题。因此前端必须显式展示 `warning` 和未解决审校问题，不能把该结果展示为审校通过。

本决策不改变模型重试、结构校验失败、Artifact 持久化失败和真正系统异常的失败语义。

## 一致性要求

实施时必须同步：

- `packages/contracts` 中的完成元数据契约；
- `docs/specs/022-max-review-output-last-draft.md`；
- Creation Graph 模块文档；
- Creation Graph API 文档；
- 测试计划和测试用例。

# 测试用例：Creation Graph 多 Agent 编排

## CG-001 创建 Run 入队

前置：用户准备提交首次或后续 Turn。  
步骤：调用 `POST /conversations` 或 `POST /conversations/:id/turns`。  
期望：Turn 事务返回 `queued` Run，写入 `run.created` 和 dispatch outbox，BullMQ 中最终存在 `creation-run` job。

## CG-002 正常完成多 Agent 创作

前置：Worker 正常运行。  
步骤：创建 Run 后等待 Worker 完成。  
期望：依次产生 Brief、Title、Outline、Writer、ImagePlan、Review、Render、Artifact 节点记录；Run 变为 `completed`。

## CG-002A Worker 读取真实上下文

前置：Conversation 有用户消息、资源和 Skill。  
步骤：创建 Run，由 Worker 消费。  
期望：Brief Agent 收到当前 Conversation 的真实上下文；`userInput` 和 `resourceIds` 不为空；不读取其他 Conversation。

## CG-002B Worker 读取冻结会话记忆

前置：Conversation 已有 Working Memory 和 latest Artifact。  
步骤：创建修改类 Run，由 Worker 消费。  
期望：Worker 只读取该 Run 的 `graph_runs.context_json`；GraphState 包含 Working Memory 摘要和 `lastArtifactId`；不会读取后续新消息覆盖当前 Run。

## CG-003 任务卡事件流

步骤：订阅 `GET /runs/:id/events`。  
期望：在 Worker 节点实际执行期间收到 `step.started`、`step.completed`、`artifact.created`、`run.completed`，前端任务卡可更新；事件不是任务完成后的批量回放。

## CG-004 不确认计划

步骤：提交完整创作需求。  
期望：不产生计划确认按钮，不要求用户提交 `approve`，Run 自动执行。

## CG-005 必要追问

步骤：提交“帮我写一篇文章”。  
期望：Clarification Agent 判断信息不足，Run 进入 `waiting_clarification`，事件流产生 `clarification.required`。

## CG-006 追问恢复

前置：Run 处于 `waiting_clarification`。  
步骤：调用 `POST /runs/:id/clarifications` 提交答案。  
期望：Graph 从 checkpoint 恢复，继续执行后续节点。

## CG-007 追问幂等

步骤：使用相同 `idempotencyKey` 重复提交追问答案。  
期望：返回同一结果，不重复写入用户答案，不重复恢复 Graph。

## CG-008 Worker 重试

步骤：模拟 Writer Agent 首次失败、第二次成功。  
期望：AgentTask 记录失败和重试，最终只创建一个 Artifact。

## CG-009 Artifact 防重复

步骤：重复消费同一个 `runId` job。  
期望：Artifact Builder 幂等，不重复创建 ArticleVersion。

## CG-010 最终内容防污染

步骤：模拟 Writer 或 Renderer 输出包含“以下是计划”“我会先”等过程文本。  
期望：Artifact Builder 拒绝保存，进入 revision 或 failed。

## CG-010A 用户指令不得成为标题

步骤：提交包含主题、受众、素材分类和风格要求的长提示词。  
期望：Brief Agent 提取简短 `subject`；Title Agent 生成至少三个候选；最终标题来自 `selectedId`，不等于或截取原始提示词。

## CG-010B 用户指令不得进入正文

步骤：提交包含“帮我做一个公众号文案，要求如下”的输入。  
期望：最终 ArticleDocument 不包含该指令、编号要求原文、执行计划或审校说明。

## CG-010C Review 触发 Revision

步骤：Reviewer 返回一个 `error` 级问题。  
期望：Graph 进入 Revision 并重新审校；最多两轮，超过上限后 failed 且不创建 Artifact。

## CG-011 SSE 断线续传

步骤：收到 event_no=3 后断开，再请求 `/events?after=3`。  
期望：只补发 event_no > 3 的事件。

## CG-012 页面刷新恢复

步骤：Run 执行中刷新页面。  
期望：恢复对话消息、任务卡当前状态和最新手机预览。

## CG-012A 基于上一版修改

前置：Conversation 已完成一版公众号 Artifact。  
步骤：用户发送“第三段加上活动时间，语气更温暖”。  
期望：Writer 或 Revision Agent 基于上一版 ArticleDocument 定向修改；最终 Artifact 保留未要求修改的章节结构，不从空白重新生成。

## CG-013 手机预览边界

步骤：生成文章后查看右侧预览。  
期望：只展示公众号标题、封面、正文段落、图片和 CTA，不展示 Agent 过程。

## CG-014 内部输出权限

步骤：普通用户请求 `GET /runs/:id/outputs`。  
期望：无权限或只返回脱敏摘要。

## CG-015 Redis 未启动

步骤：停止 Redis 后创建 Run。  
期望：Run 和 Outbox 可恢复；接口不静默执行 legacy；健康检查明确报告队列不可用。

## CG-016 Redis 恢复后重派

前置：存在待投递 Outbox。  
步骤：启动 Redis 和 Worker。  
期望：Job 只入队一次，Run 正常继续。

## CG-017 Worker 未运行

步骤：Redis 正常但不启动 Worker，创建 Run。  
期望：Run 保持 `queued`；超过阈值产生可观测告警，不生成伪步骤事件。

## CG-018 模型配置缺失

步骤：未配置 Model Gateway 且未显式设置 `MODEL_MODE=demo`。  
期望：Run 返回 `GENERATION_MODEL_UNAVAILABLE` 或 failed，不自动生成 Demo 文章。

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
步骤：用户要求在指定章节补充活动时间，并调整该章节语气。

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

## CG-019 生产环境禁止 Demo

步骤：以 `NODE_ENV=production` 和 `MODEL_MODE=demo` 启动 service 或 worker。

期望：启动检查失败或 Run 明确失败；不得生成 `multi-agent-demo` Artifact，不得产生伪步骤完成事件。

## CG-020 最新 Turn 不受历史主题污染

前置：同一 Conversation 已完成一篇儿童摄影文章。

步骤：用户提交完整的舞蹈获奖新需求，并选择 `creationMode=new`。

期望：RunContext 的 `currentInstruction` 只包含最新 Turn；Brief、标题、正文和审校结果不得出现摄影、镜头、家庭成长等旧主题语义。

## CG-021 新创作资源隔离

前置：Conversation 中已有摄影图片，本轮上传舞蹈演出图片。

步骤：以 `creationMode=new` 创建 Run，`inheritedResourceIds` 为空。

期望：Material 和 ImagePlan 只收到本轮图片；Artifact 不引用历史摄影资源。

## CG-022 显式继承旧资源

前置：存在上一版品牌 Logo，用户在新创作中显式选择该资源。

步骤：将 Logo ID 放入 `inheritedResourceIds`。

期望：RunContext 冻结该资源；服务端校验 owner 和用途后允许 LayoutPlan 在品牌模块引用。

## CG-023 结构化正文映射

步骤：Writer 生成包含 intro、三个 sections、conclusion 和 CTA 的 ArticleDraft。

期望：Artifact Builder 按 section 生成标题、段落和图片，不按段落下标猜测章节；每个 assetRef 都能追溯到 ImagePlan。

## CG-024 主题化 LayoutPlan

步骤：为舞蹈获奖内容执行 Layout Agent。

期望：输出 celebration、editorial 或其他与舞台主题适配的受控 LayoutPlan；未明确选择少儿成长 Skill 时不得沿用其绿色编号模板。

## CG-025 LayoutPlan 安全边界

步骤：模拟 Layout Agent 返回 raw HTML、style 字符串、脚本或非白名单模块。

期望：schema 校验失败并产生 `LAYOUT_PLAN_INVALID`；Renderer 不执行、不保存该内容。

## CG-026 Reviewer 定向回退

步骤：分别模拟主题理解错误、正文深度不足、图片错配和版式不匹配。

期望：Graph 分别回退 Brief、Planner/Writer、ImagePlan 和 Layout；不得把所有问题统一交给正文 Revision。

## CG-027 Review 未通过不创建 Artifact

步骤：Reviewer 两轮后仍报告主题污染或要求覆盖不足。

期望：Run failed，不产生 `artifact.created`，不存在新的 ArticleVersion。

## CG-028 Skill 贯穿全部阶段

前置：用户选择包含语气、结构、品牌色、Logo、二维码和禁用规则的私有 Skill。

步骤：执行完整 Run。

期望：Brief、Planner、Writer、Layout 和 Reviewer 分别收到与职责相关的 Skill 子集；二维码只进入 CTA，Logo 只进入品牌模块；Run 可证明 Skill 已实际应用。

## CG-029 模型推理摘要流式事件

步骤：模拟模型连续返回多个 `reasoning_content` chunk 和最终结构化 `content`。

期望：事件流按顺序产生 `agent.reasoning.delta`；最终 JSON 只在服务端组装并通过 schema 后成为 AgentOutput；浏览器收不到残缺 JSON。

## CG-030 不支持 reasoning 的模型

步骤：模型只返回 `content`，不返回 `reasoning_content`。

期望：Worker 仍产生 `agent.progress`、`agent.output.validating` 和 heartbeat；不伪造模型思考文本，Run 可以正常完成。

## CG-031 推理摘要安全过滤

步骤：模型 reasoning 包含 system prompt 片段、Skill 内部规则、疑似密钥和超长文本。

期望：用户事件不包含敏感内容；单条和单 Agent 总量满足上限；服务日志不记录原文。

## CG-032 heartbeat 与停滞提示

步骤：模型 25 秒没有返回 chunk，但连接仍然有效。

期望：每 5 秒最多产生一次 `run.heartbeat`；前端在 20 秒后显示仍在处理；任务不被误标为完成。

## CG-033 schema 纠错过程

步骤：模型第一次返回非法结构，第二次纠正成功。

期望：产生 `agent.output.validating`、`agent.retry.started` 和最终 `agent.completed`；不展示非法 JSON；用量汇总两次调用。

## CG-034 Worker 中断与唯一终态

步骤：模型调用期间终止 Worker，等待恢复阈值。

期望：Run 被恢复扫描重新入队或标记 failed；最终只有一个终态事件，不永久停在 running。

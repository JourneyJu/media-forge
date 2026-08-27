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

## CG-010D Revision 不得漂移标题

前置：Title Agent 已生成候选集合并选中 `selectedId`，Reviewer 返回正文、图片、结构或版式问题。
步骤：模拟 Revision Agent 输出的 `ArticleDraft.title` 与选中标题不一致。
期望：Graph 在非标题问题修订中恢复或保持 Title Agent 选中的标题；Artifact Builder 通过 `TITLE_SOURCE_INVALID` 回归校验，不因标题漂移导致微信排版失败。

## CG-010E 标题问题必须回退 Title Agent

步骤：Reviewer 明确返回标题不匹配、标题不准确或标题传播力不足的问题。
期望：Graph 回退到 Title Agent 重新生成候选并更新 `selectedId`，后续 Outline、ImagePlan、Writer、Layout 和 Review 使用新的选中标题；不得由 Revision Agent 直接改写最终标题。

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

## CG-027 Review 达到上限输出最后草稿

步骤：Reviewer 连续未通过并达到最大修订次数。

期望：Graph 使用最后一次 `draft` 进入 Artifact Builder；结构校验通过时依次产生 `artifact.created` 和带 `qualityStatus=warning`、`completionReason=max_revision_reached`、`unresolvedIssues` 的 `run.completed`。前端加载预览并显示人工确认提醒；Artifact Builder 失败时才产生 `run.failed`。

## CG-028 Skill 贯穿全部阶段

前置：用户选择包含语气、结构、品牌色、Logo、二维码和禁用规则的私有 Skill。

步骤：执行完整 Run。

期望：Brief、Planner、Writer、Layout 和 Reviewer 分别收到与职责相关的 Skill 子集；二维码只进入 CTA，Logo 只进入品牌模块；Run 可证明 Skill 已实际应用。

## CG-029 模型推理摘要流式事件

步骤：模拟模型连续返回多个 `reasoning_content` chunk 和最终结构化 `content`。

期望：功能关闭时产生确定性的 `agent.reasoning.delta`；功能启用且通过安全门禁时，
产生完整替换的 `agent.reasoning.summary`；最终 JSON 只在服务端组装并通过
schema 后成为 AgentOutput；浏览器收不到原始 reasoning 或残缺 JSON。

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

## CG-035 主题自然改写通过 Artifact 校验

前置条件：Brief 主题包含品牌、书名号中的节目名和奖项。

步骤：正文以自然语言插入“的”“捧回”等连接词，但覆盖相同主题要素；另准备一份完全无关正文作为反例。

期望：自然改写通过主题覆盖校验；无关正文返回 `SUBJECT_MISMATCH`。

## CG-036 队列中间重试不产生 Run 终态

步骤：配置 BullMQ `attempts=3`，让前两次模型调用超时、第三次成功。

期望：前两次只产生 `agent.retry.started`，Run 和 SSE 保持活动；第三次成功后只产生一个 `run.completed`。如果第三次仍失败，才产生唯一 `run.failed`。

## CG-037 章节标题自然润色不构成结构漂移

前置：ContentPlan 章节包含稳定 `sectionId`，展示标题为“开场：舞台上的那一束光”。

步骤：Writer 或 Revision 保留同一 `sectionId`，将标题改为“舞台上的那一束光”。

期望：Structure Guard 通过；图片和版式仍关联原章节；Artifact 正常生成，不返回 `CONTENT_PLAN_DRIFT`。

## CG-038 Revision 篡改章节集合立即失败

步骤：分别模拟 Revision 删除章节、新增未知章节、重复 `sectionId` 和交换章节顺序。

期望：在 Revision 后分别返回 `SECTION_SET_MISMATCH`、`SECTION_ID_DUPLICATED` 或 `SECTION_ORDER_DRIFT`；不进入 Layout、Review 或 Artifact。

## CG-039 图片与版式引用未知章节

步骤：让 ImagePlan 或 LayoutPlan 使用不在当前 ContentPlan 中的 `sectionId`。

期望：责任节点后的 Structure Guard 返回 `SECTION_REFERENCE_INVALID`；不通过标题或索引猜测归属。

## CG-040 结构重规划使旧产物失效

前置：已存在同一 Run 的 ContentPlan、Draft、ImagePlan 和 LayoutPlan。

步骤：Reviewer 返回 `target=plan`，Content Planner 合法增删或换序章节并生成新 `structureVersion`，随后尝试复用旧 Draft 或 LayoutPlan。

期望：旧产物返回 `STRUCTURE_VERSION_STALE`；Graph 从最早受影响节点重跑，所有下游输出使用新版本。

## CG-041 Review 按问题类型定向回退

步骤：分别生成 `title`、`body`、`image`、`layout`、`plan` 和 `brief` 问题。

期望：依次回到 Title、Revision、Image Planner、Layout、Content Planner 和 Brief/Clarification；多个问题从最上游受影响节点开始，不统一交给 Revision。

## CG-042 模型章节身份纠错

步骤：模型第一次漏传、重复或生成未知 `sectionId`，第二次根据允许 ID 列表返回正确结构。

期望：第一次产生结构化纠错事件，第二次通过；纠错不消耗内容 Revision 轮次。第二次仍失败时节点明确失败且不创建 Artifact。

## CG-043 历史无章节身份输出兼容

前置：历史 AgentOutput 没有 `sectionId` 和 `structureVersion`。

步骤：分别准备章节数量与索引一致、标题前缀不同的历史输出，以及章节数量不一致或引用越界的输出。

期望：前者按 `runId + 章节序号` 只读映射并允许重新生成；后者不做语义猜测，从最早受影响节点重跑；历史快照和已发布 ArticleVersion 不被回写。

## CG-044 结构门禁日志与安全摘要

步骤：触发一个 `SECTION_SET_MISMATCH`。

期望：后台日志包含 `runId`、节点、`structureVersion`、错误码和预期/实际 ID 集合，不包含完整 prompt、思维链、密钥或未脱敏正文；用户侧显示可理解的结构失败摘要。

## CG-045 Agent 分析动态生命周期

步骤：让同一 Agent 产生两次安全摘要，然后完成；随后模拟旧
`executionId` 的迟到摘要，并分别覆盖失败和队列重试路径。

期望：前端按 `revision` 替换摘要，不拼接原文；完成时清空并收起当前步骤；
迟到摘要被忽略；失败步骤保留最后安全摘要；重试创建新 `executionId`；
任一路径都不阻塞 AgentOutput 和 Run 终态。

## CG-046 用户指定单一颜色

步骤：用户要求“整体使用深蓝色，风格克制”，生成一篇舞台获奖文章。

期望：`UserPresentationConstraints` 保留深蓝和克制要求；PresentationStyleDecision 以深蓝为颜色锚点，内容只补充辅助色、背景、比例和装饰；LayoutPlan 不静默改用其他主色。

## CG-047 用户指定明确色值和使用范围

步骤：用户要求“标题使用 `#173F37`，金色只用于少量点缀，背景不要深色”。

期望：目标色值、使用范围和背景限制可追溯到 PresentationStyleDecision 和 LayoutPlan；正文保持可读，不把金色用作大面积背景。

## CG-048 用户禁用颜色

步骤：用户要求“不要红色和金色”，内容主题为获奖庆典。

期望：系统不因庆典主题自动选择红金方案；禁用色不进入 LayoutPlan 的主色、强调色、背景或大面积装饰；图片本身不可控的原始颜色不构成违规。

## CG-049 未指定颜色时按内容推断

步骤：分别生成舞台获奖、温暖成长、专业报告、实用指南和品牌宣传文章，用户不指定颜色。

期望：Presentation Director 根据内容、受众、正文密度、图片 mood 和 Skill 生成有安全依据的呈现决策；五类内容不得全部落到同一视觉主题和色彩意图。

## CG-050 用户颜色与 Skill 冲突

前置：用户主动选择一个明确禁止紫色且要求品牌绿色的 Skill。

步骤：用户要求“主色改成紫色”。

期望：Graph 进入 `waiting_clarification` 并返回可理解的冲突说明；不得静默忽略用户要求或 Skill 硬约束。

## CG-051 Presentation 不得改变图片语义

步骤：ImagePlan 将证书图分配给荣誉章节、合影分配给结尾；Presentation Director 返回图片展示策略。

期望：PresentationStyleDecision 只能定义尺寸、组合、边框和图注策略；LayoutPlan 仍保持原 `sectionId` 和语义角色，不交换两张图片。

## CG-052 Presentation 与 Layout 定向回退

步骤：分别让 Reviewer 返回 `target=presentation` 的颜色适配问题和 `target=layout` 的未知模块问题。

期望：前者重跑 Presentation、Layout 和 Review；后者只重跑 Layout 和 Review；两者均不交给正文 Revision。

## CG-053 只修改呈现风格

前置：已生成包含标题、三个章节、ImagePlan、PresentationStyleDecision 和 LayoutPlan 的 Artifact。

步骤：用户要求“改成低饱和蓝灰色，减少装饰，图片改为大图穿插”。

期望：Graph 重跑 Presentation、Layout 和 Review；标题、正文、章节集合、`sectionId`、图片资源和图片语义归属保持不变。

## CG-054 呈现决策结构版本过期

步骤：Content Planner 生成新 `structureVersion` 后尝试复用旧 PresentationStyleDecision。

期望：返回 `PRESENTATION_STRUCTURE_STALE` 或等价 violation；不进入 Layout、Review 或 Artifact。

## CG-055 Presentation 输出安全边界

步骤：模拟 Presentation Director 返回 raw HTML、CSS、脚本、对象存储内部地址、完整 prompt 或正文改写字段。

期望：schema 或安全校验失败并产生 `PRESENTATION_STYLE_INVALID`；不写入合法 AgentOutput，不进入 Layout，不创建 Artifact。

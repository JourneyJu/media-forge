# 测试方案：AI 生成

## 模块文档

- `docs/modules/ai-generation/README.md`

## 当前状态

微信公众号生成第一版实现前，必须覆盖生成任务、模型网关、prompt 快照、结构校验、文章版本保存和失败分类。

## 测试范围

| 范围 | 目标 |
| --- | --- |
| 生成初版 | 输入主题、素材和 skill 后创建任务并保存版本。 |
| 对话修订 | 基于当前版本和用户指令生成新版本。 |
| 模型配置 | 第一版从 service env 读取，前端不传 API Key。 |
| 输出校验 | 模型返回非法 JSON 或非法结构时不保存坏版本。 |
| 失败分类 | 区分模型失败、解析失败、配额失败、策略失败和系统失败。 |
| 用量日志 | 记录模型、token、耗时、状态和错误分类。 |
| Agent 计划 | 素材分析后生成结构化计划，步骤顺序和目标可展示。 |
| 排版优先 | layout 只生成骨架，expand 不擅自改变章节结构。 |
| 审阅循环 | 局部问题修订，结构问题重构后重新扩充和审阅。 |
| 循环限制 | 修订、重构和总步骤达到上限后暂停。 |
| 用户确认 | waiting_user、决定幂等、lockVersion 冲突和恢复执行。 |
| 步骤事件 | 当前会话或计划条能按游标增量获取步骤和决定请求。 |
| 版本安全 | 每次内容变化保存版本，失败步骤不覆盖当前版本。 |
| 隐私安全 | 不返回原始思维链、密钥和未脱敏 prompt。 |

## 验证命令

```bash
pnpm --filter @mediaforge/contracts typecheck
pnpm --filter @mediaforge/service test
pnpm --filter @mediaforge/service typecheck
```

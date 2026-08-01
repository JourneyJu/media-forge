# MediaForge 工作流目录

本目录保存开发流程相关规则。`AGENTS.md` 只保留项目级主规则和路由，不承载完整流程细则。

## 文件

| 文件 | 说明 |
| --- | --- |
| `development-flow.md` | 需求分级、设计流、实施流、测试失败分流和完成标准 |
| `coding-flow.md` | 实际编码流程、测试失败分类和 Coding Loop |
| `task-template.md` | 单任务执行模板，包含 `allowed_files` |

L 级改动的计划文件放在 `.plan/`，不要放在 `.workflow/`。

## 使用方式

开始任务时：

1. 先读根目录 `AGENTS.md`。
2. 再按任务读取 `CONTEXT.md` 和相关产品、架构、标准文档。
3. 涉及实现时读取 `.workflow/development-flow.md`。
4. 进入编码阶段时读取 `.workflow/coding-flow.md`。
5. 需要拆任务时使用 `.workflow/task-template.md`。
6. 如果识别为 L 级，先到 `.plan/` 创建计划文件，确认后再实现。

# 架构文档

架构文档记录系统级边界、数据归属、关键链路和模块路由。

## 文件

| 文件 | 说明 |
| --- | --- |
| `overview.md` | 系统架构总览和模块路由 |
| `database.md` | 数据库设计和表归属 |

## 规则

- 架构文档只写系统级内容。
- 具体模块职责写到 `docs/modules/{module}/README.md`。
- API 细节写到 `docs/api/{module}.md`。
- 测试方案和测试用例写到 `docs/testing/`。
- 架构决策需要长期保留时，写 ADR。


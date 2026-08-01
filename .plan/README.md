# MediaForge 计划目录

`.plan/` 用于保存 L 级改动的实施前计划。L 级改动包括服务边界变化、数据库 schema 或迁移、主链路变化、新外部依赖、数据迁移等。

## 规则

- 识别为 L 级后，必须先在 `.plan/` 创建计划文件。
- 计划文件完成 AI 自审后，等待人工确认。
- 人工确认前，只允许只读分析、临时 spike 和计划文档修改。
- 人工确认后，才能进入正式实现。
- 如果实现中发现影响面扩大，回到 `.plan/` 更新计划并重新确认。

## 文件命名

```text
YYYYMMDD-short-title.md
```

示例：

```text
20260726-add-database-migrations.md
20260726-split-model-gateway.md
```

## 模板

使用 `.plan/plan-template.md`。


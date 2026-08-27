# Coding 实施流程

本文件只描述实际编码阶段。需求分级、L 级计划和文档拆解见 `.workflow/development-flow.md`。

## 入口条件

进入 Coding 前必须满足：

1. 已完成需求分级。
2. S 级已说明影响面和验证方式。
3. M 级已完成方案、AI 自审和人工确认。
4. L 级已完成 `.plan/` 计划、AI 自审和人工确认。
5. 涉及接口、schema、架构或模块事实的变更，已先同步对应文档和契约。
6. 已声明 `allowed_files`。

## Coding 主流程

```text
读取规则和上下文
→ 锁定 allowed_files
→ 更新 contracts
→ 编写实现
→ 编写或更新测试
→ 运行测试
→ 测试通过？
  → 是：实施报告
  → 否：Coding Loop
```

## Coding Loop

测试不通过时，先分类，不直接乱改。

```text
测试失败
→ 判断失败类型
  → 实现问题：回到“编写实现”
  → 测试用例问题：修测试，并说明为什么测试与需求/契约不一致
  → 契约问题：回到 contracts 和相关文档，必要时重新人工确认
  → 方案问题：停止编码，回到方案 / .plan，并等待人工确认
  → 环境问题：记录命令、目录、错误和未验证风险
  → 同类失败 3 次：停止，输出失败报告，等待人工介入
```

## 失败类型判断

| 类型 | 判断标准 | 下一步 |
| --- | --- | --- |
| 实现问题 | 测试期望正确，代码没满足 | 修改实现，重跑测试 |
| 测试用例问题 | 测试与已确认需求、契约或模块文档不一致 | 修改测试，说明原因 |
| 契约问题 | 请求、响应、字段、错误码或类型定义不对 | 更新 contracts、API 文档和测试 |
| 方案问题 | 当前实现路径无法满足需求，或暴露新架构/数据风险 | 停止编码，回到方案或 `.plan/`，人工确认 |
| 环境问题 | 依赖缺失、服务不可用、Docker 或网络问题 | 记录未验证项，不算通过 |

## 测试命令顺序

先跑最小充分验证，再扩大范围。

```bash
pnpm --filter @mediaforge/contracts typecheck
pnpm --filter @mediaforge/service typecheck
pnpm --filter @mediaforge/web typecheck
pnpm typecheck
pnpm test
pnpm build
```

## 本地服务器更新流程

当用户明确要求更新 `146.56.198.214` 服务器时，完成代码修改和测试后按本机私有流程执行：

1. 读取 `output/server-deploy.env` 获取服务器地址、账号和远端项目目录。
2. 本地运行最小充分验证，必要时扩大到 `pnpm.cmd typecheck`、`pnpm.cmd test`。
3. 本地运行 `pnpm.cmd build`。
4. 运行 `output/deploy-remote.ps1` 更新远端。
5. 更新完成后验证 `/health` 和 `/auth/password-key`。
6. 更新完成后删除本地构建产物。

`output/` 已被 `.gitignore` 忽略。不得把服务器密码、生产 env、token 或私钥写入可提交文件。

## 完成报告

Coding 完成时必须说明：

1. 改了哪些文件。
2. 实现了什么行为。
3. contracts 是否变化。
4. 文档是否同步。
5. 跑了哪些验证命令。
6. 是否有未验证项。
7. 是否有剩余风险。

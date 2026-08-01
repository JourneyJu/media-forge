# 测试方案：资源与对象存储

## 目标

验证资源上传后立即持久化、Conversation 创建前暂存、发送绑定、刷新恢复、权限隔离、过期清理和会话删除联动。

## 单元测试

- object key 只由 tenant、user 和 resource ID 生成。
- 文件名不会进入 object key。
- MIME 白名单、文件签名、大小和数量限制。
- UploadSession 状态迁移和 24 小时过期计算。
- Resource 状态迁移 `uploading → staged → attached`。
- attached Resource 不能单独删除。

## PostgreSQL / MinIO 集成测试

- 上传后 PostgreSQL Resource 为 staged，MinIO 原图存在。
- 预览图可用时保存 preview key。
- 对象写入失败时 Resource 标记 failed，不返回伪成功。
- 数据库更新失败产生的对象由过期清理任务最终删除。
- 退出或重新进入页面不自动恢复旧 staged Resources，页面仍为空会话。
- 未自动恢复的 staged Resources 在 TTL 后被清理。
- attached Resource 不被 UploadSession TTL 清理。

## API 测试

- 只有 owner 可以读取 UploadSession、preview 和 content。
- 原文件和预览图通过 Service 流式返回。
- 上传和创建 UploadSession 幂等。
- 发送前可以删除 staged Resource。
- attached Resource 删除返回冲突。
- 超期 UploadSession 返回 410。

## 前端测试

- 选择或粘贴图片后立即显示上传状态。
- 1、4、5、10 张图片分别展示正确缩略图和 `+N`。
- 缩略图固定 `44 × 44`，不撑高输入区域。
- 发送成功后资源移动到用户消息气泡。
- 发送前失败保留可重试状态，发送后不显示单独删除按钮。

## 验证命令

```bash
pnpm --filter @mediaforge/contracts typecheck
pnpm --filter @mediaforge/service test
pnpm --filter @mediaforge/worker test
pnpm --filter @mediaforge/web test
```

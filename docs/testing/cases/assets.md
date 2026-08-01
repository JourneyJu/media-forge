# 测试用例：资源与对象存储

| ID | 场景 | 步骤 | 预期 |
| --- | --- | --- | --- |
| RES-001 | 创建暂存会话 | 调用 `POST /upload-sessions` | 返回 active UploadSession 和 24 小时过期时间，不创建 Conversation。 |
| RES-002 | 上传图片 | 上传合法 JPEG | MinIO 原图存在，PostgreSQL Resource 为 staged，返回预览地址。 |
| RES-003 | 粘贴图片 | 在输入框粘贴 PNG | 与文件选择走同一上传链路并持久化。 |
| RES-004 | 非法签名 | 声明 JPEG 但发送其他内容 | 返回 `RESOURCE_SIGNATURE_INVALID`，不作为可用素材。 |
| RES-005 | 文件过大 | 上传超过 10 MB 文件 | 返回 413，不完整保留对象。 |
| RES-006 | 重新进入页面 | 上传后退出并重新进入且未发送 | 页面展示新的空会话，不恢复旧 Resource，不产生历史；旧对象等待 TTL 清理。 |
| RES-007 | 发送前移除 | 删除 staged Resource | 资源从输入区移除，对象最终删除。 |
| RES-008 | 发送绑定 | 首次 Turn 带 Resource ID | Resource 更新为 attached，并绑定 Conversation 和 Message。 |
| RES-009 | 已发送资源删除 | 调用 staged 删除接口删除 attached Resource | 返回 `RESOURCE_ALREADY_ATTACHED`。 |
| RES-010 | 暂存过期 | 让 UploadSession 超过 TTL 并执行清理 | staged / failed 资源和对象被删除，attached 资源保留。 |
| RES-011 | 越权读取 | 用户读取他人 Resource | 返回 404。 |
| RES-012 | 紧凑展示 | 输入区添加 5 张图片 | 只显示前 4 张和 `+1`，点击后可查看全部。 |
| RES-013 | 多图展示 | 输入区添加 10 张图片 | 只显示前 4 张和 `+6`，布局不溢出。 |
| RES-014 | 会话级删除 | 删除包含多张图片的 Conversation | 所有 attached Resource 元数据、原图和预览图最终删除。 |

# 机器接口操作

## Machine operations

| 操作 | 用法 |
| --- | --- |
| `list_agents` | 按 `runId` 观察状态, 原生线程与回合身份, 保留期内的通知, 待处理请求, `cursor`, `completion` 和 `measurement`; 查询不启动审核 |
| `wait_agent` | `runId`, 已取得的 `cursor` 和可选 `timeout_ms`; 有更新即返回, 超时不代表 Reviewer 失败, 取消等待不停止审核 |
| `followup_task` | 向可靠原线程交付新一轮完整任务, 更新输入与报告绑定; 原线程已卸载时由管理进程内部恢复后开始新回合 |
| `send_message` | 向 `runId` 排入消息, 活动回合提供准确 `turnId`; 不唤醒空闲 Reviewer, 回合已变化时处理错误, 不改投替代线程 |
| `messages` | `runId` 和可选的 `direction`, `limit`, `beforeMessageId`; 回复不确定时据此决定等待, 重发或报告不确定 |
| `interrupt_agent` | `runId` 与当前 `turnId`; 中断活动工作或结束等待用户的暂停任务, 保留运行环境与原线程 |

- 回执超时或连接失败时, 不自动重发: 用 `messages` 查询发给该 Reviewer 的最近消息, 再决定等待, 重发或报告结果不确定. 查不到记录不能单独证明发送失败.
- `--wait` 命令在输出 `<id>:done` 前返回 (读到回执后工具超时或进程被终止) 不表示审核结束, 审核仍在运行; 工具会话丢失后重新连接同理: 用回执中的 `runId` 调 `list_agents` 取 `cursor` 观察, 再按需 `wait_agent` 续等, 直到 `completion` 非空. 原线程或原有路径与设置无法恢复时明确失败, 不静默新建线程.
- 从 `completion` 取得结果后读取绑定报告. 空报告或残留草稿不是有效结果; 收尾失败时按具体原因处理.

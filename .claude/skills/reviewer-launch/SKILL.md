---
description: Main Agent 启动, 跟进, 等待, 中断或恢复独立 Reviewer (Code Standards, 要求符合审核, Spec Readiness) 时使用: 固定审核版本, 准备报告路径, 调用 `arw background-agent` 机器接口, 处理长时间运行和暂停通知. Reviewer 自身不使用.
name: reviewer-launch
---

# Reviewer 启动与控制

Reviewer 的审核行为由 [Reviewer 责任](../../../docs/agents/reviewer.md) 和各 Canonical Role 规定. 本 Skill 只规定与用户沟通的 Main Agent 怎样准备和控制审核.

平台差异:

- Codex: 直接运行 `arw background-agent`. 输出 `Background Agent control is blocked by the sandbox` 时 (管理进程须在沙盒外启动, 沙盒禁用网络时连接也被拒绝), 申请提权在沙盒外重跑同一命令, 可按 `arw background-agent` 前缀申请长期批准; 审批策略为 `never` 等不能提权时停止, 请用户在可提权的会话中运行. 可以保留一个工具会话逐行写入请求, 长请求写入文件后用 `arw background-agent < <request.jsonl>` 发送. 管理进程在共享 Codex App Server 中为每个 Reviewer 创建独立根线程, 不占用 Main Agent 的原生子 Agent 槽位, 不用原生子 Agent 工具代替该入口.
- Claude Code: Bash 工具不保留可续写的进程会话, 每次操作单独运行一次 `arw background-agent`, 用文件或管道把 JSONL 请求写入标准输入; 等待较久的命令放进后台命令. 未选择 `anthropic` 的 Reviewer 设置在这里默认用 Claude 后端 `haiku` 和 `high`; Claude 后端 Reviewer 只用 `haiku`, 不用其他 Claude 模型. 不用 Claude Code 原生 subagent 代替独立 Reviewer.
- 两个平台: 标准输入结束后, 进程先等全部未返回的请求写出响应再退出, 管理进程和已启动的审核继续运行. `wait_agent` 的 `timeout_ms` 必须在 `10000` 到 `3600000` 之间; 同一进程内的请求 `id` 不能重复.

## Review rounds

Spec Readiness 和提交审核的每一轮由所属工作流的 `prepare` 写出审核轮目录: 固定版本的输入, 执行规则副本, 每个 Reviewer 的空报告和一行 `<role>.jsonl` 请求 (首轮 `spawn_agent`, 复审 `followup_task`). Main Agent 不手工拼请求或复制规则.

1. 运行 `cat <轮目录>/*.jsonl | arw background-agent --wait`; 只重审其中一个 Reviewer 时只传它的文件.
2. 每个请求先输出回执, 结束时再输出一行 `<id>:done`. `completion` 非空时读取其 `reportPath` 的报告; `completion` 为 `null` 而 `messages` 含 `source` 为 `provider-program` 的消息时按 [暂停通知](#long-running-and-paused-reviews) 处理; 来源为 `agent` 的是 Reviewer 的中途通知, 结果以报告为准; `ok: false`, `state: "exited"` 或 `providerError` 按具体原因处理.
3. 复审前修复并重新运行 `prepare`, 得到下一轮目录. 运行中的输入不改写, 未完成审核不当作通过.

## Other reviews

`code-review` 的独立比较等没有 `prepare` 的审核, 按审核轮目录的同样结构手工准备: 固定 `code-review` 规定的不可变 Git 对象, 在会话临时目录保存执行规则副本及来源路径和 SHA-256, 为报告分配只含空报告文件的独立目录, 然后调用 `spawn_agent`, `input` 提供:

- `role`: Canonical Role ID. `identity`: 普通审核为 `{kind: "ordinary", issueIds: [...]}`, `issueIds` 完整排序.
- `instructions`: 完整 Canonical Role 与 `docs/agents/reviewer.md` 内容. `handoff`: 所属审核工作流要求的全部审查输入.
- `cwd`: 当前 Git 仓库根目录, 省略 `readPaths`. `writePaths`: 只含报告目录. `reportPath`: 准确报告文件. `stateDirectory`: 已存在的会话临时目录, 不在 `writePaths` 内.

所有路径都是绝对路径. 模型设置由用户配置 `config.json` 和仓库 `arw.config.json` 决定, Main Agent 不覆盖; 只有 Reviewer Capability 和基准的隔离实例可以在 `settings` 中覆盖. 复审用 `runId` 加相同完整字段调用 `followup_task`; 只有 issue 身份集合改变, 原线程不可用或不可恢复, 或用户明确要求时, 才用 `newThread` 创建替代线程.

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
- 工具会话丢失后重新连接, 用 `list_agents` 和 `cursor` 观察, 再按需 `wait_agent`. 原线程或原有路径与设置无法恢复时明确失败, 不静默新建线程.
- 从 `completion` 取得结果后读取绑定报告. 空报告或残留草稿不是有效结果; 收尾失败时按具体原因处理.

## Long-running and paused reviews

- 普通审核从开始等待达到 30 分钟且 Reviewer 仍在运行时, 向用户报告当前状态及尚未核实的事实, 询问继续等待还是结束, 然后结束当前回复; 此后每 15 分钟再次询问. 用户决定前保持 Reviewer 运行, 不自行停止或替换.
- 收到累计主动早退暂停通知时, 向用户说明累计次数和暂停状态, 询问继续还是结束, 然后结束当前回复. 用户同意继续时用 `send_message` 向原任务发送工作指示; 要求结束时用 `interrupt_agent`. 等待决定期间只查询状态.

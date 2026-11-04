---
description: Main Agent 启动, 跟进, 等待, 中断或恢复独立 Reviewer (Code Standards, 要求符合审核, Spec Readiness) 时使用: 固定审核版本, 准备报告路径, 调用 `arw background-agent` 机器接口, 处理长时间运行和暂停通知. Reviewer 自身不使用.
name: reviewer-launch
---

# Reviewer 启动与控制

Reviewer 的审核行为由 `docs/agents/reviewer.md` 和各 Canonical Role 规定. 本 Skill 只规定与用户沟通的 Main Agent 怎样准备和控制审核.

平台差异:

- Codex: 直接运行 `arw background-agent`. 输出 `Background Agent control is blocked by the sandbox` 时 (管理进程须在沙盒外启动, 沙盒禁用网络时连接也被拒绝), 申请提权在沙盒外重跑同一命令, 首次提权时选择本会话内总是允许该命令 (沙盒禁网时每次调用都要提权), 或按 `arw background-agent` 前缀申请长期批准; 审批策略为 `never` 等不能提权时停止, 请用户在可提权的会话中运行. 可以保留一个工具会话逐行写入请求, 长请求写入文件后用 `arw background-agent < <request.jsonl>` 发送. 管理进程在共享 Codex App Server 中为每个 Reviewer 创建独立根线程, 不占用 Main Agent 的原生子 Agent 槽位, 不用原生子 Agent 工具代替该入口. 工具调用返回时 `--wait` 进程仍未结束, 对同一会话用空输入续等并取最长等待时间 (如 `yield_time_ms` 设为 `300000`), 进程退出即返回; 不用 `sleep`, 短间隔轮询或 `list_agents` 代替等待.
- Claude Code: Bash 工具不保留可续写的进程会话, 每次操作单独运行一次 `arw background-agent`, 用文件或管道把 JSONL 请求写入标准输入; 等待较久的命令用 Bash 工具自身的后台运行 (结束时有通知), 不用 shell `&`, `nohup` 或 `setsid` 脱离 (结束时没有通知). 未选择 `anthropic` 的 Reviewer 设置在这里默认用 Claude 后端 `haiku` 和 `high`. 不用 Claude Code 原生 subagent 代替独立 Reviewer.
- 两个平台: 标准输入结束后, 进程先等全部未返回的请求写出响应再退出, 管理进程和已启动的审核继续运行. `wait_agent` 的 `timeout_ms` 必须在 `10000` 到 `3600000` 之间; 同一进程内的请求 `id` 不能重复.

## Review rounds

Spec Readiness 和提交审核的每一轮由所属工作流的 `prepare` 写出审核轮目录: 固定版本的输入, 执行规则副本, 每个 Reviewer 的空报告和一行 `<role>.jsonl` 请求 (首轮 `spawn_agent`, 复审 `followup_task`). Main Agent 不手工拼请求或复制规则.

1. 运行 `cat <轮目录>/*.jsonl | arw background-agent --wait`; 只重审其中一个 Reviewer 时只传它的文件.
2. 每个请求先输出回执, 结束时再输出一行 `<id>:done`. `completion` 非空时读取其 `reportPath` 的报告; `completion` 为 `null` 而 `messages` 含 `source` 为 `provider-program` 的消息时按 Long-running and paused reviews 节处理; 来源为 `agent` 的是 Reviewer 的中途通知, 结果以报告为准; `ok: false` (含 `reviewer-not-ready`), `state: "exited"` 或 `providerError` 按具体原因处理; `reviewer-not-ready` 和 `incomplete` 都不是审核结果, 重派时重新 `prepare` 后重跑.
3. 复审前修复并重新运行 `prepare`, 得到下一轮目录. 运行中的输入不改写, 未完成审核不当作通过.

## 按需读取

- 审核没有 `prepare` 可用 (如 `code-review` 的独立比较) 时: 读取 `./other-reviews.md`.
- 用 `list_agents`, `wait_agent`, `followup_task`, `send_message`, `messages`, `interrupt_agent` 观察或控制 Reviewer, 或回执超时, 连接失败, `--wait` 提前返回时: 读取 `./machine-operations.md`.
- 启动批量, 基准或能力验证运行前: 读取 `./capacity-priority.md`.
- 启动因 `capacity is exhausted` 失败, 或启动后 2 分钟内没有回合开始时: 读取 `./capacity-priority.md`.

## Long-running and paused reviews

- 普通审核从开始等待达到 30 分钟且 Reviewer 仍在运行时, 向用户报告当前状态及尚未核实的事实, 询问继续等待还是结束, 然后结束当前回复; 此后每 15 分钟再次询问. 用户决定前保持 Reviewer 运行, 不自行停止或替换.
- 收到累计主动早退暂停通知时, 向用户说明累计次数和暂停状态, 询问继续还是结束, 然后结束当前回复. 用户同意继续时用 `send_message` 向原任务发送工作指示; 要求结束时用 `interrupt_agent`. 等待决定期间只查询状态.

# Claude 后端支持与 Main 双向通信

Status: ready-for-agent

## What to build

长期规范要求 Main 能用 `send_message` 给运行中的后台 Agent 发工作指示, 后台 Agent 也能主动通知 Main. Claude 后端 (ADR 0032, ticket 04) 每轮运行一次性的 `claude -p`, 作业从 stdin 一次写完即关闭, 运行中的指示一律拒绝 (`lib/background-agent/claude-sessions.mjs` 的 `steer`); Reviewer 只有读写文件工具, 也发不出通知. 进程 id 没有记录, 所以管理进程异常退出后冷启动无法核对旧进程, 库中有空闲 Agent 时每次请求都失败 ("Earlier App Server exit could not be confirmed").

用户决定 (2026-10-27) 选 A. 总要求: Claude 后台 Agent 必须实现规范 `Background Agent control` 下全部功能 (Machine entry, Communication, State, Capacity and recovery, listing), 与 Codex 后端对等, 不打折扣; 现有 Claude 后端因 ADR 0032 而缺失或降级的行为都要补齐, 不只限于下列各项.


- 先实测: `claude -p --input-format stream-json --output-format stream-json` 常驻进程在回合进行中收到 stdin 新消息时如何处理 (插入当前回合, 排队到回合后, 或报错). 实测结果决定 `send_message` 在活动回合上的语义, 写进本 ticket.
- 每个 Claude 后台 Agent 改为一个常驻进程. 规范 `Background Agent Communication` 中的各种消息都要覆盖, stdin 只解决其中一个方向:
  - Main 到 Agent 的工作指示 (`send_message`), 以及 Reviewer 运行程序和提供方程序自动产生的工作指示: 由管理进程从 stdin 送入活动回合; 空闲时 `followup_task` 开启新回合.
  - Agent 到 Main 的进度, 问题, 阻塞, 完成通知: Agent 自己调用 `arw background-agent send_message`. Claude Reviewer 现在只有读写文件工具, 需要只放行这一条命令 (`--allowedTools` 限定命令前缀), 进程环境提供 `ARW_BACKGROUND_AGENT_RUN_ID` 和根线程身份, 管理进程按身份核对来源.
  - 程序产生的暂停通知和管理状态通知 (开始, 结束, 故障, 中断, 待答复请求): 由管理进程从 stream-json 输出观察原生事实后发给 Main, 不依赖 Agent 发送; `list_agents` 和 `wait_agent` 仍须呈现回合结束或故障.
- 记录每个进程 id, 冷启动时按 id 核对旧进程是否已退出, 修复上述冷启动缺陷; 管理进程收到 SIGTERM 时正常退出.
- Codex 沙盒内首次调用 `arw background-agent` 时, 启动管理进程的命令请求提权, 在沙盒外运行, 不需人工预启动 (用户 2026-10-27).
- 设计定稿前交一个不低于 Main 的独立 Agent 复核; ADR 0032 中 "运行中指示被拒绝" 的决定由新 ADR 取代.
- ticket 18 测量中 Claude 后端在 `dontAsk` 模式下偶发拒绝 Read/Bash, 导致 Reviewer `incomplete` (2026-10-27, 三次); 一并查明原因并修复.
- 本 ticket 提交时一并把 issue 10 (先修好 `## Spec Requirement` 格式) 和 issue 16 设为 `completed`, 不补跑就绪审核 (用户 2026-10-27).

预估改动: 运行时代码约 +150/-60 行, 测试约 +100 行, 规范与 ADR 约 +40 行.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#background-agent-communication`
- `docs/specs/agent-repository-workflow/spec.md#capacity-and-recovery`

## Acceptance criteria

- [ ] 逐节对照 `Background Agent control` 列出 Claude 后端的每项缺失或降级, 全部补齐, 对照表记入 `## Comments`.
- [ ] stream-json 回合中插入消息的实测行为记入 `## Comments`.
- [ ] Claude 后端覆盖规范列出的全部消息形式 (Main 指示, 程序指示, Agent 主动通知, 程序暂停与管理状态通知), 有测试覆盖.
- [ ] 管理进程被结束后冷启动, 空闲的 Claude Agent 不再导致请求失败; 有测试覆盖.
- [ ] Codex 沙盒内首次调用能自动在沙盒外启动管理进程.
- [ ] Claude Code 和 Codex 各跑一次真实审核, 行为正常.
- [ ] 新 ADR 取代 ADR 0032 的相关决定; issue 10 和 16 为 `completed`.

## Blocked by

- None - can start immediately

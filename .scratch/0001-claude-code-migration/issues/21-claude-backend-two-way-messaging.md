# Claude 后端支持与 Main 双向通信

Status: ready-for-agent

## What to build

长期规范要求 Main 能用 `send_message` 给运行中的后台 Agent 发工作指示, 后台 Agent 也能主动通知 Main. Claude 后端 (ADR 0032, ticket 04) 每轮运行一次性的 `claude -p`, 作业从 stdin 一次写完即关闭, 运行中的指示一律拒绝 (`lib/background-agent/claude-sessions.mjs` 的 `steer`); Reviewer 只有读写文件工具, 也发不出通知. 进程 id 没有记录, 所以管理进程异常退出后冷启动无法核对旧进程, 库中有空闲 Agent 时每次请求都失败 ("Earlier App Server exit could not be confirmed").

用户决定 (2026-10-27) 选 A:

- 先实测: `claude -p --input-format stream-json --output-format stream-json` 常驻进程在回合进行中收到 stdin 新消息时如何处理 (插入当前回合, 排队到回合后, 或报错). 实测结果决定 `send_message` 在活动回合上的语义, 写进本 ticket.
- 每个 Claude 后台 Agent 改为一个常驻进程, 运行中的消息从 stdin 送入; 后台 Agent 向 Main 的通知按规范的 `agent-to-main` 通道实现 (所需最小工具放行由设计决定).
- 记录每个进程 id, 冷启动时按 id 核对旧进程是否已退出, 修复上述冷启动缺陷; 管理进程收到 SIGTERM 时正常退出.
- Codex 沙盒内首次调用 `arw background-agent` 时, 启动管理进程的命令请求提权, 在沙盒外运行, 不需人工预启动 (用户 2026-10-27).
- 设计定稿前交一个不低于 Main 的独立 Agent 复核; ADR 0032 中 "运行中指示被拒绝" 的决定由新 ADR 取代.
- 本 ticket 提交时一并把 issue 10 (先修好 `## Spec Requirement` 格式) 和 issue 16 设为 `completed`, 不补跑就绪审核 (用户 2026-10-27).

预估改动: 运行时代码约 +150/-60 行, 测试约 +100 行, 规范与 ADR 约 +40 行.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#background-agent-communication`
- `docs/specs/agent-repository-workflow/spec.md#capacity-and-recovery`

## Acceptance criteria

- [ ] stream-json 回合中插入消息的实测行为记入 `## Comments`.
- [ ] Claude 后端的运行中 `send_message` 和后台 Agent 到 Main 的通知按规范工作, 有测试覆盖.
- [ ] 管理进程被结束后冷启动, 空闲的 Claude Agent 不再导致请求失败; 有测试覆盖.
- [ ] Codex 沙盒内首次调用能自动在沙盒外启动管理进程.
- [ ] Claude Code 和 Codex 各跑一次真实审核, 行为正常.
- [ ] 新 ADR 取代 ADR 0032 的相关决定; issue 10 和 16 为 `completed`.

## Blocked by

- None - can start immediately

# 用 headless `claude -p` 运行 Claude Reviewer

ARW 要求在 Codex 和 Claude Code 中都能完整使用 `arw background-agent`. [ADR 0016](0016-use-repository-owned-agent-projection-configs.md) 曾把 Claude Code 的原生 Reviewer 执行定为暂停, [ADR 0030](0030-use-user-wide-background-agent-management.md) 只让用户级管理进程管理一个共享 Codex App Server. 本决定取代 ADR 0016 中 "Claude Code Reviewer 执行暂停" 的决定, 并把 ADR 0030 的管理范围扩展到 Claude 后端; 两份 ADR 的其他决定保持不变.

用户级管理进程按 Reviewer 设置选择后端: `modelProvider` 为 `anthropic` 时使用 Claude 后端, 其他提供方继续使用现有共享 Codex App Server. 两种后端实现同一 `NativeSessions` 接口, `arw background-agent` 的 JSONL 机器接口和 `arw lba` 的输出不变. Claude Code 中的 Main Agent 调用时, 设置解析结果未选择 `anthropic` 的 Reviewer 使用 Claude 默认值 `haiku` 和 `high`; Codex 中的 Main Agent 继续默认 `gpt-6-luna` 和 `xhigh`.

Claude 后端没有常驻服务. 每个 Reviewer 回合运行一次 headless `claude -p --output-format stream-json --verbose`: 首轮用 `--session-id` 建立会话, 跟进用 `--resume` 续接同一会话, 结果事件的文本就是 Reviewer 的最终状态. 工作目录是审核仓库, `--tools` 只提供读文件和写文件工具, `--permission-mode dontAsk` 拒绝未预先允许的操作, `--allowedTools` 只允许编辑获准的报告目录, `--setting-sources ''` 和 `--strict-mcp-config` 不让用户或仓库设置与 MCP 扩大权限. Claude 不支持运行中追加指令, 因此运行中的指示被拒绝, 跟进只能在本轮结束后以新一轮交付; 中断以结束该回合进程实现.

共享 App Server 生命周期, 模型目录合并和 Strata key 租约仍只属于 Codex 后端, Claude 后端不启动也不观察共享 App Server.

## Rejected alternatives

- 不使用 Claude Code 原生 subagent 运行 Reviewer. 它依附与用户沟通的 Main Agent 会话, 不满足独立根会话与跨调用方管理的要求.
- 不为 Claude 后端维持常驻 `stream-json` 输入进程以支持运行中追加指令. 进程生命周期与恢复会变成第二套共享服务, 而 Reviewer 跟进只在回合结束后发生.

## Consequences

Claude Reviewer 的权限依赖 Claude Code 的工具与权限规则, 是有界工作流保证, 不声称抵抗恶意运行环境. 用户级配置中的 Codex 默认值与显式 Codex 设置无法区分, 所以 Claude Code 中的 Main Agent 只有显式选择 `anthropic` 才会改用配置中的模型; 从 Claude Code 选择 Codex Reviewer 需要另行设计配置.

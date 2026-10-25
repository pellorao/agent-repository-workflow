# Claude 后端跑通 Reviewer

Status: ready-for-agent

## What to build

`arw background-agent` 按 Reviewer 配置选择后端. 新增 Claude 后端实现 `NativeSessions`, 每个 Reviewer 会话运行一次 headless `claude -p` (`stream-json`, `--session-id`, `--resume`, `--allowedTools`, `--permission-mode`); 跟进以续接实现, 中断以结束进程实现. Claude 默认 `haiku` / `high`. `arw lba` 显示两种后端的 Reviewer. 写新 ADR 取代 ADR 0016 的暂停决定并修订 ADR 0030 的范围.

预估改动: 约 800 行.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#platform-and-reviewer-runtime`

## Acceptance criteria

- [ ] 在 Claude Code 中经 `arw background-agent` 能启动, 跟进, 等待和中断一个 Reviewer, `arw lba` 可见.
- [ ] Codex 后端行为不变.
- [ ] 用假 `claude` 脚本覆盖新建, 续接, 中断和失败退出.
- [ ] 新 ADR 已写入.

## Blocked by

- 01 Claude Code 会话身份

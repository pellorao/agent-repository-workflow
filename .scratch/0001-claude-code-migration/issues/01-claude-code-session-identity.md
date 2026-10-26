# Claude Code 会话身份

Status: completed

## What to build

在 Claude Code 中运行的 Main Agent 能取得稳定的会话身份, 使临时工作区 `.tmp/claude-code/<sessionId>/` 和 Spec Readiness 准备在 Claude Code 中可用. 先实测 Claude Code 是否提供会话环境变量; 没有时由投影的 `SessionStart` hook 把 `session_id` 写入 `CLAUDE_ENV_FILE`. 只实现实测选中的一种.

预估改动: 约 150 行.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#platform-and-reviewer-runtime`

## Acceptance criteria

- [x] 实测结论记入本 issue 的 `## Comments`.
- [x] Claude Code 环境中 `getCurrentAgentIdentity()` 返回会话身份, Codex 行为不变.
- [x] 相关测试通过.

## Blocked by

- None - can start immediately

## Comments

- 2026-10-26 实测 (Claude Code 2.1.310, WSL): Bash tool 子进程环境中有 `CLAUDECODE=1` 和 `CLAUDE_CODE_SESSION_ID=<uuid>`. 该值与本会话 scratchpad 路径中的会话 id 一致, 子 agent 中读到的也是父会话的同一个值, 可作稳定会话身份. 因此选用环境变量路线, 不实现 `SessionStart` hook.
- 平台判定: 新增 `createCurrentPlatformAdapter()`, `CLAUDECODE === '1'` 时用 `claude-code` 适配器读 `CLAUDE_CODE_SESSION_ID`, 否则沿用 Codex 适配器读 `CODEX_THREAD_ID`. 原先固定用 Codex 适配器取身份的调用点全部改为它. `arw background-agent` 在 Claude Code 中仍按原逻辑报 "currently requires Codex", 留给 Claude 后端 ticket.

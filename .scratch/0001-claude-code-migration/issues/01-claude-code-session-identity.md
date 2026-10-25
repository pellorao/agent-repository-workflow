# Claude Code 会话身份

Status: ready-for-agent

## What to build

在 Claude Code 中运行的 Main Agent 能取得稳定的会话身份, 使临时工作区 `.tmp/claude-code/<sessionId>/` 和 Spec Readiness 准备在 Claude Code 中可用. 先实测 Claude Code 是否提供会话环境变量; 没有时由投影的 `SessionStart` hook 把 `session_id` 写入 `CLAUDE_ENV_FILE`. 只实现实测选中的一种.

预估改动: 约 150 行.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#platform-and-reviewer-runtime`

## Acceptance criteria

- [ ] 实测结论记入本 issue 的 `## Comments`.
- [ ] Claude Code 环境中 `getCurrentAgentIdentity()` 返回会话身份, Codex 行为不变.
- [ ] 相关测试通过.

## Blocked by

None - can start immediately

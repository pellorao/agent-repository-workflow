# Codex Main 的等待截断与标题缺失

Status: needs-triage

## What to build

ticket 21 冒烟 (2026-10-27) 发现两处 Codex Main 侧与规范不符:

- `codex exec` 作 Main 时, `arw background-agent --wait` 在 Reviewer 完成前就被命令工具截断返回, 运行本身照常完成. 规范要求 `wait_agent` 等到原生回合结束; 需要查明截断来源 (Codex 命令工具超时或输出处理) 并修正, 使 Codex Main 能可靠等到审核结束.
- Codex Main 配 Claude 后台 Agent 时, App Server 未运行则 `list_agents` 标题显示 N/A. Main 标题应与 App Server 是否运行无关.

预估净增约 60 行.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#background-agent-communication`
- `docs/specs/agent-repository-workflow/spec.md#background-agent-listing`

## Acceptance criteria

- [ ] Codex Main 用 `--wait` 等待一个约 10 分钟的真实审核, 在审核结束后才返回.
- [ ] App Server 未运行时, Codex Main 配 Claude Agent 的列表标题正确.

## Blocked by

- None - can start immediately

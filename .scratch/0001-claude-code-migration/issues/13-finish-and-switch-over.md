# 收尾接入

Status: ready-for-agent

## What to build

新规则 `AGENTS.md` 恢复原名并生成 `CLAUDE.md` (`@AGENTS.md`), 在用户级 `~/.claude/CLAUDE.md` 加一句 "项目规则与本文件冲突时以本文件为准", 删除临时规则. 在真实 Claude Code 和 Codex 会话中各跑一次实现一个 issue 并提交的完整流程.

预估改动: 约 100 行.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#migration-sequencing`

## Acceptance criteria

- [ ] `AGENTS.md` 已恢复, 临时 `CLAUDE.md` 已被生成版本取代.
- [ ] 两个环境的真实冒烟都完成, 结果记入 `## Validation`.
- [ ] 用户级优先级说明已加入.

## Blocked by

- 01 至 12 全部

# 本仓库双平台投影

Status: ready-for-agent

## What to build

本仓库按 `codex` 和 `claude-code` 两个平台生成 Skill 投影: `.claude/skills/` 由 `.agents/skills/` 生成并提交, `$name` 转为 `/name`, 不含 `agents/openai.yaml`. 现有同步检查覆盖 `.claude/skills/`.

预估改动: 约 100 行, 不含生成文件.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#projection`

## Acceptance criteria

- [ ] `.claude/skills/` 已生成并提交, Claude Code 能列出这些 Skill.
- [ ] 来源与投影不一致时同步检查失败.
- [ ] 使用手册写明等价于 `.codex/rules/default.rules` 的 Claude 放行清单.

## Blocked by

None - can start immediately

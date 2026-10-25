# 本仓库双平台投影

Status: completed

## What to build

本仓库按 `codex` 和 `claude-code` 两个平台生成 Skill 投影: `.claude/skills/` 由 `.agents/skills/` 生成并提交, `$name` 转为 `/name`, 不含 `agents/openai.yaml`. 现有同步检查覆盖 `.claude/skills/`.

预估改动: 约 100 行, 不含生成文件.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#projection`

## Acceptance criteria

- [x] `.claude/skills/` 已生成并提交, Claude Code 能列出这些 Skill.
- [x] 来源与投影不一致时同步检查失败.
- [x] 使用手册写明等价于 `.codex/rules/default.rules` 的 Claude 放行清单.

## Blocked by

None - can start immediately

## 实施记录

- 生成: `node scripts/project-claude-skills.mjs`; 检查: `node scripts/project-claude-skills.mjs --check`, 并由 `tests/source-layout.test.mjs` 在 `pnpm test` 中执行.
- 复用 `createClaudeCodePlatformAdapter().evaluate`, 配置取自 `distribution/projections/config.json`.
- `.gitignore` 忽略 `.claude/worktrees/` 和 `.claude/settings.local.json`.
- `claude -p` 实测列出全部未设 `disable-model-invocation` 的 13 个 Skill; 其余 12 个只供用户 `/name` 调用, 不进入模型列表.
- 偏离: 未并入 `sync-workflow-distribution.mjs`/`check-workflow-distribution.mjs`, 改为独立脚本 (代码更少). 改 `.agents/skills/` 后需另行运行生成命令, 漏跑由 `pnpm test` 拦下.
- `arw.config.json` 的 `languageChecks.default.exclude` 加入 `.claude/skills/**`, 投影与来源相同, 不重复检查.

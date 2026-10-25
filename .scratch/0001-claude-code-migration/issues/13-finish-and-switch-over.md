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
- [ ] README 写明升级说明: `code-spec-reviewer` 和 `commit-audit-reviewer` 已并入 `requirements-reviewer`, 原先给它们设的模型需改到新角色; ADR 0023 加状态说明并修正失效锚点.
- [ ] 卸载后不再残留空的 background-agent-state 目录.
- [ ] 在旧版目标仓库上运行 `arw workflow update` 时, 已删除规则文档中的仓库自有内容不丢失: 迁入入口文件的仓库自有区域, 并在交接输出中提示用户核对.

- `reviewer-launch` Skill 中 Claude Code 一条仍写着 "只支持 Codex": 按 Claude Code Main 实际驱动 `arw background-agent` 的方式改写, 并在 smoke 中实测.
- Spec Readiness 记录升到版本 7 后, 下游仓库未提交 issue 的旧记录 (含 `not-applicable` 例外) 会被判为过期, 需重新生成: 在 README 升级说明中写明.

## Blocked by

- 01 至 12, 14 全部

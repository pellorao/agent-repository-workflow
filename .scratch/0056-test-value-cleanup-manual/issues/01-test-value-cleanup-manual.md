# test-value-cleanup 改为只能手动触发

Status: completed

## What to build

把 `test-value-cleanup` Skill 改为只能由用户显式调用 (用户 2026-11-03 决定; 其余 Skill 触发方式不变). 该 Skill 只在用户主动要求清理低价值测试或维护者每周例行清理时使用, 改为手动可减少 Agent 在普通测试工作中的误触发. 具体改动: `.agents/skills/test-value-cleanup/SKILL.md` 前置元数据加 `disable-model-invocation: true`, `agents/openai.yaml` 的 `policy.allow_implicit_invocation` 改为 `false`; `description` 按 `writing-for-agents` 的用户调用做法改为面向人的一行摘要, 去掉触发条件: "清理低价值测试: 固定范围和基数, 按相对价值删除测试, 记录损失并完成完整命令耗时验收."; 用 `node scripts/project-claude-skills.mjs`, `node scripts/sync-workflow-distribution.mjs`, `node scripts/generate-install-arw.mjs` 重新生成 `.claude/skills/` 与 `distribution/` 副本, 不手改生成物; `docs/manuals/skills.md` 与 `docs/manuals/skills.zh-CN.md` 中该 Skill 的小节标题改为 "name it explicitly" / "需显式点名", 与其他手动 Skill 一致.

体积预算: 源文件 3 行改动 (1 行新增, 2 行修改), 两份手册各改 1 行标题; 不新增代码, 不增加文档篇幅.

## Acceptance criteria

- [x] `SKILL.md` 含 `disable-model-invocation: true` 且 `description` 为不含触发条件的一行摘要, `openai.yaml` 为 `allow_implicit_invocation: false`.
- [x] `.claude/skills/` 与 `distribution/` 副本由脚本重新生成并与源一致.
- [x] 两份手册把该 Skill 标为需显式点名.
- [x] 验证命令退出码 0.

## Blocked by

None.

## Validation

- 验收 1: `.agents/skills/test-value-cleanup/SKILL.md` frontmatter 含 `disable-model-invocation: true`, `description` 为上述一行摘要; `.agents/skills/test-value-cleanup/agents/openai.yaml` 的 `allow_implicit_invocation: false`.
- 验收 2: 副本 `.claude/skills/test-value-cleanup/SKILL.md`, `distribution/skills/test-value-cleanup/SKILL.md`, `distribution/skills/test-value-cleanup/agents/openai.yaml` 由 `node scripts/project-claude-skills.mjs` 与 `node scripts/sync-workflow-distribution.mjs` 生成, `--check` 与 `node scripts/check-workflow-distribution.mjs` 通过.
- 验收 3: `docs/manuals/skills.md` 与 `docs/manuals/skills.zh-CN.md` 中该 Skill 的小节标题改为需显式点名.
- `pnpm typecheck`, `pnpm test`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check` 退出码均为 0.
- 体积: 源文件净增 1 行 (`disable-model-invocation`) 加 2 行修改 (`description`, `allow_implicit_invocation`), 两份手册各改 1 行标题, 无新增代码; 生成物由脚本生成.
- Spec Readiness: 记录 `not-applicable` 例外 (用户 2026-11-02 常设确认).
- 只删减与合并的自查: 改动已是最小, 无可再删减内容.

## Comments

- 提交审核第 1 轮: Code Standards 指出手动 Skill 的 `description` 应按 `writing-for-agents` 改为人读摘要, 已改并纳入 What to build, 验收与预算; 因 subject 改动重新记录 `not-applicable`.

# 发布验证基线不再限制多余程序

Status: completed

## What to build

用户 2026-11-03 要求: 真实操作系统里的程序各式各样, 发布验证的 VM 基线不限制复杂度. Guest requirements 只列 ARW 真正依赖的程序及版本, 没有列出的程序有无与版本都不影响验证; guest 检查本身不得调用 pnpm, TypeScript 或 Agent CLI; 保留 "客户机不需要外网, 候选只经 bundle 和压缩包传入".

- `.agents/skills/release/references/vm.md` Guest requirements 的 "不安装或启动 Agent CLI, 不安装 pnpm, TypeScript 或其他源码仓库开发依赖" 一条改为上述内容 (`.claude/skills/` 投影用 `node scripts/project-claude-skills.mjs` 更新).
- `docs/specs/agent-repository-workflow-release/spec.md` 第 15 行 (Release procedure 第 3 步) 与 Validation coverage 表中 "受验系统不安装 Agent CLI" 的理由, `.agents/skills/release/SKILL.md` 第 8 步括注, `scripts/release-guest-check.mjs` 中 "受验系统没有 Agent CLI" 的注释, 去掉同义的限制 (guest 检查不调用这些工具的规则只由 vm.md 陈述, 其他处不复述); 脚本注释改为 "guest 检查不调用 Agent CLI".

体积预算: 文档净增不超过 100 字符 (`wc -m`); 注释一行替换, 非测试代码行数不变.

预期验证: `node arw.mjs text check`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node arw.mjs terms check --strict`, `git diff --check`, `node arw.mjs language inspect` 改动的文档, `node --test tests/release/release-vm.test.mjs`.

## Acceptance criteria

- [x] vm.md Guest requirements 不再要求不安装 Agent CLI, pnpm, TypeScript 或开发依赖, 写明未列出的程序不影响验证, 写明 guest 检查不调用这些工具, 保留无需外网和只经 bundle 与压缩包传入 (审核核对文字).
- [x] 发布 spec, release Skill 和 guest 脚本注释中不再有 "受验系统不安装 Agent CLI" 一类同义限制 (grep 核对).
- [x] 上述验证命令退出码 0, `.claude` 投影与源一致.

## Blocked by

None.

## Validation

- `node arw.mjs text check`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check` (先运行投影), `node arw.mjs terms check --strict`, `git diff --check`, `pnpm typecheck` 通过; `node --test tests/release/release-vm.test.mjs` 8/8 通过; `node arw.mjs language inspect` 三份文档均以中文为主 (81.9% 至 85.3%).
- 体积 (`wc -m`): vm.md +34, 发布 spec -55, release Skill -19, 合计净减 40 字符; 脚本只替换一行注释 (`git diff --numstat` 1/1).
- grep `不安装 Agent CLI|不安装或启动` 在 `docs`, `.agents`, `scripts`, `README*` 中无剩余.
- Spec Readiness: `not-applicable` 例外 (用户 2026-11-02 常设确认), `arw spec-readiness verify` 通过.
- 只删减与合并的自查: 去掉发布 spec 第 15 行和表格理由, release Skill 第 8 步括注中的同义限制, 脚本注释一行改写; vm.md 条目整条改写为 "以上之外的程序有无与版本都不影响验证 ...; guest 检查本身不调用 pnpm, TypeScript 或 Agent CLI ...", 是该规则唯一的权威陈述.

## Comments

- 提交审核第 1 轮 2 条均修复: guest 检查不调用工具的规则只留在 vm.md, 发布 spec 第 15 行和 release Skill 第 8 步不再复述; `## Validation` 自查记录改为如实描述. `## What to build` 随之调整, 已重新记录 `not-applicable`.
- 台账: .scratch/0052-vm-baseline-no-extra-program-limit/issues/01-vm-baseline-no-extra-program-limit.md:10 冲突裁决 第 1 轮 code-standards 要求单一权威来源, 规则只留 vm.md, 其他处删去复述而非改写; Main 接受范围调整

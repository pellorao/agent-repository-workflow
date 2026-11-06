# 产品版本推进到 0.5.4

Status: completed

## What to build

0.5.3 已发布并通过公开 Bootstrap 验证. 按 `release` Skill 第 5 节, 把根 `package.json` 的 `version` 从 `0.5.3` 推进到下一个开发版本 `0.5.4`, 运行 `node scripts/generate-install-arw.mjs`, 之后源码安装的 `-pre` 身份为 `0.5.4-pre`.

预估净增: 0 行 (一行替换).

## Acceptance criteria

- [x] 根 `package.json` 的 `version` 为 `0.5.4`, 其余内容不变.
- [x] `node scripts/generate-install-arw.mjs` 已运行, `--check` 通过.
- [x] 全量测试, 类型检查, 分发检查, `arw text check` 通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test` 934 通过 / 0 失败; `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check` (即 `arw text check`), `git diff --check` 通过.
- `node scripts/generate-install-arw.mjs` 运行后 `scripts/install-arw.mjs` 没有变化.
- 净增: 代码 +1 / -1 (净 0).

## Comments

- 就绪记录为 `not-applicable` 例外 (无设计决定的单 issue, 用户 2026-11-02 在 projects AGENTS 中对此类 issue 的常设确认), 在修改 `package.json` 前生成.
- 本 issue 只做 `release` Skill 第 5 节的版本推进; 同节的发布版本 fixture 更新作用于仓库外的 fixturesDirectory, 结果 (`agent-assisted.tgz` 与 tag `arw-0.5.3`) 记入发布准备 issue `.scratch/0098-version-0-5-3/issues/01-version-0-5-3.md` 的 `## Comments`.

# 产品版本推进到 0.5.3

Status: completed

## What to build

0.5.2 已发布并通过公开 Bootstrap 验证. 按 `release` Skill 第 5 节, 把根 `package.json` 的 `version` 从 `0.5.2` 推进到下一个开发版本 `0.5.3`, 运行 `node scripts/generate-install-arw.mjs`, 之后源码安装的 `-pre` 身份为 `0.5.3-pre`.

预估净增: 0 行 (一行替换).

## Acceptance criteria

- [x] 根 `package.json` 的 `version` 为 `0.5.3`, 其余内容不变.
- [x] `node scripts/generate-install-arw.mjs` 已运行, `--check` 通过.
- [x] 全量测试, 类型检查, 分发检查, `arw text check` 通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test` 920 通过 / 0 失败; `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check` 通过.
- `node scripts/generate-install-arw.mjs` 运行后 `scripts/install-arw.mjs` 没有变化.
- 净增: 代码 +1 / -1 (净 0).

- 发布验证 (候选 `c402a34ce334912f4377ab0f800be91c837a4889`, 均为 0.5.2 升级到 0.5.3):
  - `PASS win32 node 24.18.0 0.5.3 c402a34ce334912f4377ab0f800be91c837a4889`
  - `PASS linux node 24.18.0 0.5.3 c402a34ce334912f4377ab0f800be91c837a4889` (Ubuntu)
  - `PASS linux node 24.17.0 0.5.3 c402a34ce334912f4377ab0f800be91c837a4889` (Alpine)
- 本地检查: `pnpm typecheck`, `pnpm test` (934 通过, 0 失败), 分发检查, `generate-install-arw --check`, `arw text check`, `arw terms check --strict`, `arw language inspect distribution` 通过 (各文档中文占比最低约 71%, 为外部拷贝的 `codebase-design`, 其余均在 80% 以上, 没有英文为主的文档).
- Fixture: plain 按 `references/fixtures.md` 的参数 `workflow init` 后 `workflow verify` 通过; agent-assisted (`arw-0.5.2`) 由 guest 检查覆盖.
- Agent CLI 检查: 隔离 home 安装候选, `workflow init` 后 `claude -p` 与 `codex exec` 的回答都含 `implement` 与 `Agent Repository Workflow`.
- 交接冒烟 (第 9 步, run): plain fixture 经隔离 home 的 `arw` 做 `workflow init`, `claude -p` 完成 Post-init handoff 后, `arw workflow verify` 退出 0; `arw list issues --all-statuses --full` 退出 0, 1 个 issue 行对 1 个 issue 文件; `git diff --name-status --no-renames <base>` 没有非 `A` 的文件.
- 发布: tag `0.5.3` 与 main 指向候选, GitHub Release 含 `arw.tar.gz`; 公开 Bootstrap (指定版本与最新) 安装后 `arw --version` 均输出 `0.5.3`.

## Comments

- 就绪记录为 `not-applicable` 例外 (无设计决定的单 issue, 用户 2026-11-02 在 projects AGENTS 中对此类 issue 的常设确认), 在修改 `package.json` 前生成.
- 本 issue 只做 `release` Skill 第 5 节的版本推进; 同节的发布版本 fixture 更新作用于仓库外的 fixturesDirectory, 结果 (`agent-assisted.tgz` 与 tag `arw-0.5.2`) 记入发布准备 issue `.scratch/0038-version-0-5-2/issues/01-version-0-5-2.md` 的 `## Comments` (提交审核第 10 轮 requirements-reviewer 的问题按此处理).
- 第 9 步 (交接冒烟): run (维护者 2026-11-07 授权).
- 第 10 步 (Reviewer 能力漂移检查): skip (维护者 2026-11-07 授权).
- 发布后 fixture 更新 (2026-11-07): `agent-assisted.tgz` 已按 `references/fixtures.md` 更新到 0.5.3, fixture 内提交 `5136ba6` 加 tag `arw-0.5.3`, `workflow update` 与 `verify` 通过; `plain.tgz` 未改.

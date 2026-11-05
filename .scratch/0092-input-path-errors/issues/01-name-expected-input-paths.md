# 输入路径报错写明期望位置

Status: completed

## What to build

把输入文件放错位置的错误信息改为写明期望位置, 并在两个 Skill 中各用一句话写明位置. 不改校验条件, 不含设计决定.

1. `lib/spec-readiness/spec-readiness.mjs` 的 `generateSpecReadiness`: Exception 草稿不在当前 Agent 临时工作区时, 错误信息写出该工作区的绝对路径 (`workspace()` 返回的目录), 并说明草稿须是其中的 JSON 文件. 输入路径不是绝对路径的错误同样写出这个目录.
2. `lib/commit-audit/commit-audit.mjs` 的 `prepareCommitAudit`: 路径不合格时错误信息写明规则 `<仓库根>/.tmp/<目录>/input.json` (文件名必须是 `input.json`, 位于仓库 `.tmp/` 下, 绝对路径), 其中仓库根用实际绝对路径, 并带上收到的路径.
3. `.agents/skills/spec-readiness/exception-workflow.md` 用一句话写明例外草稿放在 `.tmp/<agent-platform>/<sessionId>/<NNNN>_<NN>/spec-readiness/` 下 (当前会话的 spec-readiness 临时工作区). `.agents/skills/commit/implementation-workflow.md` 的 Run 第 1 步用一句话写明 `input.json` 的路径形式 `<仓库根>/.tmp/<目录>/input.json`.
4. 同步 `distribution/` 副本, `.claude/skills` 投影和生成的安装脚本.

测试先行: 两条错误信息各一个失败测试 (先红后绿), 断言信息含期望位置. 不新增其他测试.

预算: 非测试代码净增不超过 3 行; 文档字符净增不超过 300 (源文件 `.agents/` 与 `docs/`, 不含生成副本); 测试不计.

预期验证: 新增测试, `node --test tests/spec-readiness tests/commit-audit`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check`.

## Acceptance criteria

- [x] 两条错误信息写明期望位置, 且有先红后绿的测试.
- [x] 两个 Skill 文件各有一句位置说明, 源文件, `distribution/` 副本和 `.claude/skills` 投影一致.
- [x] 预期验证全部通过.

## Blocked by

- None - can start immediately

## Comments

用户 2026-11-02 已确认这类不含设计决定的合并 issue 不需要治理设计 (就绪记录 `not-applicable`). Main 授权本任务自主实施 (`.tasks/ARW/patherr.md`); 来源是 `common/mainctx` 11-05 复盘 "重复出现的问题": 11-04 共 13 次因输入文件位置放错而失败.

实测净增 (`commit-audit prepare`): 非测试代码 0 行, 文档 +146 字符 (源文件 `.agents/`; 含 `distribution/` 与 `.claude/skills` 生成副本共 +438), 测试 +19 行. 提交审核第 1 轮两个 Reviewer 均为 `No problems.`.

## Validation

- 先红后绿: `tests/spec-readiness/spec-readiness.test.mjs` 的 `exception input outside the Agent workspace names the expected directory` 和 `tests/commit-audit/cli.test.mjs` 的 `prepare names the expected input.json location when the path is wrong` 在改实现前失败, 改后通过; `node --test tests/spec-readiness/*.test.mjs tests/commit-audit/*.test.mjs` 63 通过.
- `pnpm test` 908 通过, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0092-input-path-errors/`, `git diff --check` 通过.
- Skill 位置说明: `.agents/skills/spec-readiness/exception-workflow.md` 与 `.agents/skills/commit/implementation-workflow.md` 各改 1 句, `distribution/` 与 `.claude/skills` 副本由同步脚本生成.

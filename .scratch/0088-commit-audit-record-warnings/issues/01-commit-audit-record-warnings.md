# prepare 提示记录与实测不符的体积数字和缺失的验收命令记录

Status: completed

## What to build

按本 effort 的 spec 实现: `arw commit-audit prepare` 在标准错误的体积摘要之后, 对每个授权 issue 输出以 `warning:` 开头的行, 指出 (a) `## Validation` 中以摘要标题行格式 (`<类别>: <数字> lines|characters`) 写下的 `code:`, `documents:`, `tests:` 数字与本次候选实测不同, (b) 已勾选的验收项里 `pnpm`, `node`, `arw`, `git` 开头的行内命令在 `## Validation` 中没有出现. 识别规则, 比较对象, 警告输出位置与顺序, 不阻断, 不进入 `request.json` 和 Reviewer 交接, 都见 spec 的 Implementation Decisions. 没有不符时摘要逐字不变, 标准输出不变.

同一 issue 内的配套修改:

- Issue Documents Module 导出具名常量 `CHECKED_TASK_MARKER` (其规范化验收标记使用的已勾选标记模式), 规范化与新比对共用它, 规范化输出不变; 章节定位用它已导出的函数. 长期规范 Issue Documents Module 的接口描述增加这个常量. 见 spec 的 Module Design.
- 长期规范 `docs/specs/agent-repository-workflow/spec.md` 的 Commit Audit 一节写明这两类警告并完整写出识别规则 (使长期文档自足), Commit Audit Module 的责任描述增加这项只读比对; 该节中 "`verify` 也不检查 issue 中的数字" 保持成立.
- 通用提交工作流 Skill 的 Run 一节在 `prepare` 一步增加一句: 标准错误中的 `warning:` 行逐条核对, 只是提示, 不是关卡. 该 Skill 的 `.claude` 投影和 Workflow Distribution 副本与源文件保持同样文字, 由 `node scripts/project-claude-skills.mjs --check` 和 `node scripts/check-workflow-distribution.mjs` 验证一致.

预期验证:

- 在 Commit Audit 现有测试夹具上增加一个测试: 授权 issue 的 `## Validation` 含不符的 `code:` 数字, 相符的 `tests:` 数字 (均带单位词), 无单位词的数字和自由文字写的数字, `## Acceptance criteria` 含不同列表符, 缩进, 围栏内, 未勾选和格式不合的行, 具体场景见 spec 的 Testing Decisions; 观察 `prepare` 的摘要末尾恰有三行警告, 其余情形不产生警告, `prepare` 不失败. 现有摘要测试不改断言即通过, 证明没有警告时输出逐字不变.
- 运行 `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check`, `arw terms check --include .scratch/0088-commit-audit-record-warnings/`.

相关边界: issue 没有 `## Validation` 章节时按空文本处理; 数字不带符号时视为正数; 同一类别出现多次时逐个比较; 未勾选的验收项不检查.

体积预算: 非测试代码净增约 40 行 (章节与片段识别, 比对与格式化约 36 行, 摘要计算返回类别合计约 4 行, 共用已勾选标记定义约 +1 行); 文档约 1200 字符 (长期规范约 900, Skill 约 100 且含两份副本).

## Acceptance criteria

- [x] `prepare` 在摘要之后为每个不符输出一行 `warning:`: 记录的 `code:`, `documents:`, `tests:` 数字与本次候选实测不同, 或已勾选验收项的 `pnpm`, `node`, `arw`, `git` 命令在 `## Validation` 中缺失; 相符的数字, 自由文字数字, 已出现的命令和未勾选的项不产生警告.
- [x] 警告不使 `prepare` 失败, 不改变退出码, 标准输出, `request.json`, Reviewer 交接和 `verify`; 没有不符时摘要逐字不变.
- [x] 长期规范和提交工作流 Skill (含投影与分发副本) 已同步, 相关检查脚本全部通过; `pnpm test` 和 `pnpm typecheck` 通过.

## Blocked by

- None - can start immediately

## Validation

- Test first: the new Commit Audit test failed before the change (no `warning:` lines) and passes after it; the existing summary test passes unchanged, and the Issue Documents normalization tests pass unchanged after the shared `CHECKED_TASK_MARKER`.
- `pnpm test`: 906 tests passed (904 before, +2 new). `pnpm typecheck` passed.
- `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check` and `node scripts/generate-install-arw.mjs --check` passed. `node arw.mjs text check` passed. `node arw.mjs terms check --include .scratch/0088-commit-audit-record-warnings/` passed. `git diff --check` clean.
- Measured net growth (`git diff --numstat` of the candidate, `.scratch` excluded): code +20 lines (commit-audit.mjs +17, issue-documents.mjs +3), documents +1012 characters (long-term spec +907, the three commit Skill copies +35 each), tests +29 lines.

## Comments

- The code budget in What to build (about 40 lines) was an overestimate: the implementation puts both warnings in one small function and reuses `locateSections`, `findUnfencedLineIndexes` and the new shared `CHECKED_TASK_MARKER`, so the measured non-test code is +20. The document budget (about 1200 characters) is met at +1012. The estimate is left as written so the readiness subject stays unchanged.
- Round 1 rewrite: a missing `## Validation` or `## Acceptance criteria` section now yields empty text (it had yielded the whole file); the unit word is fixed per category from `kinds` (`lines` for `code` and `tests`, `characters` for `documents`); the authorizing issues come from `deriveRequest` instead of a second inventory read; the first two are covered by tests, and the effort spec now states the per-category unit.
- Round 2 rewrite: the issue record comparison is its own function `recordWarnings` (Code Standards: it is a block of complex logic, so the single call site does not justify inlining it into `summarizeCandidate`); behavior unchanged.

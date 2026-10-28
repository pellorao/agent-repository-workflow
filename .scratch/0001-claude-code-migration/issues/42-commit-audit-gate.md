# 提交门禁补强: verify 核对受审版本与非空报告, Strata T2 缺陷修复

Status: completed

## What to build

用户批准的待办 merge-gate (2026-10-28). 目标是让 `arw commit-audit verify` 成为真正的机械门槛, 并修复 Strata 复核中确认的 Commit Audit 与 Spec Readiness 门禁缺陷. 现状: 暂存内容在审核后变化仍通过 verify; 空 `review.txt` 不被引擎察觉; 轻量提交放行非规范 effort 目录和含 NUL 的规则 Markdown, 且一个畸形 issue 会让 verify 跳过其余全部检查.

范围:

- `verifyCommitAudit` 隐含模式 (不带 `--non-implementation`) 增加可注入的 `platformAdapter` (默认当前平台, 与 `prepareCommitAudit` 相同), 读取当前会话 (`getCurrentAgentIdentity()`) 工作区 `_commit-audit/` 中编号最大的审核轮 `request.json`, 并报错 (每条消息提示重新 `arw commit-audit prepare` 并复审): 没有审核轮 (或无法读取); `HEAD` 不等于 `base`; 当前暂存树 (`git write-tree`) 不等于 `tree` 且差异不只是授权 issue 文件中 `Status` 与 `subjectContent` 之外的变化 (用 `git diff-tree -r --name-only -z` 取变化路径, 每个路径必须是授权 issue 文件, 且其 `Status` 与 `readIssueRequirement(...).subjectContent` 与受审树 (`git show`) 相同; 其他路径一律拒绝; 授权 issue 其余部分的变化不检查, 由 Main Agent 核对; prepare 之后才勾选验收项会被拒绝).
- 同一模式下, `requirements-reviewer` 与 `code-standards-reviewer` 各自在所有轮中取最新非空 (trim 后) `review.txt`, 没有则报错并提示重发 (只重跑一个 Reviewer 时另一个沿用旧轮结果). 不校验报告条目格式.
- Spec Readiness `generate` 的空报告错误增加重发提示.
- `--non-implementation`: effort 目录名必须通过 `parseEffortDirectoryName`; `.md` 暂存文件含 NUL 字节时报错; `stagedIssueInventory` 抛错时就地记入 errors 并继续其余检查; `isGate2DocumentPath` 的 effort 段改为 `\d{4}-<slug>` (`spec.md` 与既有的 `PRD.md` 同一正则, 只收紧目录名, 不改变其他识别结果; 不改变 `list`, `print`, `open` 或迁移的 Artifact 识别结果).
- Spec Readiness `assertExceptionApplicable` 的 issue 文件名判断改用 `ARTIFACT_ISSUE_FILE_PATTERN`.
- 平台: 逻辑与平台无关, 唯一差异是审核轮目录由 `getCurrentAgentIdentity()` 的会话标识决定 (Codex 与 Claude Code 来源不同); 测试各用一个 identity. 不改 reviewer-runtime, Reviewer 报告格式, `prepare` 行为.
- 同步 `docs/specs/agent-repository-workflow/spec.md` 与 commit Skill (含 `.claude/skills` 投影).

预估净增: 代码约 +55, 测试约 +60, spec 与 Skill 文字约 +12.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#arw-artifact-model`
- `docs/specs/agent-repository-workflow/spec.md#work-records-and-implementation-authorization`
- `docs/specs/agent-repository-workflow/spec.md#commit-audit`
- `docs/specs/agent-repository-workflow/spec.md#interfaces`
- `docs/specs/agent-repository-workflow/spec.md#generate-promote-and-verify`

## Acceptance criteria

- [x] 隐含 verify: 没有审核轮, HEAD 变化, 暂存树变化且非授权 issue 记录差异时各返回错误并带重发提示; 授权 issue 只改 `## Comments` 时通过; 授权 issue 改 `Status` 时拒绝. 观察: `tests/commit-audit/cli.test.mjs` 新用例断言 `verifyCommitAudit` 返回的错误消息含 `prepare`; 回退对应检查后用例变红.
- [x] 授权 issue 在 prepare 之后只勾选验收项时拒绝 (比较准确的 `subjectContent`). 观察: 同文件新用例.
- [x] 空 `review.txt` 拒绝; 只重跑一个 Reviewer 时沿用旧轮非空报告通过. 观察: 同文件新用例.
- [x] `generate` 空报告错误含重发提示. 观察: `tests/spec-readiness/spec-readiness.test.mjs` 现有空草稿用例匹配 `relaunch`.
- [x] `verify --non-implementation` 拒绝 `.scratch/audit-notes/spec.md` 与含 NUL 的 `.md`; 重复 canonical issue 抛错时仍报告 CRLF 错误. 观察: 各一个新用例.
- [x] `assertExceptionApplicable` 对 `01-a-.md`, `00-x.md` 的判断与规范文件名一致. 观察: `tests/spec-readiness/spec-readiness.test.mjs` 新用例.
- [x] `isGate2DocumentPath` 不再识别非规范 effort 目录 (`.scratch/audit/spec.md`) 下的文档. 观察: `prepare` 新用例, 引用该路径的 issue 因 Gate 2 文档并集为空而要求 `gate2Exception`.
- [x] Codex 与 Claude Code 两种 identity 各有一个审核轮路径解析用例.
- [x] spec, commit Skill 及其投影与分发副本已更新; `arw text check`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs` 通过; 新增测试每个回调不超过 100 毫秒.

## Blocked by

- None - can start immediately

## Validation

- Spec Readiness: 4 轮 haiku high 后 `No problems.` (前 3 轮的问题: 合同自相矛盾的差异口径, 未引用的治理章节, slug 语法与 PRD 识别范围), 另在修正 spec 措辞后重审一次, `arw spec-readiness verify --issue issue:0001:42` 退出 `0`.
- `pnpm test` 779 个测试, 778 通过 / 0 失败 / 1 跳过; `pnpm typecheck`, `node scripts/project-claude-skills.mjs --check`, `node scripts/check-workflow-distribution.mjs`, `arw text check`, `git diff --check` 通过. `arw terms check` 只剩 spec 859 行一条既有的 `Artifact` 发现.
- 红绿核对: 去掉空报告检查, 暂存树比较, 授权 issue 内容比较, NUL 检查, `stagedIssueInventory` 的原有路径各使对应用例变红.
- 净增 (`git diff --numstat`): 代码 +54, 测试 +107 (含改写一个旧用例), 文字约 +12, 合计约 173, 约为预估 127 的 1.4 倍, 未超一倍.
- 平台: 逻辑与平台无关; Codex 与 Claude Code 两种 identity 各有一个审核轮用例.
- 提交审核第 1 轮后修正: `isGate2DocumentPath` 改用 `ARTIFACT_EFFORT_DIRECTORY_PATTERN`; 最新轮 `request.json` 不可读时带重发提示; 测试的 `prepare` 辅助函数接受 `platformAdapter`; commit Skill 不再复述 spec 中的核对规则. 未采纳: 分发副本同步 (`distribution/` 在本票前已落后于 Skill, 由发布流程同步, `check-workflow-distribution` 通过); 抽出轮次枚举辅助函数 (两处各一行, 不值得).

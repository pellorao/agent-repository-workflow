# Gate 2 增量审核并删除 Spec Requirement

Status: completed

## What to build

用户确认的最终状态见 effort `spec.md` 的 `Solution`: 每次实施提交做 Gate 1 加差异回归检查; Gate 2 只审核治理文档在 `git diff <since> <tree>` 中的改动, `since` 由引擎从 Git 历史推导且不存储; 删除 issue 的 `## Spec Requirement` 及其全部读取和写入规则. 所有条目合并为一个 issue 一起实施.

代码 (`lib/`):

- `lib/arw-common/` 新增 effort 起点推导函数 `deriveEffortStart`, 规则见 spec `Effort 起点 since`, Commit Audit 与 Spec Readiness 共用.
- `lib/arw-common/issue-documents.mjs`: `readIssueRequirement` 改名 `readIssueSubject`, 只返回 `subjectContent` 与 `subjectIdentityContent`, 不再解析要求列表, 不识别 `Not required`; `readModuleCorrectionSoftLocks` 名单去掉 `Spec Requirement`.
- `lib/commit-audit/commit-audit.mjs`: 删除 `governingDocuments`, `gate2Exception` 及其解析, 校验和与 `input.json` 的可选键. Gate 2 在 effort 全部 issue 终态时为 `{since, documents}` (`documents` 取 `git diff --name-only <since> <tree>` 中满足现有 `isGate2DocumentPath` 的路径, 可为空), 否则为 `null`. `reviewRoundErrors` 中的 subject 比较改用 `readIssueSubject`.
- `lib/spec-readiness/spec-readiness.mjs`: 删除 `validateRequirementEligibility`, `headingAnchor`, `readIssue` 中的要求部分, `prepare`, `promote`, `verify` 中的要求种类和"引用必须是已审 Input"检查; 例外由记录本身承载, `assertExceptionApplicable` 保留. `prepare` 调用 `deriveEffortStart` 并把 `since` 作为新字段写入 Reviewer Request (被 `requestDigest` 覆盖, 读取已存储 Request 时缺少或多出键被拒绝); 记录结构不变.
- `lib/artifact-migration/artifact-migration.mjs`: 删除 `rewriteStructuredRequirementPaths` 及"活动 issue 必须先手写该章节"的诊断.
- `lib/workflow-distribution/workflow-distribution.mjs`: 自包含检查的禁止词表按新名字更新 (`readIssueSubject`).

文档与规则 (主副本; `distribution/` 副本与 `.claude/skills/` 投影随之同步):

- 长期规范: 主 spec (`docs/specs/agent-repository-workflow/spec.md`) 的 issue 模板和 `## Spec Requirement` 语法段, 迁移段, Spec Readiness 一节 (Request 绑定内容加 `since`, 审核对象, 审查步骤中的"要求选择", `verify` 的"issue 要求只引用已审核输入"及相关失败描述), Commit Audit 一节的 `input.json`/Gate 2/确定性验证, Issue Documents Module, Gate 2 例外的设计理由改写为增量审核的归纳论证; JIRA spec 中提到 `## Spec Requirement` 的 6 处; 开发 spec 的自包含禁止词; ADR 0006 和 ADR 0023 就地改写原决定并写明理由 (含 ADR 0023 撤销"不从作为输出修改的长期 Spec 扩大"这一限定, 见 spec `ADR Evaluation`), 不新建 ADR; `docs/agents/reviewer.md` 的"只读固定版本"句增加 Spec Readiness 检索相关既有章节的例外 (分发副本同步). 增量审核的归纳依据: 文档在某点全量审过后, 之后每次改动都被审核者对照核对, 所以未改动的部分仍然成立; 剩余风险和被否决的方案 (逐文档基线, 整份审核) 写进设计理由.
- Skill: `issue-tracking` (删除 `## Issue requirements` 整节和相关表述, 改为一句说明 `What to build` 可引用 spec 锚点且不做机械校验), `to-tickets`, `to-spec`, `spec-readiness` (subject 范围, Governing design 引用, 自检项, Respond to findings), `commit` (Gate 2 范围, 删除两条跳过例外, `input.json`, 新增差异回归, 第 4 步抽查至少一处落在差异回归上), `application-workflow/references/module-correction.md`.
- 角色: `spec-readiness-reviewer` (subject 只含 `What to build` 与验收标准; 不依据引用选择范围, 自行检索相关既有章节; 范围是 Input 自 `since` 起的改动, 本 effort 的 spec 和检索到的章节; 删除"选择是否正确"类检查和 gap 类型; 允许读取检索到的章节), `requirements-reviewer` (Gate 2 按差异逐块核对, 新增差异回归的固定步骤, 写成逐文件的步骤).
- 其他: `docs/agents/source-checkout-validation.md`, `docs/agents/writing.md` 的禁止词, `docs/manuals/skills{,.zh-CN}.md`, `docs/manuals/application-jira{,.zh-CN}.md`.
- Reviewer 能力场景 `tests/fixtures/reviewer-capability/spec-readiness-reviewer/runtime-migration`: 夹具 issue 删除该章节, 删除 3 个专测"要求选择"的期望 (2 个问题用例, 1 个正例), 保留其余; 不重新登记基线. 改动前读 `docs/agents/source-checkout-exceptions.md`.

测试按新行为增删: 删除要求语法, 资格检查, `gate2Exception`, 迁移路径改写的用例; 新增 `deriveEffortStart` 三种情形 (effort 未提交, 已有历史, 根提交), Commit Audit 的 Gate 2 差异文档, 新格式 issue 的就绪和迁移用例.

Spec Readiness 的 Input 与审核说明: 治理 Input 由 Main 显式给出并被摘要绑定; Reviewer 检索到的既有章节只是比较证据, 不绑定, 不进入新鲜度, 不产生记录.

不做: 现有 issue 的迁移或删除章节; 就绪新鲜度改按改动绑定; 重新登记能力基线; 补审旧 ADR.

体积估算 (按 `AGENTS.md` 的 `Efficiency First` 第 7 条, 只计非测试代码): 净增约 -110 行 (起点推导 +9, issue-documents -22, spec-readiness -46, commit-audit -24, artifact-migration -30). 实际净增大于 0 (即超出估算一倍且方向相反) 时停下说明. 文档和测试不计入.

## Acceptance criteria

- [x] `deriveEffortStart`: 对 effort 未提交返回 `base`, 对已有提交返回最早提交的父提交, 对 effort 目录在根提交中返回空树对象. 观察: 新测试用真实临时 Git 仓库断言三种情形.
- [x] Commit Audit: effort 全部终态时 Request 的 `gate2` 是 `{since, documents}`, `documents` 只含 `git diff --name-only <since> <tree>` 中的治理文档, 无改动时为空数组且不需要例外; 未全部终态时为 `null`; `input.json` 含 `gate2Exception` 被拒绝. 观察: `tests/commit-audit/cli.test.mjs` 断言.
- [x] 删除: `grep -rn -E "readIssueRequirement|gate2Exception|governingDocuments|validateRequirementEligibility|rewriteStructuredRequirementPaths" lib scripts` 无输出; `grep -rn "Spec Requirement" lib` 无输出.
- [x] Issue 解析: 无 `## Spec Requirement` 的新格式 issue 与含该章节的旧格式 issue 都得到正确 subject, 章节缺失, 重复或顺序错误时抛错; 旧格式 issue 的 subject 摘要与改动前相同. 观察: `tests/arw-common/issue-documents.test.mjs`.
- [x] Spec Readiness: 无 `## Spec Requirement` 的 issue 可 `prepare`, `generate`, `promote`, `verify`; 就绪例外不要求 issue 写 `Not required`; Request 含 `since`. 观察: `tests/spec-readiness/` 断言.
- [x] Artifact 迁移: 新格式 issue 的迁移不再被"必须先手写该章节"诊断阻断. 观察: `tests/artifact-migration/cli.test.mjs`.
- [x] 文档: `grep -rn "要求选择\|只引用已审核输入\|空要求确认" docs .agents distribution` 无与已删除机制相关的残留; 上述 spec, ADR, Skill, 角色和手册不再有要求写入 `## Spec Requirement` 的规则 (`grep -rn "Spec Requirement" docs .agents distribution` 只可能出现在说明旧 issue 仍可读取的单处); ADR 0006, ADR 0023 已改写并写明理由; `requirements-reviewer` 与 `commit` Skill 含差异回归步骤; `spec-readiness-reviewer` 的范围规则符合 spec.
- [ ] Reviewer 能力夹具: `runtime-migration` 删除 3 个选择类期望后其余 17 个期望及其 fixture 仍一致加载, 夹具 issue 无该章节. 观察: 相关测试通过.
- [x] 验证与体积: `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check` 通过; 新增或语义修改的测试用例回调耗时低于 100 毫秒; 非测试代码净增不大于 0. 观察: `git diff --numstat -- lib`.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test`: 799 通过, 0 失败. `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check`, `git diff --check` 均通过.
- 删除与文档 grep: `lib`, `scripts` 无 `readIssueRequirement`, `gate2Exception`, `governingDocuments`, `validateRequirementEligibility`, `rewriteStructuredRequirementPaths`, `lib` 无 `Spec Requirement`; docs, `.agents`, `distribution` 无已删除机制的残留 (ADR 0023 与主 spec 中说明已删除的提及除外).
- 非测试代码净增约 -133 行 (`git diff --numstat -- lib scripts` 加新文件 `lib/arw-common/effort-start.mjs` 18 行).
- Reviewer 能力夹具验收项未完成: 计分器要求重新测量格式基线 (场景与登记基线不符, 且删除 k=1 问题用例使 k 档失衡), 按 Main 决定推迟为单独待办, `tests/fixtures/**` 保持不变.

# Strata T6 纯删除: 无调用方的导出, 不可达守卫, 未读取的字段与参数, 重复的 `exists`

Status: completed

## What to build

用户批准的待办 (2026-10-29): Strata 复核分诊 T6 "纯删除". 每项已对实施前的代码逐条核实 (全仓库含测试与脚本的引用检查), 只删除确实无人使用或守卫不可能触发的内容; 公开 Interface, spec 点名的内容和删除会改变行为的内容不删, 列在下面 "不删除".

删除 (内部行为不变):

- 无调用方的导出与函数: `compareCanonicalArtifactIds` (及 `artifacts.mjs` 的再导出与其测试断言), `createDeterministicRepositoryStateInspector`, `normalizePathPattern`, `KNOWN_LOCK_MIGRATORS`, `lib/arw.mjs` 的 `isArtifactKind`, `UNINSTALL_USAGE` 的 `export` 关键字 (模块内仍使用), 背景 Agent manager 的 `subscribe` 与 `releaseMaintenance` 返回成员 (测试中的同名只是局部变量).
- 无人读取的返回字段与参数: `readIssueDocuments` 的 `legacyDetected` (artifacts 清单自己计算), `ValidatedBlockerSet.meaningfulValues` (只删 `validateBlockerSet` 返回值与该类型中的字段, `ParsedBlockerTokens.meaningfulValues` 仍被 `parseBlockerValues` 读取, 保留), `emitDiagnostics` 的 `selectedPath` 参数, `parseOptionPairs` 的 `repeatedOptions` 参数 (两处调用都未传).
- 不可能触发的守卫: 两处 `requiredGroup` 的 `throw` (所用正则的具名组都是必选组, 保留一个函数并以类型断言收窄, 由 `artifact-identity.mjs` 导出, `issue-documents.mjs` 导入), `application-completion.mjs` 的 `jira.key.length === 0` (正则要求至少 1 个字符) 与 `input.issues.length > 0` (前面的恰好一次解析已保证).
- 无人调用的类型成员: `MigrationFilesystem` 的 `readFile` 与 `readdir`.
- 重复辅助函数 (issue 40 提交审核第 30 轮 Main 已接受的争议项, 合并为纯删除): `reviewer-capability-setup.mjs`, `reviewer-capability-view.mjs`, `reviewer-capability/operations.mjs` 各自定义的相同 `exists`, 以及 `scenario.mjs` 的 `sharedPath` 内联的同一判断, 合并为 `scenario.mjs` 导出的一个 `exists`.

不删除 (需 Main 决定, 本 issue 不处理):

- `proveUpstreamEffort` 成功结果的 `proof` 与 `convergeJiraIssue` 的 `phase` 输入: 无人读取, 但 Application JIRA spec 的 Git Upstream Proof Interface 与 JIRA Convergence Interface 合同把证明和阶段列为 Interface 内容, 删除要先修改 spec, 交 Main 决定.
- `controllerId`: 是持久化恢复记录 (`recovery-record.mjs`, manager 恢复时校验 `record.controllerId`) 与 host 协议的字段, 涉及 6 个文件约 50 处, 删除改变持久状态格式, 不是纯删除.
- `git-upstream-proof.mjs` 的 `effortDirectory === undefined` 与 `specEntry === undefined || effortPath === undefined` 守卫, `artifacts.mjs` 的 "has no effort number" 守卫, `uninstallation.mjs` 重复的 manifest 守卫: 在 `noUncheckedIndexedAccess` 与类型收窄下承担类型作用, 删除需要改写为类型断言, 属重构而不是删除.
- `artifacts.mjs` 的再导出块与 `ISSUE_FILE_PATTERN` 别名, `ArtifactRepository.scratchDirectory`, `submodule-git-adapter.mjs` 的 `branch` 类型成员 (调用方传入字面量, 删除触发类型错误), `submodule-git-adapter.mjs` 的 `dependencies.git`, `managed` 安装所有权字段: 涉及多文件接口或契约, 非纯删除.
- 其余 Strata 分诊中 "真但琐碎" 的条目未逐条处理 (分诊只列出约 25 条 T6); 未列入上面两节的不属本 issue.

注意: 作为架构证据提供的源码已是实施后的状态, 上面已删除的内容在其中不再出现; 以实施前的 `git show HEAD:<path>` 为准核对.

下面 `## Spec Requirement` 引用的是被删代码所属模块的现行行为要求 (本 issue 不改变行为, 删除后须保持满足).

预估净增 (代码 / 测试 / 文档): 代码约 -75, 测试约 -5, 总约 -80 行 (分诊预估 -150 至 -250; 其中大部分条目因上述原因不是纯删除).

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#arw-artifact-operations`
- `docs/specs/agent-repository-workflow/spec.md#capacity-and-recovery`
- `docs/specs/agent-repository-workflow-application-jira/spec.md#application-validation-and-completion`
- `docs/specs/agent-repository-workflow-development/spec.md#validation-strategy`

## Acceptance criteria

- [x] 上面 "删除" 一节每项不再出现在源码中, 无引用残留. 观察: `grep -rnE 'compareCanonicalArtifactIds|createDeterministicRepositoryStateInspector|normalizePathPattern|KNOWN_LOCK_MIGRATORS|isArtifactKind' lib tests scripts` 无输出; `grep -nE '\bsubscribe\b|releaseMaintenance' lib/background-agent/manager.mjs` 无输出; `grep -n 'selectedPath\b\|repeatedOptions' lib/arw.mjs` 无输出; `grep -n meaningfulValues lib/arw-common/issue-documents.mjs` 只剩 `ParsedBlockerTokens` 的类型, `parseBlockerValues` 与 `parseBlockerTokens` 中的行; `grep -rn '^const exists' lib` 无输出, `grep -rn 'export const exists' lib` 只有 `lib/reviewer-capability/scenario.mjs`.
- [x] 外部可观察行为不变. 观察: `pnpm test` 与 `pnpm typecheck` 通过, 被删除功能的测试以外没有测试被修改 (只有 `compareCanonicalArtifactIds` 的两条断言被删).
- [x] `node scripts/check-workflow-distribution.mjs`, `arw text check`, `git diff --check` 通过.
- [x] 净增为负. 观察: `git diff --numstat` 汇总.

## Blocked by

- None - can start immediately

## Validation

- Spec Readiness: 3 轮 haiku high. 第 1 轮问题: 提供的是实施后快照, 被删内容 "不存在"; 验收 grep 自相矛盾; `Not required` 需用户确认, 改为引用被删代码所属模块的现行行为要求. 第 2 轮问题: `phase` 与 `proof` 属 Application JIRA spec 的 Interface 合同内容, 已从删除范围移出. 第 3 轮 `No problems.`, `arw spec-readiness verify --issue issue:0001:46` 退出 `0`. 偏离: 实施先于就绪审核完成 (审核期间代码已改, 架构证据不受新鲜度检查).
- `pnpm test` 792 项, 791 通过 (1 项既有跳过), `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `arw text check`, `git diff --check` 通过. 未新增测试; 验收 grep 输出符合预期.
- 净增 (`git diff --numstat`, 不含 issue 与就绪记录): +28/-86, 净 -58 (估算 -80). 低于分诊预估 -150 至 -250, 因多数条目不是纯删除.

## Comments

- 开发 spec 没有可引用的代码质量要求, 所以 `## Spec Requirement` 引用被删代码所属模块的现行行为要求, 不写 `Not required` (例外需要用户明确确认).
- 提交审核第 1 轮 code-standards 两个问题: `requiredGroup` 合并已修复; 把 `exists` 移入 `lib/common/filesystem.mjs` 的建议不采纳, 因开发 spec (Filesystem Module 准入条件, 夹具读取直接使用 `node:fs`) 不允许, 保留 `scenario.mjs` 导出.

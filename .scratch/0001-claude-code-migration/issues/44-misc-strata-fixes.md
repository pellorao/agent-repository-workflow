# 零散缺陷与重复实现收口: JIRA resolved 终态, 围栏内状态行, 语言表格对齐, editor 与 git 进程, 迁移诊断, 安装入口测试 mock 化

Status: completed

## What to build

用户批准的待办 merge-misc (2026-10-28 Strata 复核分诊 T3, T5, 加 ticket 24 遗留), 平台无关的 lib 纯逻辑, 两个平台行为相同. 每项已对当前代码核实:

- Application 完成资格把 Wayfinder `resolved` 视为终态 (复用 `issue-documents.mjs` 导出的 `TERMINAL_STATUSES`), 不再永久阻断 `jira-sync completed`.
- 关联, 同步, 迁移预检的 `Status:` 与 `Type:` 行只在 Markdown 围栏代码外识别 (复用并导出 `findUnfencedLineIndexes`); 围栏内同名行不再造成误阻断或误判 Wayfinder, CRLF 保留.
- `arw language inspect` 表格与 JIRA 列表改用 `formatTextTable`, 删除两份自写 `formatTable`; 中文路径对齐 (JIRA 侧只是去重, 其 Key 列为 ASCII, 本不错位).
- `launchConfiguredEditor` 用函数形式替换 `{file}`, 含 `$&`, `$$` 的路径不再被改写; `createNodeGitRunner` 对 stdin 的 `error` 事件不再崩溃, git 提前退出时返回其真实退出结果, 并新增可注入 `spawn` 参数供测试.
- `migrate artifacts` 诊断: 路径统一为不带 `./` 的仓库相对写法, 排序用 `compareText` 而不是 `localeCompare`, 缺失的 Spec Readiness 记录使用 ARW 实际写入的 `<NN>.spec-readiness.json` 名.
- T5 其余项逐项核实后并入: 重复 effort 编号时不再叠加 "不是有效 canonical ID" 与 "未编号" 两条错误信息 (只保留准确的 `Duplicate effort number`); `module-correction-check` 的 `sortDiagnostics` 改用 `compareText`; `workflow-distribution-sync` 删除自己的 `sortDiagnostics` 副本, 复用 `workflow-distribution` 导出的版本.
- 不并入: T3 的 `application-jira-cli.mjs` 重复回滚. `applyFileTransaction` 失败后已自行回滚并返回 `rollback` 明细, CLI 对失败仓库再恢复一次是回滚部分失败时的第二次机会, 删除会削弱恢复, 不是无风险去重, 需单独评估.
- 迁移前如何生成 Spec Readiness 记录 (非规范目录中生成器不运行) 是流程缺口, 不在本 ticket, 记为后续待办.
- 安装入口测试: 应答 `y` 与无效应答改为 `askYesNo` 的注入式内存测试, 真实进程只保留 `n` 与 EOF; installation spec 的入口测试句同步改写.

spec 文字: application-jira spec 的完成条件澄清 Wayfinder `resolved`, 关联与同步各补一句 "状态行只在围栏代码外识别"; ARW spec 的 `Document content boundaries` 补 issue 元数据字段只在围栏外识别的通则, `migrate artifacts` 段补诊断路径, 排序与伴随文件名; installation spec 补交互式 PATH 询问的有效应答, 重问与输入结束合同, 并改写入口测试句.

预估净增 (代码 / 测试 / 文档): 代码约 -15, 测试约 +130, spec 约 +4, 总约 +120 行.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow-application-jira/spec.md#application-and-module-issue-association`
- `docs/specs/agent-repository-workflow-application-jira/spec.md#status-and-downstream-mirroring`
- `docs/specs/agent-repository-workflow-application-jira/spec.md#application-validation-and-completion`
- `docs/specs/agent-repository-workflow/spec.md#document-content-boundaries`
- `docs/specs/agent-repository-workflow/spec.md#arw-artifact-operations`
- `docs/specs/agent-repository-workflow/spec.md#document-language-inspection`
- `docs/specs/agent-repository-workflow-installation/spec.md#installation-target-and-choices`
- `docs/specs/agent-repository-workflow-installation/spec.md#validation-strategy`

## Acceptance criteria

- [x] Wayfinder `resolved` 的 effort 在其他条件满足时 `eligible: true`, `open` 仍为 `false`. 观察: `tests/application-jira/application-completion.test.mjs` 新增用例.
- [x] 围栏内含 `Status: ...` 行时, 关联与同步只改围栏外的真实行并保留 CRLF; 围栏内含 `Type: ...` 行的 legacy issue 不被当作 Wayfinder issue, 迁移对它的处理与没有该行时一致. 观察: `application-association.test.mjs`, `application-sync.test.mjs`, `tests/artifact-migration/cli.test.mjs` 新增用例.
- [x] 语言表格含中文路径时各列对齐, JIRA 列表输出不变, 两份自写 `formatTable` 已删除. 观察: `tests/arw-common/language-composition-presentation.test.mjs`; `grep -rn "const formatTable" lib` 无输出.
- [x] 路径含 `$&`, `$$` 的文件按原样传给编辑器; git stdin 报 `error` 时 runner 返回 git 的真实退出结果而不是崩溃. 观察: `tests/arw-common/editor-process.test.mjs`, `tests/common/git-process.test.mjs` (注入 `spawn`, 无真实进程).
- [x] 迁移诊断无 `./` 前缀, 排序不依赖区域设置, readiness 名为 `<NN>.spec-readiness.json`. 观察: `tests/artifact-migration/cli.test.mjs` 的现有与新增断言; `grep -n "localeCompare" lib/artifact-migration/artifact-migration.mjs lib/application-jira/module-correction-check.mjs` 无输出.
- [x] 重复 effort 编号只报告 `Duplicate effort number`, `sortDiagnostics` 只剩一份分发实现加各自局部排序. 观察: `tests/arw-common/artifacts.test.mjs` 新增用例; `grep -rn "const sortDiagnostics" lib/workflow-distribution` 仅一处.
- [x] `askYesNo` 有真值表, 无效应答重问和输入结束的注入式测试; 真实进程安装入口用例只剩 `n` 与 EOF; installation spec 的入口测试句相应改写; 新增测试回调均小于 100 毫秒. 观察: `tests/installation/cli-prompt.test.mjs`, `tests/installation/installation.test.mjs`.
- [x] `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `arw text check` 通过.

## Blocked by

- None - can start immediately

## Validation

- Spec Readiness: 4 轮 haiku high 后 `No problems.` (前三轮问题: 围栏内 `Type:` 与交互式 PATH 询问缺长期合同, 迁移预检分类与 Application Source Issue 冲突, 缺失 Spec Requirement 诊断无合同; 处理: ARW spec `Document content boundaries` 补元数据字段只在围栏外识别的通则, installation spec 补有效应答合同, 删除冲突的分类句, 验收改为 "处理与没有该行时一致"), `arw spec-readiness verify --issue issue:0001:44` 退出 `0`.
- `pnpm test` 790 项, 789 通过 (1 项既有跳过), `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `arw text check`, `git diff --check` 通过; `arw terms check --include .scratch/0001-claude-code-migration/` 只剩既有的 3 条 `Artifact` 发现 (issue 42, effort spec 141 行, ARW spec 859 行).
- 新增测试均在内存或注入假对象中运行, 回调均小于 3 毫秒; 真实进程安装入口用例由 4 个子案例降为 2 个 (`n` 与 EOF), 其耗时仍为既有的真实进程开销 (约 135 与 255 毫秒), 未改变 ticket 24 的待用户决定例外.
- 验收证据: 完成资格 `application-completion.test.mjs`; 围栏 `application-association.test.mjs`, `application-sync.test.mjs`, `artifact-migration/cli.test.mjs`; 表格 `language-composition-presentation.test.mjs`; editor 与 git `editor-process.test.mjs`, `common/git-process.test.mjs` (注入 `spawn`); 重复编号 `artifacts.test.mjs`; 安装入口 `installation/cli-prompt.test.mjs`, `installation.test.mjs`.
- 偏离: 新增交互式 PATH 询问合同与 issue 元数据围栏通则两处 spec 文字 (审核要求); 并入 T5 的 `sortDiagnostics` 两处 (`module-correction-check` 改 `compareText`, `workflow-distribution-sync` 复用导出版本) 与重复 effort 编号信息; 未并入 `application-jira-cli` 重复回滚 (见 What to build). 未单独测试 `localeCompare` 改 `compareText` (与现有排序断言一致且全部通过).
- 净增 (`git diff --numstat` 加三个新测试文件, 不含 issue): 代码约 -15, 测试约 +161, spec 约 +4 (估算 +120, 在两倍预算内).

## Comments

---
description: 用户要求 Git 提交后使用: 对已暂存候选分类, 执行实施 issue 提交 (要求符合审核与 Code Standards 两个并行 Reviewer, Gate 1 和 Gate 2 范围) 或非实施机械提交, 并编写提交说明. 完成或解决 issue 本身不触发.
name: commit
---

# 提交

只有用户要求 Git 提交后才使用. 完成或解决 issue 本身不启动审核, 暂存或提交验证.

## Select the workflow

- 每个提交只包含一个 effort, Main Agent 只暂存该 effort 的内容. 共享文件中的改动按实际语义归属判断, 不按路径猜测.
- 检查精确的已暂存路径集合. 每一项都符合 [非实施分类](#non-implementation-commit-workflow) 时使用非实施工作流; 任何一项属于当前仓库的实施工作时, 对完整候选使用 [实施 issue 工作流](#implementation-issue-commit-workflow); 某项无法分类时先停止并解决归属, 不推断它是实施工作.
- 只改 Agent 规则与文档 (`AGENTS.md`, `docs/**`, Skill 及其 `.claude/skills` 投影中的 Markdown, 以及仓库根目录的 `README.md`, `CONTEXT.md`, `CLAUDE.md`) 的候选属于非实施分类, 不要求 effort. 代码仍是实施工作.
- 同一实施授权覆盖完整候选时, 符合条件的非实施内容可以与实施工作保留在一起, 不因一项原子变更同时更新规划记录或仓库状态而拆分它. 授权范围外的内容先取得自己的授权, 才能加入候选.

## Implementation issue commit workflow

1. 确定完整排序的 `authorizingIssueIds`, 按 `code-review` 的 [完成记录](../code-review/result-reuse.md#completion-records) 规则更新真实的 Status 和验收勾选, 暂存完整实施候选. 必要实施验证按 `validation` Skill, 可以与审核并行; 未完成的检查不提供通过事实.
2. 启动 Reviewer 前自查 (这些是复审的常见问题): 没有重新实现已有公共辅助函数; 无死代码, 文件内部导出已去掉; 测试名与断言相符, 测试回调低于 100 毫秒; 审核对象是已暂存的真实树, 不审私有索引 (`git write-tree` 取树).
3. 按 [Run](#run) 准备审核轮, 并行运行 `requirements-reviewer` (要求符合审核) 和 `code-standards-reviewer`. 一次提交最多这两个并行 Reviewer.
4. 两个 Reviewer 正常结束 (`ready`) 后, 按 `docs/agents/subagent-findings.md` 独立核对报告中的每个问题. 每轮自选一两处 Reviewer 应当检查的要求或代码位置抽查; 发现漏检时该轮结果作废并重审. Reviewer 返回 `incomplete` 时本轮结束, Main Agent 处理其原因后重新 `prepare`.
5. 修复后暂存 (审核运行期间也可以暂存) 并用同一 `input.json` 再次 `prepare`; 新一轮自动沿原线程复审, 只交付相邻版本变化和该 Reviewer 的前轮报告 ([复审规则](../../../docs/agents/reviewer.md#re-review)). 某个 Reviewer 的输入没有受影响时只运行另一个的 `.jsonl`, 保留其结果.
6. 按 [记录章节](../issue-tracking/SKILL.md#issue-record-sections) 规则统一暂存收尾记录, 用 `git diff <受审 tree> $(git write-tree)` 核对最终暂存树相对受审版本只有记录差异. 只有记录差异不需要复审. `arw commit-audit verify` 也机械核对这一点 (规则见 spec 的 Commit Audit): 授权 issue 的 `Status` 和 What to build, Spec Requirement, Acceptance criteria 三段 (含验收勾选) 在 `prepare` 之后不得再改, 所以先勾选验收再 `prepare`; 失败时按提示重新 `prepare` 并复审.
7. 提交门槛是两个 Reviewer 正常结束且报告中的问题都已处理 (修正, 按质疑规则证明无效, 或按 [来源分流](../../../docs/agents/subagent-findings.md#triage-by-origin) 记入后续 issue). 只修改代码的修复不使 Spec Readiness 记录失效, 不重跑就绪审核. 未完成 issue 的问题只在确属计划中尚未完成的工作时保留. 运行 `arw commit-audit verify` 并取得空错误列表.
8. 对每个授权 issue 运行 `arw spec-readiness verify --issue issue:<NNNN>:<NN>` 并取得 `0`, 然后提交.

## Commit Audit

### Scope

- `authorizingIssueIds` 是已暂存实施的完整授权范围, 属于同一 effort. 尚未完成的 issue 可以授权中间提交.
- Gate 1 覆盖本次每个新进入 `completed` 或 `wontfix` 的 issue, 它必须在授权范围内. Engine 拒绝遗漏授权和跨 effort 的变化.
- Gate 2 是 effort 级 Spec Audit, 在当前 effort 的每个实施 issue 都处于终态时适用. 文档是授权 issue 有效 `## Spec Requirement` 引用的 spec, PRD 和 ADR 的并集, 审核范围是整份文档.
- 适用 Gate 2 的文档并集为空时, 停止并取得用户明确确认, 在输入中写入包含具体 `reason` 和 UTC 秒级 `confirmedAt` 的 `gate2Exception`.
- 并集非空且整个 effort 的提交都没有改动并集内的文档时, 可以跳过 Gate 2: Main Agent 用 `git log` 核对后写入 `gate2Exception` (`reason` 写明核对结果, 不需用户确认), Request 的 Gate 2 文档为空. 并集内文档在本次候选中有改动时引擎拒绝.

### Run

1. 在仓库 `.tmp/` 下写一个 `input.json`, 只含完整排序的 `authorizingIssueIds` 和适用时的 `gate2Exception`. 运行 `arw commit-audit prepare --input <absolute-input-path>`; 它新建 [审核轮](../reviewer-launch/SKILL.md#review-rounds) 目录 `_commit-audit/<n>/`, 其中 `request.json` 含 `gate1`, `gate2`, `reviewPath` 和受审版本 `base`, `tree`, 只打印轮目录.
2. 按 `reviewer-launch` 的 [审核轮](../reviewer-launch/SKILL.md#review-rounds) 运行 `cat <轮目录>/*.jsonl | arw background-agent --wait`. Reviewer 按 [报告格式](../../../docs/agents/reviewer.md#report) 逐条写入问题, 或写 `No problems.`.

Main Agent 负责暂存, Request, 审核协调和处理问题, 不代写语义判断. Reviewer 只用只读 git 命令读取 `base` 和 `tree`, 不调用 Engine, 不修改索引.

## Non-implementation commit workflow

只有精确的已暂存候选只包含已由初始规划记录, issue, map 或仓库工作流授权的符合条件内容, 且 (规则与文档项除外) 属于同一个 effort 时才使用. 符合条件的项只有:

- `.scratch/<NNNN>-<effort-slug>/spec.md` 和 `.scratch/<NNNN>-<effort-slug>/map.md`.
- ARW 解析为实施, Application Source 或 Wayfinder issue 的 `.scratch/<NNNN>-<effort-slug>/issues/<NN>-<issue-slug>.md`.
- `.scratch/<NNNN>-<effort-slug>/research/**` 或 `.scratch/<NNNN>-<effort-slug>/prototype/**` 下的安全普通文件, 可以使用任何扩展名, 不要求其他文件链接它们.
- 只含上述规则与文档 Markdown 的改动, 不要求就绪记录. 运行 `arw text check`, Main Agent 用 grep 自查跨文档引用和副本一致性. 例外: 改动审核系统本身 (Reviewer 角色, 关卡语义) 或长期规范合同条款时, 由 Main Agent 按 `reviewer-launch` 的 Other reviews 手工准备并启动一个 `requirements-reviewer` (普通身份, `issueIds` 为空数组, 再次审核按 `reviewer-launch` 复用原线程, 不用 `commit-audit prepare`), 最多一轮, 不运行 Spec Readiness; Main Agent 处理报告问题后提交, 不复审.
- 安全的 `gitlink`. 它把子模块提交记录为当前仓库状态, 是否符合条件不取决于 Application 配置, 自身路径或其他已暂存项; Main Agent 仍按实际语义把它归入本次 effort.

候选可以删除该 effort 的辅助文件, 但必须保留每个已提交的 ARW Artifact 身份; 类型和编号不变的重命名属于身份保留. 候选使实施 issue 新进入 `completed` 或 `wontfix` (包括从另一个终态转换) 时不符合条件; `HEAD` 中已处于相同终态的 issue 不因其他字节变化而再次进入该状态.

运行 `arw commit-audit verify --non-implementation`, 它完成上述分类, 单一 effort, 未暂存替代内容 (含子模块 `HEAD`), 终态转换, ARW Artifact 解析, 文本格式, `git diff --cached --check` 和身份保留的全部机械检查, 不做语义或跨文件检查. 错误列表为空才提交; 失败时修复候选后重跑, 完整候选包含实施工作时改用实施 issue 工作流.

该工作流不运行 Spec Readiness, Commit Audit, Code Review 或任何独立 Reviewer (规则与文档例外的 `requirements-reviewer` 除外).

## Commit messages

遵循 Conventional Commits 1.0.0, 标题使用 `<type>[optional scope][!]: <description>`. 用户可见功能使用 `feat`, 缺陷使用 `fix`; 常用辅助类型是 `docs`, `test`, `refactor`, `style`, `build`, `ci`, `perf` 和 `chore`. 破坏性变更在冒号前加 `!`, 或使用 `BREAKING CHANGE: <description>` 尾注. 描述简短并使用祈使语气; 只有理由, 迁移说明或取舍不明显时才写正文.

## Failure

任何关卡失败, 必要 Input 不可用, Reviewer 报告的问题未处理, 或 Reviewer 返回 `incomplete` 时, 在提交前停止.

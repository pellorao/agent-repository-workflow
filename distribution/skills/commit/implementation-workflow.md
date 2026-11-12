# 实施提交流程

## Implementation issue commit workflow

1. 确定完整排序的 `authorizingIssueIds`, 按 `../code-review/result-reuse.md` 的 Completion records 节规则更新真实的 Status 和验收勾选, 暂存完整实施候选. 必要实施验证按 `validation` Skill, 可以与审核并行; 未完成的检查不提供通过事实.
2. 启动 Reviewer 前自查 (这些是复审的常见问题): 没有重新实现已有公共辅助函数; 无死代码, 文件内部导出已去掉; 测试名与断言相符, 测试回调耗时满足 `validation` Skill 的 Coverage 节规定的阈值; 审核对象是已暂存的真实树, 不审私有索引 (`git write-tree` 取树).
3. 按 Run 节准备审核轮, 并行运行 `requirements-reviewer` (要求符合审核) 和 `code-standards-reviewer`. 一次提交最多这两个并行 Reviewer.
4. 两个 Reviewer 正常结束 (`ready`) 后, 按 `docs/agents/subagent-findings.md` 独立核对报告中的每个问题, 并按 `../reviewer-launch/SKILL.md` 抽查. Reviewer 返回 `incomplete` 时本轮结束, Main Agent 处理其原因后重新 `prepare`.
5. 报告有问题需要修复或处置时, 读取 `./fix-rounds.md` 并按其执行 (复审, 台账, 轮次规则, 冲突裁决); 没有问题时跳过.
6. 按 `../issue-tracking/SKILL.md` 的 Issue record sections 节规则统一暂存收尾记录, 用 `git diff <受审 tree> $(git write-tree)` 核对最终暂存树相对受审版本只有记录差异. 只有记录差异 (Validation, Comments, 含新增的台账) 不需要复审, 记完直接提交. `arw commit-audit verify` 也机械核对这一点: 授权 issue 的 `Status` 和 What to build, Acceptance criteria 两段 (含验收勾选) 在 `prepare` 之后不得再改, 所以先勾选验收再 `prepare`; 失败时按提示重新 `prepare` 并复审.
7. 提交门槛是两个 Reviewer 正常结束且报告中的问题都已处理 (修正, 按质疑规则证明无效, 按 `docs/agents/subagent-findings.md` 的 Triage by origin 节记入后续 issue, 或按台账记 "记录不修" 或 "冲突裁决", 前者对实施开始后只涉及 issue subject 措辞, 重复或一致性的问题任何轮次都可用, 其余措辞, 重复和文档去重类问题仅限第 3 轮起). 只修改代码的修复不使 Spec Readiness 记录失效, 不重跑就绪审核. 未完成 issue 的问题只在确属计划中尚未完成的工作时保留. 运行 `arw commit-audit verify` 并取得空错误列表.
8. 对每个授权 issue 先确认其 issue 文件没有未暂存修改 (`git diff --quiet -- <issue 文件>`), 再运行 `arw spec-readiness verify --subject-only --issue issue:<NNNN>:<NN>` 并取得 `0` (只核对 subject, 治理 Input 和 Reviewer Role 的变化不阻断), 然后提交. 按 `../implement/SKILL.md` 的 Entry 节的行为保持重构例外实施, 没有就绪记录的 issue 跳过 `verify`. 提交后建议用户运行 `$retro` 复盘本次工作.

## Commit Audit

### Scope

- `authorizingIssueIds` 是已暂存实施的完整授权范围, 属于同一 effort. 尚未完成的 issue 可以授权中间提交.
- Gate 1 覆盖本次每个新进入 `completed` 或 `wontfix` 的 issue, 它必须在授权范围内. Engine 拒绝遗漏授权和跨 effort 的变化.
- Gate 1 同时包含由 diff 驱动的回归检查: 检索与核对步骤由 `docs/agents/roles/requirements-reviewer.md` 的差异回归检查拥有.
- Gate 2 是 effort 级 Spec Audit, 在当前 effort 的每个实施 issue 都处于终态时适用. 范围是 `git diff <since> <tree>` 中治理文档 (`docs/specs/`, `docs/adr/` 下的 Markdown 和当前 effort 的 `spec.md`, `PRD.md`) 的改动, `since` 由引擎从 Git 历史推导为 effort 起点. 没有这类改动时无需审核.

### Run

1. 在 `<仓库根>/.tmp/<目录>/input.json` (文件名必须是 `input.json`) 写一个文件, 只含完整排序的 `authorizingIssueIds`. 运行 `arw commit-audit prepare --input <absolute-input-path>`; 它新建审核轮目录 `_commit-audit/<n>/` (见 `../reviewer-launch/SKILL.md` 的 Review rounds 节), 其中 `request.json` 含 `gate1`, `gate2` (文档与 `since`), `reviewPath` 和受审版本 `base`, `tree`, 在标准输出只打印轮目录, 并在标准错误输出候选的实测净增 (代码行数, 文档字符数, 测试行数) 和下一个 ADR 编号, 写 issue 的 `## Validation` 或 `## Comments` 时原样复制摘要块 (一个 issue 分多次提交时把各次数字相加); 摘要后的 `warning:` 行逐条核对 (含 Validation 缺摘要块, 数字与实测不符), 它们不是关卡, 但要先改 Validation 并重新 `prepare`, 再启动 Reviewer, 不留给 Reviewer 发现.
2. 按 `../reviewer-launch/SKILL.md` 的 Review rounds 节运行 `cat <轮目录>/*.jsonl | arw background-agent --wait`. Reviewer 按 `docs/agents/reviewer.md` 的 Report 节逐条写入问题, 或写 `No problems.`.

Main Agent 负责暂存, Request, 审核协调和处理问题, 不代写语义判断. Reviewer 只用只读 git 命令读取 `base` 和 `tree`, 不调用 Engine, 不修改索引.

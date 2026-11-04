---
description: 用户要求 Git 提交后使用: 对已暂存候选分类, 执行实施 issue 提交 (要求符合审核与 Code Standards 两个并行 Reviewer, Gate 1 和 Gate 2 范围) 或非实施机械提交, 并编写提交说明. 完成或解决 issue 本身不触发.
name: commit
---

# 提交

只有用户要求 Git 提交后才使用. 完成或解决 issue 本身不启动审核, 暂存或提交验证.

## Select the workflow

- 每个提交只包含一个 effort, Main Agent 只暂存该 effort 的内容. 共享文件中的改动按实际语义归属判断, 不按路径猜测.
- 检查精确的已暂存路径集合. 每一项都符合 Non-implementation commit workflow 节时使用非实施工作流; 任何一项属于当前仓库的实施工作时, 对完整候选使用 Implementation issue commit workflow 节; 某项无法分类时先停止并解决归属, 不推断它是实施工作.
- 只改 Agent 规则与文档 (`AGENTS.md`, `docs/**`, Skill 及其 `.claude/skills` 投影中的 Markdown, 以及仓库根目录的 `README.md`, `CONTEXT.md`, `CLAUDE.md`) 的候选属于非实施分类, 不要求 effort. 代码仍是实施工作.
- 同一实施授权覆盖完整候选时, 符合条件的非实施内容可以与实施工作保留在一起, 不因一项原子变更同时更新规划记录或仓库状态而拆分它. 授权范围外的内容先取得自己的授权, 才能加入候选.

## Implementation issue commit workflow

1. 确定完整排序的 `authorizingIssueIds`, 按 `../code-review/result-reuse.md` 的 Completion records 节规则更新真实的 Status 和验收勾选, 暂存完整实施候选. 必要实施验证按 `validation` Skill, 可以与审核并行; 未完成的检查不提供通过事实.
2. 启动 Reviewer 前自查 (这些是复审的常见问题): 没有重新实现已有公共辅助函数; 无死代码, 文件内部导出已去掉; 测试名与断言相符, 测试回调耗时满足 `validation` Skill 的 Coverage 节规定的阈值; 审核对象是已暂存的真实树, 不审私有索引 (`git write-tree` 取树).
3. 按 Run 节准备审核轮, 并行运行 `requirements-reviewer` (要求符合审核) 和 `code-standards-reviewer`. 一次提交最多这两个并行 Reviewer.
4. 两个 Reviewer 正常结束 (`ready`) 后, 按 `docs/agents/subagent-findings.md` 独立核对报告中的每个问题. 每轮自选一两处 Reviewer 应当检查的要求或代码位置抽查, 其中至少一处是回归抽查 (改动代码所服务的既有要求是否仍成立); 发现漏检时该轮结果作废并重审. Reviewer 返回 `incomplete` 时本轮结束, Main Agent 处理其原因后重新 `prepare`.
5. 修复后暂存 (审核运行期间也可以暂存) 并用同一 `input.json` 再次 `prepare`; 新一轮自动沿原线程复审, 只交付相邻版本变化和该 Reviewer 的前轮报告 (`docs/agents/reviewer.md` 的 Re-review 节). 某个 Reviewer 的输入没有受影响时只运行另一个的 `.jsonl`, 保留其结果. 复审报告中写明仍成立且本轮变化没有解决它的旧问题, 若已在台账记录处置, 不再重新分流. 处置台账: 不修复的问题记入问题所属授权 issue (无法归属时记入排序第一的) 的 `## Comments`, 每条一行 `台账: <文件和行或章节> <转入后续 issue|记录不修|冲突裁决> <理由>`, 定位精确到句子或行且只覆盖所列问题 (过宽的条目会让 Reviewer 漏报邻近的真实问题), 并在 `prepare` 前暂存; `prepare` 把全部授权 issue 的 `## Comments` 交给 Reviewer, 本轮变化没有触及其定位和影响范围的台账问题不再被报告. 轮次按同一次提交尝试 (同一授权范围) 中 `prepare` 的次数计, 第 3 轮起只为行为缺陷开修复轮 (无论由谁引入, 拿不准按行为缺陷处理), 措辞, 重复和文档去重类问题记 "记录不修" 后不再修. Code Standards 与要求符合审核的结论互相冲突时, 包括后一轮要求改回前一轮按另一个 Reviewer 所做的修复, Main Agent 按 effort spec 裁决并记 "冲突裁决", 不直接改回. 修复会改变 effort spec 或授权 issue 已写明的事实 (接口, 位置, 数据流, 失败结果, 行为, 输出, 持久状态, 范围或验收含义) 时, 同一修复中改写这些文字 (spec 按 `../rule-and-design-changes/SKILL.md` 的 Reviewer-proposed changes 节, issue subject 按 `../spec-readiness/SKILL.md` 的 Authorization timing 节), 或把修复收窄到 spec 允许的范围; 不做该修复时记 "冲突裁决". 台账不用于驳回 Reviewer 的问题, 认为问题无效仍走质疑规则.
6. 按 `../issue-tracking/SKILL.md` 的 Issue record sections 节规则统一暂存收尾记录, 用 `git diff <受审 tree> $(git write-tree)` 核对最终暂存树相对受审版本只有记录差异. 只有记录差异不需要复审. `arw commit-audit verify` 也机械核对这一点: 授权 issue 的 `Status` 和 What to build, Acceptance criteria 两段 (含验收勾选) 在 `prepare` 之后不得再改, 所以先勾选验收再 `prepare`; 失败时按提示重新 `prepare` 并复审.
7. 提交门槛是两个 Reviewer 正常结束且报告中的问题都已处理 (修正, 按质疑规则证明无效, 按 `docs/agents/subagent-findings.md` 的 Triage by origin 节记入后续 issue, 或按台账记 "记录不修" 或 "冲突裁决", 前者仅限第 3 轮起的措辞, 重复和文档去重类问题). 只修改代码的修复不使 Spec Readiness 记录失效, 不重跑就绪审核. 未完成 issue 的问题只在确属计划中尚未完成的工作时保留. 运行 `arw commit-audit verify` 并取得空错误列表.
8. 对每个授权 issue 先确认其 issue 文件没有未暂存修改 (`git diff --quiet -- <issue 文件>`), 再运行 `arw spec-readiness verify --subject-only --issue issue:<NNNN>:<NN>` 并取得 `0` (只核对 subject, 治理 Input 和 Reviewer Role 的变化不阻断), 然后提交. 按 `../implement/SKILL.md` 的 Entry 节的行为保持重构例外实施, 没有就绪记录的 issue 跳过 `verify`. 提交后建议用户运行 `$retro` 复盘本次工作.

## Commit Audit

### Scope

- `authorizingIssueIds` 是已暂存实施的完整授权范围, 属于同一 effort. 尚未完成的 issue 可以授权中间提交.
- Gate 1 覆盖本次每个新进入 `completed` 或 `wontfix` 的 issue, 它必须在授权范围内. Engine 拒绝遗漏授权和跨 effort 的变化.
- Gate 1 同时包含由 diff 驱动的回归检查: 检索与核对步骤由 `docs/agents/roles/requirements-reviewer.md` 的差异回归检查拥有.
- Gate 2 是 effort 级 Spec Audit, 在当前 effort 的每个实施 issue 都处于终态时适用. 范围是 `git diff <since> <tree>` 中治理文档 (`docs/specs/`, `docs/adr/` 下的 Markdown 和当前 effort 的 `spec.md`, `PRD.md`) 的改动, `since` 由引擎从 Git 历史推导为 effort 起点. 没有这类改动时无需审核.

### Run

1. 在仓库 `.tmp/` 下写一个 `input.json`, 只含完整排序的 `authorizingIssueIds`. 运行 `arw commit-audit prepare --input <absolute-input-path>`; 它新建审核轮目录 `_commit-audit/<n>/` (见 `../reviewer-launch/SKILL.md` 的 Review rounds 节), 其中 `request.json` 含 `gate1`, `gate2` (文档与 `since`), `reviewPath` 和受审版本 `base`, `tree`, 在标准输出只打印轮目录, 并在标准错误输出候选的实测净增 (代码行数, 文档字符数, 测试行数) 和下一个 ADR 编号, 写 issue 的 `## Validation` 或 `## Comments` 时直接复制 (一个 issue 分多次提交时把各次数字相加); 摘要后的 `warning:` 行逐条核对, 只是提示, 不是关卡.
2. 按 `../reviewer-launch/SKILL.md` 的 Review rounds 节运行 `cat <轮目录>/*.jsonl | arw background-agent --wait`. Reviewer 按 `docs/agents/reviewer.md` 的 Report 节逐条写入问题, 或写 `No problems.`.

Main Agent 负责暂存, Request, 审核协调和处理问题, 不代写语义判断. Reviewer 只用只读 git 命令读取 `base` 和 `tree`, 不调用 Engine, 不修改索引.

## Non-implementation commit workflow

只有精确的已暂存候选只包含已由初始规划记录, issue, map 或仓库工作流授权的符合条件内容, 且 (规则与文档项除外) 属于同一个 effort 时才使用. 符合条件的项只有:

- `.scratch/<NNNN>-<effort-slug>/spec.md` 和 `.scratch/<NNNN>-<effort-slug>/map.md`.
- ARW 解析为实施, Application Source 或 Wayfinder issue 的 `.scratch/<NNNN>-<effort-slug>/issues/<NN>-<issue-slug>.md`.
- `.scratch/<NNNN>-<effort-slug>/research/**` 或 `.scratch/<NNNN>-<effort-slug>/prototype/**` 下的安全普通文件, 可以使用任何扩展名, 不要求其他文件链接它们.
- 只含上述规则与文档 Markdown 的改动, 不要求就绪记录. 没有 issue 授权的此类改动不与任何 issue 的改动放在同一提交; 多处这类改动可以合并为一个提交, 提交说明正文逐项写明修改的原因和目的. 运行 `arw text check`, Main Agent 用 grep 自查跨文档引用和副本一致性. 例外: 改动审核系统本身 (Reviewer 角色, 关卡语义) 或长期规范合同条款时, 由 Main Agent 按 `reviewer-launch` 的 Other reviews 手工准备并启动一个 `requirements-reviewer` (普通身份, `issueIds` 为空数组, 再次审核按 `reviewer-launch` 复用原线程, 不用 `commit-audit prepare`), 最多一轮, 不运行 Spec Readiness; Main Agent 处理报告问题后提交, 不复审.
- 安全的 `gitlink`. 它把子模块提交记录为当前仓库状态, 是否符合条件不取决于 Application 配置, 自身路径或其他已暂存项; Main Agent 仍按实际语义把它归入本次 effort.

候选可以删除该 effort 的辅助文件, 但必须保留每个已提交的 ARW Artifact 身份; 类型和编号不变的重命名属于身份保留. 候选使实施 issue 新进入 `completed` (包括从另一个终态转换) 时, 只有该 issue 没有就绪记录且没有 `行为保持重构例外:` 声明 (它的全部交付都是规则, 文档和 `.scratch` 记录) 才符合条件, 有就绪记录的 issue 走实施 issue 工作流; 新进入 `wontfix` 不受此限; `HEAD` 中已处于相同终态的 issue 不因其他字节变化而再次进入该状态.

运行 `arw commit-audit verify --non-implementation`, 它完成上述分类, 单一 effort, 未暂存替代内容 (含子模块 `HEAD`), 终态转换, ARW Artifact 解析, 文本格式, `git diff --cached --check` 和身份保留的全部机械检查, 不做语义或跨文件检查. 错误列表为空才提交; 失败时修复候选后重跑, 完整候选包含实施工作时改用实施 issue 工作流.

该工作流不运行 Spec Readiness, Commit Audit, Code Review 或任何独立 Reviewer (规则与文档例外的 `requirements-reviewer` 除外).

## Commit messages

遵循 Conventional Commits 1.0.0, 标题使用 `<type>[optional scope][!]: <description>`. 用户可见功能使用 `feat`, 缺陷使用 `fix`; 常用辅助类型是 `docs`, `test`, `refactor`, `style`, `build`, `ci`, `perf` 和 `chore`. 破坏性变更在冒号前加 `!`, 或使用 `BREAKING CHANGE: <description>` 尾注. 描述简短并使用祈使语气; 只有理由, 迁移说明或取舍不明显时才写正文.

## Failure

任何关卡失败, 必要 Input 不可用, Reviewer 报告的问题未处理, 或 Reviewer 返回 `incomplete` 时, 在提交前停止.

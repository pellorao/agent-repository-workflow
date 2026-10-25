---
description: 用户要求 Git 提交后使用: 对已暂存候选分类, 执行实施 issue 提交 (要求符合审核与 Code Standards 两个并行 Reviewer, Gate 1 和 Gate 2 记录) 或非实施机械提交, 并编写提交说明. 完成或解决 issue 本身不触发.
name: commit
---

# 提交

只有用户要求 Git 提交后才使用. 完成或解决 issue 本身不启动审核, 暂存或提交验证.

## Select the workflow

- 每个提交只包含一个 effort, Main Agent 只暂存该 effort 的内容. 共享文件中的改动按实际语义归属判断, 不按路径猜测.
- 检查精确的已暂存路径集合. 每一项都符合 [非实施分类](#non-implementation-commit-workflow) 时使用非实施工作流; 任何一项属于当前仓库的实施工作时, 对完整候选使用 [实施 issue 工作流](#implementation-issue-commit-workflow); 某项无法分类时先停止并解决归属, 不推断它是实施工作.
- 同一实施授权覆盖完整候选时, 符合条件的非实施内容可以与实施工作保留在一起, 不因一项原子变更同时更新规划记录或仓库状态而拆分它. 授权范围外的内容先取得自己的授权, 才能加入候选.

## Fixed review version

从 `arw commit-audit prepare` 到本轮两个 Reviewer 完整结束或 Main Agent 明确终止期间, 不改变索引, HEAD 和本轮输入, 也不进行另一次提交. 工作树中的修复可以继续, 本轮结束后才暂存. 违反此边界的变化使本轮作废; `generate` 发现 Request 与当前候选不符时报告 `candidate-invalid`. 提升记录后到 `verify` 完成期间保持索引稳定.

## Implementation issue commit workflow

1. 确定完整排序的 `authorizingIssueIds`, 按 `code-review` 的 [完成记录](../code-review/result-reuse.md#completion-records) 规则更新真实的 Status 和验收勾选, 暂存完整实施候选 (不含本次 Gate 1 或 Gate 2 输出). 必要实施验证按 `validation` Skill, 可以与审核并行; 未完成的检查不提供通过事实.
2. 按 [Run](#run) 准备 Request, 并行启动两个 Reviewer: `requirements-reviewer` (要求符合审核) 和 `code-review` Skill 的 Code Standards 轴. 一次提交最多这两个并行 Reviewer.
3. 两个 Reviewer 返回 `ready` 后运行 `generate`, 按 `docs/agents/subagent-findings.md` 独立核对清单的 `gap`, `uncertain` 项和 Code Standards 问题. 每轮从清单 `satisfied` 项中抽查一到两项的证据定位; 证据不支持结论时, 该轮清单作废并重审.
4. 修复后重新暂存并在新目录 `prepare`. 复审只交付相邻版本的变化及影响范围和该 Reviewer 的前轮报告 ([复审规则](../../../docs/agents/reviewer.md#re-review)); 某个 Reviewer 的输入没有受影响时保留其结果.
5. 按 [记录章节](../issue-tracking/SKILL.md#issue-record-sections) 规则统一暂存收尾记录, 机械核对它相对受审候选的差异. 只有记录差异不需要复审.
6. 存在终态转换时, 只有 `generate` 成功且 `open` 中没有 `blocking: true` 项, 才原样提升映射字节, 暂存目标并运行 `arw commit-audit verify`. 未完成 issue 的非阻断 `gap` 只在确属计划中尚未完成的工作时保留, 否则按问题处理.
7. 对每个授权 issue 运行 `arw spec-readiness verify --issue issue:<NNNN>:<NN>` 并取得 `0`, 再核对最终候选只包含已审核版本, 获准记录差异和映射目标, 然后提交.

Main Agent 发现某个问题本应在已通过的 Gate 2 中被发现时, 在该 effort 的 spec 末尾记录一行 (问题, 对应提交和 Gate 2 Reviewer 模型), 作为调整 Reviewer 模型的依据.

## Commit Audit

### Scope

- `authorizingIssueIds` 是已暂存实施的完整授权范围, 属于同一 effort. 尚未完成的 issue 可以授权中间提交; 它的要求也进入清单, 但不产生 Gate 1 记录.
- 清单由 Engine 生成: 每个授权 issue 的 `## What to build` 正文行和每条验收标准各为一项; Gate 2 适用时, 治理文档的每个正文行 (非空, 非标题, 不在围栏代码块内) 各为一项. Reviewer 只填写结论和证据定位.
- Gate 1 覆盖本次每个新进入 `completed` 或 `wontfix` 的 issue, 它必须在授权范围内. Engine 拒绝遗漏授权和跨 effort 的变化.
- Gate 2 是 effort 级 Spec Audit, 在当前 effort 的每个实施 issue 都处于终态时适用. 文档是授权 issue 有效 `## Spec Requirement` 引用的 spec, PRD 和 ADR 的并集, 审核范围是整份文档.
- 适用 Gate 2 的文档并集为空时, 停止并取得用户明确确认. 只有包含具体 `reason` 和 UTC 秒级 `confirmedAt` 的 `gate2Exception` 才产生 `not-applicable` 记录.

### Run

1. 在仓库 `.tmp/` 下建立新目录, 写入 `input.json`, 只含完整排序的 `authorizingIssueIds` 和适用时的 `gate2Exception`. 运行 `arw commit-audit prepare --input <absolute-input-path>`; 它创建 `request.json` 和 `reports/review.md` (要求清单), 只打印 Request 绝对路径, 已有文件不覆盖.
2. 按 `reviewer-launch` Skill 启动 `requirements-reviewer`. 线程身份是该角色加完整排序的 `authorizingIssueIds`; `handoff` 提供 Request 路径; `reportPath` 是 `reports/review.md`.
3. Reviewer 返回 `ready` 后运行 `arw commit-audit generate --request <absolute-request-path>`. `review-incomplete` 表示清单有项缺少结论, 定位无效或缺少说明, 把诊断完整转交同一 Reviewer 修正; `request-invalid` 和 `candidate-invalid` 由 Main Agent 处理.
4. 成功时 Engine 在 Request 目录写入 `<NN>.audit.json` 或 `spec-audit.json`, 返回按 `targetPath` 排序的 `files` 映射和未满足项 `open`. Main Agent 只提升映射指定的准确字节.

Main Agent 负责暂存, Request, Engine 调用, 审核协调和提升, 不代写语义判断. Reviewer 不调用 Engine, 不修改索引.

### Audit records

- Gate 1 记录是 `.scratch/<NNNN>-<effort-slug>/issues/<NN>.audit.json`, Gate 2 记录是 `.scratch/<NNNN>-<effort-slug>/spec-audit.json`. 每项记录 `source`, `result`, 定位 `evidence` 和说明 `note`.
- 正式记录只对当时通过验证的候选有效, 之后只作为历史文件保留. `arw commit-audit verify` 只读取当前暂存终态变化所需的记录, 检查每个要求行都有 `satisfied` 或 `n/a` 结论且定位存在.

## Non-implementation commit workflow

只有精确的已暂存候选只包含已由初始规划记录, issue, map 或仓库工作流授权的符合条件内容, 且属于同一个 effort 时才使用. 符合条件的项只有:

- `.scratch/<NNNN>-<effort-slug>/spec.md` 和 `.scratch/<NNNN>-<effort-slug>/map.md`.
- ARW 解析为实施, Application Source 或 Wayfinder issue 的 `.scratch/<NNNN>-<effort-slug>/issues/<NN>-<issue-slug>.md`.
- `.scratch/<NNNN>-<effort-slug>/research/**` 或 `.scratch/<NNNN>-<effort-slug>/prototype/**` 下的安全普通文件, 可以使用任何扩展名, 不要求其他文件链接它们.
- 安全的 `gitlink`. 它把子模块提交记录为当前仓库状态, 是否符合条件不取决于 Application 配置, 自身路径或其他已暂存项; Main Agent 仍按实际语义把它归入本次 effort.

候选可以删除该 effort 的辅助文件, 但必须保留每个已提交的 ARW Artifact 身份; 类型和编号不变的重命名属于身份保留. 候选使实施 issue 新进入 `completed` 或 `wontfix` (包括从另一个终态转换) 时不符合条件; `HEAD` 中已处于相同终态的 issue 不因其他字节变化而再次进入该状态.

1. 运行 `git diff --cached --name-status` 并用 Git 检查已暂存项, 冻结非空路径集合, 状态, 项模式和对象身份. 拒绝不安全路径, 符号链接, 目录项, 不受支持的项和分类以外的项.
2. 确认每个已暂存项都没有未暂存的替代内容. 对照 `HEAD` 分类添加, 更新, 重命名和删除, 保留每个已提交的 `issue:<NNNN>:<NN>`, `map:<NNNN>` 和 `spec:<NNNN>` 身份, 检测实施 issue 的终态转换. 当前存在于工作树中的 `gitlink`, 其子模块 `HEAD` 必须等于已暂存对象身份.
3. 对每个新增或更新的已注册 ARW Artifact, 证明 `arw print <canonical-id>` 会读取已暂存字节后运行它, 只要求解析成功, 身份符合预期且记录类型正确. 不运行关系, 阻断项, 生命周期, 链接或语义检查.
4. 检查已暂存普通文件字节是没有 BOM 的 UTF-8 和 LF 行尾, 并运行 `git diff --cached --check -- <path>...`. 不评估散文含义, 完整性, 引用或跨文件一致性.
5. 再次读取已暂存路径集合, 状态, 模式和对象身份; 任何变化都从第 1 步重新开始.
6. 每项检查都成功后才提交. 失败时修复候选并重新开始; 完整候选包含实施工作时改用实施 issue 工作流.

该工作流不运行 Spec Readiness, Commit Audit, `arw commit-audit verify`, Code Review 或任何独立 Reviewer.

## Commit messages

遵循 Conventional Commits 1.0.0, 标题使用 `<type>[optional scope][!]: <description>`. 用户可见功能使用 `feat`, 缺陷使用 `fix`; 常用辅助类型是 `docs`, `test`, `refactor`, `style`, `build`, `ci`, `perf` 和 `chore`. 破坏性变更在冒号前加 `!`, 或使用 `BREAKING CHANGE: <description>` 尾注. 描述简短并使用祈使语气; 只有理由, 迁移说明或取舍不明显时才写正文.

## Failure

任何关卡失败, 必要 Input 不可用, 存在阻断的 `gap` 或 `uncertain` 或 Code Standards 问题未处理, 或 `code-review` 返回 `incomplete` 时, 在提交前停止, 不提升不完整的审计批次.

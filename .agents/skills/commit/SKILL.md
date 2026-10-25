---
description: 用户要求 Git 提交后使用: 对已暂存候选分类, 执行实施 issue 提交 (Code Review, Commit Audit 的 Gate 1 和 Gate 2) 或非实施机械提交, 并编写提交说明. 完成或解决 issue 本身不触发.
name: commit
---

# 提交

只有用户要求 Git 提交后才使用. 完成或解决 issue 本身不启动 Commit Audit, 暂存, 审查或提交验证.

## Select the workflow

- 每个提交只包含一个 effort, Main Agent 只暂存该 effort 的内容. 共享文件中的改动按实际语义归属判断, 不按路径猜测.
- 检查精确的已暂存路径集合. 每一项都符合 [非实施分类](#non-implementation-commit-workflow) 时使用非实施工作流; 任何一项属于当前仓库的实施工作时, 对完整候选使用 [实施 issue 工作流](#implementation-issue-commit-workflow); 某项无法分类时先停止并解决归属, 不推断它是实施工作.
- 同一实施授权覆盖完整候选时, 符合条件的非实施内容可以与实施工作保留在一起, 不因一项原子变更同时更新规划记录或仓库状态而拆分它. 授权范围外的内容先取得自己的授权, 才能加入候选.

## Exclusive Commit Audit

Commit Audit 固定当前仓库的完整索引, HEAD 和本轮绑定输入. 从 `prepare` 到该轮 Reviewer 完整结束或 Main Agent 明确终止期间, 不改变它们, 也不进行另一次提交. 工作树中的其他已授权工作和本候选的修复可以继续, 不替换旧轮证据; 该轮完整结束后才暂存新实现或记录. 违反此边界的索引, HEAD 或输入变化使本轮作废, 残留报告不是完整结果. 提升正式输出后到 `verify` 完成期间保持最终索引稳定. 不新增锁.

## Implementation issue commit workflow

1. 确定提交范围及完整排序的 `authorizingIssueIds`, 暂存完整实施候选, 其中不含本次提交操作产生的 Gate 1 或 Gate 2 输出.
2. 取得当前有效的 Spec Readiness (`spec-readiness` Skill) 和必要实施验证 (`validation` Skill). 它们可以与不依赖其结果的代码审核并行, 未完成的检查不提供通过事实.
3. 按 `code-review` 的完成记录规则核对真实完成状态和验收勾选, 然后冻结完整实施路径, blob 身份, HEAD 和树对象.
4. 使用 `code-review` Skill 完成 Gate 3. 它唯一拥有代码轴的结果复用, 完成标记, 比较, 修复和报告责任, 本 Skill 不另设判定.
5. 根据 `HEAD` 和已暂存候选判断是否有实施 issue 新进入 `completed` 或 `wontfix`.
   - 没有终态转换: 只完成所需代码审核, 不准备 Commit Audit, 不生成或提升 Gate 1 和 Gate 2, 不运行 `arw commit-audit verify`.
   - 存在终态转换: 满足 [固定审计范围](#exclusive-commit-audit) 后按 [Commit Audit](#commit-audit) 准备完整 Request; 需要新判断的代码轴可以与审计并行, 不默认等待 Gate 3 通过.
6. 取得各适用轴和审计的完整报告, 按 `docs/agents/subagent-findings.md` 独立核对问题并完成获准修复. 候选或适用输入真正变化时, 对替代版本完成受影响的就绪, 验证和差异复审, 保留未受影响的有效结果. 每个适用轴完整通过且没有未解决问题后继续; 审计完整结束不表示全部要求满足.
7. 按 [记录章节](../issue-tracking/SKILL.md#issue-record-sections) 规则统一暂存实际收尾记录, 机械核对它相对受审候选的准确差异. 只有记录差异不需要语义复审; 其他变化回到受影响的验证和复审.
8. 存在终态转换时, 审计完整报告写入后运行 `arw commit-audit generate --request <absolute-request-path>`. 只有生成完整且适用 Gate 1 和 Gate 2 都为 `satisfied` 时, 才原样提升映射字节, 批量暂存审计目标, 运行 `arw commit-audit verify` 及依赖正式输出的最终检查. 核对 HEAD 和暂存内容只包含已审核版本, 获准记录差异和准确映射目标, 不扩大暂存范围.
9. 按 [就绪授权时点](../spec-readiness/SKILL.md#authorization-timing) 重新验证最终内容. 全部适用审核与必要验证有效, 最终候选字节及允许差异核对成功后才提交.

已审实施内容不变而审计产物出错时, 不重新运行 Gate 3: `arw commit-audit verify` 只因提升或暂存出错而失败时, 只修正对应映射字节和必要定位后重新核对和验证; JSONL 审核输出无效时, 把完整诊断交给同一个 Commit Audit Reviewer 修订完整草稿后重新生成.

## Commit Audit

### Scope

- `authorizingIssueIds` 是已暂存实施的完整授权范围, 可以包含同一 effort 的多个 issue. 尚未完成的实施 issue 可以授权中间代码提交: 它出现在 `authorizingIssueIds` 中, 但不进入 Gate 1, 以免未完成的验收标准过早成为提交阻断项.
- Gate 1 只覆盖本次实际的终态转换. 每个新进入 `completed` 或 `wontfix` 的 issue 都必须获得授权并具有 Gate 1. ARW Engine 根据已暂存候选推导机械可见的终态转换, 并拒绝遗漏授权, 缺少或未授权的 Gate 1 项, 以及重复或冲突记录. 独立 Reviewer 判断 Git 无法证明的代码与 issue 关系, 包括只含代码的候选和重新打开后再次完成的历史.
- Gate 1 覆盖 `## What to build` 中每条非空, 非标题, 非围栏代码块的正文行和每条验收标准. 每项具有准确正数来源行, 简短要求, 证据及 `satisfied`, `gap` 或 `uncertain`; `satisfied` 须有证据且没有问题, 其他结果须有可采取行动的说明. `## Validation` 和 `## Comments` 不是要求来源.
- Gate 2 是 effort 级 Spec Audit, 在当前 effort 的每个实施 issue 都处于终态时适用, 由 Engine 根据已接受的授权 issue 和完整的已暂存 effort 清单推导. 其 `documents` 和要求是本批已接受授权 issue 有效 `## Spec Requirement` 的并集, 不因 effort 把相关背景文档或长期规范作为输出修改而加入它们. 审核范围和来源行下限见 [Gate 2 规则](../../../docs/agents/roles/commit-audit-reviewer/gate-2.md).
- 适用 Gate 2 的要求并集为空时, 停止并取得用户明确确认. 只有包含具体 `reason` 和 UTC 秒级 `confirmedAt` 的 `gate2Exception` 才产生完整的 `not-applicable` 记录; 空数组本身不构成确认, 例外也不豁免其他关卡.

### Run

1. 在仓库 `.tmp/` 下为本次审核建立独立目录, 写入固定名称 `input.json`, 只包含同一 effort 完整排序的 `authorizingIssueIds` 和适用时的单个 `gate2Exception`. 运行 `arw commit-audit prepare --input <absolute-input-path>`. 它在同一目录创建 `request.json`, 在独立的 `reports/` 子目录创建空 `review.jsonl`, 只返回 Request 绝对路径. `reports/` 是本次唯一获准的报告目录; 除本次 `input.json` 外, 任何受管理文件碰撞都使准备失败且不覆盖现有内容.
2. 按 `reviewer-launch` Skill 启动 `commit-audit-reviewer`. 线程身份是该角色加完整排序的 `authorizingIssueIds`; `handoff` 只提供当前 Request 路径 (复审另加该 Skill 规定的前轮材料); `reportPath` 是该 `review.jsonl`.
3. Reviewer 完整返回 `ready` 后, 按记录章节规则机械核对并统一暂存记录差异, 再运行 `arw commit-audit generate --request <absolute-request-path>`. Engine 依次检查 `request`, `candidate-preconditions`, `review-syntax`, `requirement-coverage`, `evidence` 和 `output-plan`, 只报告最早失败阶段中能够安全确定的全部诊断. `review-output-invalid` 完整转交同一 Reviewer 修订绑定草稿; `request-invalid`, `candidate-invalid`, `output-write-failed` 和 `generation-failed` 由 Main Agent 处理. 每次重试仍消费完整 JSONL.
4. 成功时 Engine 在 Request 目录中平铺生成 `<NN>.audit.json` 或 `spec-audit.json` 等适用文件, 并返回按 `targetPath` 排序的完整 `files` 映射, 路径都相对仓库根目录. Main Agent 只把映射指定的准确来源字节提升到对应目标并暂存. 任何 `gap` 或 `uncertain` 都阻止整批提升. 写入失败不返回映射, 残留临时文件没有提升资格.

Main Agent 负责实施, 暂存, Request, Engine 调用, 审核协调和正式提升, 不代写语义判断. Reviewer 不调用 Engine, 不生成正式记录, 不修改索引.

### Audit records

- Gate 1 记录是 `.scratch/<NNNN>-<effort-slug>/issues/<NN>.audit.json`, `issueId` 使用 `issue:<NNNN>:<NN>`. Gate 2 记录是 `.scratch/<NNNN>-<effort-slug>/spec-audit.json`, `effort` 使用 4 位编号, 不含 issue 身份. 正式记录不使用 `schemaVersion`; 不使用 Markdown 审计章节或 `Full Issue Audit`.
- 正式记录只对当时冻结并通过验证的候选有效, 之后只作为历史文件保留. `arw commit-audit verify` 只读取当前暂存终态变化所需的记录.
- 旧轮完整结束后, 仅记录章节差异经机械核对不需要新 Request. 实施, 要求, 输入或结论的真正变化需要新的完整 Request.

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

任何关卡失败, 必要 Input 不可用, 结论为 `gap` 或 `uncertain`, 或 `code-review` 返回 `incomplete` 时, 在提交前停止, 不提升不完整的审计批次.

<!-- arw:managed:start -->
# 提交工作流

只有在用户要求 Git 提交后才使用该工作流. 完成或解决 issue 本身不会启动 Commit Audit, 暂存, 已暂存审查或提交验证.

## Select the commit workflow

选择工作流前, 检查精确的已暂存路径集合, 然后按以下条件选择:

- 每个提交只包含一个 effort. Main Agent 只暂存该 effort 的内容. 共享文件中的改动按其实际语义归属判断, 不根据路径猜测.

- 只有每个已暂存项都满足完整的符合条件内容分类器时, 才使用非实施提交工作流.
- 任何一项属于当前仓库的实施工作时, 对完整候选内容使用实施 issue 工作流.
- 某项不满足任何分类时, 在选择工作流前停止并解决其责任归属. 不得推断未分类项都是实施工作.

如果同一项实施授权覆盖完整候选内容, 符合条件的非实施内容可以与实施工作保留在一起. 不得仅因一项原子实施变更同时更新规划记录或仓库状态而拆分它. 授权范围外的内容必须先获得自己的适用授权, 才能加入候选内容.

## Exclusive Commit Audit

Commit Audit 固定当前 Git 仓库的完整索引, HEAD 及本轮完整绑定输入和执行规则. 从准备到该轮 Reviewer 完整结束或 Main Agent 明确终止期间不改变这些范围, 不进行另一次提交. 其他 Reviewer 可以读取各自完整固定版本, 工作树中的其他已授权工作及本候选已授权修复可以继续, 不替换旧轮审计证据. Request, 报告及 Engine 临时产物在各自获准范围写入, 不新增原生锁.

开始前取得当前有效就绪和必要实施验证, 最终候选及已有完成记录真实齐备, 并确认本轮索引, HEAD 和输入已完整固定. 同候选 Code Standards, Code Spec 与 Commit Audit 可以同时开始, 不以代码轴已经通过为默认前提. 正式验收实际要求另一审核完成事实时保留真实依赖. 所有审核仍须完整交付适用通过结果才能提交, 不能把正在审核或暂时无输出当作通过或停止.

已授权修复可以先写工作树, 旧审计继续读取固定索引并完整结束. 该轮完整结束后才暂存新实现和准备替代版本, 受影响审核按[公共复审规则](reviewer.md#review-changes-and-prior-coverage)取得完整当前结果. [记录章节](issue-tracker.md#issue-record-sections)也先写工作树, 完整旧轮结束后机械核对并统一暂存, 差异本身不要求语义复审. 未经这项边界允许的索引, HEAD 或绑定输入变化使本轮停止, 不把残留报告当完整结果. 提升正式输出后到 verify 完成期间保持最终索引稳定.

## Implementation issue commit workflow

1. 确定已授权的提交范围及其完整排序的 `authorizingIssueIds`. 检查仓库状态, 并暂存完整的实施候选内容, 其中不包含本次提交操作产生的 Gate 1 或 Gate 2 输出.
2. 安排适用的 Spec Readiness 检查和必要实施验证, 按[验证规则](validation.md)并行或复用有效事实. 就绪需要刷新时准备完整当前工作流, 可与不依赖它的代码审核及已授权实施并行, 待完成检查不提供通过事实.
3. 核对真实完成状态及验收勾选, 按 `code-review` 的完成标记规则处理; [记录章节](issue-tracker.md#issue-record-sections)保存已发生的实施证据. 正式验收以某审核通过为条件时先完成该真实依赖, 不预写未来成功. 运行受影响文档验证, 取得当前有效就绪及必要实施验证后冻结完整实施路径, blob 身份, HEAD 和树对象.
4. 使用 `code-review` 按轴判断结果复用. 已有完整有效结果直接保留, 需要新判断的轴接收同一固定候选及完整输入. 该技能唯一拥有代码轴有效性, 完成标记, 比较, 修复和报告责任; 本文不添加另一套 Gate 3 判定.
5. 根据 `HEAD` 和当前已暂存候选判断是否有 implementation issue 新进入 `completed` 或 `wontfix`.
6. 没有终态转换时只完成所需代码审核, 不准备 Commit Audit, 不生成或提升 Gate 1 或 Gate 2, 不运行 `arw commit-audit verify`, 然后按第 8 步收尾. 存在转换时满足[固定审计范围](#exclusive-commit-audit), 按 [Commit Audit Workflow](commit-audit-workflow.md)准备完整 Request; 同候选需要新判断的代码轴与审计可以并行, 不默认等待 Gate 3 通过.
7. 取得各适用轴和审计的完整报告, 独立核对问题并进行获准修复. 工作树修复不改变旧轮版本; 依赖实时索引的旧审计完整结束后才能暂存新实现. 真正候选或适用输入变化时对替代版本完成受影响验证及所需差异复审, 保留未受影响的有效代码轴结果. 每个适用代码轴完整有效通过且没有未解决问题后继续, 审计完整结束不表示全部要求满足.
8. 按记录章节规则统一暂存实际收尾记录, 机械核对相对受审候选的准确差异及文档, 定位, 当前事实. 只有记录差异不需要语义复审. 没有终态转换时核对最终候选和 HEAD 符合已审版本及允许记录差异, 进入第 10 步; 其他变化返回受影响验证及复审.
9. 存在终态转换且审计完整报告已经写入时调用 `arw commit-audit generate --request <absolute-request-path>`. 输出无效交回同一 Reviewer 修正完整草稿, 其他失败按审计工作流处理. 只有完整生成结果且适用 Gate 1 和 Gate 2 都为 `satisfied` 才原样提升映射字节, 批量暂存审计目标, 运行 `arw commit-audit verify` 及依赖正式输出的最终检查. 核对 HEAD, 实施范围和内容只包含已审核版本, 获准记录差异及准确映射目标, 不扩大暂存范围.
10. 按[就绪授权时点](spec-readiness.md#authorization-timing)重新验证最终当前结果. 全部适用审核与必要验证有效, 最终候选字节及允许差异核对成功后才提交.

终态转换分支中的 Commit Audit 开始前, 按 `code-review` 判断候选变化是否使审查结果失效.

运行中的 Commit Audit 索引或输入漂移使本轮失效. 完整结束后, 仅记录章节变化按其机械规则处理; 真正实施, 要求或其他适用输入变化需要新的完整 Request 和完整当前报告, 原 Reviewer 按公共规则差异复审. 替代候选重新执行受影响的就绪和验证, 代码轴按 `code-review` 判断实际影响, 不默认重跑全部通过轴或全盘审核.

已批准实施内容不变, 只存在获准记录差异时, 审计产物错误按以下方式处理. 两种情况都不重新运行 Gate 3:

- `arw commit-audit verify` 失败且问题只在准确提升或暂存时, 只修正对应映射字节和必要定位, 重新核对并验证.
- JSONL 审核输出无效时, 把完整诊断交给同一个 Commit Audit Reviewer 修订完整草稿并重新生成.

## Non-implementation commit workflow

只有在用户要求 Git 提交, 且精确的已暂存候选内容仅包含已经由适用的初始规划记录, issue, map 或仓库工作流授权的符合条件内容时, 才使用该工作流.

候选内容只属于一个 effort, 可以添加或更新符合条件的项. 它可以删除该 effort 的辅助文件, 但必须保留每个已经提交且已注册的 ARW Artifact 身份. 保持相同类型和编号的路径重命名属于身份保留, 不是删除.

只有采用以下形式之一的项才符合条件:

- `.scratch/<NNNN>-<effort-slug>/spec.md`.
- `.scratch/<NNNN>-<effort-slug>/map.md`.
- ARW 解析为实施, Application Source 或 Wayfinder issue 的 `.scratch/<NNNN>-<effort-slug>/issues/<NN>-<issue-slug>.md`.
- `.scratch/<NNNN>-<effort-slug>/research/**` 或 `.scratch/<NNNN>-<effort-slug>/prototype/**` 下的任何安全普通文件.
- 任何安全的 `gitlink`.

`gitlink` 把所引用的子模块提交记录为当前仓库中的仓库状态. 它不是该仓库的实施产物. 它是否符合条件不取决于 Application 配置, 自身路径或其他已暂存项.

只有在已暂存候选内容不会使实施 issue 进入 `completed` 或 `wontfix` 时, 它才继续符合条件. 新的终态 issue, 从非终态发生的转换, 或从另一个终态发生的转换, 都不符合非实施提交工作流. 已经在 `HEAD` 中处于相同终态的 issue, 不会仅因其他字节发生变化而再次进入该状态.

研究和原型文件可以使用任何扩展名, 且不要求 map, issue, spec 或其他文件提供链接. 该工作流不检查阻断项是否已经解决, 不要求 map 决定指针, 不验证链接或跨文件关系, 不评估含义或完整性, 也不增加删除后果检查. `gitlink` 不需要伴随 Application Source Issue 或其他规划记录, 但 Main Agent 仍要按实际语义把它归入本次唯一 effort.

运行以下完整顺序:

1. 运行 `git diff --cached --name-status`, 并使用 Git 检查已暂存项. 冻结非空路径集合, 状态, 项模式和对象身份. 拒绝不安全路径, 符号链接, 目录项, 不受支持的项, 或完整符合条件内容分类器以外的任何项.
2. 确认每个已暂存项都没有未暂存的替代内容. 使用已暂存状态和 `HEAD` 项对添加, 更新, 重命名和删除操作分类, 保留每个已经提交的 `issue:<NNNN>:<NN>`, `map:<NNNN>` 和 `spec:<NNNN>` 身份, 并检测进入 `completed` 或 `wontfix` 的实施 issue. 只有类型和编号保持不变时, 才允许重命名描述性 slug. 对当前存在于 `gitlink` 工作树中的项, 要求其当前子模块 `HEAD` 等于已暂存对象身份. 嵌套的未提交文件内容不能替代该 `gitlink` 身份.
3. 对每个新增或更新的已注册 ARW Artifact, 只有在证明 `arw print <canonical-id>` 会读取已暂存字节后才运行该命令. 要求基础解析成功, ARW Artifact 身份符合预期, 且记录类型正确. 不得运行关系, 阻断项, 生命周期完成, 链接, 覆盖或语义检查. 保留身份的重命名操作中, 旧路径已无剩余字节可供解析.
4. 根据适用的机械文本规则检查精确的已暂存普通文件字节, 包括没有 BOM 的 UTF-8 和 LF 行尾. `gitlink` 没有普通文件字节可供检查. 不得评估散文含义, 完整性, 引用, 值或与其他文件的一致性. 对精确候选内容运行 `git diff --cached --check -- <path>...`.
5. 再次读取已暂存路径集合, 状态, 模式和对象身份. 任何变化都会使工作流从第 1 步重新开始.
6. 只有每项机械检查都成功后才执行提交. 失败会在提交前停止工作. 修复候选内容并重新开始. 只有完整候选内容包含实施工作时, 才把它送入实施 issue 工作流.

该非实施提交工作流不运行 Spec Readiness, 不创建或验证就绪记录, 不运行 Commit Audit, 不创建 Gate 1 或 Gate 2 记录, 不运行 `arw commit-audit verify`, 不调用 Gate 3 或 Code Review, 也不使用任何独立 Reviewer.

## Commit Audit workflow

只有 `Implementation issue commit workflow` 的第 5 步识别到终态转换后, 才对实施 issue 提交执行 Gate 1, Gate 2, 独立 Reviewer 和审计有效期工作. 开始这些工作或 Gate 3 前, 阅读 [Commit Audit Workflow](commit-audit-workflow.md).

## Commit messages

遵循 Conventional Commits 1.0.0. 使用标题 `<type>[optional scope][!]: <description>`. 对用户可见功能使用 `feat`, 对缺陷使用 `fix`. 常用的辅助类型是 `docs`, `test`, `refactor`, `style`, `build`, `ci`, `perf` 和 `chore`.

在冒号前紧接着使用 `!`, 或使用 `BREAKING CHANGE: <description>` 尾注标记破坏性变更. 描述保持简短并使用祈使语气. 只有在理由, 迁移说明或取舍不明显时才添加正文.

## Failure behavior

如果任何关卡失败, 必要的 Input 不可用, 结论是 `gap` 或 `uncertain`, 或 `code-review` 返回 `incomplete`, 则在提交前停止. 不得提升不完整的审计批次. Commit Audit 前的候选变化按 `code-review` 的有效性和完成记录规则处理. 审计开始后的候选变化或审计产物错误, 按实施提交工作流的失效边界回退.
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
None.
<!-- arw:repository-owned:end -->

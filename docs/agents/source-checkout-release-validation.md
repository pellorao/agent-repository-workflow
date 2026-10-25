# Source Checkout 发布验证

每次新发布验证按以下顺序开始:

1. 读取当前签出根目录中的 `package.json.version`. 期间不解析候选内容, 也不创建临时状态.
2. 向用户提出精确问题 `是否确认对 <version> 版本进行发布验证?`, 把 `<version>` 替换为精确的软件包值.
3. 只有用户明确肯定后, 才开始验证所显示的版本.

这项回答不授权发布, 分支推送, 创建标签, 推送标签或创建 GitHub 发布对象. 回答缺失, 拒绝或含糊时, 在每个后续步骤前停止. 如果用户表示软件包值与希望验证的版本不同, 终止当前发布验证. 告知用户必须在发布验证外另开 issue 更改 `package.json`, 且不得继续取得 VM 配置或运行验证.

取得精确版本确认后, 向用户询问本次发布所用模式版本 2 VM JSON 和独立本地来源 JSON 的绝对路径, 再询问是否为本次发布完全跳过 Reviewer Capability Conformance. 只接受明确的 `skip` 或 `run`. 这两个回答只属于当前连续发布操作, 但同一操作中的修复轮次继续使用已经确认的路径和选择, 不重复询问. 路径, 内容和凭据不得写入仓库文件或发布证据.

发布验证维护命令使用该路径执行有界的虚拟机调度, 生命周期操作, 传输, 来宾系统执行, 结果取回, 恢复和清理. 每次 `run` 或 `resume` 仍重新读取并验证原路径中的当前文件. 运行状态不保存配置字节, 哈希或凭据.

## Local candidate loop

完整发布验证仍要求候选历史中存在较早的稳定 Release. 没有该输入时停止, 不因候选解析支持空树而跳过旧版矩阵或制造正式旧版.

发布验证的候选来自当前 issue 已批准并暂存的完整索引. Main Agent 在当前会话临时工作区创建隔离的本地 Repository, 以当前 Source Checkout `HEAD` 为 parent, 用准确暂存 tree 创建一个只供验证的 Git 提交. 当前 Source Checkout 分支和 `HEAD` 保持不变. 临时 Repository 的 `HEAD` 必须是该提交, 工作树必须干净, `origin` 显示值必须仍是 `release-validation.json` 配置的规范地址.

验证命令只在自己的子进程环境中使用精确 Git URL 映射, 把该规范地址重定向到本次隔离的本地裸 Repository. 映射不写入用户或 Repository Git 配置, 不传给正式发布操作, 并在子进程结束时消失. 因此本地验证执行候选中的真实 Bootstrap 和正常 Git tag 选择, 解析, fetch, checkout 与 Installer 交接, 但不声称验证 GitHub HTTPS 网络或远程 tag 可见性.

首次候选按以下阶段验证:

1. 验证根 `release-validation.json` 和用户提供的外部 VM JSON. 在任何 Reviewer 能力 `prepare` 或线程启动前消费已确认的 `skip | run`. `skip` 不运行能力批次; `run` 为每个受影响 Reviewer 完成发布规则要求的 3 实例聚合和会话检查.
2. 从临时提交解析版本, commit, tree, 基线和排序后的变更路径. 确认版本递增, 且隔离本地 Repository 中不存在当前版本 tag.
3. 使用 `release-validation.json` 中的宿主命令时限准备 Registry 要求的 Git 捆绑包. 候选捆绑包只从隔离 Repository 创建, 并且只携带准确候选分支及候选历史中低于候选版本的最近稳定 Release tag. 准备过程必须验证该 tag 可从候选到达, tag 指向准确 commit, 且该 commit 中的 `package.json` 版本与 tag 一致. 两个目标由仓库外来源 JSON 的目录复制当前内容并建立当次 Git 基线, 不从远端取得固定提交. 调用 `prepare-bundles` 时显式传入 `--sources <absolute-json-path>`.
4. 运行 `node scripts/release-vm-validation.mjs run --config <absolute-json-path> --candidate <full-commit> --workspace <absolute-session-workspace>`. 这个阶段只运行 Registry 中的 `pre-tag` VM 场景. 只遵循返回的语义或补偿交接路径, 并使用 `resume` 继续. 不得手动重放已注册步骤.
5. 对每个待处理项, 在其 `responseTemplatePath` 指明的精确普通文件中原位编辑, 然后把同一路径传给 `resume --input`. 不得保存或传递复制出的响应路径.
6. Runner 只根据清理通过且所有正式步骤均通过的场景创建 Registry 要求的归档. 完整结果必须确认每个已注册的 `pre-tag` 归档, 且没有失败, 诊断, 未解决或待处理交接. `post-init` 场景及其归档不属于这个计划.
7. 在临时 Repository 中运行 `pre-tag` Release Conformance. 它验证归档, 文档术语, pnpm `>=11 <12`, frozen install, typecheck, test, ESM 语法, 生成的 Bootstrap, 文本和差异检查. 成功结果必须返回 `tagAllowed: true`.
8. 只有 `pre-tag` Release Conformance 通过后, 才向用户询问是否运行 Registry 中唯一的 `post-init` VM 场景. 只接受明确的 `skip` 或 `run`, 不设默认值. 把选择作为 `--choice <skip|run>` 传给 `node scripts/release-vm-validation.mjs post-init-choose --candidate <full-commit> --choice <skip|run> --pre-tag-result <absolute-pre-tag-result-path> --state <absolute-post-init-state-path>`. `run` 还必须传入原来的 `--config <absolute-json-path>` 和 `--workspace <absolute-session-workspace>`. `skip` 不准备或启动这个场景. `run` 执行它的完整步骤, Agent 交接, 后续机械验证, 清理和归档; 待处理交接只使用 `post-init-resume --candidate <full-commit> --state <absolute-post-init-state-path> [--input <absolute-response-path>]` 继续. 任一失败都会使当前候选失败, 不得改用 `skip` 忽略已经发现的问题. 最后使用 `post-init-status --candidate <full-commit> --state <absolute-post-init-state-path>` 机械确认 `tagAllowed: true`. 本地状态必须能够区分明确跳过, 尚未询问和证据缺失.
9. 只在隔离本地裸 Repository 中为候选 commit 创建准确版本 tag. 使用相同的进程级 URL 映射执行候选中的真实 Bootstrap, 创建 Registry 登记的 `post-tag` 归档, 再运行本地 `post-tag` Release Conformance. 这个阶段不使用 VM. 成功结果必须返回 `tagAllowed: false`.

本地版本 tag 不进入 Source Checkout, 不写入规范远程, 不创建 GitHub 发布对象, 也不授权正式发布. 候选被替代或当前操作结束后删除整个隔离 Repository. 正式发布仍按[发布和恢复](source-checkout-release-publication.md)验证真实远程状态.

Registry 中的跨平台 Installation 场景必须使用候选捆绑包携带的最近稳定 Release tag 建立真实旧版本 checkout, 不得通过改写候选版本号构造旧版本. 每个适用平台依次验证安装旧版本, 同版本 repair, 升级到候选, 默认模式拒绝降级, 明确授权降级到旧版本, 以及再次升级恢复候选. 每项安装由被安装 Release 自己的 Installer 和载荷验证器验证其 tag, commit, 软件包版本及源载荷, Guest 不得导入或解释其他 Release 的内部模块. 安装后还必须验证已安装 manifest, 已安装命令版本, PATH 所有权和状态转换边界. 已安装 manifest 声明的 managed file 路径集合必须与同一 Release checkout 中应安装的完整路径集合准确相同, 并且每个已安装条目都必须是与该 checkout 对应条目类型和字节准确相同的普通文件. 清单缺失或多出路径, 条目类型不一致, 文件缺失或任何字节不一致都使验证失败. 候选升级的机械预期使用候选自己的配置转换规则计算已有配置的预期字节. 如果旧版本不能接受候选迁移后的配置, 隔离 home 中的显式降级必须明确重建旧版本配置, 再次恢复候选时再验证配置迁移. 对已经注入旧版本 Workflow Distribution 的目标 Repository, 先在隔离 home 中安装旧版本并使用该安装的 `workflow verify` 验证同版本状态, 然后才安装候选并执行更新. 后续 launcher, 配置保留, 卸载和最终状态验证继续针对同一条安装链.

## Repair iteration

发现问题时不立即停止当前验证开始修复. Runner 先继续全部不依赖失败结果的正式路径, 按既有规则返回语义交接, 执行虚拟机安全处理, 并提供补偿交接. Main Agent 只在原正式失败结果保持不变后决定安全且最小的临时补偿. 补偿后代仍是诊断内容, 不进入正式归档, 也不把失败候选变成通过候选.

原始正式结果不足以确定故障类别或恢复方法时, 再读取[发布验证故障附录](source-checkout-release-validation-troubleshooting.md). 读取后只采用与当前实际事实吻合的条目; 没有匹配条目时继续按本节调查, 不猜测原因. 该附录只提供诊断和恢复入口, 不改变本节的正式结果与集中修复顺序.

只有当前候选的全部可执行路径都已经完成, 才进入一次集中修复:

1. 把每个实际问题和确定的修复方法追加到当前发布准备 issue 的 `## Comments`. 不为单个发布验证问题创建另一个 issue, 也不把这些运行细节写入 effort spec.
2. 直接实施并暂存修复. 每项修改前后不单独运行 Spec Reviewer, Code Review 或 Commit Audit Reviewer.
3. 用新的完整暂存 tree 创建新的隔离提交. 旧候选的 VM 结果, 归档和 Conformance 结果不进入新候选的正式通过结果.
4. 继续使用当前发布已经确认的版本, VM JSON 路径和 Reviewer Capability 选择. 配置仍在每次运行前重新验证. 本次准备中已经核对的目标 Git 捆绑包可以复用, 但候选捆绑包必须为新提交重建. 先前候选的 `post-init` 选择不绑定到新候选.
5. `run` 选择为新提交重新运行适用 Reviewer Capability 批次; `skip` 继续不运行. 随后重新运行完整 Registry `pre-tag` 矩阵和 `pre-tag` Conformance. 通过后重新询问新候选的 `post-init` 选择, 完成该选择要求的状态和验证, 再运行本地版本 tag Bootstrap 与本地 `post-tag` Conformance. 再次发现问题时重复本节.

## Candidate promotion

完整本地发布验证成功后, 才对同一个暂存候选进入 Candidate promotion, 完成最终 Spec Readiness, 必要验证和 Gate 3. 任一 Reviewer 要求修改实施, 测试, 治理或 issue 要求字节时, Main Agent 留在 Candidate promotion 内直接修复并暂存. 治理 Input 或 issue subject 变化时, 先刷新 Spec Readiness; 无论是否需要刷新 Spec Readiness, 都按 `code-review` 对变化后的候选重新执行受影响的必要验证和 Gate 3. 重复修复和审核, 直到全部适用审核都通过且没有未解决问题.

只有上述审核收敛过程修改了候选, 才在审核全部通过后返回一次 `Repair iteration`. 完整本地发布验证再次成功, 且审核对象, 输入和适用规则保持不变时, 按 `code-review` 复用已有的 Spec Readiness 和 Gate 3 通过结果, 不重新调用 Reviewer. 没有发生候选修改时直接继续本节后续步骤.

Gate 3 具备当前完整有效的通过结果后, 当前发布准备 issue 的职责已经完成. Main Agent 按 [issue 完成责任](../../.agents/skills/issue-tracking/SKILL.md#issue-lifecycle)更新真实终态和文字未变且已经满足的验收标记, 在 `## Validation` 中保存实际验收证据, 在 `## Comments` 中记录讨论和审核事件. 两个记录章节变化按统一记录责任机械核对, 其他候选变化按 `code-review` 的实际输入有效性规则处理. 终态转换继续按通用提交规则运行 Gate 1, Gate 2, Commit Audit 和 `commit-audit verify`; 没有发布专用审核豁免.

Commit Audit Reviewer 要求修改实现, 测试, 治理或 issue 正式要求时, 当前 Commit Audit 结果按通用提交规则失效, Main Agent 回到本节的审核收敛过程. 按实际影响刷新必要就绪, 验证及代码审核轴并取得全部适用的有效通过结果后, 再返回一次 `Repair iteration`. 只有完整本地发布验证重新通过, 审核结果仍可复用, 且 issue 仍满足终态转换要求时, 才重新执行 Commit Audit. 两个记录章节的变化按下方闭合收尾范围处理, 不因此重跑本地发布验证. Commit Audit 不会提前到完整本地发布验证或 issue 终态转换之前.

本地验证候选与最终已暂存候选之间只允许以下变化:

- 当前发布准备 issue 的准确完成记录变化.
- Commit Audit Engine 返回的准确 `sourcePath` 到 `targetPath` 映射所指定的正式 Gate 1 和 Gate 2 记录.

Main Agent 必须机械确认其他路径, 文件模式和字节完全相同, 并对允许的收尾变化运行 issue 严格读取, 文档, 术语, 差异空白, Commit Audit 和适用的最终检查. 任一额外变化或任何检查失败都会使本地发布验证失效并返回 `Repair iteration`. 符合该闭合范围的收尾不重复 VM, Bootstrap 或完整源码测试.

全部提交关卡通过后只创建一个正式发布提交. 该提交包含已验证的实现和准确治理收尾, 是后续分支推送与正式 tag 的唯一候选. 发布准备 issue 不负责之后的外部写入, 正式远程 `post-tag` 或 GitHub 发布, 这些操作不需要为本次发布另建 issue.

开始阶段的 Reviewer Capability `skip` 选择只豁免 Reviewer 能力证据. 其余关卡不替代该证据, 也不会因此减少.

Registry 中的 `post-init` 阶段是最后一个使用 VM 的阶段. 它不属于 `pre-tag` VM 计划或 `pre-tag` Release Conformance 的必需归档集合, 也不得在该 Conformance 通过前启动. `run` 必须从场景开头建立全新目标状态, 完成唯一的初始化 issue Agent 交接, 再完成全部后续验证和清理. `skip` 不运行其中任何步骤, 也不要求该场景归档. 两种选择都必须留下绑定当前候选的明确本地结果, 且只有通过的 `run` 结果或明确的 `skip` 结果才允许进入本地 tag 验证.

只有被 Release Validation Registry 标记为实际检验完整 Agent Post-init Handoff 和初始化 issue 生命周期的操作才使用该交接. 其他发布验证中的初始化和重新初始化操作遵循当前 Registry 分配. 这项省略不适用于普通的 `arw workflow init`. 在已经注册的初始化 issue 操作中, 当前 Main Agent 可以省略 Spec Readiness, 但仍要执行完整审计, 实际已授权工作, 验证证据, 严格 issue 生命周期和最终仓库验证. 应用普通的 Post-init Handoff 冲突规则. 当前安装的 Workflow Distribution 替换每条冲突的 Repository-owned 规则, 不冲突的 Repository-owned 规则得到保留, 并适用于 issue 的其余部分. 使用已配置且只适用于发布的回答应用 Registry 列出的每项用户选择, 无需询问用户, 同时保留精确的仓库事实, 并完成由此产生的每项验证. 这项发布特定委托不会改变普通用户选择规则. 在精确的 `## Validation` 标题下记录非空完成证据. 该操作不请求来宾系统仓库提交, 因此 Code Review, Commit Audit 和提交都不会触发, 也没有豁免. 不得把该发布场景限制写入目标 issue 文本.

来宾系统 Installation 和仓库场景不下载, 探测, 检查或启动 Agent CLI. `workflow init` 安装的平台内容只来自为该场景编码的明确用户选择. 不得把 Codex 或 Claude Code 可用性设为来宾系统前提条件.

## Publication and tag recovery

发布或恢复发布标签前, 阅读 [发布和恢复](source-checkout-release-publication.md).

## Shared virtual machine handoff

验证使用共享 VMware Workstation Pro 来宾系统时, 在检查, 启动, 更改, 快照或还原 VM 前阅读 [跨平台 VMware 验证](cross-platform-vm-validation.md).

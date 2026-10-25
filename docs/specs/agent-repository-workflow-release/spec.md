# Agent Repository Workflow Release 长期规格

## Scope

本文定义 ARW 源码仓库验证和发布稳定版本的长期规则: 发布候选, 本地检查, Reviewer Capability Conformance, 跨平台 VM 验证, tag, 公开 Bootstrap 验证, GitHub 托管发布对象和失败恢复. 具体操作步骤由源码仓库专用且只能显式调用的 `$release` Skill (`.agents/skills/release/`) 拥有. [Agent Repository Workflow 长期规格](../agent-repository-workflow/spec.md) 拥有产品和仓库工作流. [开发长期规格](../agent-repository-workflow-development/spec.md) 拥有 Workflow Distribution 与平台投影. [安装长期规格](../agent-repository-workflow-installation/spec.md) 拥有 Bootstrap, 安装来源与载荷, Identity, Installation Contract 和 ARW 安装目录.

## Release validation configuration

根 `release-validation.json` 只保存规范 HTTPS 远端 `repositories.sourceCheckout.url`. Bootstrap 生成物从它投影远端, 正式推送和 tag 后验证都使用它. 它没有版本字段, 因为配置与读取代码由同一 Git 提交绑定. VM 位置, 快照和凭据由维护者在仓库外的 VM JSON 中提供, 不进入仓库, issue 或发布证据.

## Release procedure

1. Main Agent 读取 `package.json.version`, 取得维护者对该准确版本进行发布验证的确认. 确认不授权任何外部写入. 版本必须高于候选可达的全部稳定 tag, 且该 tag 在本地和规范远端都不存在.
2. 维护者为本次发布选择 Reviewer Capability Conformance 的 `skip` 或 `run`.
3. 候选是一个已提交, 工作树干净的 commit. 在候选上运行 pnpm frozen install, `pnpm typecheck`, `pnpm test`, Workflow Distribution 检查, Bootstrap 生成物检查, 文本检查和严格术语检查.
4. 跨平台 VM 验证在每台受支持的 Windows 和 Linux 受验系统上, 从基线快照开始, 只通过宿主传入的候选 Git bundle 取得候选, 用候选自己的 `install.mjs` 和仅存在于受验系统的本地版本 tag 安装, 然后证明新开终端能解析到已安装的 `arw` 且版本正确, `arw workflow init` 与 `arw workflow verify` 在新 Git 仓库中成功, 卸载后新终端不再解析 `arw`. 结束后硬关机并还原快照. 受验系统不安装或启动 Agent CLI, 也不安装源码仓库开发依赖.
5. 任一检查发现候选缺陷时, 修复并形成新候选, 从第 3 步重新开始. 环境问题修复后只重跑受影响的检查. 临时补偿后的结果只用于诊断.
6. 全部通过且维护者授权准确项目, `origin`, 分支和版本后, 推送分支, 创建并推送无前缀的版本 tag. 规范远端第一次看到的 tag 就必须指向已验证 commit. 随后从公开 HTTPS 地址取得该 tag 的 `scripts/install-arw.mjs`, 在隔离 home 中安装并确认版本.
7. 公开 Bootstrap 验证通过后, 才发布 GitHub 托管发布对象.

## GitHub release publication

公告保存在 Repository 之外, title 和正文使用中文, 只描述在本次 tag 上可观察的变化, 并包含安装章节和 `Changelog`. Main Agent 向维护者展示准确 title 和完整公告文件, 批准绑定准确字节, 任何变化都需要重新批准.

写入前确认本地与规范远端的 tag 都指向已验证 commit, 并完成 `gh` 认证预检. 先只读查看同 tag 的 Release: 已存在且 tag, 经 Git 解析的 commit, title 和正文全部匹配, 并且是正式已发布对象时, 视为幂等成功; 冲突或读取失败时停止. 只有明确不存在时才用 `--verify-tag` 创建, 不提供 `--target`. 创建后, 以及超时或结果不明时, 都只做只读核对, 不盲目重复创建. `targetCommitish` 不能证明 tag 提交.

创建 GitHub 托管发布对象是 Main Agent 使用外部维护者工具完成的操作, 不是 ARW runtime Module. ARW 代码不读取 `gh` 凭据.

## Reviewer capability gate

Reviewer Capability Conformance 只运行变更路径命中的固定 Codex Reviewer. Claude Code 只承担原生格式, 准确初始文件字节, Workflow Distribution, 平台投影和变更检测的确定性验证. 实时能力门禁不属于每次提交的 Commit Audit 或 Gate 3.

每个受影响 Reviewer 的一个批次包含 3 次具有独立身份的完整重复. Code Standards, Code Spec 和 Commit Audit 的每次重复各运行其唯一场景的一个全新实例, 因而每个角色一批有 3 个实例. Spec Readiness 的每次重复运行两个场景各一个全新实例, 只按相同重复序号配对, 因而一批有 6 个实例. 每个实例具有独立 `instanceId`, 只属于一次重复, 并使用全新线程和隔离场景工作区. 平台容量不足时可以按准备顺序分批执行, 但完整重复与实例集合, 同序配对, 同批输入和答案隔离保持不变. 场景名称和交接顺序固定且中性, 不泄露隐藏预期; 调用方把返回的 `instanceId` 作为当前 `prepare` 的不透明绑定值, 不从中推导隐藏预期或能力优先级. 这些实例只用于定向和发布能力验证, 不改变普通真实审核的实例数量.

每个实例由 Reviewer 执行一次独立审核. 原始报告中的所有可评分内容使用同一逐用例评分规则, 表示格式妨碍解析时由 Main Agent 在独立副本中修正, 保留原件及全部判断和证据. Code Standards, Code Spec 和 Commit Audit 的一次重复汇总其唯一实例的全部用例; Spec Readiness 先合并同序两个场景实例的全部问题用例和干净用例, 再计算该重复的 F2, 不先计算场景分数再等权平均. `repetitionScores` 保留 3 个折减前 F2 分数, 其算术平均值是折减前分数 `scoreBeforePenalty`. 任一实例存在表示格式错误, 错误的来源或证据引用, 缺失要求, 重复或拆分要求记录, 或违反适用检查停止规则时, 只把其所属重复的 F2 乘一次 `0.9`; 同一重复内多项或多类错误不累计折减, 没有这些错误时保留原分数. 普通漏报, 误报及证据覆盖不足按逐用例规则失分, 不仅因判断错误额外折减. `finalRepetitionScores` 保留 3 个已调整分数, 其算术平均值 `score` 是唯一权威分数. 能力通过只要求 `score >= 0.75`, 单次重复没有独立门槛.

能力验证和 benchmark 只在同一审核任务最终交付后按既有评分合同计分. 自动接续及提供方内部错误恢复仍属于运行程序内部, 尚未作为调用方的失败结果交付, 因而这些过程及其中已经恢复的工具错误不触发分数折减; 中间回合状态或恢复次数不改变实例的能力结果. 最终绑定报告中的真实错误仍按上述用例及折减规则处理, 实际来源违规继续按会话检查合同处理.

定向与发布能力验证沿同一评分路径计算权威结果, 同时消费共享 Reviewer 运行计量, 并列展示逐实例工作耗时, 各类原生 token 消耗及任务平均和模型阶段两类输入输出速度. 计量遵循[产品运行计量合同](../agent-repository-workflow/spec.md#isolation-and-measurement)与[工作时间合同](../agent-repository-workflow/spec.md#model-work-time), 保留观察来源及适用的估算标记和依据, 不另定义速度公式或计时机制. 评分与计量按当前准备记录中的 Reviewer 身份和 `instanceId` 关联, 使审核质量与运行效率对应同一实例, 不用其他实例的数据补足结果. benchmark 的已有统计合同由其操作权威拥有, 本文不重复声明.

因模型自身行为完全没有可评分内容的实例, 在 Main Agent 核对原生会话与冻结场景并确认原因后, 全部用例记 0 分. 已有可评分内容继续计分, 缺失判断的用例记 0 分; Spec Readiness 配对中的另一个实例仍正常评分, 两个场景的全部用例保留在分母中. 准备, 运行, 传输或测量错误及未知原因使结果无法可信评分时, 不产生分数, 先修复后按实际影响范围恢复. 输入身份, 当前准备绑定, 原生会话和来源隔离条件独立于分数核对; 有效性条件失败不能被高分掩盖. 精确逐用例规则, 错误记录与计分输入由[评分规则](../../agents/reviewer-capability-scoring.md)拥有.

Code Review finding 使用[共同证据规则](../../agents/reviewer.md#code-review-evidence)形成可独立复核的最小完整证据. 同一真实问题可以从多个等价代码位置获得证明. 隐藏用例允许同一 `check` 声明多个完整证据位置, 使正确指向分配点或查询点的 finding 不会仅因未采用写入点锚点而被误判. 验证器在单个实例内按[问题关联规则](../../agents/reviewer-capability-scenarios.md#problem-association)逐位置完整匹配, 按[问题评分规则](../../agents/reviewer-capability-scoring.md#problem-cases)选择最高分位置且只形成一次关联, 然后才计算重复分数. 证据不能跨位置拼接, 既有评分公式和重复 finding 的原子性惩罚保持不变.

当前有效候选的 3 次完整重复形成一个 Reviewer 批次. 最终分数达到 `score >= 0.75`, 且全部强制门禁与全部实例会话检查通过时, 即满足发布能力收敛. 模型报告中的格式, 引用, 覆盖和检查停止错误按上述规则失分及折减, 不独立使批次失败. 结果只在同一 Reviewer 的当前有效重复集合内汇总, 不跨 Reviewer 求平均. 每个场景的每次重复只消费一份当前有效的完整实例结果; 重跑结果替代对应受影响结果, 未受影响的场景与重复保留其有效结果. Spec Readiness 按同序号配对当前有效的两个场景结果计算重复分数.

发生错误时, Main Agent 先评估错误对整个场景和各次重复结果的实际影响. 所有情况均先修复错误, 再按确认的影响范围恢复: 如果错误影响当前场景全部重复, 重新准备该场景全部 3 次重复并使用全新 Reviewer 会话; 如果只影响当前重复, 只重跑该重复, 重新执行的实例使用全新 Reviewer 会话; 如果不影响当前重复的结果, 无需重跑审核, 保留已有结果. 未受影响的场景和重复保留有效准备, 原始报告, 会话证据与评分输入. 表示格式问题按上述独立副本规则处理. 候选, Role, 场景或评分合同变化也按实际影响确定哪些结果失效, 在受影响范围内修正并重新建立有效绑定. 错误修复保留 Reviewer 原始报告的判断和证据, 不改变既有评分公式或绕过强制门禁; 最终验证仍要求完整的 3 次重复和全部适用场景.

能力验证按实际调用用途采用[产品运行合同路由的提供方程序时限](../agent-repository-workflow/spec.md#capacity-and-recovery), 时限消费同一[模型工作时间](../agent-repository-workflow/spec.md#model-work-time). 暂时没有最终输出或草稿仍未完成不构成失败; 未达到适用停止条件时, Main Agent 读取完整会话记录并观察实际进展, 不以单次等待超时终止或替换 Reviewer. 达到适用程序截止, 用户明确结束, 或记录证明任务确实无法继续时, 按准确运行事实处理结束. 普通审核的用户等待沟通仍只由[Reviewer 指引](../../../.agents/skills/reviewer-launch/SKILL.md#long-running-and-paused-reviews)拥有.

Codex Platform Host 拥有每个全新 Reviewer 实例线程的正式输出和完整会话记录. Main Agent 按[会话检查规则](../../agents/reviewer-capability-session-inspection.md#inspection-boundary)检查重复与 `instanceId`, 输出身份, 候选与场景绑定, 完整性, 会话中的禁止来源读取和实际进展. 固定生成的交接在接收方记录中只有密文时, 该规则使用已知准备内容, 实例绑定和平台现有的发送方与接收方事实完成匹配, 不要求解密或直接比较明文; 实际观察和初始交接后的全部消息仍属于检查范围. 文件不可用, 不可解析, 身份不匹配, 无法匹配的交接, 来源不明的附加消息, 禁止来源读取或不可恢复失败使当前批次关闭式失败. 自动 `verify` 取得最终正式成功后, Main Agent 另行在准确 `preparedPath` 的父目录原子写入 `release-validation-report.md`; 评分运行时代码不生成该报告. 报告中的批次结果先写最终分数和折减前分数, 紧接着用说明文字按稳定顺序写 3 个折减前重复分数, 3 个已调整重复分数和原始错误记录, 并记录各实例的错误及适用的表示修正情况. 其他诊断计数不与权威结果混排. 报告再逐个实例记录 Reviewer 身份, 重复身份, `instanceId`, 场景, 正式结果, 会话 ID, 平台原生路径, 检查范围, 解析结果, 启动上下文结果, 检查结果和准确发现项; 没有发现项时写 `None.`. 会话不可用或检查失败时, 只要该批次目录仍可写, 报告就保存全部已知字段和准确失败. 已完整计算的分数可以保留为诊断, 但不能改变批次失败结论. 报告缺失或写入失败使该批次失败. 该报告, 正式输出与完整会话只属于当前 `.tmp` 工作区, 不复制进归档, 受 Git 管理的 Repository 或跨进程恢复状态, 也不自动清理平台原生会话记录.

定向优化在每个完整实时轮次后按[轮次间用户审核](../../agents/reviewer-capability-session-inspection.md#human-review-between-targeted-rounds)取得下一轮具体方案批准. 批准后的夹具修改完成[独立质量审核](../../agents/reviewer-capability-scenarios.md#fixture-authority)即可直接进入该轮适用验证, 规模较大的场景重建则必须在修改前列入批准方案. Agent 指令, 长期规范和其他受保护文档仍独立遵循[用户确认](../../../.agents/skills/rule-and-design-changes/SKILL.md#user-confirmation). 批准批次使普通就绪失效时, 修改与定向检查之间的例外, 以及优化结束后关闭 issue 前必须重新完成普通 Spec Readiness 的要求, 均遵循 [Spec Readiness 定向例外](../../agents/source-checkout-exceptions.md#targeted-reviewer-optimization-exception).

### Targeted Reviewer error analysis

场景质量的独立盲审具有单独的启动授权边界. 每次开始新的盲审前, Main Agent 说明范围和预计耗时, 取得用户对该次盲审的明确同意; 夹具修复或验证授权不自动包含盲审. 同一未变更可见场景的两阶段审核和必要质疑不重复请求授权, 只修改隐藏预期时复用原审核线程. 该边界保留独立质量要求, 让用户在承担审核耗时前决定启动时机. 具体流程遵循[场景质量规则](../../agents/reviewer-capability-scenarios.md#fixture-authority).

四个 Reviewer 的能力评分复用多套完整证据位置表达最小证明及合理直接佐证组合, 不跨位置或 finding 拼接. 评分按冻结来源排除可确定的空白行, 保留无关正文的精确率惩罚; 空白不能提供必要证据, 无效定位不能以此豁免. 该处理不改变正式证据归一化或 JSONL 文件格式, 具体计分遵循[评分规则](../../agents/reviewer-capability-scoring.md).

Code Standards, Code Spec, Spec Readiness 和 Commit Audit 的每个定向优化轮次, 都由 Main Agent 根据场景和适用规则独立核查全部实例的完整最终 finding, 再对照隐藏预期. 语义确认接受或拒绝的候选, 以及没有形成候选的问题都属于核查范围, 隐藏预期和机械得分不能证明问题成立.

每轮报告展示按数量降序排列的错误分组表或列表, 包含各组数量, 具体表现, 支持判断的证据和可能原因. 明确统计单位, 完整核查数量和总数, 同一 finding 是否允许多组计数, 以及跨实例重复出现的计数方式. 漏报单独根据已核实的问题清单判断, 不把未满分用例数量作为漏报数量. 原因分析区分已观察事实与待验证假设, 不把调用次数或分数变化直接解释为原因.

Reviewer 错误, 场景缺陷, 隐藏预期遗漏或错误, 评分器问题和未决规则解释分别记录. 同一问题跨轮追踪其首次发现, 当前判断, 修正范围和验证证据, 区分已修复, 未修复, 修复不完整和仍有争议; 未决事项在取得决定前保持未决, 不在后续报告中默认为已确认结论. 已发现的真实问题仍须逐句核对, 不能连带接受错误附加断言. 当前未决工作由持续更新的优化清单组织, 其固定中文章节, 单项归类, 状态更新及简洁性要求遵循[清单维护规则](../../agents/reviewer-capability-session-inspection.md#session-optimization-tracking). 清单保存当前状态, 跨轮处理历史留在对应报告中.

每轮先展示本批次的最终分数和折减前分数, 紧接着用说明文字展示 3 个折减前重复分数, 3 个已调整重复分数和原始错误记录, 再展示同一角色前两轮的最终权威分数. 每次向用户展示评分和耗时时, Reviewer 耗时以逐实例明细为主要展示项, 本轮总墙钟和实例工作耗时合计作为补充; 按[定向轮次展示规则](../../agents/reviewer-capability-session-inspection.md#human-review-between-targeted-rounds)标明角色, 场景, 重复, 实例及并行重叠, 并说明场景或计分口径差异. 具体轮次记录留在验证证据中, 长期规范只保存上述持续要求. 完整核查, 会话检查, 原始结果保留和下一轮授权遵循[定向轮次检查规则](../../agents/reviewer-capability-session-inspection.md#complete-finding-checks-in-targeted-rounds); 修复场景或预期不追溯使旧轮次通过.

## Reviewer capability conformance

内部 Scoring Interface 的创建操作接收已适配的 `evidenceSources`, `expected`, `instanceId`, `reviewerId` 和 `scenarioRoot`, 复制输入并返回同步评分操作. 评分操作接收规范 `checks`, `adjudicationDecisions` 及适用的 clean observation scores, 返回完整单实例用例结果和 candidates, 不读取其他实例, 不组合重复, 不判断批次门禁, 不执行文件, Git 或进程 I/O, 也不保存跨调用状态. 正式验证每次重新创建评分器, 不跨两次 `verify` 缓存 prepared state 或绑定结果.

Reviewer Capability Conformance 的完整发布准备命令 `node scripts/reviewer-capability-conformance.mjs prepare` 不接受调用方参数. CLI 从当前目录发现最近 Git `repositoryRoot` 的绝对路径, 验证受 Git 管理的发布配置, Platform Adapter 返回准确 `{platform: "codex", sessionId}`, 再以 `{phase: "pre-tag", remote: "origin", repositoryRoot}` 调用 Release Candidate Interface. 只有候选解析成功才把 `candidate.changedPaths` 用于 Reviewer 选择, 把 `candidate.tree` 用于读取 Role 字节与创建场景; 调用方不能提供或替换候选或 Platform Host 身份. 成功时准确返回 `{generations, handoffs, preparedPath, reviewerIds, status: "prepared"}`. `reviewerIds` 是变更路径命中的排序且唯一 Reviewer 身份. 每个移交项准确包含 `{instanceId, reviewerId, scenarioRoot, input}`, Spec Readiness 移交项另含 `scenarioId`. `input` 可直接作为共享后台 Agent 机器入口的 `spawn_agent` 输入, 准确包含 `{role, identity: {kind: "isolated", instanceId}, instructions, handoff, cwd, writePaths, reportPath, stateDirectory}`. `role` 等于 `reviewerId`; `instructions` 包含候选树中该 Canonical Role 的完整正文和公共 Reviewer 规则, 不含隐藏答案; `handoff` 是该实例准备的 Reviewer 可见提示. `cwd` 等于 `scenarioRoot`; `reportPath` 等于该实例准备记录绑定的原始报告路径; `writePaths` 只授权该场景内包含 `reportPath` 的准确临时写入范围, 不包含其他实例或 Source Checkout 的文件. `stateDirectory` 准确等于 `preparedPath` 的父目录, 位于发起准备的当前 Main Agent 会话在 Source Checkout 中的临时工作区. Main Agent 从发起准备的 Source Checkout 调用机器入口, 使用户配置和恢复记录绑定该调用方仓库; Reviewer 的受审仓库和实际读取, 写入权限由场景 `cwd` 与路径授权决定. Main Agent 可按能力验证已授权的隔离设置另向 `input.settings` 提供本轮覆盖; 未覆盖时, 同一机器入口按用户配置解析模型, 提供方, 推理强度和服务档位, 准备命令不选择模型或建立成本机制. Spec Readiness 的每个生成项包含对应的 `instanceId`, `draftPath`, `workdir` 和 `scenarioId`; Commit Audit 的每个生成项包含 `instanceId`, `requestPath`, `reviewerId` 和 `workdir`. Commit Audit 的 `requestPath` 只嵌入 Reviewer 可见的 `input.handoff`, 不作为移交项额外字段. `preparedPath` 指向当前 Repository, 平台, Main Agent 会话与本批次唯一运行下的临时记录. 该记录准确包含 `{contracts, mode: "release", platform, reviewerIds, runId}`. 每个合同准确包含 `{instances, platform, reviewerId, scenarioRevision}` 以及发布模式必需的 `roleSha256` 和 `reviewerInstructionsSha256`; `instances` 按准备顺序绑定 3 次重复, 每项包含 `{expected, instanceId, reportPath, scenarioDigest, scenarioRoot}`, Spec Readiness 实例另含 `scenarioId`, 其中 `artifact-promotion` 场景另含 `resultPath`; Code Standards 与 Code Spec 实例另含 `resultPath`, Commit Audit 实例另含 `requestPath`. Code Standards, Code Spec 和 Commit Audit 每次重复各绑定一个实例; Spec Readiness 按相同序号把两个场景实例绑定为一次重复. Code Review 的 `reportPath` 同 `resultPath`, 是对应 `scenarioRoot` 下 `.tmp/review-result.md` 的精确绝对路径, 随准备操作创建并绑定到该实例. Spec Readiness 和 Commit Audit 的 `reportPath` 是对应正式 Request 绑定的 `draftPath`; Spec Readiness 的 `artifact-promotion` 实例的 `resultPath`, `runtime-migration` 生成项的 `draftPath` 均准确等于各自实例的 `reportPath`. Commit Audit 的 `requestPath` 是对应场景内由正式准备入口建立的独立 Request. 准备记录不保存候选提交, 树, 基线或变更路径. 只有全部 3 次重复及其实例准备完成后才返回可执行交接和准备记录; 中途失败不返回部分结果. 缺失会话身份, 候选失败或 Role, 场景, 重复与实例绑定变化时关闭式失败.

局部恢复使用 `node scripts/reviewer-capability-conformance.mjs prepare --prepared <prepared-path> --input <selection-path>`. 准备模式和 Reviewer 集合从原准备记录取得, `selection-path` 指向严格的 `{ "instances": [{"reviewerId":"<reviewer-id>","instanceId":"<current-instance-id>"}, ...] }` 临时 JSON 对象, 只允许非空, 无重复的当前角色与实例身份对集合. 角色与实例身份共同定位准备记录中的一个位置, 同一 `instanceId` 出现在不同 Reviewer 中时不会连带选择其他角色. Main Agent 按[错误影响范围](#reviewer-capability-gate)选择受影响项: 一个场景的全部重复对应该场景的 3 个实例, 一个重复的受影响场景对应其当前实例. 准备流程校验原记录及未受影响项仍可保留的绑定, 为受影响项建立新 `instanceId`, 独立场景, Request, 原始报告与恢复范围, 保留未受影响项的准确绑定, 再物化包含完整当前集合的新准备记录. 局部准备记录在所属模式的既有字段之外, 准确增加 `previousPrepared: {preparedPath, sha256}`. `preparedPath` 是本次来源准备记录的安全绝对路径, `sha256` 是该文件完整字节的 SHA-256, 来源仍位于当前 Repository, 平台和 Main Agent 会话的准备范围. 原记录和旧原始报告保留原字节, Main Agent 不自行更改准备条目. 返回的新 `preparedPath` 绑定全部当前有效实例, `handoffs` 与 `generations` 只包含本次新建项. 后续 `verify` 使用新 `preparedPath`, 输入中以新结果替代受影响项并保留其余有效项, 仍要求每个当前实例恰好一项结果及全部 3 次完整重复. 无效选择或未受影响项绑定已失效时, 准备失败并说明问题, 不静默扩大重跑范围.

局部准备和验证核对 `previousPrepared` 指向的准确文件及其摘要, 再按固定角色, 重复和场景位置核对实例关系. 至少一个位置必须在新准备运行下取得独立的新绑定; 其他位置的实例条目必须与来源记录中的对应条目完整一致, 且仍满足当前适用合同. 新绑定只属于当前准备运行的对应位置, 不接受其他运行中的替换项. 来源链沿相同 Repository, 平台, Main Agent 会话, 模式和 Reviewer 集合核对, 来源缺失, 字节变化, 循环或不一致均失败. 普通完整准备记录不含 `previousPrepared`, 仍要求全部实例属于其自身运行; 连续局部准备重复同一来源核对规则, 不建立另一个评分或结果选择权威.

完整轮次使用返回的每个 `input` 通过共享机器入口启动全新 Reviewer 线程, 收集每个实例的绑定结果, 再用同一 `preparedPath` 调用 `verify --prepared <prepared-path> --input <artifacts-path>`. 产物 JSON 的 `artifacts` 数组按 Reviewer 身份排序且唯一, 每项 `{reviewerId, instances}` 覆盖准备返回的完整 Reviewer 集合. `instances` 按交接顺序为每个已准备 `instanceId` 提供准确一项. 普通输入为 `{instanceId, artifactPaths}`, 路径集合必须是该实例绑定的原始报告, 或该实例成功生成的完整规范产物. Code Review 直接使用绑定的 `resultPath`; Spec Readiness 与 Commit Audit 的规范产物仍经各自正式生成入口取得, 正式生成因模型报告内容错误拒绝时直接评分绑定原始 JSONL. 不同实例不能复用报告路径. 原始报告的来源, 证据, 覆盖和适用检查停止错误保留, 可评分内容继续评分, 不要求先产生正式生成失败记录作为能力评分前提.

表示格式妨碍解析时, Main Agent 保留原件, 仅在同一实例临时工作区的独立副本中修正表示, 输入准确为 `{instanceId, artifactPaths: null, formatCorrection: {originalReportPath, correctedReportPath}}`. 两个路径均为绝对路径, 原件准确等于准备绑定的 `reportPath`, 副本不同于原件且位于同一场景的 `.tmp` 范围. 修正不改变检查, finding, 结果, 要求身份, 问题含义, 来源, 证据选择或定位, 不从聊天或摘要补造报告. 验证器核对原件确有表示格式错误, 绑定原件与副本, 对可解析内容应用同一能力评分, 原始内容错误继续失分并触发所属重复的折减. 没有可评分内容且 Main Agent 确认原因属于模型自身行为时, 输入准确为 `{instanceId, artifactPaths: null, modelFailure: {reason}}`, `reason` 为非空具体原因. 三种输入互斥, 无结果或原因未知不能隐式记为 0 分. Request 与当前候选身份核对始终适用. 普通 Spec Readiness 与 Commit Audit 的正式生成仍执行严格合同, 能力评分不生成普通审核授权, 不把独立副本当成原始报告或提交授权.

各类能力验证实例结果可以另带可选 `measurement`, 消费本次共享运行完成响应中的计量, 按当前准备记录的角色和 `instanceId` 关联. 该数据只供工作耗时, token 和两类速度展示, 不改变原有报告输入互斥关系, 评分, 折减或授权判断. 没有提供计量的既有输入继续按原评分合同处理, 不把未取得的指标当作模型失分; 新观察与估算按[公共计量合同](../agent-repository-workflow/spec.md#model-work-time)和[模型阶段合同](../agent-repository-workflow/spec.md#model-phase-measurement)解释, 不让 Reviewer 在报告内补写这些数字.

`verify` 重新解析当前候选, 核对 Platform Host 身份, Role 和场景摘要, 实例与 Request 绑定及评分输入可信性. 有效性条件失败返回 `{status: "failed", diagnostics}`, 模型报告错误进入同一评分路径. Commit Audit 要求归属无法唯一确定时返回 `needs-requirement-binding`, 交付待绑定来源及原始条目; Main Agent 按[逐要求规则](../../agents/reviewer-capability-scoring.md#problem-cases)为全部待绑定要求指定唯一原始条目或 0 分, 以 `--requirement-bindings <bindings-path>` 交回完整决定. 缺失, 重复, 跨实例或复用条目的决定被拒绝. 四个角色按完整必要证据建立全部问题候选, 不按词组决定关联. 存在候选时返回 `needs-adjudication`, Main Agent 逐项确认同一缺陷, 为每个候选恰好提供一个 `matched` 或 `not-matched` 决定, 以相同 `--prepared`, `--input` 和适用的要求绑定加 `--adjudication <decisions-path>` 重新调用. 无候选或全部裁决完成后计算单实例用例结果, 按重复形成 `repetitionScores`, `finalRepetitionScores`, `scoreBeforePenalty` 和 `score`, 保留原始错误与输入有效性结果, 再按最终分数及其他有效性条件形成批次结论. 不完整, 重复, 额外或格式错误的裁决被拒绝; Main Agent 不改写原始内容, 不拼接证据或直接调分. 成功返回 `{reviewerIds, status: "verified"}`, 失败保留具体原因及能够可信计算的分数. 定向与发布模式共用此 Interface.

最终 `verify` 成功后, Main Agent 读取评分报告与完整会话记录, 完成全部检查, 再另行写入该批次唯一的 `release-validation-report.md`; 评分运行时代码不生成该报告. 命令与报告先展示最终分数和折减前分数, 再显示 3 个折减前重复分数, 3 个已调整重复分数及错误记录. 定向局部观察可用同一准备记录和已取得的绑定输入运行 `score-completed`, 共用相同适配, 要求绑定, 裁决及评分规则, 只形成结果齐备的重复分数. 3 次重复齐备才计算两个平均分, 局部观察不提供批次通过结论. 错误恢复按[发布能力门禁](#reviewer-capability-gate)的实际影响范围执行, 重跑结果替代受影响项, 保留未受影响结果. 输入, Platform Host, Role, 场景, 重复或实例集合, 准备记录, 绑定, 会话或必要验证报告无效时批次失败. 候选连续性仍由 Main Agent 在当前发布操作中负责.

Reviewer Capability 的内部 Candidate Content operation 接受 `{candidateTree, files, repositoryRoot}`. `candidateTree` 是完整 Git tree object ID, `repositoryRoot` 是当前候选 Repository 根, 有序 `files` 的每项准确为 `{filePath, label}`; `filePath` 是安全 Repository 相对路径, `label` 是非空有界诊断身份. Operation 按首次出现位置去重 path. 空输入返回 `{status: "succeeded", entries: []}` 且不观察 Git. 非空输入只通过 Candidate Content Git Seam 执行一次批量观察. 成功返回 `{status: "succeeded", entries}`, entries 保持去重后的请求顺序, 每项准确为 `{bytes, filePath}` 且 bytes 是独立 copy.

候选内容缺失返回 `{status: "failed", code: "candidate-content-missing", filePath, message}`, 内容类型或完整性无效返回 `code: "candidate-content-invalid"`, Git 观察失败返回 `code: "candidate-content-git-failed"`. 非成功结果不返回部分 entries; `filePath` 只在失败能绑定准确请求 path 时出现. 无效调用 shape 抛出 `TypeError`. Reviewer Capability prepare 在任何持久 prepared state 前消费完整成功 entries; verify 漂移检查重新读取所需准确子集. 失败继续使用现有关闭式 prepare 或 verify 失败结果, 不改写候选选择或跳过 Reviewer.

## Failure recovery and authorization

本地检查和 VM 验证不需要外部写入授权, 也不写规范远端. 外部写入授权只覆盖准确项目, `origin`, 分支和版本, 不允许强制推送, 修改其他分支或 tag, 也不允许移动已经推送的 tag.

公开 Bootstrap 验证失败时, Main Agent 先证明本地与远端 tag 都仍指向候选, 再只删除这两个准确 tag 并确认两端都不存在. 无法证明时停止. 修复后形成新候选, 重新完整验证. GitHub 托管发布对象的失败发生在 tag 验证之后, 不触发 tag 恢复: 保留 tag, 记录准确远端状态并停止, 后续创建, 更新或删除需要维护者重新决定.

## Design rationale

每次发布在任何 Reviewer 能力操作前要求用户明确选择 `skip` 或 `run`. 永久强制运行会保留最完整的能力证据, 但也把 Reviewer 可用性和验证规则要求的批次等待成本强加给每次发布. 永久跳过或默认跳过会降低成本, 却会静默移除能力门禁. 当前选择把成本和证据取舍留给每次发布的用户, 并接受缺少明确回答时必须暂停. `skip` 不由其他检查补偿, 因为源码仓库, VM, Repository 和 Conformance 验证证明的是候选行为与发布材料, 不是 Reviewer 能力本身.

VM 验证只证明用户实际依赖的结果: 安装, PATH 登记, 初始化和卸载在真实 Windows 与 Linux 上可用. 它由 Agent 按 Skill 运行一个短检查脚本, 不再由程序维护场景登记表, 归档和一致性校验; 这些机制校验的大多是验证程序自己产生的数据, 维护成本远高于它们发现问题的价值. 升级, 降级, 真实目标仓库矩阵和初始化 issue 生命周期不属于发布门禁, 需要时由维护者另行要求.

## Validation strategy

固定测试验证发布配置读取, Bootstrap 生成物与配置一致, 以及 Reviewer Capability Conformance. VM 验证和公开 Bootstrap 验证只在真实发布时由 `$release` Skill 执行, 不作为 implementation issue 的完成测试, 常规测试不访问公网. 源码仓库确定性测试矩阵由[验证规则](../../agents/source-checkout-validation.md#source-checkout-deterministic-coverage)承担.

Reviewer Capability candidate 内容测试对不同文件和 Reviewer 数量运行同一准备边界, 证明任意非空批次固定使用一次 Candidate Content Git operation, 并覆盖请求去重, 顺序, 准确 bytes, missing, 内容无效, Git failure 和 verify 漂移重读. 测试不以固定总命令数替代 Candidate Module 自己仍需执行的独立 Git 观察. 准备结果测试核对四个角色的 `input` 可直接交给共享机器入口, 原始报告路径和场景临时写入范围准确绑定, Source Checkout 的调用方配置与当前会话恢复边界独立于场景审查权限, 且 Reviewer 输入没有隐藏答案.

Reviewer Capability 验证使用绑定报告及已确认的模型失误记录, 观察全部可评分内容统一计分, 模型自身无可评分内容记 0 分, 准备或运行错误不计分. Spec Readiness 同序两场景先合并全部用例, 一个场景失分不丢弃另一个的有效得分. 报告格式, 引用, 覆盖及停止规则错误只折减所属重复一次, 多类错误不累计折减, 两个平均分来自正确的重复集合, 只按最终平均分判断能力门槛. 原始报告保持不变, 输入身份与会话隔离失败仍阻止通过. 这些观察防止模型内容错误使整批无法评分, 局部结果被丢弃, 多重折减或高分掩盖不可信输入.

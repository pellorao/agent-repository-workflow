# Reviewer Capability 会话检查和收敛

## Native session records

Codex Platform Host 必须为每个返回的交接保留一份完整的平台原生记录. 检查过程如下:

1. 使用 `~/.codex/sessions/` 下唯一的原生 JSONL 记录.
2. 按照已记录的 Reviewer 线程 ID 匹配.
3. 验证 `session_meta.payload.id` 等于该 ID.
4. 从第一个事件到终态响应解析记录.

平台可以把能力验证生成的交接正文作为 `encrypted_content` 保存在原生记录中. 接收方记录不需要提供可解密正文, 会话检查也不要求它与 `prepare` 返回的已知 `input.handoff` 直接进行明文比较. Main Agent 从完整 `input` 和 `instanceId` 开始, 使用共享入口及平台已经保留且可用的线程 ID, 事件时间戳和密文等事实, 核对发送方的交接记录与接收方的初始 `agent_message` 属于该交接和实例绑定. 还须核对这是没有父对话的全新 Reviewer 根线程, 原生权限符合本轮授权, 且本轮没有子 Agent 参与; 无法核对必要事实时不产生通过证据. 这项核对不要求另造密文机制或取得交接正文的精确内容证明. 无法与准确准备项配对, 出现来源不明的附加消息, 或存在其他来源异常时, 完整批次关闭式失败.

保留的记录缺失, 格式错误, 重复, 不匹配或不可用时, 完整批次必须以关闭方式失败, 因为无法完成禁止来源检查. 工具结果或平台事件被报告为截断或摘要, 不会自动导致失败. 当前发布没有定义对应的 Claude Code 启动, 捕获或解析器要求.

## Inspection boundary

对于发布模式, 只有在自动验证成功后, 才检查每个返回的交接会话. 对于定向模式, 每个轮次后都检查每个返回的交接会话, 即使自动验证失败也不例外, 因为失败的会话提供下一次 Role 或场景迭代所需的证据. 每个 `instanceId` 都必须具有自己完整且身份匹配的会话记录.

Reviewer 无法选择的平台注入 `system instruction`, `developer instruction`, 仓库规则, 能力可用性, 以及权限或环境元数据都属于已记录的启动上下文, 不是 Reviewer 选择的审查来源. 单独检查该启动上下文. 如果它包含隐藏的预期合同, 先前的能力响应, 其他实例结果或其他场景特定答案资料, 拒绝该轮次. 已记录的启动上下文不授权 Reviewer 读取其中提到的任何外部文件.

完成初始交接配对后, 检查初始交接后的全部消息, 每次读取和写入, 每项工具调用及结果, 以及最终状态. Reviewer 只能主动观察其生成的交接和完整场景根目录中的文件, 包括适用 Agent 指令和交接提供的准确 Request; 完整 Canonical Reviewer Role 与公共 Reviewer 规则由 `input.instructions` 提供. Commit Audit 和 Spec Readiness Reviewer 只写各自 Request 绑定的 JSONL, 返回 `ready | incomplete`, 不查询模型或平台环境身份, 不读取 Engine 实现或调用审核请求准备, 正式结果生成, 提升与验证入口. 四种 Reviewer 均可按公共通信规则使用运行环境已提供的 `ARW_BACKGROUND_AGENT_RUN_ID` 发送允许的中途消息; 该运行标识及通信回执只用于准确消息交付, 不作为审查证据. 最终结果按 [Reviewer 通信与会话规则](../specs/agent-repository-workflow/spec.md#communication-and-sessions)由运行层核实并通过 `completion` 交付. Code Standards 和 Code Spec 只写绑定的 `resultPath`, 完成后的最终响应只返回相同状态合同. Reviewer 不观察外层 Source Checkout, 隐藏预期, 其他实例或批次结果, 既有能力结果, Engine 实现或模型与平台环境身份. 来源不明的附加消息或允许清单外观察都会使批次失败.

按[能力门禁的内部恢复边界](../specs/agent-repository-workflow-release/spec.md#reviewer-capability-gate)检查同一任务中的自动接续和提供方恢复. 可从现有记录归属于本任务运行程序的工作指示, 以及正常工具调用返回的错误结果, 不属于来源不明的附加输入. 程序来源不扩大允许观察的资料范围; 隐藏预期, 其他实例资料等实际违规仍按上述来源规则处理.

根据原生会话中可观察的发现与写入时机核查及时性, 不以写入次数或批次大小判定违规. 检查审核中修订或撤回的对应更新, 该实例完整审核的完成确认和准确原始文件. Main Agent 按需读取绑定文件, 不把聊天正文重新整理成报告, 也不把存在但未完成的文件当作成功结果. 格式错误时, Main Agent 保留原件, 只在独立评分副本中修正表示, 并核对判断, finding, 要求身份, 证据, 来源与定位未改变. Spec Readiness 的 `artifact-promotion` 按[完整审查交接](reviewer-capability-preparation.md#full-review-spec-readiness-report)核对全部适用检查完成后的 `ready` 和同一绑定 JSONL, 不把 Requirements 提前返回当作完整交付; 该报告不经过普通生成入口. `runtime-migration` 和 Commit Audit 的普通规范产物仍由各自正式生成边界提供, 能力评分可按[评分输入规则](reviewer-capability-scoring.md#scoring-input)直接消费绑定原始报告. 记录必须包含可与准确准备项配对的初始交接和完整最终响应, 每次工具调用都必须有对应结果, 且记录必须能够解析. 报告中出现截断或摘要本身不会使检查失败. 会话不可用或无法解析, 身份不匹配, 启动上下文泄漏, 使用禁止来源, 或准备, 运行及传输故障使必要结果不可取得, 都会使完整批次失败. 模型自身行为造成的未完成审查或没有可评分内容按评分规则处理, 不作为会话身份或来源隔离失败. Main Agent 可以单独记录 Reviewer 最终是否覆盖每个必要 Input, 作为优化证据. 覆盖不完整不会使会话检查失败, 也不改变正式结果.

## Inspection reports

对于发布模式, 在 Main Agent 发布验证报告中记录每项交接检查. 对于定向模式, 无论自动验证结果如何, 都在精确 `preparedPath` 的直接父目录中以原子方式写入简洁的 `session-inspection.md`.

把报告绑定到该精确 `preparedPath`. Main Agent 另行编写报告, 评分运行时不自动生成或补全它. 批次级评分按[最终评分规则](reviewer-capability-scoring.md#final-score)展示. 每个交接的记录包含 Reviewer 身份, 重复身份, `instanceId`, 场景, 正式结果, 原始报告与适用的格式副本, 会话 ID, 原生路径, 检查范围, 解析器结果, 启动上下文结果, 检查结果和精确问题. 没有问题时使用 `None.`. 如果会话不可用或检查失败, 且批次目录仍可写, 记录每个已知字段和确切失败. 已完整计算的分数可以保留为诊断, 但不能改变批次失败结论. 报告缺失或写入失败会使批次失败.

只在平台原生位置保留原始 Codex 会话记录, 直到 Main Agent 完成检查. 不得将其复制到已跟踪的仓库中, 也不得使其成为自动验证器的输入. 报告内容应保持最少. 失败只引用解释问题所需的事件, 命令或路径. 不得自动清理原生记录. 如果持久化被禁用, 保留设置可能在检查前删除记录, 或任何必要记录不可用, 轮次都会失败.

## Complete finding checks in targeted rounds

每个定向轮次形成诊断和下一轮计划前, 无论机械验证成功或失败, Main Agent 都必须独立逐条核查所有实例完整最终报告中的 finding, 包括语义确认接受或拒绝的候选, 以及没有形成候选的项目. 根据当前场景内容及该角色适用的规则和治理要求检查问题, 影响及修复依据, 再对照隐藏预期. 不把 `expected.json` 或机械匹配结果当作真实性证明, 也不因一条 finding 包含真实问题就接受其全部附加结论.

区分已有缺陷, 同一缺陷的不同表现, 额外真实问题, 预期或评分器错误, 误报与未证明结论. 在本轮诊断中记录每个实例的核查范围和已检查数量及总数, 仅为异常与分歧提供说明和必要证据. 按[长期错误分析合同](../specs/agent-repository-workflow-release/spec.md#targeted-reviewer-error-analysis)展示数量降序的错误分组及可能原因, 明确计数口径, 分开记录基准问题和未决解释, 并延续前轮每项问题的修复状态与证据. 不要求逐条保存正常核查结论, 也不要求 Reviewer 为正确或干净用例追加说明.

该核查不扩大 [Main Agent 裁决](reviewer-capability-verification.md#adjudication) 的权限, 不改写原始报告或追溯修改本轮分数. 所需修正列入下一轮拟议计划, 按既有用户批准和[发布能力门禁](../specs/agent-repository-workflow-release/spec.md#reviewer-capability-gate)的实际影响范围处理. 核查未完成, 或仍有影响结果可信度的场景, 预期或评分器问题时, 不得声称定向收敛.

## Session optimization tracking

Code Standards, Code Spec, Spec Readiness 和 Commit Audit 的定向优化都由 Main Agent 在当前会话的[临时工作区](environment.md#temporary-workspaces)维护一份持续更新的优化清单, 作为后续优化工作的推进依据. 清单只表达当前问题和处理状态, 具体问题和本轮决定不写入长期规则. 文首仅简述当前范围与授权边界, 不重复各章节内容.

清单固定使用以下 5 个中文二级章节, 按表中顺序排列, 不增加其他章节或下级章节. 空章节写 `无`.

| 章节 | 收录范围 |
| --- | --- |
| 已确认方法待实施 | 解决方法已确认, 尚未完成实施的事项 |
| 已确认问题待定方法 | 问题已确认, 解决方法尚未确定的事项 |
| 尚未确认为问题的争议 | 存在争议, 尚不能确定是否为问题的事项 |
| 已实施待验证 | 实施完成, 仍有必要验证未完成的事项 |
| 已关闭事项 | 已完成, 已撤回或已移交事项的当前结论 |

每个问题保留稳定编号, 只在一个章节出现. 未关闭条目记录问题本身, 当前判断或已确认方法, 下一步及其授权或依赖, 必要证据链接. 来源可由发现轮次或证据链接标明. 核心结论直接写在条目中, 不仅提供链接让读者自行寻找. 已关闭事项只保留简短最终结论和依据链接; 移交事项注明目标 issue, 不再列为当前清单的待办.

收到新要求, 完成问题核查, 取得用户决定或处理状态变化后及时原位更新同一清单, 在继续依赖该项的工作或向用户报告状态前完成更新. 判断, 方法或执行状态变化时, 同步更新内容和所属章节, 删除失效描述. 实施完成但验证未完成的事项移入已实施待验证, 已完成或已关闭的事项移入已关闭事项. 修复不完整的项继续保留待办, 不能仅因已修改文件或机械测试通过就标为解决. 用当前证据或决定支持分类, 不把争议默认为问题, 也不把候选方法写成已获确认的方案.

清单不记录处理历史, 不追加逐轮进展, 审批经过, 工具调用, 旧方案或被取代的状态. 详细分析, 评分和耗时保存在对应报告, 清单按需链接并保留原始轮次证据与分数. 每次更新都检查全文的一致性与简洁性, 合并重复内容, 清除过期描述; 不为日期, 轮次或单项问题新增章节.

开始后续优化前先核对清单, 新发现也先纳入清单再安排工作. 后续修改和验证按清单中的已确认方法及依赖推进, 未确定的方法先讨论, 争议项先核实. 清单不替代既有用户批准, 新盲审启动授权或轮次审查边界; 开始依赖步骤前仍须满足这些条件.

## Human review between targeted rounds

形成诊断时, 分别识别语义判断, 证据定位或结果格式, 工具操作和来源隔离方面的问题, 使下一轮修改针对实际失败原因. 使用已有报告和原生会话记录区分观察事实与因果假设; 调用次数或上下文用量较高本身不能证明它导致漏报.

每个定向轮次完成正式验证, 完整会话检查和上述全部 finding 核查后, 诊断该轮次, 并向用户提供证据和下一次迭代的拟议计划. 每个定向轮次都在这个用户审查边界结束. 用户明确批准方案前, 不得为下一次定向迭代作出任何变更, 也不得开始该迭代. 该边界只适用于定向 Reviewer 能力迭代. 它不适用于真实仓库审查返回 `gap` 或 `uncertain` 后的普通 Spec Readiness 修复, 也不会为发布模式增加每个轮次一次的用户停点.

本轮评分按[最终评分规则](reviewer-capability-scoring.md#final-score)展示, 再列出同一角色前两次轮次的最终权威分数作为对比. 不把旧诊断计数混排成权威结果. 同时并列展示关联本次准确实例的工作耗时, 各类原生 token 消耗及任务平均和模型阶段两类输入输出速度, 标明角色, 场景, 重复, `instanceId` 及并行重叠, 本轮总墙钟和实例工作耗时合计作为补充. 计量采用[产品运行计量合同](../specs/agent-repository-workflow/spec.md#isolation-and-measurement)与[工作时间合同](../specs/agent-repository-workflow/spec.md#model-work-time), 每个估算值明确标记来源和依据, 不把估算写成精确观察, 不另列一套公式或时钟. Main Agent 格式副本工作不计入 Reviewer 耗时或用量. 原始错误及适用的独立格式副本均记录, 能够评分的内容使用同一能力评分规则, 无法评分时明确原因及模型失误记 0 分或运行错误不计分的处理. 不足三个轮次时显示已有结果; 场景或评分口径不同时标明差异.

## Targeted Spec Readiness exception

Source Checkout 使用 `docs/agents/source-checkout-exceptions.md` 中的定向 Reviewer 优化例外时, 先完成用户批准的修改批次, 然后根据本节运行该迭代的确定性, 语法, 文本和实时能力验证. 不得在已批准批次和定向验证之间插入另一次普通的仓库 Spec Readiness 周期.

## Release convergence

Gate 顺序是 `prepare`, 每个新建 Reviewer 实例交接, 一次完整的机械 `verify`, 可选的 Main Agent 裁决和最终 `verify`, Main Agent 对每个实例会话的检查, 最后另行编写发布验证报告. 每个受影响的 Reviewer 必须在当前有效候选上取得 3 次独立的完整重复. Code Standards, Code Spec 和 Commit Audit 的每次重复各有一个实例; Spec Readiness 的每次重复按相同序号配对两个场景实例, 因而一批有 6 个实例. 批次评分与分数门槛按[最终评分规则](reviewer-capability-scoring.md#final-score)判定, 全部批次级与实例级强制关卡和会话检查也必须通过. 任一实例结果缺失或未通过会话检查时, 完整批次失败; 已确认的模型失误记 0 分按评分规则参与完整结果集合. 错误及候选, Role, 场景或评分合同变化后的恢复, 遵循[发布能力门禁](../specs/agent-repository-workflow-release/spec.md#reviewer-capability-gate)的实际影响范围规则; 重跑结果替代受影响结果, 未受影响的场景和重复保留有效结果. 会话观察绝不能修复记录.

## Targeted convergence

定向收敛要求所选 Reviewer 在当前有效候选上取得 3 次独立的完整重复, 按[最终评分规则](reviewer-capability-scoring.md#final-score)达到分数门槛, 并通过全部强制关卡和全部实例的完整会话检查. Code Standards, Code Spec 和 Commit Audit 的每次重复各使用一个场景实例. Spec Readiness 的每次重复按相同序号配对两个场景实例. 本轮只消费准确绑定的当前有效实例结果, 缺失实例或强制关卡失败仍使该轮失败. 错误及项目变化后的恢复遵循[发布能力门禁](../specs/agent-repository-workflow-release/spec.md#reviewer-capability-gate)的实际影响范围规则, 未受影响的有效准备, 原始报告, 会话证据与评分输入保留; 重跑结果替代受影响结果, Spec Readiness 仍按同序号配对.

每个轮次仍然在用户审查边界结束, 包括一次已经成功的完整批次. Main Agent 提供诊断和后续计划并等待用户决定. 达标结果表示当前定向工作已经收敛, 因而不需要为了确认同一结果再运行第二个批次. Workflow Distribution 源文件只在 live 迭代收敛且用户批准同步后更新, 不把本轮 Source Checkout 文档或 Role 修改提前复制到分发内容.

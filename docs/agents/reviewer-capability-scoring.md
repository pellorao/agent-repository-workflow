# Reviewer Capability 评分

## Problem cases

四个 Reviewer 的能力评分按冻结场景的来源正文识别空白行, 从实际和预期计分集合中排除这些行, 不计入匹配数, 覆盖率或精确率分母. 空白行不能满足必要关联证据. 只有成功定位且正文为空白的行可以排除; 无法定位或无效的证据不因此得到宽免. 这一步仅用于能力验证, 不改写原始报告或正式记录, 不改变正式证据归一化及 JSONL 格式要求.

每个按[语义确认](reviewer-capability-scenarios.md#problem-association)已经建立关联的问题用例, 正确结果获得 `0.4`, 证据最多获得 `0.4`, 原子性最多获得 `0.2`. 证据只计算根据 [Locator matching](reviewer-capability-scenarios.md#locator-matching) 匹配的完整定位信息. 令 `coverage` 为预期定位信息中匹配项的比例, `precision` 为实际定位信息中匹配项的比例. 计算 `evidenceScore = 10 * precision * coverage / (9 * precision + coverage)`. 任一输入为 0 时结果为 0. 该 F3 分数优先完整的预期证据, 同时保留对无关额外定位信息的实质惩罚. 对于一个用例中结果和证据得分最高的关联, 令 `caseUniqueness = 1 / associatedFindingCount`, `findingPurity = 1 / associatedCaseCount`. 计算 `atomicityScore = 2 * caseUniqueness * findingPurity / (caseUniqueness + findingPurity)`, 然后给予 `0.2 * atomicityScore`. 该对称 F1 分数为合并和重复问题提供部分分数, 而不是把任一结构变成无关的第二次失败. 具有多个合理检查的缺陷仍是一个用例. 每个允许的检查都声明适合该审查角度的证据.

同一 finding 对同一问题用例满足多个允许位置时, 先分别按各位置的完整预期证据计算上述证据分, 选择得分最高的位置; 同分选择声明顺序最早的位置. 结果分不因位置变化而改变. 该 finding 与该用例只形成一次关联, 再参与上述原子性计算, 不因同时命中多个位置受到重复惩罚. 不同 finding 仍分别计入重复问题数量. 这一步发生在单个实例内, 先于重复分数的计算.

Spec Readiness 报告中, 单条 finding 提供的个别证据路径不是本次 Input 或允许的审核对象, 或定位信息归一化后没有正文行时, 只让无效证据失去匹配. 该 finding 的其他有效证据及同份报告的其他 finding 继续评分; 如果该 finding 没有剩余有效证据, 它无法命中相应用例并记 0 分. 原始引用错误同时按下方折减规则处理. 这一处理不放宽真实 Spec Readiness 生成对有效正文证据的要求.

Commit Audit 的正式报告仍须为每项独立要求提供一条记录. 能力评分中, 某项预期要求被拆成多条原始记录, 或完全缺失时, 该项对应的问题用例或干净用例得 0 分, 不从拆分记录中选择最佳条目, 也不拼接结果和证据; 来源引用错误的要求同样记 0 分, 其他可明确归属的要求继续评分. 同一来源行可能包含多项独立要求. 当该来源行的原始记录数量异常, 且无法仅凭要求来源唯一归属时, Main Agent 必须对该行的每项预期要求明确指定唯一的一条原始记录, 或指定该项得 0 分. 未完成覆盖该行全部预期要求的绑定前, 不计算该实例的分数. 一条原始记录不能绑定多项预期要求. 原始要求记录错误同时按下方折减规则处理; Code Review 对重复或合并 finding 仍应用现行原子性公式.

## Clean cases

干净用例首先获得二元误报分数, 并且只评估未与任何问题用例关联的问题. 每个普通干净用例保留一个必要的主要 `evidence` 集合. 可选的 `evidenceAlternatives` 数组声明直接支持同一个用例的其他完整非空证据集合. 它不得与主要集合或该用例中的其他替代集合重复. 主要集合仍然是从预期已满足的 Commit Audit 要求到对应干净用例的唯一绑定. Commit Audit 的干净观察与误报判断同时保留 Gate 和 requirement 绑定; 同一证据集合支持不同 requirement 时, 一项误报不得影响其他 requirement. 对于普通干净用例, 只有当问题位于相同范围, 其实际证据根据 [Locator matching](reviewer-capability-scenarios.md#locator-matching) 包含任一完整已接受集合中的每个定位信息, 且后续宽松概念确认与预期语义对象匹配时, 问题才以它为目标. 独立评估每个集合, 绝不跨集合合并定位信息. 仅共享文件路径并不足够, 除非该精确的仅含文件路径定位信息是一个已经声明的完整集合. 每个范围包含一个固定的 `no other supported finding` 干净用例. 如果实际范围中仍有任何未关联的问题, 该用例失败. 部分正确, 合并或重复的问题由相应问题用例评分, 不再接受第二项干净用例惩罚. 测试夹具内容不得包含已经批准的问题清单以外的受支持缺陷. 结构化的已满足 Commit Audit 要求还会向相应干净用例提供一项 F3 证据观察. 主要绑定标识该用例后, 分别根据主要集合和每个替代集合独立计算相同的精确定位信息覆盖率和精确率公式, 使用最高分, 不对集合求和或组合, 然后取该观察分数和二元误报分数中的较小值. 缺失, 非数组, 格式错误, 超出范围或无法定位的证据不获得匹配, 但不会成为强制关卡失败. 除上述已确认的空白行外, 所提供的每个证据项仍计入每次比较的精确率分母, 有效行范围中的每个实际行计数一次.

## Final score

对可评分的报告内容统一应用上述逐用例规则. 判断缺失或无效证据只影响对应内容的得分, 同份报告中其余可评分内容继续评分. Code Standards, Code Spec 和 Commit Audit 的一次重复只汇总该重复唯一实例的全部问题用例和干净用例. Spec Readiness 的一次重复只按相同序号配对两个场景实例, 先合并这一对实例的全部问题用例和全部干净用例, 再计算该重复的比率和分数. 两个场景的用例数量直接进入同一分母, 不先计算场景分数再等权平均. 重复序号只用于配对, 不赋予权重或优先级.

对每次重复, 报告 `fullProblemCases`, `earnedProblemPoints`, `totalProblemCases`, `earnedCleanPoints`, `passedCleanCases` 和 `totalCleanCases`. 计算 `problemDetectionRate = earnedProblemPoints / totalProblemCases` 和 `cleanAcceptanceRate = earnedCleanPoints / totalCleanCases`. 使用 `score = 5 * problemDetectionRate * cleanAcceptanceRate / (4 * cleanAcceptanceRate + problemDetectionRate)` 组合两者. 任一比率为 0 时该重复分数为 0. 该 F2 分数更重视问题发现率, 同时惩罚误报. `fullProblemCases` 和 `passedCleanCases` 只计算分数精确为 `1` 的用例, 这两个计数都不驱动比率.

每个 Reviewer 的 `repetitionScores` 保存 3 个折减前 F2 分数, 其算术平均值是折减前分数 `scoreBeforePenalty`. 对每次重复, 该重复任一实例存在表示格式错误, 错误的来源或证据引用, 缺失要求, 重复或拆分要求记录, 或违反适用检查停止规则时, 把该重复的原始分数乘以 `0.9`. 同一重复内多项错误或多类错误只折减一次, 没有这些错误时保留原分数. 普通漏报, 误报及证据覆盖不足按逐用例规则失分, 不仅因判断错误而额外触发折减. Spec Readiness 同序两个场景先合并用例计算 F2, 再对该重复最多折减一次. `finalRepetitionScores` 保存 3 个已调整分数, 其算术平均值 `score` 是唯一权威分数. 能力通过只要求 `score >= 0.75`; 单次重复, 问题发现率和干净接受率没有独立门槛.

Main Agent 核对原生会话与冻结场景后, 确认实例因模型自身行为完全没有可评分内容时, 该实例的全部用例记 0 分, 作为该次实际运行的能力结果. 例如必要文件实际存在, Reviewer 自行找错位置并放弃继续审查. Spec Readiness 的另一个配对实例仍正常评分, 两个场景的全部用例继续进入重复分母. 审查未完成但已有可评分内容时, 保留这些内容的得分, 未作出判断的用例记 0 分, 不补造缺失内容. 准备, 运行, 传输或测量错误导致无法可信评分, 或原因尚未查清时, 不产生分数; 先修复错误, 再按实际影响范围恢复.

结构化结果明确区分 `repetitionScores`, `finalRepetitionScores`, `scoreBeforePenalty`, `score`, 原始错误记录和输入有效性结果. 面向人的结果先显示最终分数及折减前分数, 紧接着用说明性正文按稳定顺序显示 3 个折减前重复分数, 3 个已调整重复分数和错误记录. 各次重复独立保留全部用例结果, 不跨重复挑选或拼接判断. 逐用例计数和错误分析放在明细中, 不另设评分.

输入有效性条件独立于能力分数: 3 次重复的完整实例集合及其结果存在且绑定正确; 会话记录可用, 身份匹配且能够解析; 隐藏预期与禁止来源保持隔离; 评分输入可信, 属于当前批次且已正确绑定; Request 与当前候选身份有效. 已确认的模型失误记录可以代替没有可评分内容的报告, 但不能代替必要运行或来源核对. 任何输入有效性条件失败都会使批次失败, 已能可信计算的局部分数仍保留, 不形成最终平均分或通过结论. 模型报告的格式, 引用, 覆盖或检查停止错误按上述规则评分与折减, 不作为输入身份错误处理.

## Scoring input

只收集当前仓库 `.tmp/` 工作区下每个 Reviewer 的可验证评分输入. 构建一个 JSON 输入, 其 `artifacts` 数组按已经准备的 Reviewer 身份排序, 并且恰好包含每个已准备身份一次. 普通项使用精确结构 `{ "reviewerId": "<identity>", "instances": [{"instanceId":"<prepared-instance-id>","artifactPaths":["<absolute-temporary-path>"]}] }`. `instances` 按交接顺序准确覆盖该身份的每个已准备实例, 且每个 `instanceId` 恰好出现一次. 每个 `artifactPaths` 只包含该实例准备记录绑定的原始报告路径, 或由该实例成功生成的完整规范产物路径:

- Spec Readiness 的 `runtime-migration` 实例正常完成后, Main Agent 从声明的 `workdir` 执行精确的对应 `generation` 项, 使用绑定的 `draftPath`, 并收集生成的规范结果. 正式生成因模型报告内容错误而拒绝时, 直接提交绑定的原始 JSONL, 所有可评分内容继续评分. Main Agent 不更改生成命令, 不向 Reviewer 暴露该命令.
- Spec Readiness 的 `artifact-promotion` 实例直接提交准备记录绑定的 `resultPath`, 该路径必须与不可变请求的 `draftPath` 相同. 交接要求完成全部适用检查, Requirements 问题与后续检查的问题可以同时存在; 验证器保留全部 finding, 不把这种场景要求的继续检查记为停止规则错误, 不生成正式就绪产物或实施授权.
- Commit Audit 正常完成后, Main Agent 从该实例绑定的 Request 调用正式生成入口, 收集完整规范审计路径集合. 正式生成因要求覆盖, 来源或证据错误而拒绝时, 直接提交绑定的原始 JSONL, 保留原始错误并按逐要求规则评分. Request 和当前候选身份校验始终适用.
- Code Spec 或 Code Standards 直接提交绑定的 `resultPath`. 最终响应遵循 [Code Review 完成状态合同](reviewer.md#code-review-results); 是否存在可评分内容由绑定报告与原生会话共同核对, 不由简短完成状态代替.

每个实例执行一次独立审核, Main Agent 保留 Reviewer 写入绑定 `reportPath` 的原始报告不变. 表示格式妨碍解析时, Main Agent 只在该实例临时工作区的独立副本修正表示, 使用 `{ "instanceId": "<prepared-instance-id>", "artifactPaths": null, "formatCorrection": {"originalReportPath":"<bound-report-path>","correctedReportPath":"<independent-copy-path>"} }` 作为同一能力评分入口的输入. 原件必须准确等于准备绑定的 `reportPath`, 副本必须在同一实例场景的 `.tmp` 临时范围, 与原件不同且不属于其他实例. 修正不得改变检查, finding, 结果, 要求身份, 问题含义, 来源, 证据选择或定位, 也不得补造报告. 原始格式错误完整记录, 副本通过可解析性和身份校验后按同一用例规则评分; 其中保留的来源, 证据及覆盖错误继续失分并触发所属重复的折减. 该评分副本不充当普通审核的正式生成产物或授权.

Main Agent 确认模型自身行为导致实例完全没有可评分内容后, 使用 `{ "instanceId": "<prepared-instance-id>", "artifactPaths": null, "modelFailure": {"reason":"<non-empty-reason>"} }` 记录该实例记 0 分的具体原因. `artifactPaths`, `formatCorrection` 与 `modelFailure` 三种输入互斥. 原因未查清或属于准备, 运行, 传输或测量错误时不能填写 `modelFailure`, 也不能把未完成实例隐式当成 0 分. 零字节 Code Review 草稿不表示 `No findings.`. 不同实例不能重复使用或交换报告路径. 简短完成状态仅供 Main Agent 编排, 不保存为评分报告. 空交接数组对应空的 `artifacts` 数组.

# Reviewer Capability 验证和裁决

## Automated verification

对准备好的轮次运行 `node scripts/reviewer-capability-conformance.mjs verify --prepared <prepared-path> --input <artifacts-path>`. 路径必须与当前准备调用返回的路径完全一致, 并且属于当前仓库, 平台和 Main Agent 会话.

第一次调用先要求每个已准备 `instanceId` 恰好具有一项绑定结果, 且没有缺失, 重复, 多余或跨轮实例. 按[评分输入规则](reviewer-capability-scoring.md#scoring-input)核对原始报告, 规范产物, 独立格式副本或明确的模型失误记录, 再建立[全部合格候选](reviewer-capability-scenarios.md#problem-association):

- 输入身份或可信性条件失败时返回失败, 不用模型报告错误代替输入错误, 也不把缺失输入隐式记为 0 分.
- 没有候选时直接按[最终评分规则](reviewer-capability-scoring.md#final-score)计算结果.
- 存在候选时, 调用以退出码 `1` 返回 `needs-adjudication`. 每个候选直接包含 Reviewer, 检查, 问题用例, 该用例的冻结 `expectation`, 以及与候选身份绑定的规范化 finding 正文, 结果和证据. `findingIndex` 只标识规范化检查中的位置; 裁决不得用它推测原始报告的行序.

## Adjudication

对于 `needs-adjudication`, Main Agent 根据当前场景和适用要求, 将每个候选中冻结的 `expectation` 与同一候选中规范化的 finding 正文, 结果和证据逐项比较, 判断是否表达同一个真实缺陷. 所有候选都需要决定, 不因词组匹配而自动接受, 也不因同题已有另一条匹配而跳过. 无法确定时选择 `not-matched`. Main Agent 只决定是否关联, 不改写结果类别, 原始文本或证据, 不跨 finding 拼接, 也不直接调整分数或门禁. 验证器以确认后的关联按[最终评分规则](reviewer-capability-scoring.md#final-score)计算批次结果. 写入格式严格为 `{ "decisions": [{"candidateId": "<candidate-id>", "decision": "matched", "reason": "<non-empty reason>"}] }` 的临时 JSON 对象. 拒绝配对项时使用 `not-matched`. 返回的每个候选项必须恰好出现一次, 且不得包含其他候选项. 然后使用相同的 `--prepared` 和 `--input`, 加上 `--adjudication <decisions-path>`, 再次运行 `verify`. 临时决定文件没有模式版本, 持久兼容承诺, 候选内容哈希, 响应摘要值或修改绑定. 第二次调用从相同输入重新建立完整候选集合, 拒绝格式错误, 缺失, 重复或多余的决定. 只有 `matched` 配对参与问题关联和后续评分; `not-matched` 不建立关联. 该两阶段路径同样适用于定向迭代和发布验证. 面向人的结果按最终评分规则展示.

## Scoring report errors

报告中的格式, 来源, 证据, 要求覆盖和检查停止错误使用同一能力评分路径, 逐用例失分与逐重复折减遵循[评分规则](reviewer-capability-scoring.md). Main Agent 保留原件, 只在必要的独立副本中修正表示; 不补写判断或替换错误引用. 普通 Spec Readiness 与 Commit Audit 的正式生成仍遵循各自严格合同, 能力评分不提供普通审核或提交授权.

Spec Readiness 报告的个别证据路径或正文定位无效时, 保留全部 finding 并评分其余有效内容. `runtime-migration` 已指出 Requirements 问题却继续给出后续检查时, 保留全部可评分检查及 finding, 记录适用停止规则错误. `artifact-promotion` 的交接要求完整检查, 不因按该要求继续检查而折减.

Commit Audit 的要求记录被拆分, 重复, 缺失或引用错误时, 按[逐要求规则](reviewer-capability-scoring.md#problem-cases)处理完整和失分的要求. 同一来源行含多项预期要求且条目数量异常时, 同一评分入口先返回 `needs-requirement-binding`, 列出待绑定的来源行及原始条目. Main Agent 根据原始要求和报告, 对该行全部预期要求分别决定绑定唯一原始条目或记 0 分, 再通过 `--requirement-bindings <bindings-path>` 交回完整决定. 缺失, 重复, 复用原始条目或跨实例的决定不能进入评分. 完成要求绑定后, finding 语义裁决和逐用例评分照常执行. 此绑定只决定报告条目归属, 不改写判断或证据.

Main Agent 对完全没有可评分内容的实例核对原生会话及冻结场景, 只有确认模型自身行为是原因时才提供 `modelFailure`. 已有可评分内容仍按原报告评分, 不因 `incomplete` 状态整体丢弃. 准备, 运行, 传输或测量错误及未知原因不计分, 先修复后按影响范围恢复.

定向轮次仍有实例尚无可信结果时, 可用同一准备记录和已取得的绑定结果运行 `score-completed`. 该入口复用相同输入适配, 要求绑定, finding 裁决和评分规则, 展示已可评分的实例与完整配对重复分数; 不完整重复不生成重复分数. 所有 3 次重复齐备才计算两个平均分, 局部结果不提供批次通过结论. 该入口不设另一种评分或折减方式.

## Failure and freshness

Reviewer, 重复或实例身份缺失, 重复或多余, 输入不可信, 最终平均分 `score` 低于 `0.75`, 或会话与来源隔离等有效性条件失败时, 定向与发布模式均失败. 模型报告错误按评分规则处理, 不独立使批次失败. 每份已准备的 Reviewer 合同包含封闭 Module 注册表当前的正整数 `scenarioRevision`, 精确的临时 `scenarioRoot`, `scenarioDigest`, 3 次重复绑定和完整实例集合; `scenarioDigest` 是相对于 `HEAD` 的精确已暂存二进制差异的 SHA-256. 验证器要求修订版本仍为当前值, 并根据同一场景重新计算摘要值. 不匹配时两种模式均失败. Reviewer 必须检查已暂存状态, 临时 Git 仓库属于能力输入. 已准备状态不保存树对象身份或 Source Checkout 候选身份. 发布模式还核对当前受影响 Reviewer 集合, Canonical Role 字节和共用 Reviewer 责任字节与准备绑定一致. 单个实例或重复, 确定性测试夹具及模拟结果不能作为发布授权. 错误及候选, Role, 场景或评分合同变化后的恢复按[发布能力门禁](../specs/agent-repository-workflow-release/spec.md#reviewer-capability-gate)处理, 由准备责任重新建立受影响绑定. 保留未受影响的有效准备, 原始报告, 会话证据和评分输入, 重跑结果只替代受影响结果; 最终验证消费 3 次完整重复与全部适用场景, Spec Readiness 按同序号配对.

## Verification inputs

自动验证读取每个精确 `instanceId` 的 `artifactPaths`, `formatCorrection` 或 `modelFailure`, 具体形状和互斥规则由[评分输入规则](reviewer-capability-scoring.md#scoring-input)拥有. 所有路径都必须位于相应实例授权的临时范围. 原始报告必须等于准备绑定的 `reportPath`, 规范产物必须来自该实例成功生成映射. 独立格式副本与原件均须准确绑定, 原件确有表示格式错误; 解析副本后仍保留全部原始内容错误. Spec Readiness 和 Commit Audit 从各自绑定的不可变 Request 核对身份及当前输入, 不从其他实例或当前工作树的其他版本取正文. 文件存在和格式正确不证明审查完成, 模型失误记录也不证明运行可信; Main Agent 通过原生会话核对实际完成与错误原因.

`artifact-promotion` 复用不可变请求, Reviewer 身份, 场景输入快照和草稿路径. 它按场景交接接受全部适用检查的 JSONL, 保留全部 finding; 不生成正式 Spec Readiness 产物或实施授权. 两个 Spec Readiness 场景均从绑定请求取得正文来源并归一化实际及预期证据, 普通规范结果中的请求声明不能替代实际请求绑定核对.

后续调用读取适用的临时要求绑定与裁决决定, 每次重新建立完整集合. 除评分报告, 规范产物及用于身份与正文核对的不可变 Request 外, 自动验证不读取 Reviewer 覆盖清单, 临时脚本, 工具历史, 会话记录或其他内部工作文件. 会话证据由 Main Agent 单独检查, 不成为自动验证器输入.

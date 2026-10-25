---
name: reviewer-benchmark
description: 仅在用户显式调用时, 在 ARW 源码仓库中执行 Reviewer 模型基准工作流.
---

# Reviewer Benchmark

只有用户在 ARW 源码仓库 Source Checkout 中显式调用 `$reviewer-benchmark` 后, 才使用本 Skill. 其他 Skill 不得自动调用它. 源码中的 Skill Package 是唯一操作指引, 不进入 Workflow Distribution.

## Scope and authorization

与用户沟通的 Main Agent 负责用户沟通, 工作分派, 分歧复核和正式结果发布. 遵循 [Reviewer 指引](../../../docs/agents/reviewer.md)中的审核版本与并行规则, 以及[工作分派规则](../../../docs/agents/subagent-allocation.md). 基准结果不提供普通审核, 实施, 发布或提交授权.

确认用户授权的模型, 提供方, 原生推理强度, 服务档位, 角色, 场景, 重复次数, 保留结果和输出范围. 显式绑定实际活动 issue 与 effort. 冻结适用输入字节, 完整角色指令, 已准备场景的绑定, 隐藏预期和测量条件. 变更影响可比性时保留历史资料, 先确定受影响范围, 再取得额外采集的授权. 复用已经确认的决定, 不重复询问.

在当前会话的[临时工作区](../../../docs/agents/environment.md)保存准备记录, 机器入口绑定, 采集检查点, 决定, 两份独立评分及 Main Agent 的复核结果. 已绑定的恢复路径保持不变. 正式 `statistics.json` 和 `tables.html` 保存到实际 effort 中明确授权的输出目录. 历史结果保留原位置和原字节.

只读取本次选定提供方的引用文档:

- 配置了 Strata 驱动时, 读取 [Strata 操作](references/strata.md).
- 使用 DeepSeek API 连接时, 读取 [DeepSeek 操作](references/deepseek.md).

## Forecast and prepare

只有本次另行授权了准确预检范围, 才执行预检. 预检观察不进入正式统计. 根据实际预检结果或确实可比的历史观察, 一并估算采集, 两轮独立评分, 等待, Main Agent 复核和发布所需的时间. 说明实测依据, 外推假设, 不确定范围和容量瓶颈. Main Agent 在开始已授权采集前, 与用户确认全流程耗时范围, 容量和执行顺序; 不继承旧运行的固定容量或模型配置集合.

准备选定角色的定向批次前, 读取[能力验证准备规则](../../../docs/agents/reviewer-capability-preparation.md). 使用其现行 `prepare` 命令, 保留包含 `preparedPath` 和 `handoffs` 的完整返回对象. 场景, 重复次数, Spec Readiness 配对, 隐藏预期和准确报告路径由准备合同拥有. 每个测量实例都启动全新的 Reviewer 线程.

## Collect and resume

[源码维护入口](../../../scripts/reviewer-benchmark.mjs)接受一个操作名称和一个 JSON 输入路径. 从现行[运行器](../../../lib/reviewer-benchmark/benchmark-runner.mjs)读取各操作的输入输出, 不虚构命令参数.

```sh
node scripts/reviewer-benchmark.mjs collect <absolute-collection-input.json>
```

每个操作的输入都提供绝对路径 `repositoryRoot`, `effortDirectory` 和 `outputDirectory`. 采集和评分还提供实际 `issueId`, 包含 `model`, `modelProvider`, `reasoningEffort` 和 `serviceTier` 的选定 `configuration`, 以及包含完整准备输出的 `prepared`. 这些阶段的 `outputDirectory` 是已绑定的会话临时目录, 不是 effort 的正式输出目录.

采集程序通过共享后台 Agent 机器入口消费每个 `prepared.handoffs[].input`, 只加入本次明确选定的模型设置. 直接使用已准备场景. Reviewer 亲自写入绑定的原始报告; Main Agent 消费该文件, 不从消息重建报告. 共享运行程序拥有原生身份, 权限和单 Agent 核对, 最终任务交接及计量. 通过该程序应用选定提供方按实际用途规定的时限.

使用原采集输入和检查点恢复. 启动回执不确定时, 先核实原运行身份再继续, 不创建另一个实例掩盖不确定性. 连接关闭或单次等待超时不表示任务结束. 发生实际故障或处理积压时, 暂停新的启动, 保留绑定报告和已知事实, 调查受影响范围. 不仅为了恢复中断的运行而再次采集已经完成的实例.

## Score independently

读取[能力评分规则](../../../docs/agents/reviewer-capability-scoring.md)和[验证与裁决规则](../../../docs/agents/reviewer-capability-verification.md). 现行 Conformance 评分程序是唯一评分权威. 基准评分消费绑定的原始报告, 通过该程序记录报告错误; 不增加质量通过门槛或诊断评分分支.

```sh
node scripts/reviewer-benchmark.mjs score <absolute-scoring-input.json>
```

使用相同的采集绑定和临时 `outputDirectory`. 返回 `needs-requirement-binding` 或 `needs-adjudication` 时, 保留返回请求, 根据冻结来源作出决定, 在下一次评分输入中提供完整 `requirementBindings` 或 `adjudication` 对象. 通过 `candidateId` 关联候选, 不使用重复出现的行序号. 已确认由模型自身行为导致的空结果使用受支持的 `modelFailures` 输入; 执行故障或原因未知的情况保持待处理, 不转换为质量 0 分.

Main Agent 向两份独立评分任务提供相同的冻结报告, 已准备预期和评分合同. 各评分者的决定及输出保存在各自的临时目录, 不提供另一评分者的决定或先前分数. 保留准备归属和报告路径. Main Agent 在原采集目录中分别使用两份独立决定串行运行评分程序, 每轮结束后先把该轮 `scoring.json` 与 `role-statistics.json` 原字节保存到对应独立目录, 再开始下一轮. 两份结果保持独立, 检查点绑定不变.

完整 Conformance 结果同时展示折减前分数与最终分数. 只有 `finalRepetitionScores` 对应 v4 逐重复 `score`. 计量沿既有准备角色和实例关联, 遵循[工作时间合同](../../../docs/specs/agent-repository-workflow/spec.md#model-work-time)和[模型阶段合同](../../../docs/specs/agent-repository-workflow/spec.md#model-phase-measurement). 缺失观察保持未知; 采集程序不为了取得指标增加模型请求.

## Reconcile and recover

对两份独立评分文件使用 `compare`. 其 `commonOnly: true` 模式允许增量比较双方都已具备的完整角色. [比较实现](../../../lib/reviewer-benchmark/recheck-statistics.mjs)对同序重复分别应用既有的对称 10% 分差门槛: 无分歧时取两分平均, 分差达到或超过门槛时交 Main Agent 复核. 角色平均分相同不能抵消逐重复分歧.

Main Agent 根据原始证据解决判断分歧, 经同一 Conformance 评分程序重算. 使用 `resolve` 合并两份候选决定及 Main Agent 的明确裁决, 使用 `finalize` 合并两份独立角色评分及 Main Agent 对分歧角色的重算结果. 每个无分歧重复保留两分平均值; 只有存在分歧的重复采用 Main Agent 的重算分数. 已证实的共同错误也通过同一评分路径修正.

局部恢复时, 先修复原因, 再使用现有能力验证 `prepare --prepared ... --input ...` 选择合同. 只通过共享 `arw background-agent` 入口执行其中新建的交接, 保留未受影响结果, 把当前完整实例集合交给现行 Conformance 验证器. 完整角色的 `collect` 和 `score` 明确拒绝部分交接. 不为补齐批次而扩大选择, 也不创建旧采集合并协议. 发布复核后的评分更新时保留已采集观察.

## Publish and finish

只有 Main Agent 发布正式统计. 使用 `publish` 交接复核后的统计, `outputDirectory` 位于实际 effort 内. 已有结果的 `updatesPath` 路径会创建备份并应用经过核对的更新; 评分修正保留已采集的运行和交付事实. 同一模型与推理强度键的提供方或服务档位存在冲突时, 使用另行绑定的正式输出, 不混合条件或推断历史默认值.

对这份准确的正式统计文件使用 `render`, 输出到同一正式目录. [统计实现](../../../lib/reviewer-benchmark/statistics.mjs)拥有 v4 投影和派生展示. 保留原始墙钟, 原生 token 含义, 可选工作时间和配对阶段事实, 以及未知或估算观察. 不在统计中持久保存价格, 费用, 派生速度, 完整会话或报告副本.

核对授权的角色与实例覆盖, 对应最终分数, 原始观察保留, 每次重复的错误来源, 以及表格与已发布 JSON 的一致性. 展示分数和实际计量, 说明估算及样本覆盖. 保持未解决故障和准确恢复位置可见. Main Agent 只按公共工作流处理已授权的临时清理与 issue 完成; 基准工作不授权更改用户默认值, 外部模型安装或无关配置.

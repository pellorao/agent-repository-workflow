# Reviewer Capability 准备和交接

## Targeted preparation

对定向 Reviewer 迭代, 运行 `node scripts/reviewer-capability-conformance.mjs prepare --reviewer <identity>`. 身份必须精确对应一个已注册的 Reviewer. 命令不读取已暂存内容或工作树比较, 不导出其他 Reviewer, 不检查全局配置, 也不生成发布证据.

命令在当前仓库, Codex 平台和 Main Agent 会话下创建新的唯一批次, 然后返回:

- `preparedPath`.
- 该 Reviewer 能力合同要求的每个 `handoffs` 交接. 每项准确包含 `{instanceId, reviewerId, scenarioRoot, input}`, Spec Readiness 交接另含 `scenarioId`; `input` 是可直接交给共享 `arw background-agent` 机器入口的完整 `spawn_agent` 输入.
- 需要生成规范结果的实例完成后, 由 Main Agent 执行的对应 `generations` 条目.

每个 Reviewer 批次准确建立 3 次完整重复. Code Standards 的每次重复包含其唯一场景的一个实例, 因而一批有 3 个实例. Spec Readiness 的每次重复同时包含 `runtime-migration` 与 `artifact-promotion` 各一个实例, 因而一批有 6 个实例. 两个场景只按相同重复序号配对, 第 1 个实例与第 1 个实例组成第 1 次重复, 其余序号同理; 序号只提供稳定配对, 不表达实例优先级. `runtime-migration` 的每个实例都按普通工作流准备独立 Reviewer Request, 并为 Main Agent 保留对应生成步骤; `artifact-promotion` 的 3 个实例直接交付完整 JSONL 报告. 每个交接都包含稳定且在该 Reviewer 合同内唯一的 `instanceId`, 每个实例只属于一次重复. 实例接收相同的当前角色, 场景和绑定输入, 但使用相互隔离的全新线程, 且看不到其他实例的结果.

Reviewer 可见的 `input.handoff` 不包含 `preparedPath`, 隐藏的预期合同或由 Main Agent 执行的生成命令. `input` 准确包含 `{role, identity: {kind: "isolated", instanceId}, instructions, handoff, cwd, writePaths, reportPath, stateDirectory}`. `role` 等于 `reviewerId`; `instructions` 包含完整 Canonical Role 和公共 Reviewer 规则; `cwd` 等于 `scenarioRoot`; `reportPath` 是准备记录绑定的原始报告绝对路径; `writePaths` 只授权该场景内包含报告的准确临时写入范围; `stateDirectory` 等于 `preparedPath` 的父目录. 准备记录绑定当前批次, 所选身份, 重复, 场景和隐藏的正式预期, 不保存候选内容树对象或跨会话兼容合同. Code Standards 的 `reportPath` 等于精确的 `resultPath`, 位于各自场景的 `.tmp/` 下; 准备阶段创建零字节文件. Spec Readiness 的 `reportPath` 等于对应 Request 的 `draftPath`; `artifact-promotion` 的 `resultPath` 和 `runtime-migration` 生成项的 `draftPath` 也等于该实例的 `reportPath`. 报告与最终状态由 Main Agent 核对; 正常交付使用 `ready`, 模型自身未完成审查的结果按[评分输入规则](reviewer-capability-scoring.md#scoring-input)处理. 不得在另一个会话中重用它, 也不得自动清理旧批次.

定向迭代测试新建 Codex 线程实际使用的完整 Canonical Role 与公共 Reviewer 规则, 场景仓库内适用的 Agent 指令, 以及本轮解析的运行设置. 场景可以把必要的审查输入和 Agent 指令复制到隔离树中. Main Agent 从发起准备的 Source Checkout 调用机器入口, 由该仓库解析用户配置和恢复边界; Reviewer 的受审仓库与读写权限由已准备场景的 `cwd` 和授权路径决定. 能力验证的隔离实例可以明确提供本轮 `input.settings` 覆盖, 未覆盖的字段按全局与仓库配置解析. 项目文件变化后, Main Agent 按[发布能力门禁](../specs/agent-repository-workflow-release/spec.md#reviewer-capability-gate)评估当前场景各次重复结果的实际影响; 受影响的绑定由准备责任按恢复范围重新建立, 未受影响的有效结果保留.

准备操作只有在当前完整实例集合的准备条件全部满足后才返回交接和可执行的准备记录. 局部恢复保留未受影响实例的有效绑定, 只创建受影响实例的新绑定, 具体输入和返回范围遵循[准备 Interface](../specs/agent-repository-workflow-release/spec.md#reviewer-capability-conformance). 途中失败时不返回部分交接或可供验证的准备结果; 已创建的临时目录可以保留供诊断. 平台容量不足时, Platform Host 可以按返回顺序分批启动实例, 但重复与实例集合, 同序配对, 输入和隔离规则保持不变.

## Release preparation

对于干净且已经提交的 Source Checkout 发布候选内容, 运行 `node scripts/reviewer-capability-conformance.mjs prepare`. 命令解析已经提交的 `HEAD`, 可到达且低于它的最高稳定 SemVer 基线或当前对象格式的空树对象, 以及从基线到候选内容的完整变更路径. 它拒绝已暂存, 未暂存和未跟踪变更. 它导出完整的受影响 Reviewer 身份集合, 创建新的唯一批次, 并返回 `preparedPath`, 按 Reviewer, 重复, 场景和实例固定排序的 `handoffs`, 以及由 Main Agent 执行的 `generations`. 准备记录只存储受影响的 Reviewer 身份, Role 字节摘要值, 场景根目录, 场景修订版本, 场景摘要值, 重复绑定和准确实例集合. 它不存储 Source Checkout 候选内容, 提交, 树对象, 基线或变更路径. 空交接数组表示完整发布范围不影响任何已注册的 Reviewer 合同. Main Agent 只消费准备责任交付的准确绑定, 不自行添加, 删除或替换交接或 `generation` 条目; 错误恢复的重新准备范围遵循[发布能力门禁](../specs/agent-repository-workflow-release/spec.md#reviewer-capability-gate).

## Fresh Reviewer threads

对于每个返回的交接, Main Agent 把完整 `input` 交给共享机器入口的 `spawn_agent`, 为每个 `instanceId` 创建没有父对话的全新 Reviewer 根线程, 并核对原生文件权限与本轮没有子 Agent 参与. 每个 `instanceId` 对应一个独立线程和一次审核, 正常结果写入绑定报告; 模型自身行为导致没有可评分内容时保留该次运行并按[评分输入规则](reviewer-capability-scoring.md#scoring-input)记录原因. 这项能力测试例外允许不复用普通 Reviewer 线程, 同时适用于定向模式和发布模式. 运行恢复仅指向该实例已经确认的原线程.

重用线程可能保留预设的确定性答案或先前配置. 因此, 为这些交接之一创建的线程始终是能力测试线程, 不能用于普通 Spec Readiness, Commit Audit 或 Gate 3 工作.

Reviewer Capability Conformance 不是 Reviewer Role, 也不添加 Reviewer 种子.

## Scenario isolation

每个 Reviewer 必须把所提供的场景根目录当作完整的待审查仓库, 且只可在该根目录内读取适用的 Agent 指令. 它不得检查外层 Source Checkout, 能力测试框架, 其实现或测试, 隐藏的预期合同, 之前的能力响应, 另一个场景树, 内存, rollout 摘要或会话记录. 即使返回的定位信息恰好匹配, 只要结论来自禁止使用的来源, 该次运行仍然无效.

场景准备复制 Reviewer 完成审查时可能需要的 Agent 指令. 对根 `AGENTS.md` 或 Canonical Role 引用, 但在该只读场景不适用的文档, 交接逐项列明并要求 Reviewer 忽略, 不读取或搜索. 准备阶段发现根指令引用的文档既未复制, 也未列为不适用时, 停止准备, 不交付该场景. 如果完成审查必须执行已排除文档所治理的操作, Reviewer 返回未完成并说明原因.

## Handoff content

这些只适用于能力测试的隔离指令属于生成的 `input.handoff`, 不属于 Canonical Reviewer Role. 普通 Reviewer 工作不接收合成场景, 隐藏答案或能力测试框架指令, 也不因能力验证使用 3 次重复而增加普通审核的实例数量. 两个角色的 `input.instructions` 均包含完整公共 Reviewer 规则, `input.handoff` 包含共用场景隔离规则及准确的不适用 Agent 文档路径; 专用内容只补充场景参数, 绑定报告和适用的 Reviewer Request 路径. Spec Readiness 交接提供其准确 Reviewer Request 路径和响应协议; 对应生成步骤只由 Main Agent 保留和执行. `artifact-promotion` 还提供与请求 `draftPath` 相同的精确绝对 `resultPath`. 如果平台文件编辑工具从外层主机工作区而不是命令解释器工作目录解析相对路径, 交接要求使用场景根目录下准确的工作区相对目标, 并说明更改命令解释器工作目录不会重定向该工具.

## Full-review Spec Readiness report

`artifact-promotion` 用于观察完整审查的覆盖, 交接明确要求 Reviewer 即使在 Inputs 或 Requirements 检查发现问题, 也继续完成全部适用检查. Reviewer 保留同一绑定 JSONL 中的全部 finding, 完整交付后才返回 `{"status":"ready"}`. Main Agent 确认完成后, 按[评分输入规则](reviewer-capability-scoring.md#scoring-input)直接提交该 `resultPath`. 这项能力测试报告不经过普通生成入口, 不产生正式就绪产物或实施授权. `runtime-migration` 继续检验普通提前返回和生成行为.

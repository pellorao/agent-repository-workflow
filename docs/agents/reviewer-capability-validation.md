# Reviewer Capability 验证

## Scope

Reviewer Capability Conformance 是 Source Checkout 的发布关卡, 它使用真实的固定 Reviewer 和确定性场景验证 Codex 上的实际审查能力. 当前发布不会在 Claude Code 上运行实时 Reviewer 能力测试或会话测试. Claude Code 支持要求确定性的原生格式, 字节完全一致的种子, Workflow Distribution 构建, Platform Projection 和修改检测. 该实时关卡不属于普通提交验证, Commit Audit 或 Gate 3.

下述评分合同只有在对应 Conformance Module 的实现和验证进入同一个候选后, 才能作为运行结果的达标依据. 在此之前, 不得用这里的 `0.75` 门槛或重复平均分解释现有验证器输出.

每个 Reviewer 批次准备 3 次相互独立的完整重复. Code Standards, Code Spec 和 Commit Audit 的每次重复各使用其唯一场景的一个全新实例. Spec Readiness 的每次重复按相同序号配对两个场景实例. 重复合并计分, 报告错误处理, 分数折减, 分数门槛和结果展示遵循[最终评分合同](reviewer-capability-scoring.md#final-score). 完整实例集合, 准备与报告绑定, 会话和来源隔离等输入有效性条件必须满足. 这些重复只用于能力验证, 不改变普通真实审核.

Reviewer Capability Conformance 按工作流责任拆分. 开始每个阶段前读取适用文档:

- 准备定向或发布轮次并开始交接前, 读取 [准备和交接](reviewer-capability-preparation.md).
- 编写, 更改或解释能力场景和隐藏用例前, 读取 [场景和用例](reviewer-capability-scenarios.md).
- 计算或提供评分输入前, 读取 [评分](reviewer-capability-scoring.md).
- 执行自动验证或 Main Agent 裁决前, 读取 [验证和裁决](reviewer-capability-verification.md).
- 检查原生会话, 关联本次实例的评分与计量, 展示估算依据, 记录报告或决定是否收敛前, 读取 [会话检查和收敛](reviewer-capability-session-inspection.md).

## Targeted iteration planning

定向优化 Code Review, Spec Readiness 或 Commit Audit 时, 每轮方案聚焦已有证据支持的主要失败原因, 说明拟议修改及预期可观察的改善. 比较某项优化的效果时, 保持其他相关输入不变; 必须同时修正场景或评分器时, 重新建立比较基线, 不把分数变化单独归因于 Reviewer 改进. 场景已满足质量要求且本轮必要修正完成后, 进入验证, 不因可选改进持续扩大准备范围.

已确认有效且具有重复使用价值的改进写入承担相应责任的 Agent 规则. 尚未验证的优化假设记录在当前 issue, 取得实际效果证据后再决定是否固化. Reviewer 未遵循已有规则时, 先查明原因, 不以重复叠加同义指令代替诊断.

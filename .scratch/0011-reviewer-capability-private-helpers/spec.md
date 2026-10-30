# Reviewer Capability 内部辅助项封装

## Behavior

Reviewer Capability Module 的组池和证据处理保持现有结果, 错误与确定性行为. pool.mjs 的 SEED 和 poolItem, evidence.mjs 的 reviewerCapabilityLocatorKey 仅作为各自文件内的实现细节, 不从文件导出. 对外入口及被其他文件消费的导出保持不变. 不改变随机种子值, 候选字段筛选或证据定位键的算法.

## Module Design

Not required: 仅收回没有跨文件使用者的三个内部导出, 不改变 Reviewer Capability Module 的公开操作, 责任, Seam, 依赖方向, 权威来源或数据流. 现有维护入口和公开函数继续消费原有实现.

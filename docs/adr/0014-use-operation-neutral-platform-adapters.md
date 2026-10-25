# 使用操作中立的 Platform Adapter

## Context

ARW 的仓库工作流, 发布前同步和 Upstream Sync 都要处理 Codex 与 Claude Code 的格式差异. 各平台的目标路径, Skill 引用语法和原生 subagent 种子格式不同. 这些差异需要配置驱动的权威来源, 但 Adapter 不取得仓库归属, 用户授权, Git 恢复或业务事务责任.

旧 Platform Adapter 还扫描环境中的 Agent 与 Skill, 返回观察结果, 证明, 内置身份和冲突优先级证据. 当前支持平台已经保证仓库本地目标位于所需覆盖位置. 每次操作重复证明平台内部优先级既不能改变 ARW 自己的写入安全性, 也扩大了无法由目标 Git 仓库文件系统可靠发现的状态范围.

## Decision

ARW 保留一个操作中立的 Platform Adapter. Adapter 固定平台和只读依赖, 以同一配置解释从统一格式到目标平台的映射. 它不接收 `workflow init | update | verify | remove` 等命令名, 也不接收 ARW 锁文件或用户授权.

Adapter 可以完成以下纯计算责任:

- 从统一 Workflow Distribution 载荷计算一个平台的受管目标;
- 计算仓库自有种子目标的兼容性;
- 解析平台原生种子身份;
- 分析和转换 Skill 引用语法;
- 把来源配置选择的平台引用语法转换为统一 Codex 格式;
- 返回稳定诊断.

合法调用的公开结果使用 `succeeded | blocked | failed` 状态, 操作特定载荷和始终存在的诊断. 投影成功时返回调用方需要的受管目标, 仓库自有种子目标和准确字节. 阻断结果不返回可写的部分目标集合. 失败结果准确表达依赖或 I/O 失败. 无效调用同步抛出 `TypeError`.

Adapter 不返回环境观察结果, 证明, 证据表, 保留身份, 内置对象内容表或发现优先级. 它不扫描用户级, 系统级, 平台内置或嵌套 Git 仓库中的 Agent 与 Skill. 目标 Git 仓库的根目录现有文件观察由 Repository State Inspector 按 [ADR 0025](0025-use-root-only-repository-platform-discovery.md#decision) 提供, Repository Workflow Module 决定冲突, 归属, 授权和事务.

发布前同步与 Upstream Sync 调用同一个 Skill 引用分析和转换责任, 避免各自复制平台规则 (Upstream Sync 现已不调用 Adapter, 见 [ADR 0011](0011-use-source-only-human-reviewed-upstream-sync.md) 的状态说明). Adapter 仍不写源码仓库, 不修改 Git 暂存区, 不运行编辑器, 不取得审核或恢复状态.

Repository Workflow Module 在一次完整的写入前检查中组合所有已选平台的结果. 任一阻断问题都会阻止整个事务, 不允许已选平台集合部分成功. 确定性合并, 共享目标冲突和最后写入锁文件的责任仍归 Repository Workflow Module.

## Rejected alternatives

- 不让每个命令或生命周期维护自己的平台转换器. 这会复制目标路径和 Skill 引用规则.
- 不让 Adapter 直接写 Git 仓库或源码仓库. 只有纯计算结果才能让调用方保持事务与恢复权威.
- 不保留环境扫描和证明结果. 它们重复支持平台的环境前提, 并把平台内部不可发现事实变成每次操作的阻断问题.
- 不采用通用能力图或依赖 DAG. 当前两个平台的固定映射和有序条目已完整表达需要的依赖.
- 不允许单个平台部分成功. 一个 Repository Profile 和锁文件不能准确表示所选集合中只应用一部分.

## Consequences

平台特定语法与目标事实只有一个配置驱动的计算边界. 仓库工作流, 发布前同步和 Upstream Sync 可以复用同一转换, 同时各自保留状态, 授权和写入责任. Adapter 结果更小且可以直接测试. 代价是调用方必须提供自己生命周期已经安全取得的准确输入字节, 并负责组合多个平台结果与所有事务影响.

# Upstream Sync 最终化

## Finalize and recovery

提升前, finalize 对每条由同步负责的规范路径和准备记录的 Git 输入重复执行限定范围的预检. 无关路径可以处于 dirty 状态. 本次同步读取的路径不得包含未记录的未暂存变更, 未跟踪冲突, 不安全状态或哈希漂移.

调用 `finalize` 前, 取得对 `.agents/` 的写入授权, 并把该授权应用于 `finalize` 命令.

Finalize 以原子方式执行 3 项操作:

- 更新 Source Configuration 中的固定提交和 Theirs 引用列表.
- 把已批准候选内容提升到实际 `.agents/skills/` 和固定许可证目标.
- 写入不可变 Sync Record.

它不写入 Workflow Distribution, 不提升已跟踪的 Base/Ours 副本, 不运行 `node scripts/sync-workflow-distribution.mjs`, 也不执行 ARW Version bump, 提交, 标签, 推送, publish 或发布.

Sync Record 捕获新旧来源身份和快照摘要值, 新旧实际 Skill 摘要值, 冲突, Agent 解决结果, 许可证结果, Review 和 Approval 身份, 工具合同, 以及已完成的规范路径. 它不复制完整内容, 不保留第二份当前差异清单, 也不会成为另一个内容权威.

普通 `finalize` 和 `abort` 省略 `recoveryAuthorization`. 如果 `status()` 返回恢复计划, 适用操作接收一个封闭对象. 该对象只包含 `recoveryPlanDigest`, `channel`, `humanConfirmation` 和 `externalEvidence`.

摘要值和渠道是必需字段, 且至少有一个用户证据字段非空. 字段多余, 缺失, 无效, 为空或过期时, 返回 `invalid-recovery-authorization`, 不执行恢复写入.

Module 在恢复前重新验证计划摘要值, Git 索引证据和每个目标状态. 索引漂移, 第 3 种目标状态或恢复失败都需要手动恢复. Module 不发出提示, 也不提供独立的 `recover` 操作. 恢复授权不等于内容批准.

`abort` 只删除已经证明属于活动工作区的可丢弃状态. 它永远不修改规范输出, 也不创建 Abort Record. 部分中止使用向前重试. `awaiting-commit` 和 `checkpoint-satisfied` 状态下不能中止.

## HEAD checkpoint and later Workflow Distribution synchronization

`finalize` 成功后, 工作区进入 `awaiting-commit`, 并记录已经最终化路径的精确存在状态, 字节, 模式和 Sync Record 身份. 仅暂存还不够. 只有当前 `HEAD` 树与这些已经审查的规范字节匹配时, 检查点才满足. 提交可以包含无关路径. 只要树仍然匹配, 修订提交或变基就不会使检查点失效.

处于 `awaiting-commit` 状态的工作区不能再次最终化或中止. 检查点满足后, 状态报告 `checkpoint-satisfied`. 下一次成功准备会使旧工作区退役.

Upstream Sync 在该检查点完成. 如果采用的变更必须进入发布, 之后运行独立的 `node scripts/sync-workflow-distribution.mjs` 工作流. 不得让成功的 Upstream Sync 依赖 Workflow Distribution 状态, 也不得使用该工作流修复未完成的上游工作区.

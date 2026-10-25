# 从 Base 和 Ours 计算 Upstream Sync 本地差异

状态: 每轮从 Base 与 Ours 重新计算本地差异, 不保存差异清单, 按语义分批审核的决定继续有效, 现由 [`upstream-sync` Skill](../../.agents/skills/upstream-sync/SKILL.md) 执行. `agent-merge-notes.md`, Review Revision 绑定和 Sync Record 已随旧引擎删除, 见 [ADR 0011](0011-use-source-only-human-reviewed-upstream-sync.md) 的状态说明.

## Context

Upstream Sync 的 `prepare` 已取得准确 Base, 并从源码仓库实际 `.agents/skills/` 取得准确 Ours. 比较两者的路径, mode 和字节, 就能完整重建当前本地差异. 旧设计还要求以 `semantic-deltas.json` 持久保存当前差异说明, 并在工作区用 `active-deltas.json` 和 `delta-lifecycle.json` 重复表示本轮差异关系. 这些记录既不能替代治理文档对定制理由的解释, 也会产生缺失, 重复和过期状态.

## Decision

每轮 Upstream Sync 都直接从准确 Base 和 Ours 计算完整本地差异路径, 不保存或读取 `semantic-deltas.json`, `active-deltas.json` 或 `delta-lifecycle.json`. 它不为差异建立稳定身份, 不重复保存理由或不变量, 也不通过差异记录选择 verifier.

Main Agent 按语义选择用户审核批次, 覆盖 Ours 到 Candidate 的全部新增, 删除和修改 Skill. 语义改名作为同时包含旧路径和新路径的一个批次. 采用相同语义合并方式的跨 Skill 路径可以合并沟通, 但不得仅因文件类型相同就合并不同决定. 未确定的重要语义选择先通过 `grilling` 与用户达成共识.

每批应用候选后, Main Agent 提供自然语言合并说明, 以及一条只显示该批路径的 Ours 到 Candidate `git diff --no-index` 命令, 并取得单独批准. 已批准路径后来变化时, 必须重新审核该批.

每批批准后的自然语言说明累积到工作区 `agent-merge-notes.md`. 全部批次完成后, 用户使用该文件和已经完成的批次审核批准准确 Candidate. Module 只验证说明文件存在, 是安全普通文件且非空, 把准确字节与 Candidate 绑定到审核修订版本, 不解析, 分类, 评分或判断内容. 该文件只服务本轮审核, 不复制到 Sync Record. Sync Record 保存本轮已批准候选的差异路径, 冲突以及审核与批准身份, 但不保存语义说明, 也不成为下一轮当前差异的权威来源. 下一轮仍从新的准确 Base 与当时实际 Ours 重新计算.

本决定取代 [ADR 0011](0011-use-source-only-human-reviewed-upstream-sync.md) 中持久保存语义差异, 稳定差异身份, 双向覆盖检查和差异生命周期的决定. ADR 0011 的源码仓库限定, 用户审核三方同步, 固定提交, 来源范围, 批准, 同步记录, `HEAD` 检查点和操作特定恢复继续有效 (其中同步记录, `HEAD` 检查点和操作特定恢复后来已被 ADR 0011 的状态说明取代).

## Rejected alternatives

保留持久差异文件但在缺失时自动生成会继续维护可从 Base 和 Ours 重建的重复状态, 并且自动生成的说明不能证明原始定制意图. 用一个完整 diff 文件包集中审核所有 Skill 会产生过多内容, 使用户无法逐项判断. 只展示最终文本而不说明双方变化和合并方式又会让干净文本合并掩盖行为冲突. 因此审核按可理解的语义选择分批, 并让用户按需运行准确的限定路径 diff 命令.

## Consequences

现有本地定制不需要先补写差异清单就能参与同步. 工作区, 完成事务, 恢复计划和 Sync Record 都不再承载差异身份或生命周期. 原来由差异记录选择且未启用的候选非空检查随该机制删除, 不升级为全局要求. 每次同步都以分批沟通和限定路径 diff 向 Human 展示相关输入与最终选择, 再用临时合并说明批准准确候选, 而不是依赖过大的集中 diff, 可能过期的历史描述或程序生成的语义分类.

# 使用仅供源码仓库运行且由用户审核的 Upstream Sync

状态: 本决定中的 Upstream Sync 引擎 (同步工作区状态机, Review Revision, Approval Attestation, `finalize`/`abort`, 恢复授权, Sync Record 和 `HEAD` 检查点) 已由迁移 spec [`.scratch/0001-claude-code-migration/spec.md`](../../.scratch/0001-claude-code-migration/spec.md#rule-structure-and-context-budget) 取代: Upstream Sync 改为维护者显式调用的源码仓库专用 [`upstream-sync` Skill](../../.agents/skills/upstream-sync/SKILL.md), Agent 用 `scripts/upstream-sync.mjs` 生成 Base/Theirs/Ours 三方视图, 维护者逐批批准, 结果以 `source.json` 的固定提交, `adoptions.md` 和普通 Git 提交记录. 仅源码仓库运行, 不进入安装载荷, 维护者审核三方差异, 固定提交和来源范围继续有效.

## Decision

Upstream Sync 只在 ARW 源码仓库运行, 不进入安装载荷或目标仓库的 `arw workflow update`. 它通过 `scripts/upstream-sync.mjs` 和一个外部 Upstream Sync Module, 对已配置来源执行用户审核的 Base/Ours/Theirs 语义三方合并. `docs/agents/upstream-sync.md` 固定 Agent 编排要求. [Upstream Sync 长期规格](../specs/agent-repository-workflow-upstream-sync/spec.md) 负责当前来源配置, 状态和公开操作的完整合同; [ADR 0022](0022-place-source-checkout-scripts-under-scripts.md#decision) 负责维护入口位置.

每个来源的身份由 `upstream/sources/<source>/` 目录名确定, `source.json` 保存获取与选择上游的操作配置. Base 来自配置中固定的完整上游提交, Theirs 来自本次请求的完整上游提交, Ours 来自源码仓库实际 `.agents/skills/`. 配置中的来源范围明确选择上游输入, 排除规则优先. 快照只在可丢弃工作区中形成审核输入, 不成为第二份由 Git 跟踪的规范副本. Git 祖先关系只供审核参考, 不能替代固定 Base 字节的三方比较. 固定提交无法从已配置 URL 取得时, 准备操作关闭式失败.

Main Agent 按语义批次向用户展示候选变化并取得批准, 再以完整合并说明和准确候选取得最终批准. Approval Attestation 绑定当前审核修订版本和候选摘要, 不依赖某一个 CLI 交互面; Agent 只能转录已经发生的用户决定. 审核输入或候选变化使旧批准失效. [ADR 0028](0028-derive-upstream-sync-local-differences.md#decision) 负责从 Base 与 Ours 计算本地差异及分批审核, 不保存持久语义差异清单.

`finalize` 只提升实际 Skill, 固定许可证目标, 来源配置, 同步记录及来源自身状态. Workflow Distribution 由后续独立的发布前同步形成, 不属于本次批准对象或恢复状态. 单一活动工作区位于 `upstream/.workspaces/active/`; 不可变同步记录随来源由 Git 跟踪, 工作区清理不删除记录. 完成写入后, 准确 `HEAD` tree 检查点必须满足, 才能开始下一次同步.

恢复授权与候选内容批准分开: 前者只允许执行由当前 `recoveryPlanDigest` 绑定且仍可证明安全的特定操作恢复计划, 后者只接受准确候选. Module 在恢复写入前重验计划和目标状态, 不把内容接受决定扩张为恢复权限. 这些边界保留可审计的来源, 用户控制和可重复的事务顺序, 同时不扩大目标仓库的安装攻击范围.

## Rejected alternatives

不把 Upstream Sync 安装成目标仓库命令, 因为目标更新只应消费已经形成的 Workflow Distribution. 不用仅允许上游后代提交的规则代替准确 Base 比较, 因为 URL 迁移和重写历史可能保留相同的可审核字节. 不让 Module 从聊天推断批准, 自动合并所有语义变化, 或用 Approval Attestation 授权恢复; 这些做法会模糊用户审核的准确对象和恢复权限.

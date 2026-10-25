# 为不同生命周期使用各自的恢复基线

## Context

Repository Workflow, Engine Installation 和 Source Checkout Upstream Sync 修改不同归属域. 为三者维护一套通用日志, 备份和回滚协议会增加大量持久状态与恢复分支, 但不能消除 Git 仓库, 用户级 Installation 和来源同步工作区之间的真实差异.

## Decision

`arw workflow init`, `arw workflow update` 和 `arw workflow remove` 以 Git 索引作为恢复基线. 写入前允许已暂存变更, 但拒绝未暂存的已跟踪变更, Git 可见的未跟踪文件和未解决合并. 每个计划目标必须同时位于 Git 普通恢复视图和 Agent 管理范围内. Git 忽略规则, `.arwignore` 或 Git 内建 `.git/` 排除命中任一路径时, 操作均在写入前关闭式失败, 无论该路径是否已进入索引.

ARW 只修改工作树, 不修改索引, 不保存恢复日志或备份, 也不自动执行 Git 清理. 每个文件以原子替换避免不完整字节; 规范锁文件最后写入, 以免提前声明部分内容状态. 部分失败后, 由用户审查并把工作树恢复到索引.

Engine 的相同版本修复和受管理升级遵循 `complete preflight -> remove current managed Installation -> fresh install`. 它不维护旧运行内容的回滚. 移除未完成时不安装; 全新安装失败时, 由用户依残留冲突契约清理后重试. 新清单缺失时无法证明残留目标归属, 相同字节也不授予删除权限, 因此 Installer 不自动清理可能同时包含配置或未知用户内容的目录. 已安装的 `uninstall.mjs` 仍使用最后处理清单的向前重试.

前一次方案把已装订 DMG, 原生进程租约和自解除链接用于 macOS 安装; [ADR 0020](0020-use-external-nodejs-source-delivery.md#decision) 已以外部 Node.js 和复制式 Installation 取代这些机制. 不同生命周期分别使用适合其归属域的恢复基线这一决定继续有效.

Upstream Sync 使用单一 Sync Workspace 与 Git 索引限定范围恢复, 因为它需要保存审核, 批准和完成后的提交检查点. 实时完成失败时可以只恢复由同步拥有的精确路径; 崩溃恢复只有在索引仍匹配准备证据且工作字节可证明为前映像或后映像时继续, 否则要求人工恢复. 完成后的检查点比较 HEAD 树与已审核的规范字节, 而不保存提交 ID, 因为目标是证明字节已经进入历史并允许不改变它们的 amend 或 rebase.

## Consequences

每个生命周期只承担其归属领域真正需要的恢复复杂度. 仓库操作依赖用户熟悉的 Git 恢复, 代价是部分应用后不能直接续写旧事务. Engine 升级可能暂时不可用, 但重新安装路径简单. Upstream Sync 保留更强的限定范围恢复, 因为其跨审核与提交的长期状态无法由一次仓库操作方案替代.

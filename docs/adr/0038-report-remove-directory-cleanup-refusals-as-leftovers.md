# workflow remove 的目录清理拒绝只报告为残留

本决定为 `./0017-use-operation-specific-recovery-baselines.md` 所属的 Repository Workflow 写入安全规则增加一个限定例外, 并不改变 ADR 0017 的恢复基线.

## Context

长期规范 (`../specs/agent-repository-workflow/spec.md`) 的 `Shared safety and failures` 节要求写入操作在符号链接, 目录联接, 路径越界和状态漂移时关闭式失败. `workflow remove` 删除文件并处理锁文件后, 还要清理因此变空的目录. 这一步发生在主事务已经成功之后, 清理中遇到符号链接, 越界或删除失败的目录时, 把整个 `remove` 判为失败会让用户以为删除没有完成, 而文件和锁文件实际已处理完.

## Decision

目录清理是上述规则的限定例外: 对目录本身仍然关闭式处理 (不跟随符号链接或目录联接, 不离开仓库根, 只做非递归删除), 但拒绝只作为残留报告: `applied` 保持为真, 结果的 `leftoverDirectories` 列出这些目录, CLI 向标准输出写出提示行, 退出状态不变. 该例外只适用于成功后的空目录清理, 不适用于其他写入.

## Rejected alternatives

- 把清理拒绝判为操作失败: 已完成的结果被误报, 且没有可恢复或重试的动作.
- 静默忽略拒绝: 用户无从得知残留的目录.

## Consequences

真实取舍: 清理被拒绝时退出码不再反映这件事 (仍为 0). CLI 调用方只能看标准输出的提示文本, 只有仓库内的 Module 调用方能拿到 `leftoverDirectories`. 代价可以接受, 因为残留目录是 ARW 出于安全没有动的目录, ARW 没有往里写任何东西, 也没有删除里面的内容; ARW 管理的文件已经全部移除, 主事务已提交, 后续命令不受影响; 用户可以按标准输出的提示自行检查后决定是否删除.

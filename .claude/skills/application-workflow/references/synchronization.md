# 同步

每个已配置 Module 的工作都已提交并推送到其分发分支后, 在 Application 类型仓库中使用此阶段.

同步前, 每个已配置的 Module 都必须具有干净的工作树和 Git 索引, 并且位于 `application.submoduleDistributionBranch`. 运行:

```text
arw application sync
```

命令处理每个已配置的 Module, 并获取已配置的远程分支以核对当前状态和能否安全同步:

- 只接受 `equal` 或 `behind` 关系.
- `behind` Module 会进行快进.
- `ahead` 或 `diverged` Module 会阻止同步.
- 后续 Module 失败时, 之前成功的快进保持有效.

只有所有 Module 都收敛后, 镜像所需的仓库状态才完整. 命令才会读取每个已关联的 Module issue, 准确镜像 Module 的 `Status:`, 并读取完整的当前 `### Downstream changes` 列表. 对每个 Application Source Issue, 命令会:

- 完整替换旧的 `Downstream changes` 列表.
- 保留之前的普通评论.
- 在 Module 列表缺失或为空时写入 `- None.`.

`Downstream changes` 始终以完整的当前列表为准. 命令不使用游标, 基线, 提交范围或增量差异.

同步操作不更改任何 Application 规范, 要求, 验收标准, 阻断项或关联. `Downstream changes` 不改变 JIRA 接受或完成资格. 无效关联, 重复或位置错误的子章节, 不安全的列表结构, 以及任何 Module 阻断项都会在替换 Application issue 前产生诊断信息.

Application 中的 issue 替换是全有或全无的文件事务, 使用 Application 的 Git 索引字节作为恢复基线. 成功后, issue 修改和任何已经快进的子模块 gitlink 保持未暂存状态, Application 的 Git 索引保持不变. 审查这些字节, 并单独使用普通提交工作流.

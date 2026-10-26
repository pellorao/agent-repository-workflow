# 关联和分发

此阶段用于关联一个 Application Source Issue 和一个 Module 实施 issue, 并按依赖顺序发布生成的记录.

## Prepare the pair

在两个仓库中分别创建一个普通 issue. 关联前必须满足以下条件:

- 两个 issue 都处于非终态, 并具有相同的 `Status:`.
- 两个仓库中的预期 issue 字节已经审查并暂存, 使 Git 索引成为恢复基线.
- 每个已配置的 Module 都位于 `application.submoduleDistributionBranch`.
- 可能被关联操作归一化的 effort 不包含未暂存或未跟踪的内容.

在 Application 类型仓库中运行:

```text
arw application associate issue:<application-effort-number>:<application-issue-number> issue:<module-name>:<module-effort-number>:<module-issue-number>
```

命令会先分析所有已配置的 Module, 再执行以下操作:

- 在 Application 端写入 `Module implementation issue:`, 在 Module 端写入 `Application source issue:`.
- 可能归一化受影响的阻断项引用.
- 成功后使替换内容保持未暂存状态.

命令不执行 Git 暂存, 提交或推送, 这些操作由用户审查后在后续步骤中另行完成.

发布关联后, 任何一方都不得更改关联字段, 也不得建议更换关联目标. Application Source Issue 不是本地实施 issue. 同步操作负责镜像 Application Source Issue 的状态和 `Downstream changes`.

## Publish in dependency order

用户审查完整的关联结果后:

1. 在每个受影响的 Module 类型仓库中暂存并提交已批准的关联文件.
2. 获取单独的推送授权, 并把这些提交推送到已配置的 Module 远程仓库和分发分支.
3. 验证远程分支包含每个 Module 提交.
4. 在 Application 类型仓库中审查并暂存 Application issue 的替换内容和受影响的子模块 gitlink.
5. 只通过普通提交工作流提交 Application 类型仓库中的结果.

如果所有已配置的 Module 必须一起切换分支, 使用:

```text
arw submodule switch-branch <branch>
```

用户可以使用简写 `arw ssb <branch>`, 但 Agent 编写的指令使用规范形式. 命令要求每个 Module 具有干净的工作树和 Git 索引. 它会预检每个 Module, 不获取远程更新, 并在切换或恢复失败时报告最终分支和提交状态.

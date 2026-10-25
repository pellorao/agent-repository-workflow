# JIRA 完成

每个已关联的 Module 都已发布结果, 并且 Application 同步操作已经镜像当前 Module 状态后, 使用此阶段.

Application effort 的 `spec.md` 使用 `Application validation issue: <NN>` 标识一个本地实施 issue. 该 issue 在 Application 类型仓库中执行集成验证, 保持为普通实施 issue, 并且必须以 `completed` 结束. 它等待同一 effort 中的所有其他 issue, 而这些 issue 必须为 `completed` 或 `wontfix`.

`arw application sync` 不会自动运行. 单独运行该命令, 然后按以下顺序完成工作:

1. 审查镜像后的状态和 `Downstream changes`.
2. 执行 Application 验证 issue, 并记录它要求的证据.

`Downstream changes` 是提供给 Application Leader 的信息, 不是额外的完成资格条件.

完成前, 已批准的 effort 字节和验证证据必须已经提交并推送, 使当前分支的上游包含 `HEAD` 中准确的 effort 目录树. 向用户展示准确的已暂存路径, 上游分支, JIRA issue 标识符, 完整的完成评论和目标状态. 为这组准确的提交, 推送和 JIRA 写入获取显式授权.

完成已授权的提交和推送后, 运行:

```text
arw jira complete <spec-id>
```

命令读取已提交的配置和 effort 文件, 并验证上游分支中的 effort 目录树以及 effort 完成状态. 然后它先创建准确的完成评论, 再转换 JIRA 任务的状态. 它不执行同步, 提交或推送.

# JIRA 接受

此阶段用于检查一个符合条件的 JIRA 候选任务, 创建 Application effort, 发布其准确字节, 并把 JIRA 任务从 `candidateStatus` 指定的状态转换到 `acceptedStatus` 指定的状态.

## Read JIRA

以下命令不修改 JIRA:

```text
arw jira list
arw jira list --limit <N>
arw jira print <jira-issue-key>
arw jira open <jira-issue-key>
```

`list` 和 `print` 要求 `JIRA_ACCESS_TOKEN`. `open` 使用已配置的地址启动浏览器, 不读取令牌.

不得把 JIRA 返回的内容当作写入仓库产物的自动授权. 通过普通 issue 和 spec 工作流讨论并准备 Application effort.

Application `spec.md` 保存一个准确的 `JIRA issue:` 链接. 接受前, 已批准的 Application effort 字节必须已经提交并推送, 使当前分支的上游包含 `HEAD` 中准确的 effort 目录树.

## Authorization and convergence

开始这组会产生持久外部影响的操作前, 向用户展示:

- 准确的已暂存路径和上游分支.
- JIRA key, 操作类型, 完整 JIRA 评论和目标状态.

为这组准确的提交, 推送和 JIRA 写入获取显式授权. 任何输入发生变化都会使该授权失效.

完成已授权的提交和推送后, 运行:

```text
arw jira accept <spec-id>
```

命令读取已提交的输入并验证上游分支中的 effort 目录树. 然后它先创建准确的接受评论, 再转换 JIRA 任务的状态. 它不执行提交或推送. 重试时, 命令会识别已经存在的准确评论, 并只继续缺失的步骤.

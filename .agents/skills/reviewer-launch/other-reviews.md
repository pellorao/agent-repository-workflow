# 无 prepare 的审核

## Other reviews

`code-review` 的独立比较等没有 `prepare` 的审核, 按审核轮目录的同样结构手工准备: 固定 `code-review` 规定的不可变 Git 对象, 在会话临时目录保存执行规则副本及来源路径和 SHA-256, 为报告分配只含空报告文件的独立目录, 然后调用 `spawn_agent`, `input` 提供:

- `role`: Canonical Role ID. `identity`: 普通审核为 `{kind: "ordinary", issueIds: [...]}`, `issueIds` 完整排序.
- `instructions`: 完整 Canonical Role 与 `docs/agents/reviewer.md` 内容. `handoff`: 所属审核工作流要求的全部审查输入, 并写出 `reportPath` (运行层不另行告知 Reviewer 报告位置).
- `cwd`: 当前 Git 仓库根目录, 省略 `readPaths`. `writePaths`: 只含报告目录, 位于仓库 `.tmp/` 之内 (之外时运行层以 `invalid-input` 拒绝), 一般放在当前会话工作区 `.tmp/<平台>/<sessionId>/` 下, `<平台>` 只允许 `codex` 或 `claude-code`. `reportPath`: 准确报告文件. `stateDirectory`: 已存在的当前会话工作区目录 (不是其他会话的), 不在 `writePaths` 内.

所有路径都是绝对路径. 模型设置由用户配置 `config.json` 和仓库 `arw.config.json` 决定, Main Agent 不覆盖; 只有 Reviewer Capability 和基准的隔离实例可以在 `settings` 中覆盖. 复审用 `runId` 加相同完整字段调用 `followup_task`; 只有 issue 身份集合改变, 原线程不可用或不可恢复, 或用户明确要求时, 才用 `newThread` 创建替代线程.

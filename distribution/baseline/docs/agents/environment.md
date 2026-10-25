<!-- arw:managed:start -->
# Agent 环境

## Temporary workspaces

Agent 生成的全部仓库临时状态都以 `.tmp/` 作为 ARW Engine 管理的根目录. 会话工作区是 `.tmp/<agent-platform>/<sessionId>/`. `<agent-platform>` 只能是全小写的 `codex` 或 `claude-code` 等 Agent 平台名称, 多个单词之间使用连字号. 只属于一个 issue 的临时状态使用 `.tmp/<agent-platform>/<sessionId>/<issue-directory>/<purpose>/`, 其中 `<issue-directory>` 由本地规范 issue ID `issue:<NNNN>:<NN>` 转换为 `<NNNN>_<NN>`. 对于不属于单个 issue 的临时状态, Agent 可以在会话工作区下使用合适的子目录.

临时工作区路径中的 Agent 平台名称和会话 ID 必须由承载当前 Agent 会话的运行环境通过 Platform Adapter 提供. 对于 Codex, 会话 ID 使用该运行环境提供的 `CODEX_THREAD_ID`. 其他受支持的 Agent 平台必须使用各自运行环境明确提供的会话身份. 无法取得身份时必须停止, 不得猜测.

旧临时目录不属于当前会话的管理范围. 不得迁移或清理旧临时目录, 也不得增加自动清理机制.

当 Engine 返回准确的临时路径, Request 绑定准确的输入与输出路径, 或任务发起者在交接时提供准确授权的临时写入路径时, 后续参与者原样使用该路径. 不根据自己的会话身份, 默认目录或固定文件名重新推导已经绑定的路径.

临时验证需要隔离的候选快照时, 在该工作区中创建普通快照. 不得使用 `git worktree`, 也不得在仓库外创建临时 Git 工作树. 临时快照不得创建 Git 工作树登记.
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
None.
<!-- arw:repository-owned:end -->

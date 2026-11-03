<!-- arw:managed:start -->
# 并行实施与 worktree

## Parallel implementation

默认串行实施; 用户改为并行实施多个 issue 时:

- 每个 issue 使用一个独立的 Git worktree, 一个 worktree 只承载一个 issue. worktree 由与用户沟通的 Main Agent 创建, 合并和删除.
- 各 worktree 内的写入, 测试和提交审核只针对本 issue. Git 写入, 包括 worktree 内的暂存, 提交和合并回主分支, 仍只由与用户沟通的 Main Agent 执行.
- 预计改动同一文件的 issue 尽量不并行. 合并冲突由该 Main Agent 解决, 合并后在主分支重跑完整验证.
- 删除 worktree, 仓库或其 `.tmp` 前, 用 `echo '{"id":"1","operation":"list_agents","input":{}}' | arw background-agent` 取得全用户概览, 找出 `cwd` 位于该目录之内 (含子目录) 的加载中后台 Agent (删除的是 `.tmp` 时, 恢复记录在其中而运行的 `cwd` 通常是它所属的 Git 仓库根目录, 所以还要包括 `cwd` 等于该仓库根目录的运行; `cwd` 在该仓库根目录之上的运行不查找), 对每个所属本 Main 的运行用 `unload_agent` 卸载, 再次列出确认不再有此类行后才删除. 否则其恢复记录随目录丢失, 该运行此后无法恢复, 但空闲时仍可由容量回收或 `unload_agent` 释放名额. 属于其他 Main 或卸载失败 (忙碌) 的运行不删除目录, 告知用户.
- 并行不提高 Reviewer 和后台 Agent 的容量上限, 名额不足时排队等待.
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
None.
<!-- arw:repository-owned:end -->

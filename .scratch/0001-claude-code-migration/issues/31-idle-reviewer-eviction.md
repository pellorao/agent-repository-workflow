# 恢复记录丢失的空闲后台 Agent 无法回收, 占满全局名额

Status: needs-triage

## What to build

2026-10-28 共享管理进程的 16 个全局名额被 16 个空闲 Claude Reviewer 占满, 新 `spawn_agent` 一律返回 `Background Agent capacity is exhausted.`, 阻塞了 ticket 28; 用户授权后以 SIGTERM 正常关停才释放. 这些运行来自多个会话, 都已完成审核且处于 `idle`.

长期规范要求满额时按最近最少使用顺序回收可安全卸载的空闲根线程 (`docs/specs/agent-repository-workflow/spec.md` 约第 358 到 360 行), 但没有发生. 初步推测 (未证实): 这些运行的绑定恢复记录位于已删除的 worktree 的 `.tmp/` 下, `lib/background-agent/manager.mjs` 的 `safeIdle` 在 `verifyRecovery` 失败时返回 false, 于是 `ensureCapacity` 跳过全部候选. 期间对其中一个运行的查询报 `Reviewer recovery path must stay in the launching repository temporary workspace.`.

要做的:

- 复现并确认原因 (如: 启动 Reviewer 后删除其仓库或 worktree, 再让名额满额).
- 用户 2026-10-28 决定: 不放宽回收条件 (不采用 "记录不存在就可以回收"), 而是保证恢复记录在运行被回收或停止之前一直存在. 需要找出并堵住记录在运行仍加载时被删除的途径 (如 Main Agent 删除 worktree 或清理 `.tmp`), 例如: 删除前先确认没有加载中的运行引用该目录并先卸载它们, 或把记录放到不会随工作区删除的位置; 方案由实施时复核决定.
- `docs/agents/agent-writes.md` 的 `Issue concurrency` 要求删除 worktree 前用 `arw list background-agents` 确认没有从该 worktree 启动且仍加载的后台 Agent, 但列表目前不显示启动目录, 无法据此确认; 一并补上可确认的方式.
- 用户还问到 Strata 只有 1 个名额却 "占满 16 个": 提供方名额只限 Strata 自身, 本次 16 个都是 Claude 后端 Reviewer, 占的是全局名额. 若 `arw lba` 的输出容易让人误解为同一提供方, 顺带确认列表是否显示了提供方或模型.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#capacity-and-recovery`

## Acceptance criteria

- [ ] 原因已确认并记入 `## Comments`.
- [ ] 运行仍加载时其恢复记录不会因工作区删除或临时文件清理而丢失, 空闲运行在满额时可按规范回收, 有测试覆盖.
- [ ] 全量测试, 投影与分发检查, `arw text check` 通过.

## Blocked by

- None - can start immediately

# 非 Reviewer 后台 Agent 的恢复记录目录可能不在 Workspace 列显示的目录内

Status: needs-triage

## What to build

ticket 31 提交审核 (2026-10-28) 发现的既有问题: `arw list background-agents` 新增的 `Workspace` 列显示运行的 `cwd`, `docs/agents/agent-writes.md` 的 `Issue concurrency` 据此在删除 worktree, 仓库或其 `.tmp` 前找出加载中的运行并先卸载. 但 `spawn_agent` 的 `stateDirectory` 不受 `cwd` 约束, 非 Reviewer 运行的恢复记录可能位于 `Workspace` 显示目录之外, 按列表删除其他目录时仍可能丢失记录, 运行就再也无法回收. Reviewer 运行的 `stateDirectory` 恒在启动仓库的 `.tmp` 下, 不受影响.

可选方向 (实施时复核决定):

- 列表显示恢复记录所在目录.
- `spawn_agent` 合同要求 `stateDirectory` 位于 `cwd` 之下.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#capacity-and-recovery`
- `docs/specs/agent-repository-workflow/spec.md#background-agent-listing`

## Acceptance criteria

- [ ] 按列表确认后删除目录, 不会使任何加载中运行的恢复记录丢失; 有测试覆盖.
- [ ] 全量测试, 投影与分发检查, `arw text check` 通过.

## Blocked by

- 31

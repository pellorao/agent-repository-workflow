# 非 Reviewer 后台 Agent 的恢复记录目录可能不在 Workspace 列显示的目录内

Status: completed

## What to build

ticket 31 提交审核 (2026-10-28) 发现的既有问题: `arw list background-agents` 新增的 `Workspace` 列显示运行的 `cwd`, `docs/agents/agent-writes.md` 的 `Issue concurrency` 据此在删除 worktree, 仓库或其 `.tmp` 前找出加载中的运行并先卸载. 但 `spawn_agent` 的 `stateDirectory` 不受 `cwd` 约束, 非 Reviewer 运行的恢复记录可能位于 `Workspace` 显示目录之外, 按列表删除其他目录时仍可能丢失记录, 运行就再也无法回收. Reviewer 运行的恢复记录位置由 Reviewer 专属层绑定 (普通审核在启动仓库的 `.tmp` 下, 能力验证场景生命周期归调用方), 不属于本 issue; 变更生效前已保存的运行不追溯.

已选方案 (独立 sonnet high subagent 复核一致, 2026-10-28): `spawn_agent` 合同要求 `stateDirectory` 位于 `cwd` 之下 (可等于 `cwd`), 且 `cwd` 为绝对路径; `followup_task` 改变 `cwd` 时, 新 `cwd` 同样必须仍包含该运行的恢复记录目录. 不改列表显示 (需改表格, 规范与多处测试, 且 `Workspace` 一列已能直接用于删除前核对). 不处理祖先符号链接.

净增估算: 运行时代码约 +8, 测试约 +2 个案例 (约 +25 行), 规范约 +2 句, 总净增约 +40 行.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#capacity-and-recovery`
- `docs/specs/agent-repository-workflow/spec.md#background-agent-listing`

## Acceptance criteria

- [x] 非 Reviewer 的 `spawn_agent` 在 `stateDirectory` 不在 `cwd` 之下 (或 `cwd` 非绝对路径) 时被拒绝; `followup_task` 把 `cwd` 改到不再包含恢复记录目录的位置时被拒绝; 有测试覆盖.
- [x] 按列表确认后删除目录, 不会使任何加载中的非 Reviewer 运行的恢复记录丢失 (Reviewer 运行的记录位置由 Reviewer 专属层绑定, 变更前已保存的运行不追溯); 有测试覆盖.
- [x] 全量测试, 投影与分发检查, `arw text check` 通过.

## Blocked by

- 31

## Validation

- `pnpm test`: 714 tests, 713 pass, 0 fail, 1 skipped (新增 `tests/background-agent/manager.test.mjs` 一个用例: spawn 的 cwd 不含 stateDirectory 或 cwd 为相对路径被拒绝, followup_task 把 cwd 移出被拒绝而保持原 cwd 成功).
- `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node arw.mjs text check` 均通过.
- Spec Readiness: 4 轮 (haiku high), 12:27 到 12:34 共约 7 分钟, `verify` 退出码 0.

## Comments

- 方案复核 (独立 sonnet high): 与选定方案一致, 补充 followup_task 改 cwd 的遗漏路径与 cwd 必须为绝对路径.
- 实际净增: lib 代码约 +11/-3, 测试 +18, spec 约 +5 行文字 (含 Spec Readiness 要求补写的输入合同, 判定规则, 范围排除, 理由与 ADR 结论), 不计就绪记录.

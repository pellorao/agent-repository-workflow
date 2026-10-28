# 恢复记录丢失的空闲后台 Agent 无法回收, 占满全局名额

Status: completed

## What to build

2026-10-28 共享管理进程的 16 个全局名额被 16 个空闲 Claude Reviewer 占满, 新 `spawn_agent` 一律返回 `Background Agent capacity is exhausted.`, 阻塞了 ticket 28; 用户授权后以 SIGTERM 正常关停才释放. 这些运行来自多个会话, 都已完成审核且处于 `idle`.

长期规范要求满额时按最近最少使用顺序回收可安全卸载的空闲根线程 (`docs/specs/agent-repository-workflow/spec.md` 约第 358 到 360 行), 但没有发生. 初步推测 (未证实): 这些运行的绑定恢复记录位于已删除的 worktree 的 `.tmp/` 下, `lib/background-agent/manager.mjs` 的 `safeIdle` 在 `verifyRecovery` 失败时返回 false, 于是 `ensureCapacity` 跳过全部候选. 期间对其中一个运行的查询报 `Reviewer recovery path must stay in the launching repository temporary workspace.`.

要做的:

- 复现并确认原因 (如: 启动 Reviewer 后删除其仓库或 worktree, 再让名额满额).
- 用户 2026-10-28 决定: 不放宽回收条件 (不采用 "记录不存在就可以回收"), 而是保证恢复记录在运行被回收或停止之前一直存在. 需要找出并堵住记录在运行仍加载时被删除的途径 (如 Main Agent 删除 worktree 或清理 `.tmp`), 方案已定 (见 Comments): 删除前先卸载引用该目录的加载中运行, 记录位置不变.
- `docs/agents/agent-writes.md` 的 `Issue concurrency` 要求删除 worktree 前用 `arw list background-agents` 确认没有从该 worktree 启动且仍加载的后台 Agent, 但列表目前不显示启动目录, 无法据此确认; 一并补上可确认的方式.
- 用户还问到 Strata 只有 1 个名额却 "占满 16 个": 提供方名额只限 Strata 自身, 本次 16 个都是 Claude 后端 Reviewer, 占的是全局名额. 若 `arw lba` 的输出容易让人误解为同一提供方, 顺带确认列表是否显示了提供方或模型.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#machine-entry`
- `docs/specs/agent-repository-workflow/spec.md#capacity-and-recovery`
- `docs/specs/agent-repository-workflow/spec.md#background-agent-listing`

## Acceptance criteria

- [x] 新增所属 Main 的机器操作 `unload_agent`, 复用现有安全卸载核验 (`unloadSafely`); Reviewer 与普通运行都可用; 忙碌或非所属 Main 失败且不卸载; 规格见 spec 操作表.
- [x] `arw list background-agents` 增加完整显示运行 `cwd` 的 `Workspace` 列 (不加提供方或模型列); `docs/agents/agent-writes.md` 的 `Issue concurrency` 改为删除 worktree 或其 `.tmp` 前列出引用该目录的加载中运行, 用 `unload_agent` 逐个卸载并再次确认列表.

- [x] 原因已确认并记入 `## Comments`.
- [x] 卸载先于删除时, 空闲运行满额回收与释放名额不受目录删除影响; 恢复记录先被删除的运行仍不可回收 (条件不放宽); `unload_agent` 对忙碌, 非所属 Main, 恢复记录不符的运行失败且不卸载; 均有测试覆盖.
- [x] 全量测试, 投影与分发检查, `arw text check` 通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test`: 711 tests, 710 pass, 0 fail, 1 skipped. 新增或更新用例: `tests/background-agent/manager.test.mjs` (记录先被删的空闲运行不回收且列表含 `cwd`; `unload_agent` 对忙碌与非所属 Main 失败, 卸载后删除目录仍可准入; 记录不符时拒绝卸载), `host.test.mjs` (经 Host 路由), `presentation.test.mjs`, `arw-entry.test.mjs` (`Workspace` 列).
- `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node arw.mjs text check` 均通过.
- Spec Readiness: 5 轮 (haiku high), 11:13 到 11:25 共约 12 分钟, `arw spec-readiness verify --issue issue:0001:31` 退出码 0.

## Comments

- 2026-10-28 复现 (worker): `tests/background-agent/manager.test.mjs` 的用例启动运行并使其空闲, 删除其 `stateDirectory` 后再 `spawn_agent`, 在 `maxInstances: 1` 下得到 `Background Agent capacity is exhausted.`. 根因: `safeIdle` 在 `verifyRecovery` 读取 `background-agent-<runId>.json` 失败时返回 false, `ensureCapacity` 跳过全部候选; 记录位于启动仓库或 worktree 的 `.tmp` 下, 随 worktree 删除或 `.tmp` 清理而丢失. 流程缺口: `agent-writes.md` 已要求删除前确认无加载中运行, 但列表不显示启动目录, 也没有 Main 可用的卸载手段, 规则无法执行.
- 列表现状: 列为 `Status`, `Role`, `Main session`, `Elapsed`, 不显示提供方或模型 (Strata 与 Claude 同表无区分; 提供方名额只在内部计算). 本 issue 不加这两列, 因与目录确认无关.
- 方案 (用户 2026-10-28 决定不放宽回收; 独立 sonnet high 复核一致): `Workspace` 列 + `unload_agent` + 规则改写. 否决 A (等被回收再删: 空闲 Reviewer 只在满额时才回收, worktree 实际删不掉), C (记录移出工作区: 改恢复路径合同, 面大, 也不释放名额), D (缺失时重写记录: 需重建已删目录且实质放宽条件). 复核另提醒规则须同时覆盖清理 `.tmp`; 非所属 Main 的运行不删并告知用户.
- 体积估算 (净增): 代码约 30 行 (manager 约 12, host 路由约 5, machine 1, presentation 约 4, list 字段 1), spec 约 6 行, 规则约 3 行, 测试约 50 行; 合计约 90 行. 估算只作参考.
- 实际净增 (暂存范围 +140/-30, 含 26 行就绪记录, 测试, spec, 规则与本 issue 记录; 不计就绪记录约 +84): lib 代码约 10 行. 超出估算的部分是 Spec Readiness 要求补写的 spec 文字与测试. 偏离: 规则改动同步 `distribution/baseline/docs/agents/agent-writes.md`; 未改 reviewer-launch Skill 操作表 (其只列 Reviewer 启动与控制操作).
- 提交审核第 1 轮分流: 修复 unload_agent 中不可达的所属判断 (owned 已核对), 测试辅助 startIn 并入 harness.start, host 路由加注释, Workspace 单元格不转义反斜杠 (Windows 路径) 并补测试. 质疑并不修改 spec 的两点: 删除步骤在 spec 与 agent-writes 各写一遍, 以及 ADR 段增量叙述 -- 它们由 Spec Readiness 轮 1 到 4 的问题所要求, 改动会使就绪记录失效且重新触发同一问题. 既有问题 (后续 issue 建议): `stateDirectory` 不受 `cwd` 约束, 非 Reviewer 运行的恢复记录可能不在 `Workspace` 显示的目录内, 列表应能确认记录目录或 spawn 合同应约束 stateDirectory 位于 cwd 之下; Reviewer 运行的 stateDirectory 恒在启动仓库 `.tmp` 下, 不受影响.

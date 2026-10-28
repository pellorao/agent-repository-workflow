# 后台 Agent 列表去掉 Workspace 列, 并修复 Strata T4 的五处生命周期缺陷

Status: completed

## What to build

用户决定 (2026-10-29): 从 `arw lba` 与 `arw list background-agents` 的表格去掉 `Workspace` 列, 列表只有 `Status`, `Role`, `Main session`, `Elapsed`. 内部数据和 `list_agents` 的行仍保留完整 `cwd` (管理进程每行都有, 本 ticket 不改管理进程返回的行, 也不改 `lba` 的行校验以外的协议). `docs/agents/agent-writes.md` 的删除 worktree 前检查改用 `echo '{"id":"1","operation":"list_agents","input":{}}' | arw background-agent` 取得不带 `runId` 的全用户概览 `agents`, 找出 `cwd` 位于待删目录之内 (含子目录) 的加载中运行 (待删的是 `.tmp` 时, 恢复记录在其中而运行的 `cwd` 通常是所属 Git 仓库根目录, 所以还包括 `cwd` 等于该仓库根目录的运行; 不查找 `cwd` 位于该仓库根目录之上的运行, 它们遗漏卸载时按 spec 的同类成本处理), 其余步骤 (所属本 Main 的运行用 `unload_agent` 卸载, 再次确认, 其他 Main 或忙碌的不删除) 不变.

`lba` 的行核对 `assertBackgroundAgentRows` 不再要求 `cwd` (表格不再使用它); 其余字段核对不变.

同时修复 Strata T4 发现的五处生命周期缺陷, 每处的合同如下. 平台相关性: B1, B2, B4, B5 在管理进程一侧, 对 Codex 与 Claude Code 后端共用一份代码 (B2 的 `closed` 重试只存在于 Codex App Server 的共享进程, Claude 后端没有共享 App Server 因而不受影响; B4 经 `routeNativeSessions.close` 对两个后端都关闭); B3 在共享 Reviewer 运行层, 对两个平台的 Reviewer 一致.

- B1 (管理进程 `followup_task`): 已受理的任务在交付前失败 (例如恢复原线程失败) 时, 消息标记为 `failed` 的同时删除该消息的暂存运行设置 (`taskOptions` 条目), 使已退出且无其他占用的运行能被 `reapExited` 回收; 否则它永远不被回收.
- B2 (Codex App Server `close()`): 进程已被本次 `close()` 关闭但模型目录或进程身份清理失败后, 重试 `close()` 不再报告 `Shared App Server exited outside normal closure`: 记录 `closed` 标志, 重试时跳过进程关闭与退出检查, 只重做模型目录 `remove` 并清除先前记录的清理错误, 再重做进程身份 `remove`; 成功后才把共享状态置空并返回 `{environmentState:'exited'}`; 仍失败则继续抛出清理失败, 状态保持以便再重试. 进程非本次关闭而自行退出时, 仍报 `exited outside normal closure` 并保留进程身份 (行为不变).
- B3 (Reviewer 运行层 `interrupt_agent`): 先校验 `turnId` 是非空文本 (缺失时 `invalid-input`, 不触及原生会话), 再进入串行队列; 首次观察使用 `refresh(entry, false)`, 观察本身不继续任务 (不调用 `continueTask`); 回合与 `turnId` 不符时失败为 `turn-mismatch`; `interruptRequested` 仍只在原生中断发出之后设置 (不提前设置), 之后的第二次观察不变.
- B4 (宿主 `terminate`): 删除重复的 `sessions.close()`. 依据: `terminate` 在 `prepareMaintenance` 返回 `ready` 后才继续, 而 `ready` 之前必经 `closeSharedServer`, 它调用 `nativeSessions.close()`, 宿主传入的路由对象 (`routeNativeSessions`) 先关闭 Claude 会话再关闭 Codex.
- B5 (`model-catalog` 提供方校验): 删除 `stat` 之后冗余的 `realpath(installationDirectory)` (`stat` 已跟随符号链接, 目录不可用时同样失败).

不处理: 宿主 `interrupt` 分类措辞项 (无现实失败场景). 预估净增: 代码约 +10 (删除 B4, B5 与 `Workspace` 列约 -12), 测试约 +45, 文档与规格约 +6.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#machine-entry`
- `docs/specs/agent-repository-workflow/spec.md#capacity-and-recovery`
- `docs/specs/agent-repository-workflow/spec.md#background-agent-listing`

## Acceptance criteria

- [x] 表格四列: `renderBackgroundAgents` 的表头为 `Status`, `Role`, `Main session`, `Elapsed`, 分隔行 4 段, 行不含工作目录. 观察: `tests/background-agent/presentation.test.mjs` 断言表头与分隔行段数; 删除 Windows 路径的 `Workspace` 测试; `assertBackgroundAgentRows` 对缺 `cwd` 的行不报错, 对缺其他必需字段仍报错.
- [x] `list_agents` 概览行含完整 `cwd`. 观察: `tests/background-agent/host.test.mjs` 对不带 `runId` 的 `list_agents` 断言 `agents[0].cwd` 等于运行的仓库根目录.
- [x] 文档同步: `docs/agents/agent-writes.md` 的删除前检查使用上述 `list_agents` 命令并按 `cwd` 位于目录之内 (含子目录) 判断; `docs/specs/agent-repository-workflow/spec.md` 的 `list_agents` 行, 容量与恢复, 列表, 设计理由, ADR 评估和验证策略段落已去掉 `Workspace` 列并写明不带 `runId` 的 `list_agents` 返回含完整 `cwd` 的行. 观察: `docs/agents/agent-writes.md` 含 `.tmp` 时 `cwd` 等于所属仓库根目录也算引用的说明; `rg "Workspace" docs/agents docs/specs/agent-repository-workflow/spec.md` 只剩 Temporary Workspace 与验证策略中说明表格不含该列的一句.
- [x] B1: 观察: `tests/background-agent/manager.test.mjs` 新测试 (注入恢复失败的 `nativeHarness`) 断言失败的 `followup_task` 后消息为 `failed`, 且 `stateStore.releaseAgent` 以该 `runId` 被调用 (运行被回收); 移除 `taskOptions.delete` 后该测试变红.
- [x] B2: 观察: `tests/background-agent/codex-app-server.test.mjs` 中 "confirmed exit attempts both cleanups" 测试在清理失败 (进程身份与模型目录各一次) 后恢复 `remove`, 再次 `close()` 返回 `{environmentState:'exited'}`; 去掉 `closed` 分支后变红.
- [x] B3: 观察: `tests/reviewer-runtime/reviewer-runtime.test.mjs` 新测试断言缺 `turnId` 返回 `invalid-input`, 回合不符返回 `turn-mismatch`, 且 `interrupt_agent` 调用前后 `continueTask` 计数不变; 把首次观察改回 `refresh(entry)` 后变红.
- [x] B4, B5: 观察: 现有 host 与 model-catalog 测试全部通过 (无新测试); `grep -n "sessions.close" lib/arw-background-agent-host.mjs` 无结果, `model-catalog.mjs` 的提供方校验只调用 `stat`.
- [x] 新增测试回调均不超过 100 毫秒; `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `arw text check` 通过.

## Blocked by

- None - can start immediately

## Validation

- Spec Readiness: 5 轮 haiku high 后 `No problems.`, `arw spec-readiness verify --issue issue:0001:41` 退出 `0`. 前 4 轮的问题集中在删除 `.tmp` 前的发现范围 (`cwd` 等于所属仓库根目录; 更上层祖先 `cwd` 不查找, 遗漏时按 spec 既有的同类成本处理) 与设计理由措辞.
- `pnpm test` 773 个测试, 772 通过 / 0 失败 / 1 跳过; `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `arw text check`, `git diff --check` 通过. `arw terms check` 只有 spec 中一条既有的 `Artifact` 发现.
- 红绿核对: B1 去掉 `taskOptions.delete`, B2 去掉 `closed` 分支, B3 把首次观察改回 `refresh(entry)`, 对应新测试均变红, 恢复后通过. B4, B5 无新测试, 现有 host 与 model-catalog 测试通过.
- 为四列同步修改了 `tests/arw-entry.test.mjs` 的两处断言 (列表不再含 `/w/a`; 缺 `cwd` 不再算不兼容, 改为缺 `ownerId` 才算).
- 净增: 代码约 +1 (增 21 删 20), 测试约 +37 (增 61 删 24), 规格与文档 8 处行内改写. 平台: 全部在两个平台共用的代码中; B2 只涉及 Codex App Server.
- 上线: B1, B2 在管理进程一侧, 须 `node install.mjs` 后才在真实管理进程中生效.

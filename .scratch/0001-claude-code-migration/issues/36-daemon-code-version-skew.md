# 共享后台管理进程运行启动时所在 checkout 的旧代码, 与新 CLI 不兼容

Status: completed

## What to build

2026-10-28 发现: 共享后台管理进程 (`arw-background-agent-host.mjs --background-agent-daemon`) 由第一个需要它的 `arw` 调用启动, 运行的是该调用所在 checkout 的代码. 本机当前的管理进程 08:06 从 ticket 28 的 worktree (`.claude/worktrees/agent-aa384eae8d2b657e1`) 启动, 之后 ticket 31, 35 合入 main 并更新了安装, 它仍运行旧代码. 后果:

- 源码 checkout 的 `node arw.mjs lba` 崩溃: `Cannot read properties of undefined (reading 'split')`. 新的 `presentation.mjs` 读取 `row.cwd`, 旧管理进程返回的行没有这个字段. 已安装的 `arw lba` (0.4.0-pre) 正常.
- ticket 31 的 `unload_agent` 对这些运行不可用. ticket 29 的 worker 卸载 4 个空闲 Reviewer 时报 `Reviewer control requires its complete original Reviewer binding.`, 推测是旧管理进程没有 `unload_agent` 路由; 重启到新代码后需复核.
- 删除启动管理进程的 worktree 会让管理进程失去自己的代码来源; `Issue concurrency` 的删除前检查只看运行的 Workspace, 不看管理进程本身.

已选方案 (B', 2026-10-28, 独立分析后采纳; 不做代码指纹, 不改 `__list` 协议; 净增约 50 行):

- 管理进程入口选择: `<安装目录>/lib/arw-background-agent-host.mjs` 是文件就运行它, 否则退回调用方自己的入口 (未安装时源码入口仍可用). 管理进程的代码来源从此属于安装目录, 不随某个 worktree 删除而失效, 也不再需要在删除前检查中覆盖它. 顺带效果: 管理进程读安装目录 `config.json`.
- `lba` 在取得行后一次性核对必需字段, 不符时报明确错误 (管理进程代码与本命令不兼容, 改用已安装的 `arw lba`, 空闲后运行 `node install.mjs`), 不逐字段容错.
- 新增 host 测试: Reviewer 运行完成且 runtime 退役后, 同一所属 Main 的 `unload_agent` 成功; 临时删除路由须确认测试变红. 其他 Main 卸载仍报 `belongs to another Main session`, 不放宽.
- `docs/agents/source-checkout-validation.md` 补一行: 管理进程运行安装目录代码, 管理进程一侧改动须 `node install.mjs` 后才在真实管理进程中端到端生效.
- 上线过渡: 当前旧管理进程 (从 `agent-aa384eae8d2b657e1` worktree 启动) 须空闲时由 `node install.mjs` 的维护停止, 属停止共享管理进程, 须用户授权; 停止之前不得删除该 worktree.
- 不处理: Claude 后端 Reviewer 每回合按调用方 checkout 的 `programDirectory` 读取配置 (`claude-sessions.mjs`).
- 已确认 `unload_agent` 对 Reviewer 运行失败的原因是旧管理进程没有该路由 (该 worktree 的 host 文件无 `unload_agent`), 不是独立缺陷; 缺口只是没有 Reviewer 角色的测试.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#capacity-and-recovery`
- `docs/specs/agent-repository-workflow/spec.md#background-agent-listing`
- `docs/specs/agent-repository-workflow-installation/spec.md#background-agent-management`

## Acceptance criteria

- [x] 管理进程入口优先取安装目录的 host 文件, 否则退回调用方入口; 单测用临时目录覆盖两个分支, 不启动真实进程.
- [x] `lba` 遇到缺字段的行时报明确的不兼容错误而不崩溃; 有测试覆盖.
- [x] 新代码的管理进程上, Reviewer 运行退役后同一所属 Main 的 `unload_agent` 成功; 有测试覆盖, 且删除路由后该测试变红.
- [x] `docs/agents/source-checkout-validation.md` 与相关 spec 已按上文更新.
- [x] 全量测试, 投影与分发检查, `arw text check` 通过.

## Blocked by

- None - can start immediately

## Validation

- Spec Readiness: 三轮 haiku high 审核后 `satisfied`, `arw spec-readiness verify` 退出码 `0`.
- `pnpm test` 726 通过 / 0 失败 / 1 跳过; `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `arw text check` 通过. `arw terms check` 的 2 条 `Artifact` 发现在本 ticket 未改动的行 (既有).
- 删除 `unload_agent` 路由后新增 host 测试变红, 报错正是 `Reviewer control requires its complete original Reviewer binding.`, 恢复后通过.
- 净增: 代码约 22 行, 测试约 50 行, spec 与文档约 12 行.
- 上线: 旧管理进程需空闲时由 `node install.mjs` 维护停止 (须用户授权), 之前不得删除 `agent-aa384eae8d2b657e1` worktree.

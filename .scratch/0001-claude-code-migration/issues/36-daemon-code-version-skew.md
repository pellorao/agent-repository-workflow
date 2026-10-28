# 共享后台管理进程运行启动时所在 checkout 的旧代码, 与新 CLI 不兼容

Status: needs-triage

## What to build

2026-10-28 发现: 共享后台管理进程 (`arw-background-agent-host.mjs --background-agent-daemon`) 由第一个需要它的 `arw` 调用启动, 运行的是该调用所在 checkout 的代码. 本机当前的管理进程 08:06 从 ticket 28 的 worktree (`.claude/worktrees/agent-aa384eae8d2b657e1`) 启动, 之后 ticket 31, 35 合入 main 并更新了安装, 它仍运行旧代码. 后果:

- 源码 checkout 的 `node arw.mjs lba` 崩溃: `Cannot read properties of undefined (reading 'split')`. 新的 `presentation.mjs` 读取 `row.cwd`, 旧管理进程返回的行没有这个字段. 已安装的 `arw lba` (0.4.0-pre) 正常.
- ticket 31 的 `unload_agent` 对这些运行不可用. ticket 29 的 worker 卸载 4 个空闲 Reviewer 时报 `Reviewer control requires its complete original Reviewer binding.`, 推测是旧管理进程没有 `unload_agent` 路由; 重启到新代码后需复核.
- 删除启动管理进程的 worktree 会让管理进程失去自己的代码来源; `Issue concurrency` 的删除前检查只看运行的 Workspace, 不看管理进程本身.

要做的 (方案实施时复核决定):

- 让 CLI 与管理进程的代码版本不一致可被发现并处理. 例如: 管理进程报告版本或代码来源, CLI 不一致时提示或要求重启; 或管理进程固定从安装目录启动, 不从任意 checkout 启动.
- `lba` 遇到缺字段的旧行不崩溃, 或在版本检查处统一处理.
- 重启到新代码后, 复核 `unload_agent` 能否卸载由已退出的 worker 启动的 Reviewer 运行; 不能就一并修复.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#capacity-and-recovery`
- `docs/specs/agent-repository-workflow/spec.md#background-agent-listing`

## Acceptance criteria

- [ ] CLI 与管理进程代码不一致时有明确提示或处理, `lba` 不崩溃; 有测试覆盖.
- [ ] 管理进程的代码来源不随某个 worktree 被删除而失效, 或删除前的检查覆盖它.
- [ ] 新代码的管理进程上, `unload_agent` 能卸载由已退出 worker 启动的空闲 Reviewer 运行; 有测试覆盖.
- [ ] 全量测试, 投影与分发检查, `arw text check` 通过.

## Blocked by

- None - can start immediately

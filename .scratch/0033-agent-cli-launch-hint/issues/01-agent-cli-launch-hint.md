# Agent CLI 找不到时给出可读提示

Status: completed

## What to build

问题: Windows 上用 npm 安装的 `codex` 或 `claude` 只有 `.cmd` 包装, 而 ARW 按规范以 `shell: false` 直接启动可执行文件, 结果报 ENOENT 或 EINVAL; 现有报错 (`App Server PID is unavailable.`, `Claude process identity is unavailable.`, `Agent CLI command could not be started.`) 看不出原因.

改动 (只改提示, 不改启动方式): `lib/arw-common/agent-cli-launch.mjs` 导出 `spawnFailureHint(command)`, 返回英文提示 "If <command> could not be launched (ENOENT or EINVAL): make sure the <command> executable is on PATH; on Windows a .cmd file is an npm wrapper that cannot be launched, so install the official native build instead."; 三处使用它: `lib/arw.mjs` 的 `agent start` 在 `spawn-failed` 时追加到 `Agent CLI command could not be started.` 之后; `codex-app-server.mjs` 在子进程没有 PID 时追加到 `App Server PID is unavailable.`; `claude-sessions.mjs` 在子进程没有 PID 时追加到 `Claude process identity is unavailable.`.

体积预算 (非测试代码行): 净增约 +6; 上限 +12.

预期验证: 更新 `tests/arw-common/agent-cli.test.mjs` 的 `spawn-failed` 期望文案; Claude 与 Codex 各一个用不存在的可执行文件名启动 (真实 spawn 立即 ENOENT, 不创建进程) 的测试, 断言错误消息含提示.

## Acceptance criteria

- [x] 三处启动失败的错误消息都含 `spawnFailureHint` 的提示, 启动方式不变.
- [x] 测试覆盖三处.

## Blocked by

- None - can start immediately

## Validation

- 验收条件 1: `git diff` 显示 `lib/arw-common/agent-cli-launch.mjs` 新增 `spawnFailureHint`, `lib/arw.mjs`, `codex-app-server.mjs`, `claude-sessions.mjs` 各在原消息后追加提示, 启动参数与 `shell: false` 未变. 非测试代码净增约 +5 行, 在上限 +12 内.
- 验收条件 2: `tests/arw-common/agent-cli.test.mjs` (更新两处期望), `tests/background-agent/claude-sessions.test.mjs` 与 `codex-app-server.test.mjs` 各新增一个用不存在的可执行文件名启动的测试, 均通过; 不创建进程.
- 全量: `pnpm test` 833 通过, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check`, `arw terms check --include .scratch/0033-agent-cli-launch-hint/` 通过.
- 耗时 (三个测试文件一起运行 3 次, 中位数): 新增 "a Claude turn whose executable cannot be launched reports how to fix it" 22.8 ms, "a Codex executable that cannot be launched reports how to fix it" 31.3 ms; 修改期望文案的回调 "agent start maps process failures without starting a shell" 11.1 ms, 均低于 100 ms.
- `git diff --cached --check` 无输出; 本次 7 个 JavaScript 文件 `node --check` 均通过.

## Comments

- 就绪记录为 `not-applicable` 例外 (用户 2026-11-02 确认), 本 issue 起先生成例外记录再改实现.

# `lib/background-agent` 小清理: 删除内部重复校验与重复判断

Status: completed

## What to build

用户批准的待办 (2026-10-29): 一次 haiku 扫描给出 4 项小清理, Main 与实施者对实施前的代码逐项核对后保留其中 3 项 (`recovery-record.mjs` 保存路径的 `requireRecord` 经核对不是重复, 见 "不做"). 不改变任何外部可见行为, 公开 Interface 和持久状态格式; 按 `AGENTS.md` 的 `Efficiency First` 第 3 条, 外部数据只在进入程序的边界校验一次, 内部各层不重复判断程序自己产生的数据.

- `manager-process.mjs`: `listLinuxProcesses` 与 `listDarwinProcesses` 各有一份相同的 `getuid` 守卫 (`process.getuid?.()` 加 `undefined` 则抛错). 两个函数只在 Linux 与 macOS 被选中, 这两个平台上 `getuid` 一定存在; 即使缺失, `observeBackgroundAgentManagerProcess` 的外层 `catch` 也把任何抛出映射为 `'unknown'`, 抛出的消息无人读取; 既有用例 `tests/background-agent/manager-process.test.mjs:23` 已覆盖 "`listProcesses` 抛错则结果为 `'unknown'`" 这一映射. 两处守卫删除, 改为各一行 `const uid = /** @type {() => number} */ (process.getuid)();`: 缺失时抛 `TypeError`, 仍走同一 `catch`, 结果仍是 `'unknown'`, 且不会在 `uid` 为 `undefined` 时把所有进程误判为他人进程而得出 `'absent'`.
- `client.mjs` 的 `sendBackgroundAgentRequest` (导出; `grep -rn sendBackgroundAgentRequest lib tests scripts *.mjs` 显示调用方只有 `client.mjs` 内 4 处和 `tests/background-agent/client.test.mjs`, `daemon.test.mjs` (`lib/arw-background-agent-host.mjs` 只经 `createBackgroundAgentClient` 间接使用), 后两者传入的凭据都是 64 位十六进制, 且都不测试无效凭据或预算的拒绝): 删除对 `message.credential` 格式与 `timeoutMs`, `waitBudgetMs` 的再校验. 入口追溯: 凭据只来自 `credential(runtimeDirectory)` (读文件时已按 `^[a-f0-9]{64}$` 校验); `timeoutMs` 来自 `remaining(deadline)` (`messageTimeoutMs` 已在 `createBackgroundAgentClient` 入口校验为正安全整数), 探测请求的 `Math.min(200, remaining)` 与维护请求的 `30_000`; `waitBudgetMs` 来自 `deliver` 开头对 `input.timeout_ms` 的校验 (那是外部输入的入口, 保留). 因此这三处都不再从外部直接进入.
- `client.mjs` 中 11 处 `error instanceof Error && 'code' in error && error.code === ...` 判断 (`deliver`, 探测循环, `list`, 维护流程) 改用一个模块内的小函数 `errorCode(error)` (返回 `error.code` 或 `undefined`), 11 处全部替换. 单项会因新增函数而多 1 至 2 行, 但每处判断变短, 整批净行数仍为负. `sandboxed` 是供 `'syscall' in error` 收窄类型的守卫, 保留.

不做:

- `recovery-record.mjs` 中 `readBackgroundAgentRecoveryRecord` 的 `lstat`: 它提供之后与 `handle.stat()` 比较的 `dev` 和 `ino`, 不是重复.
- 其他文件中同样的 `'code' in error` 判断 (如 `state-store.mjs` 的 `isMissing`, `process-identity.mjs`): 不在本批范围.
- `recovery-record.mjs` 保存路径的 `requireRecord(record)`: 扫描认为 record 由内部构造而可删, 但 `manager.mjs` 的 `spawn_agent` 把机器入口的 `input.settings` 只做类型断言就放进 record, 该检查是 `settings` 各字段 (`reasoningEffort`, `serviceTier`, `config`) 进入持久恢复记录前唯一的形状校验, 不是重复. 保留; 收益仅 1 行, 不值得改变失败时机.
- 不新增测试: 删除的是内部重复校验, 无对应现实失败场景; 既有的模拟测试保持不变.

预估净增 (代码 / 测试 / 文档): 代码约 -3, 测试 0, 总约 -3 行 (实际可能为 -1 至 -5).

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#background-agent-control`
- `docs/specs/agent-repository-workflow/spec.md#capacity-and-recovery`
- `docs/specs/agent-repository-workflow-development/spec.md#validation-strategy`

## Acceptance criteria

- [x] `manager-process.mjs` 没有 `getuid` 守卫, `uid` 缺失时抛出的错误由 `observeBackgroundAgentManagerProcess` 的外层 `catch` 映射为 `'unknown'`, 不会得出 `'absent'`. 观察: `grep -n "getuid\|Current process user" lib/background-agent/manager-process.mjs` 只有两行无守卫的取值; `pnpm typecheck` 通过; `tests/background-agent/manager-process.test.mjs` 通过, 其中第 23 行用例覆盖该映射.
- [x] `sendBackgroundAgentRequest` 不再重复校验凭据与预算, 入口校验保留. 观察: `grep -n "credential is invalid\|request budget is invalid\|wait budget is invalid" lib/background-agent/client.mjs` 只剩 `credential()`, `createBackgroundAgentClient` 与 `deliver` 内的各一处; `tests/background-agent/client.test.mjs` 与 `daemon.test.mjs` 通过.
- [x] `client.mjs` 的重复错误码判断收敛到一个函数. 观察: `grep -nE "'code' ?in ?error" lib/background-agent/client.mjs` 只剩 `sandboxed` 与 `errorCode` 两行, 且 `grep -n "error.code" lib/background-agent/client.mjs` 只剩这两个函数内的引用; 既有测试通过.
- [x] `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check`, `git diff --check` 通过.
- [x] 净增为负. 观察: `git diff --numstat -- lib tests docs` 汇总.

## Blocked by

- None - can start immediately

## Validation

- Spec Readiness: 4 轮 haiku high, 第 4 轮 `No problems.`, `arw spec-readiness verify --issue issue:0001:48` 退出 `0` (另一处 Reviewer Role 改动提交后再次验证仍为 `0`). 第 1 轮 5 个问题: errorCode 的条件措辞与验收冲突, 验收 grep 漏掉无空格写法, uid 缺失分支无观察方式, 两个导出函数调用方的排他性证据不足 (均采纳). 第 2 轮 2 个问题中, 保存路径 `requireRecord` 一条核实有效 (`settings` 来自机器入口且只做类型断言, 是唯一形状校验), 因此该项移出范围并写入 "不做"; 另一条补 `arw-background-agent-host.mjs` 为 Input. 第 3 轮 1 个措辞问题已修正.
- `pnpm test` 793 项, 792 通过 (1 项既有跳过), `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check`, `git diff --check` 通过. 未新增测试.
- 观察: `manager-process.mjs` 只剩两行无守卫的 `getuid` 取值; `client.mjs` 的 `credential is invalid` 只在 `credential()`, `request budget is invalid` 只在 `createBackgroundAgentClient`, `wait budget is invalid` 只在 `deliver`; `'code' in error` 只剩 `errorCode` 与 `sandboxed`.
- 净增 (`git diff --numstat -- lib tests docs`): 代码 +16/-19, 净 -3 (估算 -3).

## Comments

- 提交审核第 1 轮: requirements 首次启动时与 code-standards 并行, 因 `client.mjs` 的 `launch()` 探测文件名只含 `process.pid`, 同一进程两个并发请求竞争而报 `ENOENT` (管理进程未运行时才会触发), 单独重跑后 `No problems.`. code-standards 2 个问题: `errorCode` 与 `sandboxed` 的注释错位 (采纳, 已把 `errorCode` 移到注释之上); 把 `errorCode` 提取到 `lib/common/` 并替换全仓库内联判断 (不采纳: 全仓库约 25 处内联判断是既有状况, 公共化是跨模块重构, 超出本 issue 的纯清理范围, 且 `lib/common/filesystem.mjs` 与 `state-store.mjs` 已各有局部 `isMissing`; 记入待办候选).

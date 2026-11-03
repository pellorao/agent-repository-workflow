# 再减少 Windows 后台管理进程启动时的 PowerShell 调用

Status: completed

## What to build

0062 之后 Windows 11 `release-vm.mjs check` 通过, 但嵌套重跑中管理进程冷启动约 4 秒, 离普通请求总等待预算 `backgroundAgent.messageTimeoutMs` (默认 5000) 只剩约 1 秒, 慢机器或杀毒扫描时可能偶发 `Background Agent control timed out before delivery.`. 每次 PowerShell 进程约 0.6 秒, 本 issue 在同一个管理进程启动路径上再省 1 到 2 次, 不改规范, 配置, 公开 Interface 或预算语义.

1. 管理进程启动时, `lib/background-agent/state-store.mjs` 的初始化和 `lib/background-agent/daemon.mjs` 的 `privateCredential` 各对同一个运行时目录调用一次 `securePrivateStatePath(runtimeDirectory,'directory')`. 合并为一个管理进程启动只加固该目录一次. 凭据仍只写入已确认私有的目录, 不出现凭据存在于未加固目录中的时段; 单独使用 `createBackgroundAgentDaemon` 时目录仍会被加固.
2. `state-store.mjs` 初始化时对已存在的各个数据库文件逐个调用 `verifyPrivateStatePath`. 改为用一个 PowerShell 进程校验全部已存在的文件 (`verifyPrivateStatePath` 已支持多个路径). 缺失的文件照旧跳过, 任一已存在文件不合规时照旧失败.
3. `state-store.mjs` 初始化在校验已存在文件之后, 仍对数据库文件调用 `securePrivateStatePath`. 改为只在本次初始化新建数据库文件时加固; 已存在的数据库文件已在第 2 项中校验, 不再运行第二个进程.

非 Windows 平台行为不变. 命令输出, 错误文字和持久状态不变. 不改 `private-state.mjs` 的 PowerShell 脚本语义.

预期验证: 用 mock (假 `powershell.exe` 或注入的执行函数) 观察 PowerShell 进程次数, 不新增真实进程测试, 测试回调低于 100 毫秒. 之后由一次完整 Windows 11 `release-vm.mjs check` 记录冷启动耗时 (该 check 在提交后另行运行, 不是本 issue 的验收).

体积预算: 非测试代码净增约 0 行 (约持平).

## Acceptance criteria

- [x] Windows 上管理进程启动 (状态库初始化加凭据准备) 对运行时目录只运行一次加固; 由测试用 mock 观察.
- [x] 状态库初始化时多个已存在数据库文件的校验只启动一个 PowerShell 进程, 任一文件不合规时初始化失败, 缺失的文件不参与校验; 由测试用 mock 观察.
- [x] 凭据和数据库已存在时重启, 状态库初始化不再对数据库文件运行第二个 PowerShell 进程; 新建数据库文件时仍加固; 由测试用 mock 观察.
- [x] 凭据写入前运行时目录已加固, 包括单独使用 `createBackgroundAgentDaemon` 的情形; 由测试或代码路径确认, 记入 `## Validation`.
- [x] 改动前后同一启动场景 (首次冷启动, 凭据和数据库已存在时重启) 的 PowerShell 进程次数记入 `## Validation`.
- [x] `node --test tests/background-agent/*.test.mjs` 与 `pnpm typecheck` 通过.

## Blocked by

- None - can start immediately

## Validation

- `node --test --test-reporter=spec tests/background-agent/daemon.test.mjs tests/background-agent/state-store.test.mjs`: 新增三个测试通过, 回调约 5 到 17 毫秒, 低于 100 毫秒. 假 `powershell.exe` (`tests/helpers/process.mjs` 的 `installAclLog`) 记录每次调用的条目, 加固标志和调用时凭据是否已存在.
- 验收项 1: `tests/background-agent/daemon.test.mjs:477` `Windows manager start secures the runtime directory once, before the credential exists`: 状态库 `loadAgents()` 之后用与管理进程入口相同的参数 (`runtimeDirectorySecured: true`) 调用 `createBackgroundAgentDaemon`, 同一条调用日志中目录加固恰好一次 (凭据尚不存在), 之后是数据库文件加固和凭据文件加固. 入口 `lib/arw-background-agent-host.mjs` 的那一行只能由真实进程触发, 由代码审查覆盖.
- 验收项 2 与 3: `tests/background-agent/state-store.test.mjs:343` `Windows state store verifies existing database files in one process and secures only a new database file`: 数据库, `-shm`, `-journal` 已存在时调用只有加固目录和一次校验 (条目含这三个文件, 缺失的 `-wal` 不参与), 没有对数据库文件的加固; 校验失败时初始化以 `could not be verified` 失败; 删除全部数据库文件后新建时, 调用为加固目录和加固新数据库文件, 不再校验. `securePrivateStatePath(paths.database,'file')` 移到 `open(...,'wx')` 成功之后, `EEXIST` 分支 (文件已存在且已校验) 不再加固.
- 单独使用 `createBackgroundAgentDaemon`: `tests/background-agent/daemon.test.mjs:466` `Windows standalone daemon secures the runtime directory before the credential exists`: 不传 `runtimeDirectorySecured` 时先加固目录 (凭据尚不存在) 再加固凭据文件.
- 验收项 4 (凭据写入前目录已加固): 代码路径. 管理进程入口 `lib/arw-background-agent-host.mjs` 先 `await createBackgroundAgentHost`, 其中 `createBackgroundAgentManager` 等待 `stateStore.loadAgents()`, 即 `state-store.mjs` 的 `initialize` 已加固运行时目录; 之后才调用 `createBackgroundAgentDaemon`, 在 `privateCredential` 写凭据. 目录在凭据写入前已加固, 不存在凭据位于未加固目录的时段. 不传 `runtimeDirectorySecured` (默认 `false`) 时 `privateCredential` 仍先加固目录再写凭据, 由 `daemon.test.mjs:466` 观察.
- 验收项 5 (次数): 状态库初始化加凭据准备 (`state-store.mjs` 的 `initialize` 加 `daemon.mjs` 的 `privateCredential`) 的 PowerShell 进程次数, 按代码路径推算 (每次 `securePrivateStatePath` 或 `verifyPrivateStatePath` 调用启动一个进程, 非 Windows 不启动):
  - 首次冷启动 (凭据, 数据库都不存在): 改动前 4 次 (状态库加固目录, 加固数据库文件, 凭据准备加固目录, 加固凭据文件), 改动后 3 次.
  - 凭据和数据库已存在时重启 (正常情况只有 `messages.sqlite`, 没有 `-wal`, `-shm`, `-journal`): 改动前 5 次 (加固目录, 校验数据库文件, 加固数据库文件, 加固目录, 校验凭据文件), 改动后 3 次 (加固目录, 校验数据库文件, 校验凭据文件). 另有已存在的 `-wal`, `-shm`, `-journal` (上次异常退出后) 时, 校验次数由已存在文件个数降为 1.
  - 启动路径上的其他调用 (模型目录与进程标识的校验等) 不变.
- 验收项 6: `node --test tests/background-agent/*.test.mjs`: 201 个测试通过; `pnpm typecheck` 通过.
- 其他: `pnpm test`: 879 个测试通过; `node arw.mjs text check` 通过; `node arw.mjs terms check --include .scratch/0063-windows-manager-startup-margin/` 通过; `git diff --check` 无输出.
- `git diff --numstat HEAD -- lib`: `arw-background-agent-host.mjs` 1/1, `daemon.mjs` 6/6, `state-store.mjs` 5/3, 非测试代码净增 +2 行 (预算约 0).

## Comments

- 合并方式: 不在 `private-state.mjs` 里记忆已加固的目录 (目录被删除重建后会跳过加固), 改为 `createBackgroundAgentDaemon` 增加内部可选输入 `runtimeDirectorySecured` (默认 `false`), 只有管理进程入口在状态库初始化完成后传 `true`. 不改命令行, 规范, 配置和预算语义.
- 改动前后的次数是按代码路径推算, 没有在 Windows 宿主上实测.
- 第 3 项已采纳 (原为实施中提出的建议): 重启时已存在的数据库文件已在多文件校验中校验过, 只有本次新建数据库文件时才加固, 重启省 1 次.
- 提交前精简自查 (Main, `/simplify` 四个角度): 未改代码. 未采纳: `verifyPrivateStatePath(...existing[0],...existing.slice(1))` 的调用形状由现有签名 `(path,kind,...others)` 决定, 改签名会波及 diff 外的调用方; 在 `private-state.mjs` 用模块级集合记住已加固目录可省去 `runtimeDirectorySecured`, 但目录被删除重建后会跳过加固而把凭据写进未加固目录, 不采用.
- 体积: 非测试代码净增 +2 行, 超出约 0 行的预算; 来自 `state-store.mjs` 为一次校验已存在数据库文件而收集路径 (含类型注解) 并守卫空集合, 这是现有 `verifyPrivateStatePath(path,kind,...others)` 签名下批量校验的必要部分, 未找到可删减的代码.
- 提交审核第 1 轮: 要求符合审核指出组合启动路径没有测试观察, 已在 `tests/background-agent/daemon.test.mjs` 增加测试, 在状态库 `loadAgents()` 之后用与入口相同的参数调用 `createBackgroundAgentDaemon`, 断言目录只加固一次且在凭据写入之前; 入口 `lib/arw-background-agent-host.mjs` 的 `process.argv` 分支只能由真实进程触发, 该行由代码审查和提交后的 Windows 11 check 覆盖. Code Standards 指出测试放错文件, 已把守护进程测试移入 `daemon.test.mjs` (复用 `startCredentialDaemon`), 状态库测试移入 `state-store.test.mjs`, 共用的 `installAclLog` 放入 `tests/helpers/process.mjs`; 体积超出补记于上一条.
- 提交审核第 2 轮: Code Standards 无问题; 要求符合审核指出 `## Validation` 的测试位置, 名称和计数仍是移动前的, 已按受审树更正 (只改记录).

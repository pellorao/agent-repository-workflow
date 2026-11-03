# 减少 Windows 后台管理进程启动时的 PowerShell 调用

Status: completed

## What to build

Windows 上 `arw background-agent` 冷启动管理进程常报 `Background Agent control timed out before delivery.`: 管理进程启动前要串行运行约 9 次 PowerShell ACL 进程 (每次约 0.6 秒), 客户端在冷启动路径上再运行约 5 次, 合计约 9 秒, 超过普通请求的总等待预算 `backgroundAgent.messageTimeoutMs` (默认 5000). 排查与方案分析见 projects 总层任务 `ARW/bgtimeout` 的报告. 规范要求管理进程启动计入该预算 (`docs/specs/agent-repository-workflow/spec.md:264`), 本 issue 不改规范和配置, 只减少调用次数, 使冷启动落在预算内.

1. `lib/background-agent/private-state.mjs`: `securePrivateStatePath` 在一个 PowerShell 进程内完成: 先按现有校验条件检查, 已合规就不再写 ACL, 不合规才按现有配置脚本写入, 最后按校验条件断言. 一个已加固的路径因此不再调用 `Set-Acl`; 这同时消除非管理员 Windows 账号上重复加固已加固路径需要 `SeSecurityPrivilege` 而失败的问题 (总层任务 `ARW/winacl`). 合规判断不新增 owner 检查. `verifyPrivateStatePath` 可以一次校验多个路径, 只运行一个 PowerShell 进程. 非 Windows 平台行为不变.
2. `lib/background-agent/client.mjs`: `credential()` 先用 `lstat` 确认目录和凭据文件存在 (缺失时直接以 `ENOENT` 失败, 不运行 PowerShell), 再用一次 PowerShell 同时校验两者. `launch()` 的启动轮询改为探测控制端口能否连接 (连上即关闭, 不发送凭据; `ECONNREFUSED` 时重试), 端口可连接后才读取凭据; 管理进程在凭据加固后才监听, 所以轮询期间不会校验尚未加固的探针目录或凭据文件 (现有轮询先校验目录, 会遇到管理进程尚未加固的状态而直接失败). 去掉 30 次轮询上限及其 `Background Agent manager did not start.` 错误, 轮询只受同一个 `messageTimeoutMs` 期限约束, 超时仍报 `Background Agent control timed out before delivery.`. 连接被拒后重启管理进程的路径沿用已读到的凭据, 不重复读取.
3. `lib/background-agent/daemon.mjs`: 新写入并加固的凭据不再重复校验; 只有凭据已存在 (`filesystem-create-collision`) 时才校验.

不改规范, 安装配置或公开 Interface; 命令输出, 错误文字 (除去上述不再出现的 `did not start`) 和持久状态不变.

预期验证: 用 mock (假 `powershell.exe` 或注入的执行函数), 不新增真实进程测试, 测试回调低于 100 毫秒. 在本机宿主 (非管理员 Windows 账号) 从 WSL 对临时目录运行新的加固与校验脚本, 确认首次加固与重复加固都成功; 之后由一次完整 Windows 11 `release-vm.mjs check` 确认冷启动成功并记录冷启动耗时 (该 check 在提交后另行运行, 不是本 issue 的验收).

体积预算: 非测试代码净增约 +15 行.

## Acceptance criteria

- [x] Windows 上对已合规路径调用 `securePrivateStatePath` 只启动一个 PowerShell 进程且不写 ACL, 对不合规路径写入后断言合规; 由 `tests/background-agent/private-state.test.mjs` 用 mock 观察进程次数.
- [x] `verifyPrivateStatePath` 一次校验多个路径时只启动一个 PowerShell 进程, 任一路径不合规时失败; 由同一测试文件观察.
- [x] 客户端冷启动时, 凭据文件已出现但控制端口尚未监听期间不校验或读取凭据, 端口可连接后读取凭据并送达请求; 端口一直不可连接时在 `messageTimeoutMs` 期限内报 `Background Agent control timed out before delivery.`; 由 `tests/background-agent/client.test.mjs` 观察.
- [x] 凭据或目录缺失时 `credential()` 以 `ENOENT` 失败且不运行 PowerShell; 由 `tests/background-agent/client.test.mjs` 观察.
- [x] 本机宿主 (非管理员 Windows 账号) 对临时目录的首次加固, 重复加固和校验都成功, 结果记入 `## Validation`.
- [x] `node --test tests/background-agent/*.test.mjs` 与 `pnpm typecheck` 通过.

## Blocked by

- None - can start immediately

## Validation

- `node --test --test-reporter=spec tests/background-agent/client.test.mjs tests/background-agent/private-state.test.mjs`: 14 个测试通过, 新增三个测试 (私有状态一次加固与校验只启动一个 PowerShell 进程, 凭据已发布但未加固且端口未监听时请求不读取凭据, 端口可连接并加固后才读取并送达, 凭据缺失以 `ENOENT` 失败且不启动 PowerShell) 各回调 3 到 46 毫秒, 都低于 100 毫秒; 在提交审核第 1 轮受审版本 (先读凭据) 上, 端口就绪测试失败, 其余两个新测试在原始代码上失败.
- `node --test tests/background-agent/*.test.mjs`: 198 个测试通过, 约 0.8 秒; `pnpm test`: 876 个测试通过, 约 2.8 秒; `pnpm typecheck` 通过; `node arw.mjs text check` 通过.
- 本机宿主 (非管理员 Windows 账号, PowerShell 5.1, Windows 版 node) 在 `%TEMP%` 下的临时目录运行新的 `private-state.mjs` (第 1 轮修改后的 `aclScript`): 旧代码对已加固目录第二次 `securePrivateStatePath` 失败 (复现 `ARW/winacl`); 新代码的目录首次加固, 目录重复加固, 文件首次加固, 文件重复加固, 目录与文件一次校验都成功, 每次调用约 0.2 秒, `icacls` 显示目录只有当前用户完全控制; 未加固的目录与文件校验和类型不符都按预期失败. 首次加固在该账号上没有因 `SeSecurityPrivilege` 失败, 所以没有改为只写 DACL.
- `git diff --numstat HEAD -- lib`: `client.mjs` 18/14, `daemon.mjs` 3/4, `private-state.mjs` 50/52, 非测试代码净增 +1 行 (预算约 +15).
- 验收项对应: 一个进程与校验失败见 `tests/background-agent/private-state.test.mjs` 新增测试; 端口就绪与超时见 `tests/background-agent/client.test.mjs` 的端口就绪测试和并发冷启动测试; `ENOENT` 见同文件的缺失凭据测试; 宿主结果见上.

## Comments

- 旧补丁 `lstat` 竞态修复未采用: 启动轮询改为探测控制端口能否连接, 因为管理进程在凭据加固后才监听 (见 `ARW/bgtimeout` 分析).
- 只用于启动轮询的管理进程操作 `__ping` 随之没有调用方, 已从 `daemon.mjs` 删除.
- 并发冷启动测试原先没有指定端口, 会连到本机真实管理进程的默认端口; 轮询改为探测端口后这会让测试误判端口可连接, 所以测试改用一个已释放的端口. 同时把该测试接受的错误收紧为 `timed out before delivery`.
- 30 次轮询上限的去除没有单独测试 (需要超过 0.6 秒的真实等待, 超过单个测试回调 100 毫秒阈值); 由代码审查确认循环只受 `messageTimeoutMs` 期限约束.
- 未合并 `state-store.mjs` 与 `daemon.mjs` 对目录的两次加固, 也未合并 `state-store.mjs` 已存在文件的校验; 按分析是可选项, 留待 VM `release-vm.mjs check` 实测冷启动余量不足时再做.
- 提交前精简自查 (Main, `/simplify` 三个角度): 去掉 `checkPrivateState` 中只为循环后判断而存在的数组, 内联只用一次的端口探测闭包. 未采纳: `Set-Private` 中写 ACL 前的类型检查保留 (先检查再写入); `list` 的预校验, `state-store.mjs` 多文件校验合并和守护进程内对目录的重复加固涉及行为或超出本 issue 列出的范围, 留待 VM 实测后再定.
- 提交审核第 1 轮: 要求符合审核指出 `process-identity.mjs` 中合并两次校验超出 issue 范围, 且会让目录 ACL 未核对时得到 `absent`, 已撤回. Code Standards 指出 `aclScript` 重复类型检查, 已改为每个条目检查一次. 要求符合审核指出 `deliver` 在端口探测之前读取凭据, 另一个客户端正在冷启动时管理进程已发布凭据但尚未加固, 此时到达的请求会因继承 ACL 校验失败而报错, 已改为有启动入口且允许启动时先探测控制端口 (`ECONNREFUSED` 才启动并轮询), 端口可连接后才读取凭据, 原来的 `ENOENT` 后启动分支随之删除; 端口探测与启动轮询共用一个局部函数. 因此客户端测试需要给启动相关测试指定一个已释放的端口, 否则会连到本机真实管理进程.

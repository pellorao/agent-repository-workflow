# Windows 上读取进程创建时间不因 PowerShell 进度输出而失败

Status: completed

## What to build

问题: `lib/background-agent/process-identity.mjs` 的 `readOperatingSystemProcessCreationTime` 在 Windows 上调用 `powershell.exe` 时 `maxBuffer` 只有 256 字节, 且没有关闭进度输出; PowerShell 向 stderr 写 CLIXML 进度记录, 每次都报 `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`, App Server 和 Claude 回合进程的身份读不到, 后台 Agent 和 Reviewer 失败. 与 0034 同一模式.

改动 (最小): 脚本前加 `$ProgressPreference='SilentlyContinue';`, `maxBuffer` 提到 `1024*1024`. 真机验证时发现脚本中的 `[DateTime]$p.CreationDate.ToUniversalTime().Ticks.ToString()` 把字符串强转为 `DateTime` 而失败 (之前被缓冲错误掩盖), 去掉多余的 `[DateTime]` 强转 (`CreationDate` 已是 `DateTime`).

体积预算 (非测试代码行): 净增 0 行; 上限 +2.

预期验证: 新测试在 PATH 放假 `powershell.exe` (向 stderr 写 4 KiB, 且仅当解码后的脚本以 `$ProgressPreference='SilentlyContinue';` 开头时输出结果), 临时把 `process.platform` 设为 `win32`; 另在 Windows 宿主用 node.exe 真机调用一次.

## Acceptance criteria

- [x] 脚本前缀 `$ProgressPreference='SilentlyContinue';`, `maxBuffer` 为 1 MiB.
- [x] Windows 上对当前 pid 返回数字串, 对不存在的 pid 返回 `null`.
- [x] 新测试覆盖进度输出被关闭且 stderr 噪声不致失败.

## Blocked by

- None - can start immediately

## Validation

- 验收条件 1, 3: `tests/background-agent/process-identity.test.mjs` 新测试 "Windows creation time read silences PowerShell progress output and tolerates stderr noise" 通过; 分别改回 `maxBuffer:256` 或去掉前缀时该测试失败.
- 验收条件 2 (真机, Windows 宿主 `node.exe`, 临时目录 `AppData/Local/Temp/arw-pidwin`, 已删除): 修复前 `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`; 仅加前缀与缓冲后 PowerShell 以退出码 1 失败 (`[DateTime]` 强转); 完整修复后当前 pid 两次读取均为 `639292319894662820` 且相等, pid 99999999 返回 `null`.
- 测试耗时: `node --test --test-reporter=spec tests/background-agent/process-identity.test.mjs` 中新测试回调 6.5 ms, 低于 100 ms 阈值 (单次测量, 远低于阈值).
- 全量: 见交付说明 (`pnpm typecheck`, `pnpm test`, `check-workflow-distribution`, `project-claude-skills --check`, `arw text check`, `git diff --check`).

## Comments

- 就绪记录为 `not-applicable` 例外 (用户 2026-11-02 确认), 先于实现生成.
- 提交审核第 1 轮: macOS `maxBuffer` 改动超出范围, 已恢复为 256; 本 issue 只改 Windows 分支.

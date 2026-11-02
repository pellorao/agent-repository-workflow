# Windows 私有状态 ACL 调用不因 PowerShell 进度输出而失败

Status: completed

## What to build

问题: `lib/background-agent/private-state.mjs` 的 `runAcl` 调用 `powershell.exe` 时 `maxBuffer` 只有 1024 字节; PowerShell 的 `-EncodedCommand` 会向 stderr 写 CLIXML 进度输出, 超出缓冲后 Node 报 `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`, Windows 卸载等操作因 "private state access could not be verified" 失败, stderr 还是 GBK 乱码.

改动 (最小): 两段 ACL 脚本 (`configureAcl`, `verifyAcl`) 在 `runAcl` 编码前加前缀 `$ProgressPreference='SilentlyContinue';` 抑制进度输出, 并把 `maxBuffer` 提到 `1024 * 1024`.

体积预算 (非测试代码行): 净增 0 行 (同一行内修改); 上限 +2.

预期验证: 新测试在 PATH 放假 `powershell.exe` (向 stderr 写 4 KiB 后以 0 退出), 临时把 `process.platform` 设为 `win32`, 断言 `securePrivateStatePath` 和 `verifyPrivateStatePath` 成功; 不运行真实 PowerShell.

## Acceptance criteria

- [x] ACL 脚本前缀 `$ProgressPreference='SilentlyContinue';`, `maxBuffer` 为 1 MiB.
- [x] 新测试覆盖 PowerShell 向 stderr 写出超过 1 KiB 时仍成功.

## Blocked by

- None - can start immediately

## Validation

- 验收条件 1: `git diff` 显示 `runAcl` 编码前缀 `$ProgressPreference='SilentlyContinue';` 且 `maxBuffer:1024*1024`, 非测试代码净增 0 行.
- 验收条件 2: `tests/background-agent/private-state.test.mjs` 新测试 "Windows ACL calls survive PowerShell writing progress output to stderr" 通过 (约 10 ms); 临时改回 `maxBuffer:1024` 时该测试失败.
- 测试脚手架: 新测试用共享的 `installFakeCommand(t, directory, name, script)` (`tests/helpers/process.mjs`) 放置假 `powershell.exe` 并还原 PATH, 仅 `process.platform` 覆盖保留在测试内; 三个测试通过.
- 全量: `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check`, `arw terms check --include .scratch/0034-private-state-acl-buffer/` 通过.

## Comments

- 就绪记录为 `not-applicable` 例外 (用户 2026-11-02 确认), 先于实现生成.
- 第 1 轮提交审核: 删除未使用的 `mkdir` 导入和恒真的 `platform` 守卫; 该文件 3 个测试通过, `pnpm typecheck` 通过.

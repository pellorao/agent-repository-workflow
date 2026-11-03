# guest 检查在 PowerShell 新会话里解析 arw

Status: completed

## What to build

发布 spec 要求 Windows 新终端解析 `arw`, 但 `scripts/release-guest-check.mjs` 只用 `cmd.exe` 的 `where arw` 解析, 对 PowerShell 只确认能找到 `powershell.exe`. PowerShell 用户 (Windows 默认终端) 经 `Get-Command` 解析 `arw` 的路径没有被验证.

在 `fresh()` 之后新增一步 (仅 Windows): 启动新的 `powershell.exe -NoProfile -NonInteractive`, 环境与 `fresh()` 相同 (Machine + User 注册表 Path 展开后, 运行 guest 检查的 node 所在目录排最前, 并设置 `NoDefaultCurrentDirectoryInExePath`), 在其中执行 `Get-Command arw` 并要求结果指向 Installation 目录, 再执行 `arw --version` 并要求输出含候选版本. 复用 `fresh()` 读取 Path 的逻辑, 不重复实现; 脚本保持只 import node 内置模块. 把原有 `PowerShell 在新终端可解析` 一步删除或保留由实施者按是否冗余判断 (`Get-Command arw` 成功已蕴含 PowerShell 可启动).

体积预算: 非测试代码约 +10 行.

预期验证: `node --check scripts/release-guest-check.mjs`, `pnpm typecheck`, `pnpm test`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node arw.mjs text check`, `git diff --check`. 脚本只在 VM 内运行, 不写单元测试, 不启动 VM; 下一次发布验证覆盖.

## Acceptance criteria

- [x] Windows 分支在新 PowerShell 会话里用 `Get-Command arw` 解析 `arw`, 要求路径位于 Installation 目录, 并运行 `arw --version` 核对版本.
- [x] 非 Windows 行为不变, 脚本仍只 import node 内置模块.
- [x] 上述验证命令通过.

## Blocked by

- None - can start immediately

## Validation

- `node --check scripts/release-guest-check.mjs`, `pnpm typecheck`, `pnpm test` (845 通过 / 0 失败), `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node arw.mjs text check`, `git diff --check` 通过 (在最终暂存树上重跑). 未启动 VM.

## Comments

- 净增: 非测试代码 +17 / -10 (净 +7, `scripts/release-guest-check.mjs`, 相对 `1b8118c`), 在 +10 预算内. `fresh()` 新增第三个参数 `shell` (`cmd` 默认, 或 `powershell`), 共用同一份 Path 读取与环境; `checkResolved` 供 cmd 与 PowerShell 共用 (原步骤名不变, PowerShell 步骤加前缀), PowerShell 用 `(Get-Command arw).Source` 与 `arw --version`; `where powershell.exe` 一步保留, 只折成一行.
- 台账: `scripts/release-guest-check.mjs` `checkResolved` 的 `prefix` 与 `resolveLabel` 两个参数 冲突裁决 第 2 轮要求符合审核要求 cmd/bash 分支保留原步骤标签 (验收 "非 Windows 行为不变", `references/vm.md` 排障条目引用原标签), 合并为单一 label 会改回带前缀的标签; 第 3 轮起非行为问题不再修.

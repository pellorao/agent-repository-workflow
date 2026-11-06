# Windows 升级失败的三处修复

Status: completed

## What to build

外部使用者在 Windows 上从 0.4.0 升级到 0.5.1 失败的报告 (`.tasks/ARW/winupgrade/user-report.md`) 经 `win11` VM 核实后确认的三处问题. 不放宽任何检查, 不含设计决定.

1. 新增公共模块 `lib/common/windows-powershell.mjs` 的 `runWindowsPowerShell`, 供 `lib/background-agent/private-state.mjs` 与 `lib/background-agent/process-identity.mjs` 共用 (并登记进 `release-manifest.json` 与卸载测试的拷贝清单): Windows PowerShell 5.1 子进程不继承 `PSModulePath` (从 PowerShell 7 启动时它指向 7 的模块); 脚本统一加 `$ErrorActionPreference='Stop'` 并把错误写到 stderr (`ARW:` 行) 后以 1 退出, 使 `Get-CimInstance` 的非终止错误不再被读成 "进程不存在" (已退出); ACL 与创建时间两处失败的错误信息带上原因 (脚本错误, 超时或退出码). `readProcessIdentity` 的 `unknown` 观察带 `reason`, `acquireBackgroundAgentMaintenance` 的 `Shared App Server process exit is unknown` 与 `Claude Agent process exit is unknown` 在原句 (含句号) 后附上该原因, 其余文字不变.
2. `lib/repository-workflow/workflow.mjs` 的 `buildTargetDescriptors`: 受管目标字节按 `readManagedBytes` 规则归一化, 使锁文件哈希与验证读取一致 (分发文件为 CRLF 时, `arw workflow update` 不再把自己刚写的文件报成 `managed-content-drift`).
3. `tests/background-agent/process-identity.test.mjs` 的 `private process identity distinguishes live, exited, reused PID and unknown observation` 与 `process identity records accept the boot-id form...`: 测试用的运行目录先 `securePrivateStatePath`. Windows 上 `mkdtemp` 目录继承 ACL, 未设为私有时 `verifyPrivateStatePath` 正确地拒绝并得到 `unknown` (不是产品缺陷, 测试没有模拟管理进程先设私有目录的前提).

不做 (报告的其余修补): 把 ACL 设置改为 .NET `SetAccessControl` 并先核对所有者. 在 `win11` 上用提升和受限两种令牌, 所有者为 Administrators 或当前用户的目录, 现有 `Get-Acl`/`Set-Acl` 路径都成功, 没有复现; 失败原因可见后若再出现再立项.

预算: 非测试代码净增不超过 25 行.

测试先行 (先红后绿): 创建时间脚本含 `ErrorActionPreference` 且子进程环境无 `PSModulePath`; ACL 子进程环境无 `PSModulePath`; ACL 与创建时间失败的原因出现在 `unknown` 观察与维护 `reason` 中; 分发文件为 CRLF 时 `init` 后 `verify` 通过.

预期验证: 新增测试, `node --test tests/background-agent tests/repository-workflow`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0094-windows-upgrade-fixes/`, `git diff --check`; 在 `win11` 上用 `core.autocrlf=true` 的检出运行相关测试.

## Acceptance criteria

- [x] 三处修复完成, 新增测试先红后绿.
- [x] 预期验证全部通过, `win11` 上相关测试通过.

## Blocked by

- None - can start immediately

## Comments

冲突裁决: 提交审核第 1 轮 Code Standards 要求(通用机制不放业务模块)把 Windows PowerShell 子进程机制 (环境, 错误约定, 失败原因) 从 `private-state.mjs` 移到公共模块 `lib/common/windows-powershell.mjs`. Main 授权的范围 (本 issue 的三处修复, 无设计决定) 不变, 新模块是同一修复的实现位置, 对用户可见行为没有影响; What to build 第 1 项据此改写, 就绪例外记录按新 issue 字节重新生成 (用户常设确认 2026-11-02 不变). 实测非测试代码净增 22 行, 在 25 行预算内.

用户 2026-11-02 已确认这类不含设计决定的合并 issue 不需要治理设计 (就绪记录 `not-applicable`). Main 授权本任务 (`.tasks/ARW/winupgrade/README.md`).

台账: `tests/background-agent/process-identity.test.mjs` `an ACL check failure on the identity file ...` 与 `maintenance reports why ...` 的重复指摘 记录不修 前者经 `readProcessIdentity` 自己的 `verifyPrivateStatePath` 分支, 后者的 ACL 失败发生在 `client.mjs` 的 `securePrivateStatePath` 之前一步, 两者不是同一分支, 且该测试由要求符合审核第 2 轮要求.
台账: `01-windows-upgrade-fixes.md` What to build 第 1 项新模块 与就绪例外依据 冲突裁决 Code Standards 要求公共模块, 要求符合审核要求不引入设计决定; 新模块只是同一修复的放置位置, 不改变命令, Interface 或用户可见行为 (仅附加错误原因), 交 Main 在提交时确认.
台账: `## Validation` win11 逐测试结果 记录不修 带 `sh` 假命令的测试 (本 issue 新增的五个 Windows 假命令测试) 在 Windows 原生无法运行, 它们在 Linux 上以假 `win32` 平台运行并通过; win11 上跑的是不依赖假命令的真实路径 (CRLF 测试, `private process identity ...`, `process identity records ...`, 真实创建时间读取).

台账: Main 裁决 (2026-11-06): 新模块 `lib/common/windows-powershell.mjs` 接受, 是 Code Standards 要求的实现位置变化, 无行为变化, 不是设计决定; 就绪例外依据用户 2026-11-02 常设确认 (总层 AGENTS.md ARW 自主工作方式) 有效; win11 逐测试结果请求维持 "记录不修".

## Validation

- 先红后绿: `workflow.test.mjs` 的 `a CRLF Workflow Distribution ...` 在改 `buildTargetDescriptors` 前失败 (`managed-content-drift`); `process-identity.test.mjs`, `private-state.test.mjs`, `daemon.test.mjs` 中的 PSModulePath, ErrorActionPreference, 失败原因断言在改 `lib/` 前失败 (stash 验证 4 个失败), 改后通过.
- `pnpm test` 912 通过, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check` 通过.
- `win11` (Windows PowerShell 5.1, Node 24, `core.autocrlf=true` 的检出, 子进程环境带 PowerShell 7 的 `PSModulePath`): 新增 CRLF 测试与 `private process identity distinguishes live, exited, reused PID and unknown observation`, `process identity records accept the boot-id form ...` 通过 (修复前者在 HEAD 上失败: 测试没有把运行目录设为私有). 真实 `readOperatingSystemProcessCreationTime` 返回创建时间, 不存在的 PID 返回 null. 抽出公共模块后, 宿主 Windows PowerShell 5.1 上运行 `runWindowsPowerShell` 包裹后的 ACL 脚本与 CIM 脚本, 脚本解析正常, 错误原因 ("Private state permits another identity.") 如期出现. 其余 Windows 原生失败的测试 (用 `sh` 假命令, 或临时目录未设私有) 在 HEAD 上同样失败, 不属于本 issue.

# Windows 用户 Path 读取使用 UTF-8 输出编码

Status: completed

## What to build

问题: `lib/installation/installation-contract.mjs` 的 `defaultWindowsPath.read` 让 `powershell.exe` 向 Node 输出 JSON, 但没有设置控制台输出编码; Windows PowerShell 默认按系统代码页 (如 GBK) 输出, Node 按 UTF-8 解码, 用户 Path 中的非 ASCII 条目 (如 `C:\测试\bin`) 变成替换字符, 之后写回注册表时用户的 Path 被损坏.

改动: read 脚本开头加 `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false);`, 与 `lib/background-agent/manager-process.mjs` 的做法一致. 其他调用 `powershell.exe` 的位置已检查: `write`, `remove`, `notify` 不读取输出; `private-state.mjs` 不读输出; `process-identity.mjs` 只读纯数字; `manager-process.mjs` 已设置 UTF-8; `editor-process.mjs` 不读输出. 另有 `scripts/release-guest-check.mjs` 的 `fresh()` 用 PowerShell 读 Machine 和 User Path 并作为输出传给子进程, 同样在脚本开头设置 UTF-8 输出编码. write 经环境变量传值, Node 在 Windows 上以 UTF-16 传环境, 无编码问题.

体积预算 (非测试代码行): 净增 +2 行 (两处脚本各在同一行内追加语句); 上限 +3.

预期验证: 新测试通过公开接口 `planPathRegistration` 与 `applyPathOwnershipPlan` (不注入 `windowsPath`), 在 PATH 中放一个假 `powershell.exe` (shell 脚本: read 只有脚本含上述编码语句才输出 UTF-8, 否则输出旧代码页字节; write 把收到的环境变量写入临时文件), 断言写入的 Path 保留非 ASCII 条目; 真实 Windows PowerShell 的行为由后续发布验证 C1 覆盖. 边界情况: 无.

## Acceptance criteria

- [x] `defaultWindowsPath.read` 的脚本设置 UTF-8 输出编码.
- [x] 新测试覆盖非 ASCII Path 经读取再写回后保持原值, 不运行真实 PowerShell.
- [x] 其他 PowerShell 调用点已检查并在 issue 中记录结论.

## Blocked by

- None - can start immediately

## Validation

- 验收条件 1: `git diff` 显示 `lib/installation/installation-contract.mjs` 的 read 脚本和 `scripts/release-guest-check.mjs` 的 `fresh()` 脚本开头新增 `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false);`, 非测试代码净增 0 行 (各在同一行内追加), 在预算内.
- 验收条件 2: `tests/installation/installation-contract.test.mjs` 新测试 "Windows PATH registration keeps non-ASCII user PATH entries" 通过, 约 5 ms; 假 `powershell.exe` 在脚本无编码语句时输出旧代码页字节, 故旧实现会失败.
- 验收条件 3: 检查结论见 `## What to build`.
- 全量: `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check`, `arw terms check --include .scratch/0028-windows-path-utf8/` 均通过.

## Comments

- 就绪记录为 `not-applicable` 例外. 提交审核两轮指出它在实现后才生成, 与 "首次修改实现文件前取得就绪结果" 的顺序不符. Main 处置: 不阻断. 该顺序要求的目的是设计在实施前定稿; 例外成立所需的用户确认 (这类无设计决定的单 issue effort 不需要治理设计, 2026-11-02, 记在总层 `AGENTS.md` 的 ARW 自主工作方式) 在实施前已经存在, 例外记录的内容不随生成时机变化, 晚生成的只是记录文件. 偏离已告知用户 (状态页). 后续 issue 已改为先生成例外记录再实施.
- 第 1 轮提交审核后 subject 有真实变化 (加入 `scripts/release-guest-check.mjs`, 测试改走公开接口, 验收条件 2 改写). 例外记录没有 Reviewer 审核可做增量复审, 已按新 subject 重新生成并提升, `verify --subject-only` 通过.
- 第 2 轮提议把 UTF-8 输出前缀抽成 `lib/common/` 公共常量: 不采纳. `scripts/release-guest-check.mjs` 是在受验系统上独立运行的验证脚本, 有意不导入 `lib/` (现在没有任何 `lib/` 导入), 让检查不依赖被检查的代码; 去掉它之后 `lib/` 内只剩本处一个新用法 (`manager-process.mjs` 是既有写法), 不满足复用条件.

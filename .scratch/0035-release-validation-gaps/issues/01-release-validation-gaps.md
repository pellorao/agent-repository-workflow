# 发布验证补齐 fixture 流程, guest 检查项和发布后版本推进

Status: completed

## What to build

问题: 0.5.1 发布验证缺口分析显示发布验证没有覆盖: 上一版托管仓库的升级, 从未初始化仓库的 init, Windows 用户 PATH 的非 ASCII 项, CRLF 重新克隆, PowerShell 解析, 最低 Node 版本, 从上一发布版升级; 发布后也没有推进 main 的开发版本.

改动:

1. Release Skill 第 3 节增加 fixture 流程: 维护者在仓库外保存两个 Git 跟踪的 fixture 压缩包 `agent-assisted.tgz` (上一发布版托管的仓库) 和 `plain.tgz` (从未初始化的仓库), 目录来自 VM 配置 JSON 的新键 `fixturesDirectory` (真实路径不写入仓库); 验证只把它们解压到全新临时目录, agent-assisted 先安装候选, 运行 `workflow update --non-interactive`, 再 `workflow verify`; plain 运行完整参数的 `workflow init --non-interactive`, 再 `verify`. 压缩包只在发布成功后更新 agent-assisted (步骤见 Skill).
2. `scripts/release-guest-check.mjs` 增加自动检查 (只用 node 内置模块): Windows 用户 PATH 含非 ASCII 项时安装, 卸载都保留它; 受管仓库经 `core.autocrlf=true` 重新克隆后 `verify` 通过; Windows 上 `powershell.exe` 在新终端可解析; Node.js 满足 `engines`; 可选 `--previous <commit>` 先安装上一发布版再安装候选 (升级). `scripts/release-vm.mjs check` 把可选 `--previous <commit>` 转交 guest 检查.
3. Release Skill 在第 3 节说明最低 Node 的 PASS 行须显示 `engines` 的最低版本, 并加入上一版升级步骤; 增加第 5 节 "Advance main", 发布完成后用独立 issue 把 main 推进到下一个开发版本.

体积预算 (非测试代码行): 脚本新增不超过 +60 行; Skill 文档不计.

预期验证: `release-vm` 的新参数转交和用法错误由 mock 测试覆盖; guest 检查脚本不单独测试 (只能在受验系统运行), 以 `node --check` 和 typecheck 保证; 不运行 VM.

边界情况与覆盖:

- `--previous` 缺值或不是 7-40 位十六进制: `release-vm` 输出 USAGE 并退出码 2 (mock 测试覆盖三种输入); guest 检查对同样输入以 `FAIL --previous 是 commit` 失败, 不静默跳过升级 (只能在 VM 批次中观察).
- 非 Windows 系统: PATH 非 ASCII 项和 `powershell.exe` 检查只在 `WINDOWS` 为真时运行, 其余检查照常; 由 Linux VM 批次观察.
- 上一版 commit 不在 bundle 中: `git archive` 失败, `取出上一发布版` 步骤 FAIL 并停止; 不单独测试, VM 批次观察.
- 不使用 `git worktree` (见 `docs/agents/environment.md`): 上一版经 `git archive` 取出到临时目录, 不留 Git 登记.

## Acceptance criteria

- [x] Release Skill 含 fixture 流程, `fixturesDirectory` 键说明 (`references/vm.md`), 最低 Node 与升级步骤, 第 5 节版本推进.
- [x] guest 检查脚本含上述自动检查且只导入 node 内置模块.
- [x] `release-vm check` 转交 `--previous` 并校验其值, 有测试.
- [x] 发布规格的 VM 验证范围与上述检查一致.

## Blocked by

- None - can start immediately

## Validation

- 验收条件 1: `.agents/skills/release/SKILL.md` 第 3 节新增步骤 5-7 和第 5 节 "Advance main", `references/fixtures.md` 新增, `references/vm.md` 增加 `fixturesDirectory`; `.claude/skills/release/` 已用 `node scripts/project-claude-skills.mjs` 重新投影 (release 不在 `distribution/`).
- 验收条件 2: `scripts/release-guest-check.mjs` 只导入 node 内置模块, `node --check` 通过, 非测试代码净增约 40 行 (预算 +60); 未运行 (它会改 HOME 和 PATH 登记, 只能在 VM 中运行, 由 Main 的 VM 批次验证).
- 验收条件 4: 规格 `docs/specs/agent-repository-workflow-release/spec.md` 的 VM 验证一段已包含升级和 fixture 检查, 降级和真实目标仓库矩阵仍排除.
- 验收条件 3: 新测试 `tests/release/release-vm.test.mjs` 用假 `vmrun`, `ssh`, `scp` 验证 `--previous` 转交到每个 Node.js 可执行文件 (约 34 ms).
- 全量: `pnpm test` (835), `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check`, `arw terms check --include .scratch/0035-release-validation-gaps/`, `git diff --check` 通过.

## Comments

- 就绪记录为 `not-applicable` 例外 (用户 2026-11-02 确认), 先于实现生成.
- 未自动化的项目在 Skill 中: 最低 Node 对应 `engines`, fixture 验证与发布后更新, 发布后版本推进.
- 提交审核第 1 轮处理: (1) `--previous` 值校验 (`/^[0-9a-f]{7,40}$/u`): `release-vm` 在构造远程命令前输出 USAGE 并退出 2, guest 检查以 FAIL 退出, 测试扩展; (2) 上一版改用 `git archive --format=tar --output=...` (参数数组, 无 shell) 取出并 `tar -xf` 解开, 不再用 `git worktree`, 原先关于 worktree 残留的说明已删除; (3) 边界情况写入 What to build; (4) 去掉机器本地路径引用; (5) Main 的决定: 维护者 (用户, 2026-11-02) 明确要求发布验证覆盖升级 (上一发布版到候选, 以及 agent-assisted fixture 上的 `arw workflow update`), 因此发布规格的 VM 验证一段改为包含升级和 fixture 的 update/init 检查, 降级和真实目标仓库矩阵仍在门禁之外 (降级被版本策略拒绝, 矩阵成本高于收益).
- 第 2 轮提交审核: 规格第 48 行删去带日期的决定来源 (已在本 Comments), 并把 guest 检查的运行环境前提, 非 ASCII PATH 与 CRLF 重新克隆列入 VM 验证范围, 与 Skill 和脚本一致.

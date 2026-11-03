# 发布 VM 检查在三台 VM 上都运行 `arw workflow update`

Status: completed

## What to build

维护者 2026-11-02 发现 0.5.1 发布验证中 Windows 和 Alpine 从未运行 `arw workflow update`, 要求 "排进去, 三台 VM 都要跑 update"; 并决定 Node 最低版本写作 ">=24", 不要求精确的 24.0.0, VM 不安装 24.0.0.

`scripts/release-guest-check.mjs` 在 CRLF 检出验证之后, 卸载之前, 解压 agent-assisted fixture, 以 `arw-<上一版本>` 分支克隆 (Windows 用 `core.autocrlf=true`), 运行 `arw workflow update --non-interactive` 和 `arw workflow verify` 并直接检查退出码. `scripts/release-vm.mjs check` 要求配置提供 `fixturesDirectory`, 把 `agent-assisted.tgz` 与发布包一起传到客机并以 `--fixture` 转给客机检查. release Skill (`SKILL.md`, `references/vm.md`, `references/fixtures.md`) 与 `docs/specs/agent-repository-workflow-release/spec.md` 的 VM 验证描述同步为 "Node.js >=24" 和上一版本 fixture 上的 update, 覆盖范围和 Node 版本只在 spec 的 VM 验证段完整陈述一次, Skill 写操作步骤并引用它; `fixtures.md` 删去已由客机检查覆盖的 agent-assisted 手动 update 步骤.

体积预算: 非测试代码约 +40 行.

预期验证: `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node arw.mjs text check`, `git diff --check`; 三台 VM 上运行 `release-vm.mjs check` (提交前, 对临时 commit 的 bundle), 全部 PASS.

## Acceptance criteria

- [x] 客机检查在 Windows, Ubuntu, Alpine 上都对上一发布版 (Skill 规则: 最高稳定版 tag, 即 0.5.1, `--previous 6a5353468bbc9792d5df0f5594109da84ae20bfb`) 的 fixture 运行 update 与 verify, 任一失败即 FAIL.
- [x] 缺少 `fixturesDirectory` 时 `check` 以退出码 2 失败, 有测试覆盖.
- [x] 发布 spec 的 VM 验证段写明 Node.js >=24 (即 `engines.node`), 不要求精确最低版本; release Skill 引用该要求 (单一权威来源, 见 Comments).
- [x] 上述验证命令通过; 三台 VM 检查结果记录在 `## Validation`.

## Blocked by

- None - can start immediately

## Comments

- 台账: `.agents/skills/release/SKILL.md:37` 记录不修 第 3 轮代码规范审核认为第 6 步对 fixture update 的说明重复 spec 第 48 行; 该句是第 2 轮要求审核要求恢复的操作者须知, 已注明以 spec 为准, 第 3 轮起措辞与重复类问题不再修.
- 台账: issue `## What to build` 第 2 段 "同步为 Node.js >=24" 冲突裁决 与第 2 轮台账同一冲突: 版本只在 spec 第 48 行写明, Skill 引用; What to build 的 "同步" 按此理解, 验收标准已写明单一来源.
- 台账: `## Validation` Windows EPERM 转入后续 issue 失败发生在 update 之前的安装步骤, 安装器与 6a53534 相同, 是既有缺陷而非本候选引入; 本 issue 不是发布, 发布 spec 第 4 步约束的是发布候选. 修复建为后续 issue (Windows 上替换 manifest 的 rename 加短暂重试), 下一次发布前完成, 届时发布验证对含修复的候选重跑三台 VM. 本 issue 验收的 fixture update 步骤在三台 VM 两个基线上都已运行并通过.
- 台账: `docs/specs/agent-repository-workflow-release/spec.md:15` 冲突裁决 要求审核第 2 轮要求第 3 步复述 fixture update, 第 1 轮代码规范审核要求只在第 48 行陈述一次; 按单一权威来源保留第 48 行, 第 3 步不复述.
- 台账: `.agents/skills/release/SKILL.md:36`, `references/vm.md` Guest requirements 节 冲突裁决 要求审核第 2 轮要求 Skill 直接写 ">=24", 第 1 轮代码规范审核要求版本只在一处陈述; 按单一权威来源只在 spec 第 48 行写明, 验收标准已同步改写.
- 净增: 非测试代码约 +33 / -9 (`release-guest-check.mjs` +21 / -5, `release-vm.mjs` +12 / -4), 在预算内. 未改其他文档中已表示 ">=24" 的 Node 版本表述.
- 必需的 VM 运行用规则规定的上一发布版 0.5.1 (`6a5353468bbc9792d5df0f5594109da84ae20bfb`, fixture 有 `arw-0.5.1` 标签). 在 0.5.1 上 update 输出 "No changes." (0.5.1 到 0.5.2 的 Workflow Distribution 相同), 只覆盖受管状态和 CRLF 路径. 因此另对每台机器再运行一次 `--previous e30ada61c3539671fc79f1690f111e92f7a95631` (0.5.0, fixture 有 `arw-0.5.0` 标签) 作为附加证据, 让 update 有真实改动; 0.5.0 的安装器写坏非 ASCII PATH 项的问题已由 0037 的写入顺序规避, 0.5.1 发布验证已用它在三台 VM 上升级通过. 附加运行不改变 Skill 的基线规则.

## Validation

- `pnpm test` 842 通过 / 0 失败; `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check` 通过.
- 测试回调耗时: `node --test tests/release/release-vm.test.mjs`, 重复 3 次, Linux 6.18 (WSL2), Node v24.22.1, 32 核; 修改的案例 34.2 至 39.1 ms, 新增的案例 19.8 至 20.2 ms, 均低于 100 ms 阈值.
- 本地 Linux (临时 HOME) 运行 guest 检查, `--previous` 为 0.5.0 commit: `PASS linux node 24.22.1 0.5.2`, fixture update 输出 "Workflow update completed.", verify 通过; 写盘约 50 MB, 已删除.
- 三台 VM 检查, 对临时 commit `83d7b3bc803e52fb3de18a0da17a45761d533a42` 的 bundle 运行 (不在任何分支上, 其树与待提交候选相同, 只差本 `## Validation` 文本), 由 Windows 宿主的 `node.exe` 运行 `scripts/release-vm.mjs check`, 运行后 VM 均已还原快照并关机. 规则要求的基线 `--previous 6a5353468bbc9792d5df0f5594109da84ae20bfb` (0.5.1):
  - `Windows 11: PASS`, guest 行 `PASS win32 node 24.18.0 0.5.2 83d7b3bc803e52fb3de18a0da17a45761d533a42` (第 3 次尝试; fixture update 输出 `Workflow update completed.`, verify 通过).
  - `Ubuntu: PASS`, guest 行 `PASS linux node 24.18.0 0.5.2 83d7b3bc...` (recommended 与 minimum 各一行, 同一 node).
  - `Alpine: PASS`, guest 行 `PASS linux node 24.17.0 0.5.2 83d7b3bc...`.
- Windows 11 在 0.5.1 基线上的失败尝试 (Windows 重命名报 EPERM, 已作为单独缺陷跟踪): 第 1 次和第 2 次尝试都在 `从压缩包安装` 失败, 消息为 `Installation failed after program files were written and the existing configuration was preserved; manifest was not written: EPERM: operation not permitted, rename '<home>\.agent-repository-workflow\.manifest.json.arw-tmp-<pid>-<id>' -> '<home>\.agent-repository-workflow\manifest.json'`. 此前各步均通过; 安装器自 0.5.1 起无代码变化; 第 3 次尝试通过. 该缺陷单独成 issue 跟踪, 不在本 issue 修复.
- 附加证据, `--previous e30ada61c3539671fc79f1690f111e92f7a95631` (0.5.0, 让 fixture update 有真实改动), 各一次尝试均通过: `Windows 11: PASS` (`PASS win32 node 24.18.0 0.5.2 83d7b3bc...`), `Ubuntu: PASS` (`PASS linux node 24.18.0 0.5.2 83d7b3bc...` 两行), `Alpine: PASS` (`PASS linux node 24.17.0 0.5.2 83d7b3bc...`).
- 汇总: 两个基线共 8 次尝试, 6 次通过, 2 次失败 (均为上述 Windows rename EPERM); 每台机器在每个基线上最终都 PASS.
- EPERM 的处置: 本 issue 不是发布验证, 验收证明的是新增的 fixture update 步骤在三台 VM 上可用, Windows 第 3 次尝试的 PASS 只作为这一点的证据, 不作为发布候选的 Windows 通过结果. 失败发生在 update 之前的安装步骤; 安装器 (`lib/`, `install.mjs`) 与 6a53534 相同, 属于既有缺陷, 不是本候选引入. 它单独成 issue, 在下一次发布前修复, 下一次发布验证按发布 spec 第 2 步对含修复的候选重跑三台 VM. 每次尝试写盘估计宿主约 35 MB, 客机约 130 MB (未精确测量).

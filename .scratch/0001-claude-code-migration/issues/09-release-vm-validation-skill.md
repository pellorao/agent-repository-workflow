# release VM 验证改为不自动触发的 Skill

Status: completed

## What to build

release VM 验证, release 发布与验证文档改为源码仓库专用, 不自动触发的 Skill, 仍由 Agent 执行, 目标是证明安装, PATH 登记和初始化在 Windows 与 Linux 上真实可用. 实现压缩到达成目标所需的最小程度.

预估改动: 大幅净减.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#rule-structure-and-context-budget`
- `.scratch/0001-claude-code-migration/spec.md#code-reduction`

## Acceptance criteria

- [x] Skill 不自动触发, 两个平台的元数据都已设置.
- [x] 按 Skill 执行能完成一次验证.
- [x] 相关代码, 测试和文档大幅净减, 测试通过.

## Blocked by

- issue:0001:03
- issue:0001:07

## Comments

- 新建源码仓库专用 Skill `.agents/skills/release/` (`SKILL.md`, `references/vm.md`, `references/publication.md`): Claude `disable-model-invocation: true`, Codex `agents/openai.yaml` 中 `allow_implicit_invocation: false`; 与 `reviewer-benchmark` 一样被 Workflow Distribution 同步排除.
- VM 验证改为 Agent 按清单运行两个小脚本: `scripts/release-vm.mjs` (vmrun 还原快照, 启动, 固定主机密钥 SSH, 传入 bundle, 最后硬关机还原) 和 `scripts/release-guest-check.mjs` (安装, 新终端解析 `arw`, `arw --version`, `workflow init`/`verify`, 卸载, 卸载后不可解析).
- 删除 Release Validation Registry, VM Runner, guest step, Release Conformance, 证据归档, 来源准备, 版本夹具, post-tag Bootstrap 验证及其测试和 11 份 docs/agents 文档; `release-validation.json` 只留规范 HTTPS 远端. `release-candidate.mjs` 和 `release-step-review-material.mjs` (只剩 `isSafeReleaseRelativePath`) 仍被 Reviewer Capability Conformance 使用, 留给 10 处理.
- 放弃的覆盖 (spec 设计理由已写明): 升级/降级链, 真实目标仓库矩阵 (agent-assisted, Code Map), post-init 初始化 issue 交接, Alpine 的独立登记. 需要时由维护者另行要求.
- "按 Skill 执行能完成一次验证" 需要真实 VM, 本次未运行. 已做的替代验证: 在 Linux 上以临时 HOME 直接运行 guest 检查通过; 用伪造的 vmrun/ssh/scp 跑通 `release-vm.mjs check` 全流程. 真实验证: 维护者提供 VM JSON 后, 对 Windows 11 和 Ubuntu 各运行一次 `release-vm.mjs check`, 两台都输出 PASS 即可勾选.
- 实测发现: 卸载 (`--remove-config true`) 后 Installation 目录留下空的 `background-agent-state/` 目录; guest 检查目前只要求不剩文件.
- `release-vm.mjs` 改为直接读取维护者原有的 VM 配置格式 (`location`, `vmwareEncryptionPassword`, `nodeExecutables`), 对 `recommended` 和可选 `minimum` 各跑一次 guest 检查; guest 检查把所用 node 的目录排在新终端 `PATH` 最前, PASS 行带 node 版本.
- 真实 VM 验证中发现并修复候选缺陷: 机器键 `Windows 11` 含空格, 使 `HostKeyAlias` 和 known-hosts 行无效, ssh 报配置错误; 改为固定别名 (每台机器各用自己的 known-hosts 文件).
- 真实 VM 验证 (候选 91c3768, 三台并行, 均从基线快照开始并在结束后还原):
  - `Windows 11: PASS` — `PASS win32 node 24.18.0 0.4.0 91c3768c8e98e667046c0803f91cbf2b0a2f570c`
  - `Ubuntu: PASS` — `PASS linux node 24.18.0 0.4.0 91c3768c8e98e667046c0803f91cbf2b0a2f570c` (recommended 与 minimum 各一行, 配置中两者指向同一个 node, 因此未真正覆盖最低版本)
  - `Alpine: PASS` — `PASS linux node 24.17.0 0.4.0 91c3768c8e98e667046c0803f91cbf2b0a2f570c`

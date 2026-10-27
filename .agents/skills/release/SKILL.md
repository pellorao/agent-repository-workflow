---
name: release
description: 仅在维护者显式调用时, 在 ARW 源码仓库中验证并发布一个稳定版本, 包括本地检查, 在 Windows 与 Linux VM 中验证安装, PATH 登记和 `arw workflow init`, 以及推送 tag 和 GitHub Release.
disable-model-invocation: true
---

# Release

只有维护者在 ARW Source Checkout 中显式调用本 Skill 时才使用. 它不进入 Workflow Distribution. 推送分支, 推送 tag 和创建 GitHub Release 都是外部写入, 每次都要取得维护者对准确项目, 分支和版本的明确授权. 版本确认本身不授权发布.

## 1. Confirm the version

1. 读取 `package.json` 的 `version`, 向维护者提问: `是否确认对 <version> 版本进行发布验证?`. 只有明确肯定才继续. 如果维护者说版本不对, 停止, 由另一个 issue 修改 `package.json`.
2. 确认 `<version>` 高于 `git tag --merged HEAD` 中的全部稳定版本 tag, 并确认 `<version>` tag 在本地和 `git ls-remote --tags origin <version>` 中都不存在.

## 2. Check the candidate locally

候选是一个已提交且工作树干净的 commit, 通常是发布准备 issue 的提交, 此时尚未推送. 先运行 `pnpm install --frozen-lockfile`, 其余检查互不依赖, 可以并行:

- `pnpm typecheck`, `pnpm test` (pnpm 11)
- `node scripts/check-workflow-distribution.mjs`
- `node scripts/generate-install-arw.mjs --check`
- `node arw.mjs text check`, `node arw.mjs terms check --strict`
- `node arw.mjs language inspect distribution`, 按 `docs/agents/writing.md` 的语言规则判断报告, 不合规时修复并提交新候选

任一检查失败时, 修复后提交新候选, 并从本节重新开始.

## 3. Validate on VMs

本节证明候选在每台 Windows 和 Linux VM 上都能完成以下流程: 安装, PATH 登记 (新开终端能解析到 `arw`), `arw workflow init` 和 `arw workflow verify`, 以及卸载. 安装使用候选自己的 `install.mjs` 和本地版本 tag.

1. 向维护者索取本次 VM 配置 JSON 的绝对路径. 配置格式和受验系统要求见 [VM 参考](references/vm.md). 配置内容, VM 身份和凭据不写入仓库, issue 或报告.
2. `mkdir -p .tmp/release`, 然后 `git bundle create .tmp/release/candidate.bundle HEAD`.
3. 对配置中的每台机器运行 `node scripts/release-vm.mjs check <config> <machine> <bundle>`. 脚本依次还原快照, 启动 VM, 传入 bundle, 运行 `scripts/release-guest-check.mjs`, 最后硬关机并还原快照. 不同机器之间互不依赖, 可以并行, 但不超过配置的 `maxParallelMachines`. 从 WSL 操作 Windows 宿主上的 VM 时, 按 [VM 参考](references/vm.md#wsl-and-windows-host) 使用 Windows 的 `node.exe` 运行.
4. 只有每台机器的最后一行都是 `<machine>: PASS` 才算通过. 记录 guest 为每个 Node.js 输出的 `PASS <platform> node <node-version> <version> <commit>` 行.

失败时先保存原始输出. 需要现场诊断时, 加 `--keep` 重跑, 用 `node scripts/release-vm.mjs ssh <config> <machine> <command>` 检查 VM, 诊断完运行 `down` 还原快照. 判断失败原因:

- 候选缺陷: 修复, 提交新候选, 从第 2 节重新开始.
- 环境问题: 修复环境, 只重跑受影响的机器.

做过临时补偿的运行只用于诊断, 不能算作通过.

## 4. Publish

全部机器通过, 且维护者授权发布后, 按 [发布参考](references/publication.md) 推送分支, 推送 tag, 验证公开 Bootstrap, 然后发布 GitHub Release. 任一步骤失败时, 按该文件中的恢复方法处理.

## Records

把发现的问题和修复方法追加到发布准备 issue 的 `## Comments`. 每台机器的 `PASS` 行作为验证证据记录在 `## Validation` 中. 不保存 VM 路径, 地址或凭据.

---
name: release
description: 仅在维护者显式调用时, 在 ARW 源码仓库中验证并发布一个稳定版本, 包括本地检查, 在 Windows 与 Linux VM 中验证安装, PATH 登记, `arw workflow init` 和 `arw workflow update`, 以及推送 tag 和 GitHub Release.
disable-model-invocation: true
---

# Release

只有维护者在 ARW Source Checkout 中显式调用本 Skill 时才使用. 它不进入 Workflow Distribution. 推送分支, 推送 tag 和创建 GitHub Release 都是外部写入, 每次都要取得维护者对准确项目, 分支和版本的明确授权. 版本确认本身不授权发布. 发布授权同时覆盖失败时回滚同一版本的 tag 与 Release.

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

本节证明候选在每台 Windows 和 Linux VM 上都能完成以下流程: 安装, PATH 登记 (新开终端能解析到 `arw`), `arw workflow init` 和 `arw workflow verify`, 以及卸载. guest 检查用 `scripts/pack-release.mjs` 把候选打成安装压缩包, 解压后用其中的 `install.mjs` 和发布标签安装.

1. 先读仓库根被 Git 忽略的 `.arw.local.json` 的 `release` 对象 (ARW 发布配置: 共用机器文件路径, `fixturesDirectory`, 每机的 ARW 专用键). 文件缺失或没有 `release` 对象时才向维护者索取各路径, 并写入该文件 (只放路径, 不放秘密), 之后不再询问. 配置格式和受验系统要求见 `./references/vm.md`. 配置内容, VM 身份和凭据不写入仓库, issue 或报告.
2. `<tmp>` 是会话工作区 (见 `docs/agents/environment.md`) 下的 `release` 目录, 本 Skill 与各参考文件都用该占位符. `mkdir -p <tmp>`, 然后 `git bundle create <tmp>/candidate.bundle HEAD`.
3. 对配置中的每台机器运行 `node scripts/release-vm.mjs check <machine> <bundle>`. 脚本依次还原快照, 启动 VM, 传入 bundle 和配置 `fixturesDirectory` 中的 `agent-assisted.tgz`, 运行 `scripts/release-guest-check.mjs`, 最后硬关机并还原快照. 不同机器之间互不依赖, 可以并行, 但不超过配置的 `maxParallelMachines`. 从 WSL 操作 Windows 宿主上的 VM 时, 按 `./references/vm.md` 的 WSL and Windows host 节使用 Windows 的 `node.exe` 运行.
4. 只有每台机器的最后一行都是 `<machine>: PASS` 才算通过. 记录 guest 为每个 Node.js 输出的 `PASS <platform> node <node-version> <version> <commit>` 行.
5. 每个 PASS 行的 node 版本都要满足 `./references/vm.md` 的 Guest requirements 节对 Node.js 的要求; 不满足时修正 VM 配置后重跑.
6. 从上一发布版升级: 给 `check` 追加 `--previous <commit>`, `<commit>` 是 `git tag --merged HEAD` 中最高稳定版 tag 指向的 commit. guest 检查先安装该版本, 再安装候选, 然后在检出 `arw-<该版本>` 标签的 agent-assisted fixture 上运行 `arw workflow update` 与 `arw workflow verify` (覆盖范围见发布 spec 的 VM 验证段). 首次发布没有上一版时省略, fixture 检出默认分支的最新状态后再 update.
7. plain fixture 验证, 步骤见 `./references/fixtures.md`; agent-assisted fixture 由 guest 检查覆盖. 通过后才算本节完成.

guest 检查自动覆盖的范围见 `docs/specs/agent-repository-workflow-release/spec.md` 的 VM 验证段.

失败时先保存原始输出. 需要现场诊断时, 加 `--keep` 重跑, 用 `node scripts/release-vm.mjs ssh <machine> <command>` 检查 VM, 诊断完运行 `down` 还原快照. 判断失败原因:

- 候选缺陷: 修复, 提交新候选, 从第 2 节重新开始.
- 环境问题: 修复环境, 只重跑受影响的机器.

做过临时补偿的运行只用于诊断, 不能算作通过.

## 4. Publish

全部机器通过, 且维护者授权发布后, 按 `./references/publication.md` 推送分支, 推送 tag, 发布带 `arw.tar.gz` 资产的 GitHub Release, 然后验证公开 Bootstrap. 推送分支或推送 tag 失败时停止并报告; tag 推送之后的步骤失败时, 按该文件的回滚步骤处理.

## 5. Advance main

发布和公开 Bootstrap 验证完成后, 用一个独立 issue 把 `package.json` 的 `version` 推进到下一个开发版本 (下一个更高的 `MAJOR.MINOR.PATCH`), 运行 `node scripts/generate-install-arw.mjs` 并提交. 之后源码安装的 `-pre` 身份基于新版本. 发布版本的 fixture 更新也在此时按 `./references/fixtures.md` 进行.

## Records

把发现的问题和修复方法追加到发布准备 issue 的 `## Comments`. 每台机器的 `PASS` 行作为验证证据记录在 `## Validation` 中. 不保存 VM 路径, 地址或凭据.

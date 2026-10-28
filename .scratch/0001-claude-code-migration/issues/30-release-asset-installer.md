# 独立安装改为下载 release 压缩包

Status: ready-for-agent

## What to build

用户反馈 (2026-10-28): `scripts/install-arw.mjs` 用 git 拉取发布标签且不限深度, 会下载完整历史 (约 20 MB), 很浪费时间; 而安装实际需要的内容压缩后约 0.5 MB. issue 29 还会把约 1.3 MB 的测试套件搬进仓库. 用户选择:

- `$release` 把安装所需内容 (`lib/`, `arw.mjs`, `install.mjs`, `uninstall.mjs`, `distribution/` 等安装载荷, 不含测试, 夹具和只服务 Source Checkout 维护的文件) 打成 `tar.gz`, 作为资产上传到 GitHub release 页.
- `install-arw.mjs` 改为: 解析目标版本 (默认最新稳定版, 保留 `--version`), 用 Node 内置 `fetch` 下载该 release 的压缩包, 用系统 `tar` 解压到临时目录 (Windows 10 起自带 `tar.exe`), 运行其中的 `install.mjs`, 结束后清理临时目录. 不再需要 git.
- 删除只服务 git 拉取的代码和测试; 更新安装规范, 发布规范, README 与安装手册中的说明.
- release VM 验证 (`release-vm.mjs` 与 guest 检查) 改为验证从压缩包安装.

设计要点 (worker 2026-10-28 细化):

- 压缩包名固定 `arw.tar.gz`, 由新增 `scripts/pack-release.mjs <输出路径>` 按 `release-manifest.json` 生成; 最新稳定版标签经 GitHub 最新发布接口解析, 下载 `releases/download/<tag>/arw.tar.gz`.
- 没有 Git 后 `--release-commit` 失去意义: 删除它和 Release Git Adapter, Release Source Adapter 只验证载荷和 `package.json.version == --release-tag`.
- `$release` 次序改为: 推送 tag, 创建带资产的 Release, 再验证公开 Bootstrap (下载需要 Release 已存在); 不再有因 Bootstrap 验证失败而删除 tag 的恢复流程.
- guest 检查把候选打成压缩包, 解压后安装.

预估净增: Bootstrap 约 -40, `release.mjs` 约 -90, `installation.mjs` 约 -10, 打包脚本约 +45, 规范, Skill 与 README 约 0, 测试约 -60 (删 Git 测试) +50 (新增), 合计约 -105.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow-installation/spec.md#public-entry-points`
- `docs/specs/agent-repository-workflow-installation/spec.md#installation-payload`
- `docs/specs/agent-repository-workflow-release/spec.md#github-release-publication`

## Acceptance criteria

- [x] `$release` 生成只含安装载荷的压缩包并上传为 release 资产; 压缩包内容由测试检查 (不含 `tests/` 等).
- [x] `install-arw.mjs` 不调用 git, 从 release 资产完成安装, `--version` 仍可用; 有测试覆盖.
- [x] 本地用一个临时压缩包和临时 HOME 实测安装成功 (不碰用户已安装的 ARW); release VM 验证在下次 `$release` 时覆盖.
- [x] 规范, README 与安装手册已更新; 全量测试, 投影与分发检查, `arw text check` 通过.

## Validation

- `pnpm test` 723 项通过 (1 项既有 skipped), `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check` 通过.
- 验收 1: `tests/installation/bootstrap.test.mjs` 用真实 `scripts/pack-release.mjs` 压缩包检查含 `lib/`, `distribution/`, `package.json`, 不含 `tests/`, 且 `installation.mjs` 导入闭包可解析.
- 验收 2: 同文件的确定性测试覆盖 `--version`, 最新版解析, 下载与解压失败, 参数与远端错误; 全程不调用 Git.
- 验收 3: 本地用 fetch 替身服务该压缩包, 临时 HOME 中运行 `scripts/install-arw.mjs --non-interactive --register-path false` 安装成功, `arw --version` 输出 0.4.0, 随后卸载; 未碰用户已安装的 ARW.
- 验收 4: 规范, ADR 0018/0020, `$release` Skill, README 与开发手册已更新.

## Blocked by

- None - can start immediately

# 独立安装改为下载 release 压缩包

Status: ready-for-agent

## What to build

用户反馈 (2026-10-28): `scripts/install-arw.mjs` 用 git 拉取发布标签且不限深度, 会下载完整历史 (约 20 MB), 很浪费时间; 而安装实际需要的内容压缩后约 0.5 MB. issue 29 还会把约 1.3 MB 的测试套件搬进仓库. 用户选择:

- `$release` 把安装所需内容 (`lib/`, `arw.mjs`, `install.mjs`, `uninstall.mjs`, `distribution/` 等安装载荷, 不含测试, 夹具和只服务 Source Checkout 维护的文件) 打成 `tar.gz`, 作为资产上传到 GitHub release 页.
- `install-arw.mjs` 改为: 解析目标版本 (默认最新稳定版, 保留 `--version`), 用 Node 内置 `fetch` 下载该 release 的压缩包, 用系统 `tar` 解压到临时目录 (Windows 10 起自带 `tar.exe`), 运行其中的 `install.mjs`, 结束后清理临时目录. 不再需要 git.
- 删除只服务 git 拉取的代码和测试; 更新安装规范, 发布规范, README 与安装手册中的说明.
- release VM 验证 (`release-vm.mjs` 与 guest 检查) 改为验证从压缩包安装.

预估净增: 安装脚本净减约 50, 发布打包约 +60, 测试约 +20, 合计约 +30.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow-installation/spec.md#public-entry-points`
- `docs/specs/agent-repository-workflow-installation/spec.md#installation-payload`
- `docs/specs/agent-repository-workflow-release/spec.md#github-release-publication`

## Acceptance criteria

- [ ] `$release` 生成只含安装载荷的压缩包并上传为 release 资产; 压缩包内容由测试检查 (不含 `tests/` 等).
- [ ] `install-arw.mjs` 不调用 git, 从 release 资产完成安装, `--version` 仍可用; 有测试覆盖.
- [ ] 本地用一个临时压缩包和临时 HOME 实测安装成功 (不碰用户已安装的 ARW); release VM 验证在下次 `$release` 时覆盖.
- [ ] 规范, README 与安装手册已更新; 全量测试, 投影与分发检查, `arw text check` 通过.

## Blocked by

- None - can start immediately

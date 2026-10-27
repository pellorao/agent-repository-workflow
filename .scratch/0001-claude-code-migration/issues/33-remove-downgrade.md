# 取消降级安装, 遇到降级请求直接报错

Status: needs-triage

## What to build

用户 2026-10-28 确认 ARW 不提供降级功能. 但现有设计提供了: `docs/specs/agent-repository-workflow-installation/spec.md` 第 21 行 "`--version MAJOR.MINOR.PATCH` ... 明确授权安装历史版本和降级", 第 252 行 "显式 `--version` 授权精确历史发布和降级", `README.md` 与 `README.zh-CN.md` 也写了可用 `--version` 降级, `lib/installation/installation.mjs` (约第 537 行) 只在默认最高版本时拒绝降级. ticket 32 又在安装规范第 513 行写了 "降级时须删除 `backgroundAgent.providers`".

要做的:

- 删除降级授权: 目标版本低于已安装版本时, 无论是否显式 `--version`, 安装都明确报错, 不写入任何文件. `--version` 仍可用于首次安装指定的历史版本 (没有已安装版本时不构成降级), 由实施时按最小改动确认.
- 删除只为降级存在的代码与测试, 改写安装规范, README 两个版本, 以及 ticket 32 写入的降级说明.
- 报错信息说明: 如需旧版本, 先卸载再安装.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow-installation/spec.md#public-entry-points`
- `docs/specs/agent-repository-workflow-installation/spec.md#installation-ownership-manifest`

## Acceptance criteria

- [ ] 已安装版本高于目标版本时, 带或不带 `--version` 都报错且不写入; 有测试覆盖.
- [ ] 规范与 README 不再描述降级; ticket 32 的降级说明已删除或改写.
- [ ] 全量测试, 投影与分发检查, `arw text check` 通过.

## Blocked by

- None - can start immediately

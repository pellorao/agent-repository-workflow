# 取消降级安装, 遇到降级请求直接报错

Status: completed

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

- [x] 已安装版本高于目标版本时, 带或不带 `--version` 都报错且不写入; 有测试覆盖.
- [x] 规范与 README 不再描述降级; ticket 32 的降级说明已删除或改写.
- [x] 全量测试, 投影与分发检查, `arw text check` 通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test`: 708 个测试, 707 通过, 1 跳过, 0 失败.
- `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`: 均通过.

## Estimate

净增行数估算: 运行时代码约 -3, 测试约 -3, 规范与 README 约持平; 总净增约 0. 实际: 13 个文件 +51/-94 (含 Estimate 与 Comments), 净减约 43.

## Comments

- 实现: 降级判断去掉 `!explicitVersion` 豁免, 带或不带 `--version` 都报错且零安装写入, 错误信息提示先卸载. `--version` 仍可用于首次安装历史版本.
- 偏离: 降级判断去掉豁免后 `--selection-mode` 与 `evidence.explicitVersion` 成为死输入 (Spec Readiness 第 2 轮指出), 一并删除 (installation, release, bootstrap, 生成的 install-arw.mjs, release-guest-check, 测试, 规范第 31/33/377 行). 尚无发布 tag, 不存在新旧 Bootstrap 与 Installer 混用问题. Main 已接受该偏离 (死输入, Spec Readiness 已复核).
- 规范: 改写第 21, 252 行与 ticket 32 的降级说明, 新增版本策略归属 (Engine), 理由, ADR 结论和权威表一行; Reviewer 提出的修改经独立 sonnet subagent 共同决定. Spec Readiness 共 6 轮, 第 6 轮 satisfied.
- 遗留: 无.
- 无关改动 (单独列出): 重新生成 `scripts/install-arw.mjs` 时带入 `evaluateNodeRuntime` 中 `typeof version !== 'string'` 分支的删除; 这是生成物与其源 `lib/arw-common/runtime-compatibility.mjs` 的既有偏差 (源码本无该分支), 无逻辑变化, 无法与生成同步拆开.

# 安装清单漏装 codex-home.mjs, 测试改为检查运行时导入闭包

Status: completed

## What to build

2026-10-28 按用户同意从本仓库更新本机安装后, 已安装的 `arw` 报 `Cannot find module .../lib/common/codex-home.mjs`: ticket 23 新增的 `lib/common/codex-home.mjs` 没有登记进 `release-manifest.json` 的 `runtimeFiles`. 现有测试 `tests/runtime-entries.test.mjs` 只检查 `lib/background-agent` 和 `lib/reviewer-runtime` 两个目录, 漏掉了其他目录新增的运行时模块.

已做的临时修复 (未提交, 在主工作区): `release-manifest.json` 按排序位置加入 `lib/common/codex-home.mjs`, 重新安装后 `arw lba` 正常, 全量测试通过. 用一次性脚本从 `arw.mjs` 和 `lib/arw-background-agent-host.mjs` 沿相对导入遍历 94 个模块, 均已在清单中.

要做的:

- 提交上述清单修复.
- 把 `tests/runtime-entries.test.mjs` 的目录检查改为: 从已安装入口沿相对 `import` 遍历全部运行时模块, 断言每个都在 `runtimeFiles` 中. 这样任何目录新增模块漏登记都会失败. 替换原目录检查, 不并存.

预估净增: 清单 1 行, 测试约 +10 / -10.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow-installation/spec.md#installation-payload`

## Acceptance criteria

- [x] `release-manifest.json` 包含 `lib/common/codex-home.mjs`; 从本仓库安装后 `arw lba` 正常.
- [x] 测试按导入闭包检查 `runtimeFiles`, 删掉清单中任一运行时模块时测试失败.
- [x] 全量测试, 投影与分发检查, `arw text check` 通过.

## Blocked by

- None - can start immediately

## Validation

- 清单含 `lib/common/codex-home.mjs`: `release-manifest.json` 的 `git diff`; 重新安装后 `arw lba` 正常 (主 Agent 已在本机确认).
- 导入闭包测试: `tests/runtime-entries.test.mjs` 的 "the release manifest includes every module reachable from the installed entries"; 入口含 `uninstall.mjs`; 导入扫描复用新增的 `tests/helpers/module-imports.mjs` (自 `tests/source-layout.test.mjs` 移出, 行为不变). 临时从清单删除 `lib/common/codex-home.mjs` 或只被 `uninstall.mjs` 导入的 `lib/installation/cli-prompt.mjs` 后该测试均失败, 恢复后通过.
- `pnpm test` 707 通过, 1 跳过, 0 失败; `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node arw.mjs text check` 均通过.
- `node --check` 受影响的 `.mjs` 文件与 `git diff --check` 通过.
- `arw terms check --include .scratch/0001-claude-code-migration/` 报 2 条 `Artifact` 术语发现, 位于 effort `spec.md` 与 `docs/specs/agent-repository-workflow/spec.md`, 不在本 issue 改动内.

## Comments

- Spec Readiness 一轮 (haiku high, 约 3 分钟) 返回 `No problems.`, 已提升并 `verify` 为 0.

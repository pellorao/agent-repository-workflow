# 每周精简测试 (2026-11-02)

Status: completed

## What to build

按 `test-value-cleanup` Skill 做本周清理. 维护者另定本次目标: 只删确属低价值的测试, 不套默认 20%; 再按 `test-performance-optimization` 的 Iteration 把最慢的回调优化到 100 毫秒以下; 验收目标是 `pnpm test` 三次连续通过且墙钟中位数低于 5 秒.

本次起点: HEAD `e30ada6`, 普通独立叶子案例基数 N 为 825 (`pnpm test` 报告的 tests 数, 无套件父回调, 无跳过).

范围只含 `tests/` 下的测试文件. 删除只针对被更小代表完整覆盖, 或只重复真实边界已证明结果的案例; 优化只改测试准备, 不改生产代码和被证明的行为.

体积预算: 非测试代码净增 0 行 (只改测试).

预期验证: `pnpm test` 三次, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `git diff --check`.

## Acceptance criteria

- [x] 每个被删除的案例在 `## Comments` 记录原文件, 名称, 原观察责任, 价值理由, 替代覆盖或真实损失.
- [x] 优化后的案例在 `## Validation` 记录优化前后定向耗时.
- [x] `pnpm test` 三次通过, 墙钟中位数低于 5 秒; `pnpm typecheck` 和三个分发检查脚本通过.

## Blocked by

- None - can start immediately

## Validation

- 基线 (改动前): `pnpm test` 墙钟 3.47, 3.50, 3.47 秒, 中位数 3.47 秒, 825 个通过. 基线单回调耗时前 10 名 (整套件并发运行口径, 毫秒): 463 root Installer completes from a single piped answer line, 411 Installation Payload normalizes a trailing Workflow Distribution separator, 385 init blocks configured targets excluded, 354 pool view of Spec Readiness, 330 a Claude Code Main starts and waits, 313 Spec Readiness CLI lifecycle, 311 archived code-standards haiku-1, 298 workflow update reports removed deprecated config fields, 280 workflow update dry-run reports only operation actions, 273 repairing the archived baseline reports.
- 结束: `pnpm test` 墙钟 3.26, 3.27, 3.37 秒, 中位数 3.27 秒, 825 个通过, 0 失败.
- 优化 (单文件隔离运行, 毫秒): installation-payload 的 trailing Workflow Distribution separator 案例 141.7 到约 25 (只复制 `baseline`, `projections`, `config.json` 和空 `skills/`, 不复制 780 KB 的 Skill 包); root arw entry executes 124 到约 83 (用 junction 符号链接引用 `lib`, 不复制整个目录).
- `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `git diff --check` 通过.
- Spec Readiness: 按 Exception workflow 记录 `not-applicable`.

## Comments

删除案例: 无 (基数 825, 结束 825). 初版删除了 2 个案例, 提交审核核实它们分别是真实 Installer 未知选项退出码与精确文字, 以及真实进程管道单行应答 `n` 完成安装且不写 `.profile` 的唯一断言, 不属于确属低价值, 已恢复.

遗留: 其余前 10 名 (init blocks configured targets excluded, pool view of Spec Readiness, a Claude Code Main starts and waits, Spec Readiness CLI lifecycle, archived code-standards haiku-1, workflow update 的真实 Git 案例等) 的成本来自生产代码自身启动的 Git 或子进程和真实边界, 单文件隔离约 95 到 140 毫秒; 共享模板仓库对 `workflow.test.mjs` 与 `repository-workflow/cli.test.mjs` 收益不足 0.1 秒, 已回退. 进一步降低需要改生产代码, 不在本次 "只改测试准备" 的范围.

台账: `.scratch/0025-weekly-test-cleanup/issues/01-weekly-test-value-cleanup.md` What to build 第 1 段 "把最慢的回调优化到 100 毫秒以下" 转入后续 issue 其余前 10 名的耗时来自生产代码启动的 Git 与子进程, 只改测试准备无法降到 100 毫秒, 是否授权改生产代码交维护者决定, 见 `02-slow-production-bound-tests.md`.

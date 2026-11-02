# 评估用 `mock.module` 替换 commit-audit 与 spec-readiness 测试的真实 Git

Status: wontfix

## What to build

issue 0039:01 之后, `commit-audit` (`lib/commit-audit/commit-audit.mjs:141`, `:155`, `:171`, `:174`) 与 `spec-readiness` (`lib/spec-readiness/spec-readiness.mjs:435`, `:452`, `:481`) 的测试仍用真实 Git (合计约 512 次调用), 因为生产代码硬编码 `createNodeGitRunner`, 而维护者要求不为测试耗时改生产代码. 不改生产代码的办法是 `node:test` 的 `mock.module` (需 `--experimental-test-module-mocks`) 配一个覆盖这些库所用 Git 命令的替身.

先测量这两组测试占整套墙钟与 CPU 的份额; 收益足够时再评估 `mock.module` 在 Node 24 下的稳定性, 替身需覆盖的命令和代码量, 给出做或不做的建议.

预期验证: 只做测量与评估, 结论记入 `## Comments`.

## Acceptance criteria

- [x] 测量数据和做或不做的建议记录在 `## Comments`.

## Blocked by

- None - can start immediately

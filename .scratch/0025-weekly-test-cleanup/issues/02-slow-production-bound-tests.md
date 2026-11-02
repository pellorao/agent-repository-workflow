# 生产代码造成的慢测试是否改生产代码

Status: completed

## What to build

2026-11-02 每周精简测试 (`01-weekly-test-value-cleanup.md`) 后, 基线前 10 名中仍有回调高于 100 毫秒: init blocks configured targets excluded, pool view of Spec Readiness, a Claude Code Main starts and waits, Spec Readiness CLI lifecycle, archived code-standards haiku-1, workflow update 的真实 Git 案例等 (单文件隔离约 95 到 140 毫秒). 它们的耗时来自生产代码自己启动的 Git 与子进程, 只改测试准备无法降到 100 毫秒.

由维护者决定: 授权为这些路径改生产代码 (例如减少 Git 子进程调用) 以达到 100 毫秒目标, 或接受它们作为真实边界的例外并修订每周清理的目标范围.

预期验证: 选择改生产代码时, 由届时的实施 issue 列出; 本 issue 只记录决定, 无运行验证.

## Acceptance criteria

- [x] 维护者的决定记录在本 issue 的 `## Comments`, 并据此更新 Status.

## Blocked by

- None - can start immediately

## Comments

维护者 2026-11-02 的决定 (原文):

> 大幅度利用 mock 来优化测试时间. 比如上千个测试用例, 可能就只需要实际运行一次 git, 其他全部用 mock 替代

> 绝对不要因为测试耗时问题而改生产. 如果实在做不到 100ms 以下, 那么就让它超过算了.

结论: 不授权为测试耗时改生产代码, 也不为测试加注入点; 用 mock 降耗时, 做不到 100 毫秒以下的案例保留原样并记录. 实施见 issue 0039 (`.scratch/0039-mock-slow-tests/issues/01-mock-slow-tests.md`).

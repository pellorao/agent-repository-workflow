# 生产代码造成的慢测试是否改生产代码

Status: needs-triage

## What to build

2026-11-02 每周精简测试 (`01-weekly-test-value-cleanup.md`) 后, 基线前 10 名中仍有回调高于 100 毫秒: init blocks configured targets excluded, pool view of Spec Readiness, a Claude Code Main starts and waits, Spec Readiness CLI lifecycle, archived code-standards haiku-1, workflow update 的真实 Git 案例等 (单文件隔离约 95 到 140 毫秒). 它们的耗时来自生产代码自己启动的 Git 与子进程, 只改测试准备无法降到 100 毫秒.

由维护者决定: 授权为这些路径改生产代码 (例如减少 Git 子进程调用) 以达到 100 毫秒目标, 或接受它们作为真实边界的例外并修订每周清理的目标范围.

预期验证: 选择改生产代码时, 由届时的实施 issue 列出; 本 issue 只记录决定, 无运行验证.

## Acceptance criteria

- [ ] 维护者的决定记录在本 issue 的 `## Comments`, 并据此更新 Status.

## Blocked by

- None - can start immediately

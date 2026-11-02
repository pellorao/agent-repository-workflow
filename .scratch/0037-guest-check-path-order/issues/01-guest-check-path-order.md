# guest 检查在上一版安装之后才写入非 ASCII PATH 项

Status: completed

## What to build

0.5.1 发布验证的 Windows guest 检查在安装上一发布版 (0.5.0) 之前写入含非 ASCII 的用户 PATH 项; 0.5.0 自己就会写坏这类条目 (修复在 0.5.0 之后), 所以检查在 "安装后非 ASCII 用户 PATH 项仍在" 失败, 失败的是检查顺序, 不是候选. 改为在上一发布版安装之后, 候选安装之前写入, 让该条目只需经过候选的安装和卸载. 只改 `scripts/release-guest-check.mjs` 中这一步的位置.

预估净增: 约 +1 行 (移动一行并加一行注释).

## Acceptance criteria

- [x] Windows 上写入非 ASCII PATH 项的步骤位于上一发布版安装之后, 候选安装之前; 其余步骤与顺序不变.
- [x] `node --check scripts/release-guest-check.mjs` 通过, 全量验证通过.

## Blocked by

- None - can start immediately

## Validation

- `node --check scripts/release-guest-check.mjs` 通过; `pnpm test`, `pnpm typecheck`, 三个分发检查, `git diff --check` 通过.
- 真实效果由 0.5.1 发布验证的 Windows VM 重跑确认 (检查脚本只能在 VM 中运行).

## Comments

- 改动由发布验证 worker 在诊断时先写入工作树, 例外记录 (`not-applicable`, 无设计决定的单 issue) 随后生成; 用户 2026-11-02 已追认这类顺序, 相应规则修改另行处理.

# 产品版本改为 0.5.0

Status: completed

## What to build

用户于 2026-10-28 决定下一个发布版本为 0.5.0. 根 `package.json` 的 `version` 从 `0.4.0` 改为 `0.5.0`, 这是仓库中唯一陈述产品版本的位置, 不改其他文件. 本地安装因此机械派生为 `0.5.0-pre`.

预估净增: 0 行 (一行替换).

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow-development/spec.md#source-checkout-layout`
- `docs/specs/agent-repository-workflow-installation/spec.md#public-entry-points`
- `docs/specs/agent-repository-workflow/spec.md#runtime-baseline`
- `docs/specs/agent-repository-workflow-release/spec.md#release-procedure`

## Acceptance criteria

- [x] 根 `package.json` 的 `version` 为 `0.5.0`, 其余内容不变.
- [x] 以临时 HOME 从源码本地安装后, 已安装的 `arw --version` 输出 `0.5.0-pre`.
- [x] 全量测试, 类型检查, 分发检查, `arw text check` 通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test` 726 通过 / 0 失败 / 1 跳过; `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node arw.mjs text check` 通过.
- 临时 HOME (`.tmp/t38-home`) 本地安装后, 已安装的 `arw --version` 输出 `0.5.0-pre`; 临时 HOME 已删除.
- 净增: 代码 +1 / -1 (净 0).

## Comments

- 没有适用于纯版本变更的轻量就绪路径 (`implement` Entry 只豁免 Agent 规则和文档), 故走完整 Spec Readiness. haiku high 两轮: 首轮指出引用章节不对应版本规则, 且验收观察方式未定, 改引 `#source-checkout-layout`, `#runtime-baseline` 并写明 `arw --version` 后返回 `No problems.`.

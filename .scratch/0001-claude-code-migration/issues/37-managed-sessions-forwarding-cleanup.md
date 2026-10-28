# createManagedNativeSessions 的纯转发成员改为名单循环, 并删除 4 处无用 re-export

Status: completed

## What to build

来源: Strata arch1 试点, 经独立 opus 复核 (`.tmp/strata-review/2026-10-28-arch1/selection-opus.md`) 选定; 纯内部清理, 不改行为.

- `lib/background-agent/manager.mjs` 的 `createManagedNativeSessions`: 约 35 个只做 `current().x(...)` 的转发成员改为名单数组循环赋值. 不用 Proxy get 陷阱 (返回值会被 await, 不能有 `then`). 删除走不到的 `?.()` 与 `?? null` 回退. `reserve`, `start`, `resume`, `detach`, `stopForDeadline` 与 `runId`, `previous` getter 保持显式. 不改 typedef, 运行时与测试 fake.
- 删除无人使用的 re-export: `lib/installation/installation-contract.mjs` 的 `export {parseInstallationManifest}`; `lib/arw-common/artifacts.mjs` 的 `ISSUE_FILE_PATTERN`, `SLUG_PATTERN` 改为不导出; `lib/reviewer-runtime/reviewer-measurement.mjs` 的 `export {createUsage}`, 4 个测试导入者 (`tests/background-agent/host.test.mjs`, `tests/helpers/reviewer-runtime-adapter.mjs`, `tests/reviewer-runtime/reviewer-measurement.test.mjs`, `tests/reviewer-runtime/reviewer-runtime.test.mjs`) 改从 `lib/background-agent/usage.mjs` 导入.

预估净增: 约 -35 行. 原生会话 Interface (`#interfaces`) 的操作与结果合同保持不变, 转发层只改写法, 不增删操作, 不新增 Adapter 或 Seam (`#seams-and-adapters`).

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#interfaces`
- `docs/specs/agent-repository-workflow/spec.md#seams-and-adapters`

## Acceptance criteria

- [x] 保持现有实现行为 (现有实现细节, 非新合同): 工厂返回对象无 `then`; 未 start/resume 时调用转发成员仍抛 `Native session has not started or resumed.`. 转发成员集合与改动前完全一致, 对 Interface 合同没有增删.
- [x] 现有测试不改 (除 `createUsage` 导入路径); 净减至少 20 行.
- [x] 上述 4 处 re-export 已删除或不再导出, 无其他引用残留.
- [x] 全量测试, 类型检查, 分发检查, `arw text check` 通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test` 726 通过 / 0 失败 / 1 跳过; `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node arw.mjs text check` 通过.
- 手工探针: 未 start/resume 的工厂对象 `'then' in s` 为 false, 调用 `stop`, `observe` 均抛 `Native session has not started or resumed.`.
- 净增: 代码 +14 / -35 (净 -21), 现有测试只改 4 处 `createUsage` 导入路径, 未新增测试.

## Comments

- Spec Readiness 三轮 haiku high: 前两轮因引用 `#capacity-and-recovery` 与验收条件把现有错误文本当作新合同返回 gap, 改引 `#interfaces` 与 `#seams-and-adapters` 后返回 `No problems.`, 已提升并 `verify` 为 0. 第一轮因机器重启中断.
- 测试导入者实际为 4 个 (含 `tests/helpers/reviewer-runtime-adapter.mjs`), 非原选择文档所写 3 个.

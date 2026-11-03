# Node 24.0.0 上的 SQLite ExperimentalWarning 不再混进输出

Status: completed

## What to build

批次 A 补测 (N4) 发现: 在 Node 24.0.0 上加载 `node:sqlite` 时, Node 向 stderr 打印 `ExperimentalWarning: SQLite is an experimental feature and might change at any time`, 混进 `arw background-agent` 系列命令, 卸载等输出 (较新的 24.x 已不再打印). 项目声明 `engines >=24`, 在 24.0 上用户可见.

`node:sqlite` 目前只由 `lib/background-agent/state-store.mjs` 静态导入. 在 `lib/common/process-warnings.mjs` 新增通用的 `withDroppedWarnings(shouldDrop, run)`: 在 `run()` 期间临时包装 `process.emitWarning`, 丢弃 `shouldDrop(警告文本, 警告类型)` 为真的警告 (类型可能以第二个参数字符串或 `{type}` 选项对象传入), 其余警告原样转发, `finally` 中还原原函数. 新建 `lib/background-agent/sqlite.mjs`: 用它加载 `node:sqlite`, 判定条件为类型 `ExperimentalWarning` 且消息含 `SQLite`, 导出 `DatabaseSync` (值, 并带同名 `@typedef` 供类型引用). `state-store.mjs` 只把导入改为 `./sqlite.mjs`, 不再静态导入 `node:sqlite`. 不使用 `--disable-warning` 或全局 `process.on('warning')` (不改变启动方式, 也不吞掉其他警告).

新模块要登记在 `release-manifest.json` (安装 payload). 体积预算: 非测试代码约 +15 行.

限制: 本机只有 Node v24.22.1, 它不打印该警告, 无法在真实 24.0.0 上验证; 测试直接调用 `withDroppedWarnings` 模拟警告. 真实 24.0.0 上的验证归 `ARW/vmnode` (VM 装 Node 24.0.0) 任务.

预期验证: `pnpm typecheck`, `pnpm test`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check`.

## Acceptance criteria

- [x] `withDroppedWarnings` 在 `run` 期间丢弃判定为真的警告 (两种传参形式), 转发其他警告, `run` 结束 (含抛错) 后还原 `process.emitWarning`; 有测试覆盖, 不依赖 Node 版本.
- [x] `state-store.mjs` 不再静态导入 `node:sqlite`, 两个新模块已登记进 `release-manifest.json`.
- [x] 上述验证命令通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm typecheck`, `pnpm test` (848 通过 / 0 失败), `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check` 通过.
- 新测试 2 个 (`tests/common/process-warnings.test.mjs`), 各约 1 ms. 未在真实 Node 24.0.0 上验证 (本机 v24.22.1 不打印该警告), 归 `ARW/vmnode`.

## Comments

- 净增: 非测试代码 +20 / -1 (净 +19, 相对 `HEAD`: `process-warnings.mjs` +13, `sqlite.mjs` +6, `state-store.mjs` +1 / -1), 超出 +15 预算 4 行: 按 `docs/agents/writing.md` 的通用能力规则, 把与 SQLite 无关的警告包装放进 `lib/common/` 而不是 `sqlite.mjs`, 多出新模块与其文档注释. 另 `release-manifest.json` +2 行登记两个新模块, `uninstallation.test.mjs` 的最小安装副本 +4 行 (新模块是 `state-store.mjs` 的依赖).
- 提交审核第 2 轮代码规范问题 (`lib/common/process-warnings.mjs:3` 同一行两个 `@param`) 经核对无效, 不修: `pnpm typecheck` 通过, 证明 TypeScript 把 `run` 识别为独立参数并检查其类型; 同一行写多个 `@param` 是仓库现有写法 (如 `scripts/release-guest-check.mjs` 的 `run`, `fresh`).

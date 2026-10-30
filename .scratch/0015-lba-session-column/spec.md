# lba 会话 ID 与标题分列

## Behavior

- `arw list background-agents | lba` 的表格列改为 `Status`, `Role`, `Elapsed`, `Session`, `Title`. `Session` 是所属 Main 的完整 session ID, 不截断; `Title` 是会话标题, 是本命令的可截断名称列, 按总长期规格 ARW Artifact operations 的截断规则默认截断, `--full | -f` 时不截断. 标题未知时 `Title` 以灰色文本显示 `N/A`. 其他列内容与排版规则不变.
- 卸载入口 (`uninstall.mjs`) 的停止确认表使用同一呈现, 保持全文.
- 理由: 用户 2026-10-30 提出 session ID 与标题混在一个单元格不便阅读; 分列后 ID 列对齐, 便于复制和搜索, 标题列成为普通名称列. 名称列放在最后一列, 与 `li`, `lm`, `ls`, `jl` 一致. 被拒绝的替代方案: 保持 `Main session` 单元格 `<标题> (<session ID>)` (阅读不便, 且需要渲染器的后缀机制); 缩短 session ID (无法唯一定位会话).

## ADR Evaluation

不需要新 ADR: 只改变列表呈现, 不改变持久格式, 数据来源或 Module 边界.

## Module Design

### Modules

- `lib/background-agent/presentation.mjs` 的 `renderBackgroundAgents(rows, full)` 输出新列, 以 `Title` 为可截断列.
- `lib/common/text-table.mjs`: 删除只为 `lba` 存在的后缀支持 (`suffixes` 选项及 `listTableOptions` 的对应参数), 其余行为不变.

### Interfaces

- `formatTextTable(headings, rows, options?)`, `options = {flexColumn: number, width?: number}`: 给出 `width` 时可截断名称上限为 `max(16, width - 其他列宽度之和 - 列间隔宽度之和)`; 不给 `width` 或无 `options` 时不截断. `listTableOptions(flexColumn, full)` 在 `full` 为假时返回 `{flexColumn, width: 100}`, 为真时返回 `{flexColumn}`. 两者除去掉后缀外与现状相同.
- `renderBackgroundAgents(rows, full)` 签名不变.

### Seams and Adapters

不新增 Seam.

### Testing Decisions

- `renderBackgroundAgents(rows, full)` 的单元测试 (`tests/background-agent/presentation.test.mjs`) 观察五列顺序与内容, `Session` 完整, 默认只截断 `Title`, `full` 为真时全文, 标题未知显示 `N/A`.
- `formatTextTable` 测试 (`tests/common/text-table.test.mjs`) 去掉后缀用例, 其余截断用例保留.
- 卸载停止确认表保持全文不设自动测试: 它由根入口 `uninstall.mjs` 一处字面量 `true` 决定, 该入口只做标准输入输出接线, 观察它需要启动卸载进程并模拟交互, 成本高于 100 毫秒的单测阈值, 而 `full` 为真时的表格结果已由上一条测试覆盖. 接受的成本是该字面量被改为 `false` 的回归只能由代码审核发现; 本 issue 不改动该行.

### Dependencies and Data Flow

不变.

### Module Design Rationale

后缀只服务 `lba` 一个调用方, 分列后没有使用者, 按先删后加删除. 接受的成本: 表格多一列间隔, 标题可用宽度与原方案相近 (常见最宽列下约 18 列).

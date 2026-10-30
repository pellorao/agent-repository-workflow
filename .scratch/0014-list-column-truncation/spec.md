# list 命令按列截断

## Behavior

- `arw list issues | li`, `arw list maps | lm`, `arw list specs | ls`, `arw list background-agents | lba` 和 `arw jira list | jl` 默认把表格按 100 个显示列排版 (宽字符按 2 列计): 只截断名称列, 其他列保持全文. 名称列是 `li`, `lm`, `ls` 和 `jl` 的 `Title`, `lba` 的 `Main session` 中的会话标题; `lba` 的该单元格保留 ` (<session ID>)` 全文, 只截断标题.
- 可截断部分是名称列单元格中名称本身 (`lba` 不含 ` (<session ID>)` 后缀). 它的显示宽度上限为 `max(16, 100 - 其他列宽度之和 - 列间隔宽度之和 - 后缀宽度)`, 其中其他列宽度按该列全部单元格与表头的最大显示宽度计, 后缀宽度按各行后缀的最大显示宽度计; 超出时截到上限内, 以 ASCII `...` 结尾 (`...` 计入上限). 未超出的表格与现状相同. 16 列下限使名称在其他列很宽时仍可识别, 此时整行可以超过 100 列.
- 新增选项 `--full | -f`: 输出不截断的全文表格, 与该命令的其他选项可以组合. `lba` 由 "不接受任何选项" 改为只接受 `--full | -f`. 无参数用法说明 (`lib/arw.mjs` 的 usage) 在各命令处列出该选项.
- 本设计替代两句现行合同: Application 长期规格 `jira list` 输出中的 "标题不截断" 改为默认按本规则截断, `--full` 时不截断; 总长期规格 Background Agent listing 中 "`Main session` 始终同时显示完整 session ID 和会话标题" 改为始终显示完整 session ID, 会话标题默认可按本规则截断.
- Skill 中 Agent 需要读取或过滤完整名称的 list 调用加 `--full`.
- 理由: 名称只看开头也能识别, 也能按开头搜索; 状态, 类型, 编号, 时间截断后含义不明, 所以不截. 100 列是用户指定的屏宽, 不读取终端宽度, 使输出与终端和管道无关. 被拒绝的替代方案: 按终端宽度自适应 (输出随环境变化, Agent 读到的结果不稳定); 每列固定上限 (短列不需要, 长列上限与其他列实际宽度无关); 默认全文加 `--short` (用户要求默认截断, Agent 需要全文时显式请求).

## ADR Evaluation

不需要新 ADR: 只改变列表命令的呈现和新增一个显示选项, 不改变持久格式, 数据来源, 信任根或 Module 边界.

## Module Design

### Modules

- 共享表格渲染 (`lib/common/text-table.mjs`): `formatTextTable` 增加可选的 `options` 参数, 不传时行为不变. 截断按显示宽度计算, 不切开字素.
- 各列表呈现 (`lib/arw-common/artifacts.mjs`, `lib/background-agent/presentation.mjs`, `lib/application-jira/jira-presentation.mjs`) 按 `--full` 决定是否传入截断参数.
- 命令解析 (`lib/arw.mjs` 及 Jira 命令解析) 接受 `--full | -f`.

### Interfaces

- `formatTextTable(headings, rows, options?)`, `options = {flexColumn: number, width?: number, suffixes?: string[]}`: `rows[i][flexColumn]` 是可截断的名称, `suffixes[i]` (缺省为空串) 原样接在名称之后组成该单元格; 给出 `width` 时按 Behavior 以该宽度计算上限并截断名称, 不给 `width` 时只拼接后缀不截断. 无 `options` 时与现状逐字节相同.
- `full` 布尔值从命令层传到呈现层: `li`, `lm`, `ls` 经导出函数 `listArtifacts(inventory, kind, options)` 的 `options.full` (`ArtifactListOptions` 与 `lib/arw.mjs` 的 `ListOptions` 各加 `full: boolean`; `lm`, `ls` 也带 `options`), 由内部 `renderList(kind, records, full)` 使用; `lba` 调用 `renderBackgroundAgents(rows, full)`; `jl` 调用 `renderJiraList(value, full)`. `full` 为假时向 `formatTextTable` 传 `width: 100`, 为真时不传 `width`.
- CLI: 上述命令新增 `--full | -f`; 未知选项仍为用法错误.

### Seams and Adapters

不新增 Seam. 测试直接调用 `formatTextTable` 和各命令入口.

### Dependencies and Data Flow

不新增依赖. 数据流不变, 只在呈现末端截断.

### Module Design Rationale

截断放在共享渲染器中, 因为各命令已共用它计算列宽, 截断上限依赖其他列的实际宽度; 在各呈现处各自截断会重复宽度计算. 被拒绝的替代方案是新建独立截断 Module, 它只有一个调用方. 接受的成本: 渲染器多一个可选参数. `lba` 的 ` (<session ID>)` 后缀从预算中扣除而不参与截断, 因为 session ID 是定位会话的唯一可靠依据 (标题可能重复或为 `N/A`); 被拒绝的替代方案是截断整个 `Main session` 单元格, 它会切掉 session ID. 名称下限取 16 列而不是 20 列: 按 `lba` 的常见最宽列 (`Status` 的 `starting`/`stopping` 8, 最长 `Role` 23, `Elapsed` 7, 后缀 39, 间隔 6) 标题只能得 17 列, 20 列下限会使名称被截断的行超出 100 列, 16 列仍可显示 8 个汉字或 16 个字母, 足以识别; 被拒绝的替代方案是按命令分别设下限, 它为一个数值增加配置面.

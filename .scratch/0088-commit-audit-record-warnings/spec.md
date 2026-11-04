# Commit Audit prepare 提示 issue 记录与实测不符的体积数字和缺失的验收命令记录

## Problem Statement

实施提交前, Main Agent 在授权 issue 的 `## Validation` 记录验证证据和实测净增, 并勾选 `## Acceptance criteria` 中的验收项. 提交审核的 Reviewer 把这些记录与已暂存候选对照, 发现不符就提出问题, 作者修改记录后再复审一轮. 2026-11-04 的效率分析统计了 21 轮提交审核: 其中有多轮的首轮问题只是 `## Validation` 写的行数或字符数与 `git diff --numstat` 的实测不符 (例如写 "+4 -2" 而实测 +5 -3), 或某个验收项已勾选而 `## Validation` 没有对应命令的记录 (例如 `pnpm typecheck` 和 guest 检查). 每轮这类复审约 3 到 4 分钟加一次修复. 前一个体积摘要改进 (`prepare` 在标准错误输出实测净增) 让作者能抄到正确数字, 却没有在抄错或改过代码后忘记更新记录时提醒作者, 所以这两类不符仍要等 Reviewer 发现. 两类不符都可由已暂存候选和 issue 文本机械比对得出, 不需要语义判断.

## Solution

`arw commit-audit prepare` 照常新建审核轮并输出体积摘要, 在摘要之后另外输出若干以 `warning:` 开头的行, 每行指出一个授权 issue 的记录与候选或自身不符: (a) `## Validation` 中以摘要同样的格式写下的净增数字与实测不同; (b) 已勾选的验收项里写出的命令在 `## Validation` 中找不到. 没有不符时输出与以前完全相同.

警告只是提示, 不是关卡: `prepare` 不因警告失败, 退出码不变, `verify` 不检查这些内容, 警告不写入 `request.json` 和 Reviewer 交接, Reviewer 规则和审核范围都不变. 警告与摘要一样写到标准错误, 因为调用方把标准输出当作轮目录路径使用; Spec Readiness 的 `prepare` 已经把 `warning:` 行写在标准错误, 这里沿用同样的分工.

## User Stories

1. 作为 Main Agent, 我希望抄进 `## Validation` 的净增数字在代码又有改动之后与实测不符时, `prepare` 立即告诉我, 以便在启动 Reviewer 之前改正记录, 省去一轮复审.
2. 作为 Main Agent, 我希望已勾选的验收项里写明的命令在 `## Validation` 中没有记录时得到提示, 以便补记证据, 而不是由 Reviewer 指出.
3. 作为 Main Agent, 我希望提示不会阻断提交审核, 因为多次提交的 issue, 或验收项与记录用不同写法时会出现合理的差异.
4. 作为依赖 `prepare` 标准输出的调用方, 我希望标准输出仍然只含轮目录路径.

## Implementation Decisions

### Scope of the comparison

比对对象是每个授权 issue 在已暂存候选中的文本, 与 `prepare` 现有的授权校验读取的是同一份已暂存字节. 一个 issue 不含 `## Validation` 章节时按空文本处理. 章节按二级标题 `## Validation` 与 `## Acceptance criteria` 定位, 围栏代码块内的行不当作标题, 定位复用 Issue Documents Module 已有的章节定位.

### Warning (a): recorded net growth differs from the measurement

净增数字指 `## Validation` 章节文本中 `code: <数字> <单位>`, `documents: <数字> <单位>` 和 `tests: <数字> <单位>` 形式的片段, 即体积摘要每类标题行 `<类别>: <净增> <单位> (files: <n>)` 在 `(files: <n>)` 之前的部分, 单位按类别固定: `code` 和 `tests` 为 `lines`, `documents` 为 `characters`, 其他组合不识别. 标签前面不能紧跟字母, 数字, 下划线或连字符, 标签后是冒号和一个空格, 数字是可带 `+` 或 `-` 的整数 (不带符号视为正数), 数字后是一个空格和单位词. 作者按体积摘要的约定原样复制标题行时被识别. 没有单位词的数字 (例如 `tests: 245 passed`, 测试通过数) 和用别的写法 (例如 "代码净增 +25 行") 写成的数字不被识别, 也就不会被比对: 这是有意的, 因为从自由文字里猜数字的含义会产生误报, 而摘要格式本来就是为了复制而设计的.

每个被识别的数字与本次候选的同类实测净增 (与摘要相同的计算结果) 比较, 不同就输出一行警告, 写明 issue 文件路径, 类别, 记录的数字和实测的数字. 相同时不输出. 同一类别在章节里出现多次时逐个比较. 一个 issue 分多次提交时, 作者记录的是各次相加之和, 而本次候选只覆盖其中一次, 这时警告会出现; 警告文字写明比较的对象是本次候选, 作者把各次相加后确认即可忽略, 这是接受的代价, 因为 `prepare` 无法知道这个 issue 此前已提交了哪些部分. 多个授权 issue 同时提交时, 每个 issue 记录的数字都与整个候选的实测比较, 因为候选的类别合计不按 issue 拆分.

### Warning (b): a checked acceptance item names a command that `## Validation` does not mention

验收项指 `## Acceptance criteria` 章节围栏外已勾选的任务列表行. 已勾选的行是: 至多 3 个空格缩进, 列表符 `-`, `+` 或 `*`, 列表符后 1 到 4 个空格或一个制表符, `[x]` 或 `[X]`, 其后是空白或行尾. 这正是 Issue Documents Module 规范化验收任务列表标记时识别的已勾选标记, 两处共用同一个定义, 不各写一份, 所以 `-[x]` (列表符后无空格), `[x]` 后紧跟文字的行 (括号后无空白) 和列表符后 5 个空格的行都不是已勾选项. 未勾选的行不检查. 项中的命令指其中的行内代码片段 (反引号包围) 里以 `pnpm `, `node `, `arw ` 或 `git ` 开头的片段, 这四个是本仓库验收项实际使用的命令入口; 其他片段 (路径, 标识符, 字段名) 不是命令. 命令片段的完整文字必须作为子串出现在 `## Validation` 章节文本中, 没有出现就输出一行警告, 写明 issue 文件路径, 验收项开头的一段文字和缺失的命令. 精确子串比对意味着记录里把命令写成另一种形式 (例如省略参数) 也会得到警告; 这是接受的代价, 因为警告只提醒作者核对, 而宽松匹配无法区分 "记录了" 与 "只是提到同一个程序".

### Output and ordering

警告行追加在摘要的最后一行 (`next ADR number: <NNNN>`) 之后, 每行一条, 以 `warning: ` 开头, 先按授权 issue 的排序, 同一 issue 内先 (a) 后 (b), (a) 按类别 `code`, `documents`, `tests` 的顺序, (b) 按验收项在文件中的顺序. 没有警告时摘要文本与之前逐字相同, 不多出空行.

### Failure and compatibility

比对只读取已经取得的已暂存字节, 不增加 Git 读取. 任何文本形态都不使 `prepare` 失败: issue 缺章节, 章节重复或标题异常时按找到的第一个章节处理, 找不到按空文本处理. `prepare` 对输入, 授权范围和候选的拒绝条件, 轮目录, `request.json`, Reviewer 交接, 退出码和标准输出都不变.

## Testing Decisions

在 Commit Audit 现有测试夹具上制造一个授权 issue, 其 `## Validation` 按摘要格式 (带 `lines` 单位) 写一个与实测不符的 `code:` 数字和一个与实测相符的 `tests:` 数字, 另有一个没有单位词的 `documents: 245 passed` 和一个用自由文字写的数字, 其 `## Acceptance criteria` 含一个用 `- [x]` 勾选且命令在 `## Validation` 中出现的项, 一个用 `* [x]` 勾选且命令缺失的项, 一个带 2 个空格缩进的 `+ [X]` 项且命令缺失, 一个围栏代码块内的 `- [x]` 行且命令缺失, 一个未勾选且命令缺失的项, 以及一个 `-[x]` 行 (列表符后无空格) 且命令缺失. 观察 `prepare` 返回的摘要: 摘要部分不变, 末尾恰有三行警告, 分别指出不符的 `code` 数字和 `* [x]`, `+ [X]` 两项缺失的命令; 相符的数字, 无单位词的数字, 自由文字数字, 已出现的命令, 未勾选的项, 围栏内的行和 `-[x]` 行都不产生警告. 这防止误报 (把相符的记录当不符) 和漏报 (勾选项的缺失命令未被发现), 并使识别与不识别可区分: 相符数字带单位, 所以识别失效时 "无警告" 的断言不会虚假通过. 已勾选标记定义本身的全部边界 (制表符, 5 个空格, `[x]` 后紧跟文字, 4 个空格缩进, 有序列表, 行内代码) 由 Issue Documents Module 现有的规范化测试 (`tests/arw-common/issue-documents.test.mjs`) 逐项观察, 本变更不改变它们, 也不重复; 本测试只观察 Commit Audit 确实使用该定义: 三种列表符, 缩进, 围栏, 无空格和未勾选各一例. 并保证警告不使 `prepare` 失败. 现有的摘要测试保持不变, 它没有 `## Validation` 内容, 用来观察没有警告时输出逐字不变. 命令入口测试已观察标准输出只含轮目录路径, 不需要重复.

## Out of Scope

- 不阻断提交, 不改变 `verify`, 不把警告写入 `request.json` 或 Reviewer 交接, 不改变任何 Reviewer 规则, 所以不需要 Reviewer 能力测试.
- 不比较预算, 不解析自由文字中的数字, 不识别命令之外的验收内容.
- 不检查未勾选的验收项, 不检查 `## Comments`.
- 不增加配置项, 命令选项或新的子命令.

## Module Design

### Modules

`Commit Audit Module` 在现有的候选读取, 授权校验, 审核轮准备和体积摘要之外, 新增一项只读责任: 把授权 issue 的两处记录文字与同一候选的实测数字和记录自身比对, 产出提示行. 不新增 Module, 也不改变它不判断语义, 不选择暂存范围, 不写受 Git 跟踪文件的边界: 比对是对文本片段的机械匹配, 不判断记录是否充分.

### Interfaces

`prepare` 的结果仍是轮目录和一个多行文本摘要; 摘要文本在没有不符时与之前相同, 有不符时在末尾多出 `warning:` 行. 命令入口把摘要整体写到标准错误, 轮目录写到标准输出. 命令用法, 输入文件, 退出码和 `verify` 的行为不变. 不新增结果字段, 因为这些行与摘要面向同一个读者 (写 issue 记录的作者), 同一时刻使用.

### Seams and Adapters

不新增 Seam 或 Adapter. 比对使用 `prepare` 已经读取的已暂存 issue 文本和已计算的类别合计. Issue Documents Module 已导出二级章节定位函数 (输入行数组, 标题和起点, 返回章节范围). 本变更再从它导出一个新的具名常量 `CHECKED_TASK_MARKER`: 一个匹配单行行首已勾选标记的正则, 第 1 个捕获组是 `[x]` 之前的行首部分 (缩进, 列表符和其后的空白); 它就是规范化验收标记现在使用的那个模式, 规范化用它把 `[x]` 换成 `[ ]`, 输出与之前逐字相同, 既有的 Spec Readiness 身份规范化测试不改断言即应通过. 没有新增函数, 也没有为此给 Issue Documents Module 增加结果字段; 它的长期规范接口描述增加这个常量及其用途.

### Dependencies and Data Flow

Git 索引和 HEAD 经 Repository State Inspector 一次读取为候选 (现有); `prepare` 计算类别合计 (现有), 再用合计和每个授权 issue 的已暂存文本生成警告, 附在摘要之后随结果返回, 命令入口写标准错误. Commit Audit Module 依赖 Issue Documents Module 的两个导出: 二级章节定位和已勾选标记定义 (ARW 的 Application 关联代码已这样依赖章节定位); Issue Documents Module 不依赖 Commit Audit Module, 也不知道有这项比对. 两个 Module 的边界不变: Issue Documents Module 仍只拥有正式章节, 审核对象和规范化结果, 警告不写入任何文件.

### Module Design Rationale

选择放在 `prepare` 的摘要输出, 而不是 `verify` 或 Reviewer 规则: 这两类不符的代价是多一轮复审, 最早的提示时刻就是作者拿到摘要, 准备启动 Reviewer 的时刻; 放进 `verify` 会把一个有合理例外 (多次提交, 写法不同) 的启发式变成关卡, 放进 Reviewer 规则则改变审核范围并要求能力测试, 而问题本来就可以机械得出. 数字只识别摘要标题行的格式, 命令只识别四个入口, 都是故意收窄: 误报会让作者习惯性忽略警告, 比漏报更伤害这个功能. 比对放在 Commit Audit Module 而不是 Issue Documents Module: 比较需要的类别合计由候选计算, 属于 Commit Audit Module; Issue Documents Module 明确不产生 Validation 和 Comments 的正式要求, 也不读取候选, 把这项比对放进去会让它同时承担记录文字的解释和对候选的依赖, 并反向依赖 Commit Audit. 代价是 Commit Audit Module 多了对 Issue Documents Module 两个导出的依赖, 以及已勾选标记的定义要通过导出共享才能保持一致. 不新增结果字段, 因为只有一个调用方且读者相同, 新字段只会增加一层转发. 接受的成本是: 多次提交的 issue 与写法不同的记录会得到可忽略的警告; 未被识别的写法保持原状, 仍由 Reviewer 发现.

### ADR Evaluation

权威来源不变: 比对对象是 Git 索引中的 issue 文本和同一候选的实测数字, 不引入新的权威, 也不替代 Reviewer 的判断. 不增加持久状态, 警告不落盘, 重新运行即重新计算; 没有新的恢复合同. `docs/adr/0023-separate-commit-audit-review-from-implementation.md` 的审核与实施分离不受影响: 警告不是审核结论, 不进入 Reviewer 输入. 输出只是可随时撤销的诊断文字, 不需要新 ADR.

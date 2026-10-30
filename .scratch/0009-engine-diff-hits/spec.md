# 引擎预检索差异命中

状态: 不采用 (2026-10-30). 盲测显示没有提速, 下文是未采用的历史设计记录, 实现已回退, 当前树中不存在; 依据见本 effort 的 issue 01.

## Problem Statement

实测显示提交审核的关键路径是要求符合审核的首轮: 中位 5.1 分钟, 近几次 7 到 9 分钟, 比 Code Standards 慢, 而提交审核要等两个 Reviewer 都完成. 首轮慢在 haiku high 的推理量和开放式检索, 不在 Input 大小. 其中最机械的一块是 `requirements-reviewer` 的差异回归检查: 对 `git diff <base> <tree>` 中每个非测试, 非 Markdown 的改动文件, 列出导出名, 命令与参数, 诊断码, 配置键, 再逐个在 `docs/specs`, `docs/adr` 和本 effort 的 spec 里检索命中处. 这是纯文本检索, 不需要模型判断, 却占用大量工具调用和输出 token.

## Solution

`arw commit-audit prepare` 在写出 `request.json` 时, 由引擎从代码差异中机械抽取标识符, 在受审树的文档中检索 (范围见下), 把命中的 `path:line` 写进 Request 的新字段 `diffHits`. `requirements-reviewer` 先逐条判断这些命中 (读命中所在章节, 核对其要求在受审版本中仍成立), 但差异回归检查的义务不变: 列表只是起点, 机械抽取会漏掉标识符, 所以 Reviewer 仍须对每个改动文件自行检索列表未覆盖的标识符, 命令, 文件路径和用户可见文本, 无命中也不跳过, 也不把 "列表里没有" 当作 "没有要求".

- 抽取范围: `git diff --name-only <base> <tree>` 中除 `tests/` 下文件和 Markdown 之外的改动文件 (与角色规则的差异回归检查范围相同). 抽取对象是这些文件差异中新增行和删除行 (`git diff -U0`): 删除或改名一个标识符同样可能使文档要求失效.
- 抽取的标识符 (正则, 不解析语法): `export` 声明的名字 (`export const|let|function|class NAME` 与 `export {a, b}`), 以 `--` 开头的命令行参数, 带引号的诊断码或配置键 (小写字母开头, 含至少一个 `-` 或 `.` 分隔的段, 如 `reviewer-not-ready`, `providers.anthropic.maxInstances`), 全大写下划线常量字符串. 长度小于 4 的忽略. 按 (改动文件, 标识符) 成对计, 每个文件内去重, 全部成对项按 `file`, `identifier` 的码元序排列后取前 60 对, 作为 `diffHits` 条目数的全局上界 (避免巨大差异使 Request 膨胀); 同一标识符只检索一次.
- 检索范围 (对 `<tree>` 内容的字面检索, 不判断文档性质): 受审树 (`<tree>`) 中 `docs/**/*.md` (排除 `docs/agents/**`, 那是 Agent 规则不是治理要求) 与本 effort 的 `spec.md`, `PRD.md` (effort 目录取自授权 issue 文件路径的上两级, 即 `prepareCommitAudit` 已持有的 `issuePaths[0]`, 文件不存在时 `git grep` 无命中, 不是错误). 字面量大小写敏感匹配, 一次 `git grep` 完成. 命中按路径码元序, 再按行号数值升序排列, 每个标识符保留前 8 条, 超出截断 (截断是合同的一部分: 列表不是完整性证明). 没有命中的标识符也写出, `hits` 为空数组, 让 Reviewer 知道它被抽取过且文档中无字面命中.
- 命中的判断义务 (写入角色规则): 命中只说明某文档含该字面量, 不说明其为要求. Reviewer 读取命中所在章节: 章节陈述了受该改动影响的要求 (行为, 合同, 约束) 时核对其在受审版本中仍成立, 不成立的写成问题; 章节只是叙述, 示例或与该改动无关的提及时忽略, 不写成问题. 检索范围内所有文档 (包括能力基准夹具的 `docs/dispatch/` 合同文档, 或 `docs/manuals/`) 的命中都按同一规则处理, 引擎和 Reviewer 都不预先区分文档是否 "治理文档".
- 不改变: Gate 1, Gate 2, 报告格式, 判断由 Reviewer 作出, Code Standards Reviewer 的交接.

不做: 引擎判断命中是否仍成立; 解析语法树; 为 Code Standards 或 Spec Readiness 做同类预检索 (Spec Readiness 首轮检索提示是另一项, 须单独盲测); 抽取文件路径和用户可见文本 (误报多, 交 Reviewer 自行检索).

## Module Design

### Modules

- **差异命中** (`lib/commit-audit/diff-hits.mjs`, 新增): 输入 `repositoryRoot`, `base`, `tree`, 本 effort 目录 (由 `issuePaths[0]` 推出), 输出 `diffHits` 数组. 只读 Git 对象, 不写文件.
- **Commit Audit** (`lib/commit-audit/commit-audit.mjs`): `prepareCommitAudit` 调用差异命中, 把结果放进写出的 `request.json`.
- **Requirements Reviewer 规则** (`docs/agents/roles/requirements-reviewer.md`): 差异回归检查增加 "先判断 `diffHits`, 但检索义务不变".

### Interfaces

- `request.json` 增加 `diffHits: {file: string, identifier: string, hits: string[]}[]`. `file` 是仓库相对的改动文件, `identifier` 是该文件差异中抽取的标识符 (同一标识符出现在多个文件时各写一项, 命中相同), `hits` 是 `<path>:<line>` 字符串, 路径是受审树内的仓库相对路径, 每项最多 8 条, 按路径码元序, 行号数值升序排列, 超出时保留前 8 条; 条目总数最多 60. 字段总是存在, 没有可抽取标识符时为 `[]`. 数组按 `file`, `identifier` 的码元序排列. 它只出现在 `request.json`, 不进入就绪记录, 交接文本或标准输出.
- 失败合同: 抽取与检索的 Git 命令返回码 0 (有命中) 或 1 (无命中) 视为成功, 其他非零退出使 `prepare` 失败并报告 Git 的标准错误, 不静默写出空列表: 空列表会让 Reviewer 误以为文档中无命中. `diffHits` 在 `prepareCommitAudit` 创建审核轮目录之前计算, 这与 `prepareCommitAudit` 现有顺序一致 (`base`, `tree` 与 Gate 2 文档的 Git 调用都在创建审核轮目录之前), 所以检索失败和这些既有 Git 失败一样不留下审核轮目录, `arw commit-audit verify` 读取的最新轮不受影响; 调用方修复 Git 问题后重新 `prepare`.
- Reviewer 侧: 角色规则规定 `diffHits` 是差异回归检查的起点, 不是范围: 先逐项读取命中所在章节并核对, 然后仍对每个改动文件自行检索, 报告格式不变.

### Seams and Adapters

不新增 Seam. 沿用 `prepareCommitAudit` 已有的 Git 运行器 (`createNodeGitRunner`), 测试用临时 Git 仓库观察.

### Dependencies and Data Flow

依赖方向不变. `prepareCommitAudit` 已持有 `base`, `tree` 和 `issuePaths` (授权 issue 文件路径, effort 目录由它推出, 不另行解析编号); 差异命中模块只依赖 Git 运行器, 结果沿返回值进入 `request.json`. Reviewer 通过已有的 Request 路径读取, 没有新的传递通道.

### Module Design Rationale

放进新文件而不是 `commit-audit.mjs`: 该文件已有 346 行且职责是组装审核轮, 抽取和检索是独立的一块逻辑. 用正则而不是语法解析: 抽取只需要召回常见的导出名, 参数, 诊断码和配置键, 漏掉的由 Reviewer 的保留检索义务兜底, 语法解析的代码量和依赖都不值得. 检索范围取 `docs/**/*.md` 排除 `docs/agents/**`, 而不是角色规则写的 `docs/specs`, `docs/adr`: 能力基准夹具陈述要求的合同文档在 `docs/dispatch/` 下, 只搜 `docs/specs` 与 `docs/adr` 会使基准里命中列表恒空, 无法检验; 被拒绝的替代方案是改夹具, 那会改变场景哈希并要求重测基线. 放宽的代价是 ARW 自身仓库里 `docs/manuals/` 等也可能出现命中, 属于提示性噪声, 每标识符 8 条的截断限制了其大小. 命中列表由引擎在 `prepare` 时算好, 而不是让 Reviewer 调用工具, 因为这一步不需要模型判断, 机械检索由引擎一次 `git grep` 完成最省时. 保留 Reviewer 的检索义务是质量底线: 没有它, 抽取漏掉的标识符就成为审核缺口.

### ADR Evaluation

不新增 ADR: 没有新的持久状态, 信任根或跨 Module 边界. 失败与恢复: 新增的检索失败路径与 `prepare` 已有的 Git 失败 (如 `git diff`, `git write-tree` 失败) 同类, 都在创建审核轮目录之前抛错 (现有顺序见 `lib/commit-audit/commit-audit.mjs` 的 `prepareCommitAudit`: 读取暂存候选, `git rev-parse`, `git write-tree` 与 Gate 2 文档的 `git diff` 先于 `createTemporaryWorkspace` 和 `mkdir`; 主规范对 `prepare` 的叙述把 "新建审核轮目录" 写在 "物化 `request.json`" 之前, 与代码顺序不符, 实施时把该句改为先固定 `base` 与 `tree` 并计算 Request 内容, 再新建轮目录并写出文件, 使长期规范与代码一致; 此前的失败不留下轮目录, `verify` 读取的最新轮不受影响), 重跑即可恢复, 不引入新的恢复协议或残留状态, 所以没有需要 ADR 记录的失败合同. ADR 0023 要求 Reviewer 角色指令的变更经过既有用户批准关卡: 本设计修改 `requirements-reviewer.md`, 该变更列在 issue 的 `What to build` 中, 按本仓库 Autonomous Working Mode 的 `rule-and-design-changes` 例外, 不逐处预先确认, 由用户按实施 issue 在状态页复核整体 diff, 这就是 ADR 所说的既有用户批准关卡. `request.json` 是 `prepare` 每轮重新物化的临时文件, 新字段是对它的追加, 不改变既有字段含义; ADR 0023 的 Decision 不枚举 Request 字段. 主规范 `Commit Audit` 一节的 Request 描述增加 `diffHits`, 并在 "`issue` 不声明治理要求引用" 一句保持 "差异回归检查从代码差异出发检索" 的同时注明引擎提供起点命中. 角色规则 `requirements-reviewer.md` 是 Reviewer 行为的权威来源, 主规范只引用它.

## Testing Decisions

- 确定性: 在临时 Git 仓库构造已暂存候选 (一个导出新名字并引用 `--flag` 与诊断码的源码文件, 一个含这些标识符的 `docs/` 文档与 effort spec, 一个改动的测试文件, 一个改动的 Markdown), 观察 `request.json` 的 `diffHits`: 命中 `path:line` 正确, 无命中的标识符 `hits` 为空, 测试文件和 Markdown 不抽取, 超过 8 条命中被截断 (保留路径, 行号最小的 8 条, 并观察 `hits` 内的排序), (文件, 标识符) 对超过 60 个被截断 (多文件差异下按 `file`, `identifier` 序取前 60 对); 无可抽取标识符时为 `[]`. 防止漏掉导出名, 把测试文件算进来, 或让大差异膨胀 Request.
- 失败: Git 检索非 0/1 退出时 `prepare` 失败, 不写空列表, 也不留下新的审核轮目录 (用注入的 Git 运行器观察).
- 质量不降: 确定性测试证明不了 Reviewer 在带列表时发现率不降. 用 `reviewer-capability` 的 `commit-audit` 评分单元做有无命中列表的盲测对比, 设计见 issue 的验收标准; 这是采用本功能的前提.
- 测量耗时: 新增测试的单个回调不超过 100 毫秒.

## Out of Scope

- 不改 Gate 1, Gate 2, Code Standards Reviewer, Spec Readiness.
- 不改能力基准夹具, 答案键和基线登记.
- 不新增复审基准场景.

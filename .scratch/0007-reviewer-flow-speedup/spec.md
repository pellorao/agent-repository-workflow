# Reviewer 流程提速

## Problem Statement

对 effort 0002 到 0005 的实测显示, 一个 issue 的端到端用时主要耗在四处: Reviewer 启动前的空等 (0005 的 Spec Readiness 首轮在 prepare 后 21 分钟才开始第一个回合), 实施开始后因措辞或去重修改 issue 而重跑 Spec Readiness (26% 的就绪轮次发生在 issue 已满足之后), 提交审核复审中反复出现已处置的旧问题 (后续轮的问题 80% 是再报, 并出现 "Code Standards 要求去重, 要求符合审核要求保留" 这类互相冲突、每轮只修一行文字的往返), 以及 Spec Readiness 因引用越界或验收项缺观察方式这类机械可查的问题多跑复审轮.

等待 21 分钟的原因已核实: Claude 后端的提供者容量是 4 个并行实例 (用户配置 `backgroundAgent.providers.anthropic.maxInstances`), 当时 0005 的基准 worker 以每批 4 个 haiku 运行连续占满 (14:51 到 15:14 三批背靠背, 第 4 批只有 2 个), 管理进程在容量用尽时对新的启动请求直接返回 `Provider anthropic capacity is exhausted.`, 不排队; 首轮请求在最后一批让出名额后才获准, 与第 4 批的开始相差 1 秒 (这期间调用方怎样重试没有留下记录). 所以问题出在调用方没有给关卡 Reviewer 留名额, 管理进程的行为本身符合其合同, 不需要改管理进程代码.

## Solution

最终状态如下.

- **容量优先** (规则): 关卡 Reviewer (Spec Readiness, 提交审核) 优先于基准和批量运行. 批量或基准运行同时占用的某提供者实例数不超过该提供者容量减 2, 为提交审核的两个并行 Reviewer 留出名额; 关卡 Reviewer 的启动因容量用尽失败, 或启动后 2 分钟内没有回合开始, 仍按 `agent-writes.md` 的基线排队等待: Main Agent 用 `list_agents` 查看占用名额的运行, 其结束后重新发送同一请求, 直到启动成功; 同时在启动失败或 2 分钟无回合的第一时间向用户报告占用名额的运行, 不静默等待. 这是对基线 "名额不足时排队等待" 的补充 (等待方式不变, 增加优先级和报告义务), 不放宽它. 规则写在 `reviewer-launch` Skill. 不增加管理进程的预留代码.
- **开工后措辞类改动不重跑 Spec Readiness** (规则): 实施已开始后, 提交审核提出的只涉及措辞, 重复或一致性 (不改变范围, 行为或验收含义) 的问题, 不修改 issue 的审核对象, 在 issue 的 `## Comments` 记录处置, 由提交审核的要求符合审核对照 spec 与实现核对. 改变范围, 行为或验收含义的真实变化仍修改审核对象并做增量 Spec Readiness 复审. 判断由 Main Agent 作出, 拿不准时按真实变化处理.
- **处置台账与收敛** (规则加一个交接字段, 只用于提交审核): 提交审核的复审后续轮在实测中有 80% 的问题是再报. `arw commit-audit prepare` 在每个 Reviewer 的交接里指向全部授权 issue 的 `## Comments` 章节作为处置台账 (首轮和因线程不可恢复而新建线程的轮次也带, 因为这些轮次同样可能重报已处置问题; 章节不存在表示没有已处置问题). 台账条目由 Main Agent 记录, 每条一行以 `台账:` 开头, 写明问题定位 (精确到句子或行, 条目只覆盖所列问题, 不外推到相邻或相似的问题; 回放发现过宽的条目会让 Reviewer 漏报同位置邻近的真实问题), 处置 (转入后续 issue, 记录不修, 冲突裁决) 和一句理由. 台账只记录不改写 Reviewer 语义判断的处置: Reviewer 认为问题成立这一判断不变, 只是同一问题在其位置未被触及时不再重报 (已修复的问题由相邻版本变化体现, 不入台账; Main 认为问题无效时仍走 `subagent-findings.md` 的质疑流程由 Reviewer 重新判断, 不用台账驳回); 处置记入问题所属的授权 issue, 无法归属时记入排序第一的授权 issue. Reviewer 复审规则增加: 台账已有处置的问题, 只要本轮相邻版本变化没有触及它的定位和影响范围, 就不再报告, 也不写 "仍成立"; 变化触及时台账条目作废并重新判断. 提交工作流增加: 以同一次提交尝试 (同一排序的 `authorizingIssueIds`, 从首次 `prepare` 起) 中 `prepare` 的次数为轮次, 第 3 轮起只为行为缺陷开修复轮 (无论由谁引入), 措辞, 重复和文档去重类问题以 "记录不修" 记入台账后不再开修复轮; 提交门槛对 "问题已处理" 的要求在原有三种处理 (修正, 按质疑规则证明无效, 转入后续 issue) 之外增加 "记录不修" (仅限第 3 轮起的措辞, 重复和文档去重类问题) 和 "冲突裁决", 第 1 和第 2 轮的问题仍须按原有三种处理; Code Standards 与要求符合审核的结论互相冲突时, Main Agent 按 effort spec 裁决并把裁决记入台账. Spec Readiness 的复审不使用台账: 其 Reviewer 只读取请求快照, 无法读取审核对象之外的 `## Comments`; 把 `## Comments` 放进快照需要把本地 issue 的非审核对象部分变成 Input, 与 "issue 永远不是 Input" 冲突, 被拒绝. 就绪复审后续轮 190 条问题中再报 63 条 (33%), 提交审核 113 条中 90 条 (80%), 所以收益主要在提交审核.
- **流水线** (规则): 当前 issue 实施或提交审核期间, Main Agent 可以为下一个互不依赖的 issue 完成 Spec Readiness (只写 `.scratch` 中该 issue 的文件和就绪记录), 总并行 Agent 数不超过用户级名额上限; 前一个 issue 的修复使该 issue 的治理 Input 变化时按增量复审处理.
- **prepare 预检** (引擎): `arw spec-readiness prepare` 在写出审核轮后, 对 issue 的审核对象和 Input 做三项机械预检, 命中的每一条向标准错误输出一行 `warning: ...`, 不改变标准输出 (仍只打印轮目录) 和退出码. 预检只提示 Main Agent 在启动 Reviewer 前自查, 不阻断, 也不进入 Request.
  - 引用越界: 审核对象和 Input 文本中的 `path:line` 引用, 指向仓库中已存在的文件而行号超过该文件行数.
  - 路径不存在: 审核对象和 Input 文本中以反引号包裹的仓库路径 (首段是仓库根目录下已存在的目录, 带文件扩展名), 文件不存在. 该行含 "新建", "新增", "创建" 时跳过, 因为那是计划交付的新文件.
  - 验收项缺观察方式: `## Acceptance criteria` 中的任务列表项既没有 "观察" 也没有反引号包裹的命令或路径.
  不检查反引号包裹的普通标识符或命令名是否出现在仓库中: 新标识符本来就不存在, 误报多于有效提示.

不做: 管理进程容量预留, 引擎为要求符合审核预先检索差异回归命中, Spec Readiness 首轮检索提示, 新建复审基准场景.

## Module Design

### Modules

- **预检** (`lib/spec-readiness/precheck.mjs`, 新增): 输入审核对象文本, Input 文本与仓库根目录, 输出警告字符串数组. 只读文件系统.
- **Spec Readiness** (`lib/spec-readiness/spec-readiness.mjs`): `prepareSpecReadiness` 调预检, 结果带 `warnings`.
- **Commit Audit** (`lib/commit-audit/commit-audit.mjs`): 两个 Reviewer 的交接增加台账指引.
- **CLI** (`lib/arw.mjs`): 把 `warnings` 写到标准错误.

### Interfaces

- `prepareSpecReadiness` 的返回值增加 `warnings: string[]` (总是存在, 可为空). 不在 Reviewer Request, 就绪记录, 轮目录或标准输出中出现.
- `arw spec-readiness prepare`: 标准输出和退出码不变; 每条警告一行写到标准错误, 形如 `warning: <文件>: <说明>`.
- `arw commit-audit prepare` 写出的每个 Reviewer `handoff` 增加一行 "处置台账: <全部授权 issue 路径, 逗号分隔> 的 `## Comments` 章节" 指引, 首轮, 复审轮和新建线程的轮次都有. 指引只是路径指针, 不复制章节内容, 受审树里的 issue 文件是 Reviewer 读取的唯一来源. 章节不存在表示没有已处置问题.

### Seams and Adapters

不新增 Seam. 预检读取文件系统, 测试用临时目录观察.

### Dependencies and Data Flow

依赖方向不变. `prepareSpecReadiness` 已持有审核对象文本与 Input 文本, 预检只在写出审核轮之后消费它们, 产出的警告沿返回值到 CLI 层再到标准错误. 台账指引由 `commit-audit.mjs` 在组装交接文本时追加, 授权 issue 路径已在该函数内可得.

### Module Design Rationale

台账指引文本直接写在 `commit-audit.mjs` 的交接里, 不放进共用的 `reviewer-round.mjs`: 只有提交审核使用台账, 一个只有单个调用方的字符串不值得成为共用接口. 开工后措辞类改动是否触及范围由 Main Agent 判断, 而不是交给 Reviewer 或固定分类: 交给 Reviewer 就是要避免的那次就绪复审, 固定分类无法区分措辞与含义; 接受的成本是 Main Agent 把真实范围变化误判为措辞时, 它直到提交审核的要求符合审核对照 `What to build` 和 spec 时才被发现, 所以规则规定拿不准按真实变化处理. 预检只提示不阻断, 因为这些检查是启发式的 (反引号路径可能指向本 issue 要新建的文件), 阻断会把误报变成流程障碍; 放在引擎而不是 Skill 自查清单里, 因为这几项是机械可判的, 清单靠 Main Agent 逐条人工执行成本高且常被跳过. 不检查普通标识符是因为新标识符天然不在仓库中, 无法区分遗漏与计划新增. 台账用路径指针, 并规定条目以 `台账:` 开头且带问题定位, 因为引擎不解析 `## Comments` 内容, 而 Reviewer 本来就读取受审树; 复制章节内容会让交接文本与受审树出现两份来源. 容量问题不改管理进程: 它在容量用尽时明确拒绝而不排队是合理合同, 排队会让 Reviewer 启动时间不可预测; 调用方预留名额更简单, 被拒绝的替代方案是在管理进程里为关卡 Reviewer 预留实例, 约 15 到 25 行代码, 只有规则不够用时才值得做.

### ADR Evaluation

台账与收敛规则的权威位置是主规范 `Review versions and result validity` (复审边界和 "旧问题逐项处理" 的例外), `Commit Audit` 一节 (交接和提交门槛) 和 `commit` Skill, `Reviewer` 规则的 `Re-review` 只写 Reviewer 侧行为. ADR 0023 的状态是历史记录, 其 Decision 已指向主规范的复审合同, 所以只在 `Consequences` 增加一句: 台账只记录不改写 Reviewer 语义判断的处置 (转入后续 issue, 记录不修, 冲突裁决), 因而不违反 "实现者不判断自己候选的验收结论"; 接受的成本是处置后来失效时靠 "变化触及即作废" 兜底, 以及第 3 轮起措辞类问题不再开修复轮. 不复制规则正文. "记录不修" 与 "冲突裁决" 让 Main Agent 对一个 Reviewer 认为成立的问题作出 "不阻止提交" 的处置, 这没有违反 ADR 0023: 其 Decision 中 "任一 `gap` 阻止整批提升" 属于已被取代的 JSONL 生成流程 (状态行已声明), 现行提交门槛 (`commit` Skill 第 7 步) 本来就由 Main Agent 判断问题是否 "已处理", 并已允许按来源分流转入后续 issue 或按质疑规则证明无效而不修; 新增的两种处置属于同一类 Main Agent 分流责任, 不改写 Reviewer 的语义判断, 且范围窄: "记录不修" 只限第 3 轮起的措辞, 重复和文档去重类问题 (行为缺陷仍须修复, 拿不准按行为缺陷处理), "冲突裁决" 只在两个 Reviewer 的要求互相冲突时按 effort spec 这一更高权威选择其一. 接受的风险是 Main Agent 把真实缺陷归入措辞类而漏修, 由上述保守默认和后续提交的差异回归检查兜底. 主规范的 `Spec Readiness` 一节增加开工后措辞类改动记入 `## Comments` 的规定, `prepare` 描述增加预检警告. 不新增 ADR, 因为没有新的持久状态, 信任根或跨 Module 边界. 预检警告和台账指引都是 `prepare` 输出的追加, 不改变现有字段含义.

## Testing Decisions

- 预检: 构造一个含越界 `path:line`, 不存在的反引号路径 (含一条带 "新建" 的同类路径) 和缺观察方式验收项的 issue, 观察 `prepareSpecReadiness` 返回的 `warnings` 恰好命中前三类, 跳过带 "新建" 的路径, 且干净 issue 的 `warnings` 为空. 防止误报新文件, 或漏报越界.
- CLI: 观察 `spec-readiness prepare` 标准输出仍只有轮目录, 警告出现在标准错误, 退出码为 0. 防止警告污染调用方解析的标准输出.
- 台账指引: 观察 Commit Audit 两个 Reviewer 的 `handoff` 含 "处置台账" 与全部授权 issue 路径 (用两个授权 issue 的候选). 防止多 issue 提交只指向其中一个, 使另一个 issue 里的处置对 Reviewer 不可见.
- 台账规则的有效性不能由确定性测试证明, 在 issue 的验证记录中用历史轮次回放检查: 带台账重跑若干历史复审轮, 真实新问题仍被报告, 再报消失.
- 测量耗时: 新增测试的单个回调不超过 100 毫秒.

## Out of Scope

- 不改管理进程和提供者容量配置.
- 不改 Reviewer Role 的检索行为, 不新增复审基准场景.
- `.scratch` 中已完成 effort 的记录是历史, 不改写.

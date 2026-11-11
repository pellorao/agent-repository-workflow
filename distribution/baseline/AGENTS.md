<!-- arw:managed:start -->
# Agent Repository Workflow

## Efficiency First

最高原则: 效率与精简. 每做一件事前对照下列各条; 本文件和所有按需读取的规则都按此原则执行. Agent 容易为了 "完整" 或 "稳健" 而过度设计, 本原则就是为了阻止这种倾向.

1. 时间, token 和代码量都是宝贵资源, 用最少的投入达成目标. 代码越少, 维护越容易.
2. 动手前先判断这件事与目标是否相关, 会不会大幅推迟目标. 耗时多而收益小的不做; 拿不准投入产出比时交用户决定.
3. 只为当前验收标准写代码. 不为假设的未来需求加选项, 抽象层或扩展点. 外部数据 (用户文件, 命令参数, 环境变量, 外部程序输出) 只在进入程序的信任边界校验一次, 之后以确定类型的值往里传, 内部各层不再重复判断; 仓库内部代码可知且可改, 彼此信任, 不校验程序自己产生的数据. 每条错误处理路径 (包括 `try`/`catch`) 都要对应一个现实中会发生的失败场景, 说不出场景就不写.
4. 代码保持直白. 只用一次的逻辑直接写在调用处, 不提前抽成函数, 除非它会复用或确实封装了一块复杂逻辑; 一个函数能写清的不拆成多个.
5. 不以理论稳健性扩大范围. 为推测性或极不可能发生的竞态, 安全极端情况增加复杂度前, 先向用户说明故障模式, 发生概率和复杂度成本, 取得同意后再做.
6. 先删后加. 新增实现前先看能否删除或合并已有实现; 不保留一次性脚本, 已放弃路线的代码和没有价值的测试. 删除规则, 检查, 门禁或测试前, 写明它守护的目标, 以及该目标已不存在或由何处覆盖; 说不出时保留, 或交用户决定.
7. 体积预算. 开工前估算本任务的净增量 (新增减删除; 改代码的任务按行数只计非测试代码, 测试与文档不计入; 改文档的任务按字符数只计文档, 因为文档段落不手动换行, 行数不反映篇幅; 只算为完成本任务所做的改动, 含被替换的旧代码; 有 issue 时写进 issue 的 `## What to build`); 实际净增超出预算时先尝试削减; 无法再削减时不停下, 继续完成, 在 issue 的 `## Comments` 写明超出量和原因, 由提交审核判断能否删减. 无关的冗余代码删除鼓励, 但不抵扣净增, 在交付说明中单独列出, 能分开时单独提交.

## Work Dependencies

前置工作尚未完成, 或其结果尚未取得必要确认时, 不执行依赖该结果的步骤; 是否依赖及何时需要结果, 由拥有该步骤的工作流判断. 不依赖该结果的工作可以并行推进, 但不得把临时假设或进行中的审核当作已确认结果.

## Important Decisions

未解决的替代方案可能重大影响以下事项时, 作出选择前先使用 `grilling` Skill 交用户决定:

- 产品语义或用户可见行为.
- 数据来源或格式.
- 安装或环境行为.
- 安全, 隐私或持久状态.
- 公开 Interface 或架构边界.
- 长期维护责任或难以逆转的结果.

有合理理由怀疑其重要性时就交用户决定. 只有保留已确认约束, 容易撤销且不建立持久承诺的例行细节可以自主决定.

用户的请求与目标或已确认约束冲突, 或有明显风险时, 先指出, 再用 `grilling` Skill 讨论.

Subagent 把未解决的重要决定及其分析返回 Main Agent, 不自行选择, 不直接询问用户. 独立 Reviewer 发现治理资料歧义或冲突时同样报告给 Main Agent. Main Agent 负责提交用户决定, 并协调各 Agent 的写入范围和交付.

Main Agent 照规则执行某一步很可能失败时 (如要一个 Reviewer 审查超出其能力的大范围), 不硬做: 先说明失败原因, 提出等效的变通方案及其成本, 用 `grilling` Skill 取得用户授权后再执行.

## Rule Conflicts

用户级规则 (如 `~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`) 与 ARW 规则冲突时, 以用户级规则为准. ARW 文档之间相互冲突时, 向用户说明冲突的确切内容并请求决定, 期间只推进不受该冲突影响的工作.

## Agent Writes

Subagent 只写 Main Agent 分配的范围, Git 写入只由与用户沟通的 Main Agent 执行. 写入任何文件或执行 Git 写入前, 读取 `docs/agents/agent-writes.md`. 独立 Reviewer 只写 Main Agent 指定的报告路径, 该写入由 Reviewer 角色规则授权, 不受此读取要求约束.

## Output Text

- 回复和仓库中的自然语言只使用 ASCII 标点. 中文字符与英文字母或数字相邻时, 在边界插入 ASCII 空格. 仓库文本的语言, 编码和格式见 `docs/agents/writing.md`.
- 只为持久的领域概念创建项目术语, 不为机制, 状态, 单个工单的简称或普通描述创建术语.
- 某项工作需要先等用户操作 (如等用户编辑或关闭文件) 才能进行时, 先告知用户并结束当前回复; 用户回复已就绪后才开始.
- 向用户汇报时区分有证据的事实, 推断和未确认事项, 不把推断说成事实.

## Workflow Triggers

行动前使用每个匹配的条目, 并遵循所指 Skill 或文档中的条件性交接规则. 到达触发点时才读取所指内容, 不在开工时预读后续步骤的规则. 上下文压缩后, 压缩前读过的触发内容视为未读: 再到触发点时重新读取, 即使摘要说已读或引用了其中片段.

- 更改已跟踪文件, 或构建, 修复, 修改, 完成仓库交付内容前: `implement` Skill (Entry 确认授权 issue).
- 安排或处理就绪审核 (Spec Readiness) 前: `spec-readiness` Skill.
- 更改行为, 测试或运行验证前 (含创建或语义修改测试案例后测量耗时): `validation` Skill; 以降低测试套件耗时为目标前: `test-performance-optimization` Skill; 用户要求清理低价值测试前: 读取 `.agents/skills/test-value-cleanup/SKILL.md`.
- 处理 issue, map, spec 或其工作流字段前, 以及报告 issue 完成前: `issue-tracking` Skill.
- 启动或控制独立 Reviewer 前: `reviewer-launch` Skill.
- 用户请求 Git 提交后, 在提交验证或提交前: `commit` Skill.
- 修改 Agent 指令或保存持久设计或治理的文档前: `rule-and-design-changes` Skill.
- 探索不熟悉的领域, 命名持久领域概念或决定架构边界前: `domain-modeling` Skill.
- 处理 ARW 命令和仓库发现时, 以及 `arw workflow init` 成功后: `arw-commands` Skill; Code Map 适用时: `code-maps` Skill.
- 开始多步任务时, 适合独立交付的工作默认交给 subagent (需要频繁与用户互动, 无法拆分或很小且交接成本明显更高的工作除外); 委派或创建 subagent 前, 读取 `docs/agents/subagent-allocation.md`.
- 创建或重命名文件或目录, 或编写仓库文本前, 读取 `docs/agents/writing.md`.
- 创建临时文件或目录前, 读取 `docs/agents/environment.md`.
- 接受或处理负责识别问题的 subagent 所提供的问题前, 读取 `docs/agents/subagent-findings.md`.

Code Map roots: (none)
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
None.
<!-- arw:repository-owned:end -->

# 定义 Reviewer 与正式关卡在 Engine 下的执行协议

Type: grilling
Status: resolved
Blocked by: issue:0099:05, issue:0099:07, issue:0099:08

##### Question

保留完整上下文的独立高智能 Reviewer 时, Engine 怎样把审核拆成确定性检查, Jev 类模型预检, 逐单元覆盖 (例如逐方法逐标准询问), 高智能判断, 输出格式与语义检查以及修复循环? 何时冻结候选, 何时结果失效, 怎样保证每项标准都被检查, 且不因提速而丢失上下文?

## Answer

11-13 worker 分析, 交 Main Agent 综合. 依据: [确定 Jev 类模型在流程中的职责边界](05-decide-jev-role-boundary.md) (判断模型不担任正式 Reviewer, 预检与输出检查不替代正式审核结论), [定义 Engine 驱动流程的运行合同](07-define-engine-runtime-contract.md) (步骤四类, 会话一视同仁, Git 写入只由 Engine 执行), [定义分流判断的复核与回退合同](08-define-routing-review-and-rollback.md) (正式关卡不是判断; D24 后判断模型可选, 只做提示, 没有复核, 屏障与回退), [定义 Jev 类模型的评测与转正条件](11-define-evaluation-and-graduation.md), [确定现有 ARW 合同在 1.0 中的继承范围](13-decide-legacy-contracts.md) (门禁语义原样保留, 就绪记录模式, "抽查一两处" 与 haiku 回退归本 issue), 以及 ARW HEAD `005d4a3` 的长期规格 `docs/specs/agent-repository-workflow/spec.md` (Reviewer workflow, Spec Readiness, Commit Audit 节), `docs/agents/reviewer.md`, 三个 Reviewer Role, `reviewer-launch`, `spec-readiness`, `code-review`, `commit` Skill 和 `lib/spec-readiness/spec-readiness.mjs` (`SCHEMA_VERSION = 7`). 10-25 讨论中用户关于 "逐方法喂给高智能 Agent" 与 "每轴保留一个拥有完整上下文的高智能 Agent, Engine 分批提供检查项并核对覆盖" 的表述, 已被用户 11-13 的答复取代: Reviewer 与其他 Agent 没有区别, 不特别对待, 不做覆盖清单, 逐单元送入或每轮抽查 (D15, 见 Comments). 用户 11-13 定下 1.0 的四项主要目标 (见 Comments): 减少同一流程中高智能模型的请求数, 缩短整体墙钟, 降低上下文中规则与流程所占比例, 降低规则与流程的误判率, 阈值都由实验确定; 本答案按这四项衡量各做法, 不写固定阈值. 原标为 "待用户确认" 的两处都已由用户 11-13 答复 (审核内判断 D16, 覆盖做法 D15, 见 Comments).

### Gates and sessions

- 正式关卡沿用 13 保留的语义: Spec Readiness (一个 `spec-readiness-reviewer`), 实施提交的 Commit Audit (Gate 1, 2 由 `requirements-reviewer`, Gate 3 由 `code-standards-reviewer`, 两者并行), 非提交的 Code Review 比较, 以及改动审核系统或长期合同的非实施提交 (一个 `requirements-reviewer`, 最多一轮). 关卡结论 (问题列表或 `No problems.`, `satisfied` 或 `gap`) 只来自正式 Reviewer.
- 正式关卡不是判断: Engine 不对关卡结论做复核或推翻; 判断模型不担任 Reviewer, 不产生, 核对或推翻关卡结论.
- Reviewer 是 graph 中的普通 Agent 步骤, 与其他 Agent 没有区别 (用户 11-13, D15): 启动, 恢复, 模型选择, 会话沿用, 输出核对与 Git 写入检测都按 07 对所有 Agent 工作的同一规则. 审核本来就是由别人来看, 所以一个 Reviewer 角色对一组 issue 的审核 (角色加排序后的 issue 集合, 与现行 Communication and sessions 节相同) 是与被审工作分开的一项工作, 有自己的会话: 不带作者对话, 关闭 memories, 不建子 Agent; 首轮新建, 各轮复审回到这个会话. 本步指令和权限由节点给出 (只读, 只写报告). Reviewer 与其他 Agent 一样可以经 Engine 问用户, 答复后回到同一步继续 (22, Main Agent 11-14 定), 取代现行 `docs/agents/reviewer.md` 中 Reviewer 不与用户沟通的规定; Reviewer 仍不向作者会话索取信息.
- 审核中的其他工作都是 07 的四类步骤: 确定性检查与冻结是 Engine 程序; 预检, 输出检查和修复后的核对题是判断; 处置发现与修复是产出候选的那项工作的 Agent 步骤, 回到它的原会话 (实施是实施 issue 的 worker 会话, Spec Readiness 是起草 subject 的会话), 下文称原 worker 会话; 需要用户决定的发现是等待用户.

### Steps of a gate round

流程定义中每个关卡按以下顺序执行; 某步得到问题时回到修复, 不跳步.

1. 确定性检查 (Engine 程序): 现有 `prepare` 的机械预检与 `warning:` 行 (含 Spec Readiness 自检中可机械判定的部分, Commit Audit 的体积摘要与 Validation 摘要核对), `commit-audit verify --non-implementation` 的检查, `arw text check` 和仓库配置的快速检查. Reviewer Role 中可机械判定的检查项 (体积预算是否超出, 格式, 记录章节是否齐全等) 迁移时移到本步作为确定性检查, 由 Engine 程序执行, Role 只保留需要判断的部分 (批判审读四.2); 21 按节估计三个 Role 合计约 1000 字符, 逐项清单在迁移时列出. 有问题时交 worker 修复后重做, 不启动 Reviewer. 现行 "warning 不是关卡, 但要先处理再启动 Reviewer" 由此成为流程分支. 耗时长的测试照现行可以与审核并行, 未完成的检查不提供通过事实, 失败进入修复循环. 记录类事实由 Engine 生成并写入, 不只是核对 (墙钟研究 11-14, 任务 v1-walltime: 46 个已交付 issue 的 34 个额外审核轮次中有 6 轮由完成记录的体积或实测量, 验证结果, `Status` 与验收勾选触发, 约占活动时间的 3.7%, 都能在首轮前机械消除): Commit Audit 每轮第 1 步由 Engine 把 `prepare` 实测的代码, 测试, 文档量, 各验证命令已有的结果, 授权 issue 的 `Status` 与验收勾选写进完成记录, 其中 `Status` 按流程结果, 验收勾选取自 worker 实施步骤输出 schema 中逐条验收标准的必填字段 (语义判断由 Agent 步骤作答, D24, 见 07), worker 只写说明性 Comments. 每轮重做第 1 步时重新生成, 修复改变体积或结果后记录随之更新.
2. 提示 (判断): 预检与输出检查, 用法见 Judgments in the review loop 节.
3. 冻结 (Engine 程序): 固定本轮输入. Spec Readiness 是 subject, Input 与规则副本的快照 (Spec Readiness Reviewer 只读检索仓库的例外保留, 但检索的是本轮视图的树 (`git grep <模式> <树>`), 不是工作树, 以免读到其他实例的未提交改动, 见 [定义并行流程的读取与写入隔离](10-define-parallel-flow-isolation.md)); Commit Audit 由 Engine 暂存后以 `git write-tree` 取得 `tree`, 连同 `base`; 非提交 Code Review 是不可变比较. 冻结时第 1 步写入的记录同时固定: 授权 issue 的 `Status`, What to build 与 Acceptance criteria 两段 (含验收勾选) 冻结后再改即视为新一轮 (现行 `arw commit-audit verify` 已机械拦截), 所以不再出现审核通过后才补状态或勾选而重审; 冻结时尚未完成的验证结果 (如与审核并行的长测试) 与 Comments 在第 7 步写入, 属记录章节差异, 不使本轮失效 (见 Freezing and invalidation 节).
4. 正式审核 (Agent 步骤): 首轮新建 Reviewer 会话, 复审回到原 Reviewer 会话, 交付审核包 (见 Review packet 节), 内含相邻版本差异, 前轮报告与处置台账 (现行 Re-review 节不变). 输出绑定报告 (格式不变). 报告与其他 Agent 步骤的输出一样只经通用检查: Engine 按输出 schema 核对格式 (07), 以及 graph 为该步配置的判断模型输出检查 (首版不为 Reviewer 报告设题); 不另设覆盖核对或抽查 (D15). 同一关卡有两个并行的轴时 (Commit Audit 的两个 Reviewer), 先返回报告且有发现的一轴, Engine 立即开该轴的处置步骤 (第 5 步), 不等另一轴; 另一轴继续审它的冻结输入, 返回后同样按此处理.
5. 处置 (原 worker 会话的一个 Agent 步骤): 见 Dispositions 节. 判为 "无效" 的发现连同证据带回原 Reviewer 会话, 在下一轮复审中核对. 处置与随后的修复写工作区, 不改本轮冻结的输入, 所以与另一轴的审核可以重叠 (见 Freezing and invalidation 节); 同一会话一次只执行一个回合 (07 Coexisting instances 节), 两轴的处置按报告返回先后串行, 后返回的一轴的发现排在前一个处置回合之后. 下一轮 (第 6 步之后回到第 1 步) 在两轴都已返回且各自的处置与修复完成后才开始, 轮次计数不变, 一个关卡仍是一轮一轮地数; 提早开处置只缩短另一轴审核与处置的重叠等待 (墙钟研究估计占活动时间的 0.8%, 悲观 0, 乐观 1.6%, 上限为两轴结束时间差).
6. 修复 (原 worker 会话) 后做修复核对题 (提示类, 只在配了判断模型且已启用时), 再回到第 1 步开下一轮. 轮次规则 (第 3 轮起只为行为缺陷开修复轮, 措辞, 重复和文档去重类问题记 "记录不修" 后不再修; 实施开始后只涉及 issue subject 措辞, 重复或一致性的问题不受轮次限制, 任何轮次都可记 "记录不修" 且不改 subject; 台账三类处置, 冲突裁决) 由 Engine 按轮次计数和处置输出机械执行; "是否行为缺陷" 仍由处置步骤的 Agent 判断, 拿不准按行为缺陷. 只为核对判为无效的发现而开的复审轮 (见 Dispositions 节) 同样计入轮次, 使循环有界, 规则也最简单 (Main Agent 11-14 定).
7. 收尾 (Engine 程序): Spec Readiness 依次 `generate`, `promote`, `verify`, 生成路径由 Engine 直接传给提升步骤, 现行 "Main Agent 只提升生成字节" 不再需要; Commit Audit 机械核对最终暂存树相对受审 `tree` 只有记录章节差异, 再运行 `verify` 与 `verify --subject-only` 后提交.

Reviewer 等待: 现行 "等到 30 分钟向用户报告并询问, 不自行停止" 是 07 超时规则 (所有 Agent 步骤到预算先提醒, 再超出一段先问用户, 不中断; D22) 的特例, 只是 Reviewer 的预算默认取 30 分钟; 中断 Reviewer 会丢弃整轮审核, 所以更要先问.

### Review packet

审核包是 Engine 在冻结时为每个 Reviewer 回合组装的输入集合 (批判审读三.5; E2 估算它是 Reviewer 请求数下降的主要来源, 收益由 E4 或原型实测), 写在当轮实例临时工作区 (见 10), 随步骤消息以路径交付:

- 相邻 diff: 本轮冻结输入相对上一轮冻结输入的差异; 首轮为完整候选相对基线的差异. 相邻 diff 为空时本轴不重跑 (与下文轴结果复用一致).
- 前轮发现和处置台账: 上一轮 Reviewer 报告, 每条发现的处置 (修复, 判为无效及证据, 台账三类), 以及累计台账.
- 确定性检查结果: 第 1 步各项检查的通过与警告摘要, Reviewer 不必重复核对已由程序判定的项; 加上第 1 步 `prepare` 实测的代码, 测试, 文档量 (Commit Audit), 它们也是 Engine 写入完成记录的同一份数据.
- 改动文件列表: 本轮冻结候选涉及的文件路径及增删行数.

Reviewer Role 文档与规则副本不以路径交付, 由 Engine 内联注入步骤消息: 首轮在会话的首条消息中给出全文, 复审回到同一会话时规则副本相对上轮有变化才只注入变化部分, Role 字节变化同样处理 (Spec Readiness 实施开始前 Role 变化使记录失效, 见 Freezing and invalidation 节); 不再让 Reviewer 逐个读取这些文件. 依据: 墙钟研究 11-14 (任务 v1-walltime) 在现行 Codex 侧 Reviewer 回合 (`gpt-6-luna`, `xhigh`) 中看到只读规则副本的请求占回合时间的 11.3%, 每回合定位阶段占 17%, 导航请求的中位延迟 6.3 秒; 按这三项折算, 审核包加内联注入可省 Reviewer 时间的 8% 到 20%, 中值 13%. 验收量: 原型 (D25) 中同一类 Reviewer 回合的时长相对现行至少降 10%, 低于 10% 说明这一项没有达到预期, 如实报告并交用户决定, 不自行改验收量. 内联注入的是 Reviewer 本来就要读的全部 Role 与规则, 没有删减.

审核包只是定位的辅助, 不缩小审核范围: Reviewer 仍可读完整冻结候选, 仍按 Role 做完整检查 (见 Coverage 节), 不因提速而丢失上下文.

### Coverage

按用户 11-13 的答复 (D15), Reviewer 不另设覆盖机制, 沿用现行 "单 Agent 完成全部检查": 每个 Reviewer 在自己的会话中看完整冻结候选, 按 Role 完成全部检查, 不按单元拆成多个会话, 不分批送入, 不写覆盖清单, Engine 不核对覆盖. 这样上下文不被拆散, 每轮只有一个审核回合 (运行层错误与输出不符 schema 的重答除外). 审核质量 (含漏检) 由 Reviewer benchmark 的盲评分与真实缺陷检出跟踪 (11), 不在每轮流程中检查; 依据是 ARW `.scratch` 中 13 次 Main Agent 每轮抽查都没有发现漏检.

### Freezing and invalidation

- 冻结在每轮第 3 步. 冻结前的步骤可以改候选, 冻结后本轮输入不变; worker 可以在审核进行中继续修复已核实的问题 (写工作区, 不改冻结的 `tree` 与快照), 修复进入下一轮.
- 结果失效一律由 Engine 程序判断, 不再由会话判断 "改动是否相关":
  - 一轮结果只属于其冻结输入. Reviewer 返回 `incomplete`, 运行层错误, 或输出按 07 重答后仍不符 schema, 都使该轮作废.
  - 轴结果复用: Engine 按每个轴的冻结输入集合比较 (Code Standards: 去掉记录章节后的候选与规则副本; 要求符合审核: 再加治理要求与授权 issue 的 subject). 集合有任何变化即该轴增量复审, 不变则复用. 现行 "只改治理要求时保留 Standards" 由此机械得出; 现行由 Main Agent 判断依赖的做法取消, 代价是偶尔多跑一次本可复用的轴. 用判断放宽复用首版不做, 见 Judgments in the review loop 节的范围类.
  - Spec Readiness 记录: subject 变化 (验收勾选的规范化除外) 即失效; 实施开始前 Input 或 Role 字节变化也失效 (Role 身份含从 Role 移出的机械检查项, 见 Readiness record and model settings 节), 开始后只核对 subject. "实施是否已开始" 改由 Engine 按实例状态 (本 issue 的实施步骤是否已执行) 判定, 不再从分支与工作树推断.
  - Commit Audit: 最终暂存树相对受审 `tree` 只有记录章节差异时结果有效, 否则重开一轮 (现行 `verify` 已机械检查).
  - 流程定义或 Engine 升级不使已完成的轮次失效; 进行中的轮次按 07 绑定启动时的版本完成.

### Dispositions

- 现行 "Main Agent 每轮自选一两处抽查" 取消, 不由程序选单元代替 (用户 11-13, D15): 会话一视同仁后没有独立于流程的 Main Agent, 而 Reviewer 的输出与其他 Agent 步骤一样只经通用检查.
- 处置是原 worker 会话的一个 Agent 步骤, 不另开会话: 逐条核对报告中的问题 (沿用 `docs/agents/subagent-findings.md` 的核对与按来源分流), 给出每条的处置 (修复, 按质疑规则判为无效并附证据, 或台账三类之一). 判为无效的发现不由作者一方定论 (D22): 处置结果和证据带回原 Reviewer 会话, 下一轮复审时 Reviewer 逐条核对; Reviewer 接受则撤销, Reviewer 仍坚持则转为等待用户. 只剩判为无效的发现时也开下一轮复审, 只为核对这些发现; 该轮计入轮次 (见 Steps of a gate round 节第 6 步). 由原会话处置是因为它已有候选的上下文与提示缓存, 不增加高智能会话与回合. 代价: 处置者是作者一方, 现行由非作者的 Main Agent 核对发现.
- 需要用户决定的发现转为等待用户: 质疑有效性且 Reviewer 在复审中仍坚持的 (上一条), 以及 `subagent-findings.md` 中影响不足以重跑关卡等情形. 任何 Agent (Reviewer 或 worker) 提议修改 spec 时, 现行 "Main Agent 与一个独立 subagent 共同决定" 改为处置步骤与一个独立会话的 Agent 步骤共同决定 (一般规则见 07 Agent sessions 节), 两者不一致时等待用户.

### Judgments in the review loop

审核循环中的高智能请求和墙钟主要来自正式 Reviewer 每轮的思考与工具调用, 其次是处置与修复, 所以判断模型要对四项目标有贡献, 只能减少审核轮数或缩小复审. 判断模型可选, 配了只做提示 (D24, 见 08); 未配置时下面的提示一律不出, 关卡照常. 判断在审核中只有提示类一种用法, 不产生关卡结论.

提示类: 结论只决定是否先把一个可能的问题交给 worker, 不改变关卡的输入范围或结论. 包括冻结前的预检 (Engine 从候选机械切出的每个单元 (diff hunk, What to build 条目, 验收标准) x Role 中有明确检查项的条目, 一题一个 `noul`; 单元只用于出题, 不交给 Reviewer), 输出检查 (仅 Commit Audit, 每条验收标准一题 "交付说明与 diff 是否覆盖"), 以及修复后的核对题 "这次修复是否解决了发现 X". 收益: 在 Reviewer 之前修掉问题, 或在修复不完整时省掉一轮复审; 一轮复审的成本是 Reviewer 的全部请求与等待时间, 加一次处置.

- 阈值以上的 "有问题", "未覆盖" 或 "未解决": 交 worker 核实后修复或判为无效. 写入由 worker 核实后的结论决定.
- 阈值以下, 判断模型未配置, 该类提示未按 11 启用或已停用: 不提示, 也不同步交高智能 Agent, 因为正式 Reviewer 本来就检查同一项, 同步作答只会增加请求与等待 (用户 11-13 确认, D16).
- 不做盲答复核: 正结论由 worker 的核实校对, 负结论由之后正式 Reviewer 在同一单元同一检查项上的报告校对, 不额外调用高智能 Agent. 提示类的启用与停用按 11: 离线评测过门槛才启用, 线上记被 worker 判为无效的比例, 超门槛即停用 (D16, D24).
- "已解决" 不替代 Reviewer 对发现 X 的判断, Reviewer 仍在复审中核对 X, 守住 05 的边界.

范围类首版不启用 (D16, D24): 范围类指结论决定正式关卡审什么的判断, 例如 "这次修复是否只碰了与发现相关的单元", 据此把复审范围限定到这些单元, 或判定另一个轴虽有输入变化但不受影响而复用其结果; 答错会少审一部分改动. 它改变关卡的输入范围, 不是提示, 而 D24 定了判断模型配了也只做提示; 原 D16 为它预留的 "放宽方向同步交高智能 Agent" 接口与 "08 例外" 做法都依附 08 已删的同步作答与异步复核, 一并删去. 首版复审范围由 Reviewer 按现行 Re-review 自行追踪, 审核包的相邻 diff 帮助定位 (见 Review packet 节). 以后实测 (15 的历史统计是第 2 轮起的非记录类发现有 13 到 20% 落在上轮修复改动之外, 机械限定会漏掉它们; 还需估算可省的复审请求与时间) 显示值得缩小复审时, 另开 issue 设计不靠判断模型直接改变关卡输入的做法.

与 08 "正式关卡不是判断" 的关系: 提示类在关卡之外, 只改变 worker 先看什么, 不触及关卡; 关卡结论只来自正式 Reviewer.

计量: Engine 在步骤记录中按会话与回合记下高智能请求数 (每次模型请求, 含工具调用之间的请求) 与 token, 墙钟照 07 记每步起止, 另记每个 Agent 步骤的交接开销 (交接延迟与额外请求数, 定义与预算见 07 Flow state and next action 节); 这些记录供 11 的对照与上述实测使用.

### Readiness record and model settings

- 就绪记录升到模式版本 8, 字段与版本 7 相同, 三处语义变化: `request.filePath` 指向 Engine 提供的实例临时工作区 (不再含平台会话 ID); 记录只由 Engine 在 Reviewer 返回 `No problems.` 且输出通过通用检查后生成并提升; `reviewerRole` 的 `sha256` 覆盖 Role 文档加 Spec Readiness 关卡第 1 步确定性检查所在的 graph 子流程文件 (`filePath` 与 `id` 仍指 Role 文档), 因为可机械判定的检查项移出 Role 后, 只改这些检查同样改变审核标准, 不计入就会让就绪记录在审核标准变化后仍然有效. 版本号变化使 0.x 的版本 7 记录不再授权 (13 要求升级时未完成的实施 issue 重跑 Spec Readiness), 0.x 运行时也不接受版本 8 记录.
- 删除 haiku 回退规则: 现行 `reviewer-launch` 中 "未选择 `anthropic` 的 Reviewer 设置在 Claude Code 中默认用 `haiku` 和 `high`" 取决于由哪个 harness 中的 Main Agent 启动审核. 1.0 由 Engine 启动审核, Reviewer 工作的模型与其他 Agent 工作一样按 07 的 Model choice 节在工作开始时选定, 之后各轮复审不换; Engine 按模型选 harness, 不按调用方改模型. 判断模型的配置在另一节 (16), 不能被选作 Agent 模型.

### Scenarios

1. 预检拦下问题 (配了判断模型且预检已启用): Code Standards 预检对 hunk H 的 "错误处理有对应的现实失败场景" 答 "不满足" (高于阈值); worker 核实后删掉多余的 `try`/`catch`; 冻结, 两个 Reviewer 都 `No problems.`, 提交. 省掉的是一轮复审的请求与等待; 若 worker 判为无效, 只多一次核实.
2. 多轮审核沿用会话: Commit Audit 第 1 轮 `requirements-reviewer` 报出 2 个问题; 处置与修复都在实施该 issue 的原 worker 会话中进行, 第 2 轮复审回到原 `requirements-reviewer` 会话, 两边都不换模型, 复用各自的提示缓存; Engine 的步骤记录显示每项工作自始至终只有一个会话身份.
3. Reviewer 输出格式不符: Reviewer 的报告缺少输出 schema 要求的字段; Engine 按 07 在同一会话要求重答, 重答合格后进入处置; 两次重答仍不合格时该轮作废, 实例停在可恢复状态.
4. 修复不完整 (配了判断模型且修复核对已启用): 修复后核对题对发现 X 答 "未解决" (高于阈值); worker 回到 X 补修, 再冻结下一轮, 省掉一轮注定不过的复审. 答 "已解决" 但实际未解决时, Reviewer 在复审中照常报出 X, 成本与不用判断时相同.
5. 实施开始后 spec Input 变化: Engine 由实例状态知道实施已开始, 只核对 subject, 就绪记录仍有效; 设计变化由提交审核的要求符合审核核对.
6. 一轴先返回: Commit Audit 的 `code-standards-reviewer` 先返回 2 个问题, `requirements-reviewer` 仍在审; Engine 立即在原 worker 会话开处置步骤, worker 核实后开始修复 (写工作区, 不改冻结的 `tree`); `requirements-reviewer` 随后返回 `No problems.`, 本轮结束; 下一轮冻结含修复, 两轴因冻结输入变化都增量复审. 若 `requirements-reviewer` 也有发现, 它的处置排在前一个处置回合之后, 同一会话不并行两个回合.

### Interfaces

- 05: 判断模型只做提示类判断 (范围类首版不启用), 不产生关卡结论.
- 07: 审核步骤都是四类步骤; Reviewer 是普通 Agent 步骤, 模型选择, 会话沿用 (复审回到原 Reviewer 会话, 处置与修复回到原 worker 会话) 与输出核对都按 07; Reviewer 步骤的超时处理例外如上; 步骤记录增加高智能请求数, token 与交接开销; Reviewer 的 Role 与规则副本内联注入 (Review packet 节), 属 07 上下文传递由 Engine 组装消息的同一规则; Reviewer 等待由 Engine 完成, Agent 不轮询.
- 08: 判断只做提示, 没有复核, 屏障与回退 (D24); 提示由 worker 与 Reviewer 校对 (用户 11-13 确认, D16).
- 11: 提示类的启用与停用依据如上; 四项目标的对照数据来自 Engine 的计量 (含上下文中规则与流程的占比, 判断的误判率).
- 13: 就绪记录版本 8, haiku 回退删除, "单 Agent 完成全部检查" 原样保留 (不加覆盖清单), "Main Agent 每轮抽查一两处" 取消 (D15).
- 规则转为 Engine 工作依据 (用户 11-13: 由高智能模型按 ARW 提供的 Skill 把规则转成机械程序与判断模型调用, 产物基本是一张 graph): 关卡的步骤顺序, 预检单元的切分, 轮次与失效规则是 graph 中的程序节点与转移; 预检题由转换从 Role 的检查项生成, 是提示类的判断节点, 范围类首版不设节点; Reviewer 是普通 Agent 节点, 与其他 Agent 节点的区别只在节点数据 (所属工作, 默认模型档位, 本步指令, 只读权限), 其中产生关卡结论的节点标为正式关卡; Reviewer Role 与 `docs/agents/reviewer.md` 中需要判断的部分不转换, 作为文档交给 Reviewer; Role 里可机械判定的检查项移成第 1 步的确定性检查 (程序节点).
- 14: 验收场景至少包括上面 6 个情景, 以及就绪记录版本 7 在 1.0 中不授权; 墙钟验收口径见 14 的 Comments.

## Comments

11-13: 用户对判断模型 POC 的答复改了 1.0 的目标. 原话 (节选): "判断模型要解决的问题, 主要是减少高智能模型的调用次数, 减少的原因是规则判断大部分用机械程序和判断模型替代. ... 机械程序是用高智能模型写的, 高智能模型会根据 ARW 之后提供的 skill, 把规则转为机械程序和判断模型调用, 然后 engine 就把这个转换后的数据 (基本上是一个 graph) 作为自己工作的依据." 同日用户补充: 整体流程墙钟的减少也是主要目标, 只省费用不省时间会使判断模型的价值大打折扣; 并且审核本身也要加速 (Reviewer 上下文里的规则与流程同样交给机械程序和判断模型, 不只影响 main agent); 判断模型有误判率, 要用本地模型与公开的高质量模型在同一套题上测试, 以此判断本地模型的可行性. 因此目标共四项: 高智能请求数, 整体墙钟, 上下文中规则与流程占比, 规则与流程误判率; 阈值都不预先定, 先做实验再定. 本答案因此按这四项衡量审核循环中的判断, 不再以 "缩短关键路径 30%" 为门槛.

11-13: 待用户确认的两处 (Main Agent 交用户决定, 答复后改写本答案相应部分; 两处都已答复, 见后面 D16 与 D15 两条):

- 覆盖做法. 选项: 每个单元交一个独立会话 (上下文被拆散, 请求成倍增加, 不建议); 同一会话按批次多回合送入单元并逐 "单元 x 检查项" 作答 (接近 10-25 用户 "逐方法喂给高智能 Agent" 的设想, 漏检最少, 但请求与墙钟随单元数增长); 同一回合写覆盖清单, Engine 核对后只为缺项追加回合 (本答案采用).
- 审核内判断与 08 的关系. 提示类在阈值以下不同步交高智能 Agent, 并以 worker 核实和 Reviewer 报告代替盲答异步复核 (本答案采用); 范围类先不启用, 按实测在 "同步交高智能" 与 "08 例外" 之间选择.

离线评估 (见 [本地 Jev 类候选的可行性小实验](15-task-local-candidate-feasibility.md) 的 Comments) 中, 当前候选在规则级预检上选不出可用阈值, 输出检查在测试集阈值以上覆盖 0.25, 精度 1.00; 所以首版提示类大概率只有输出检查能越过离线评测, 预检停在影子阶段, 按本答案不产生额外请求.

11-13: D16 答复 (用户, 状态页 11-13 07:04): "按你推荐的来". 即审核内判断的两处都按本答案: 提示类在阈值以下不提示, 也不同步交高智能 Agent, 以 worker 核实和 Reviewer 报告代替盲答异步复核; 范围类首版不启用, 接口按第二种做法设计, 是否启用或改用第三种等 `v1-pocreq` 的 E2, E3, E4 实测. 相应 "待用户确认" 已改为定稿. 覆盖做法 (D15) 仍待用户确认. 另按用户 11-13 的四项目标 (高智能请求数, 整体墙钟, 上下文中规则与流程占比, 规则与流程误判率) 改写了 "两项目标" 的说法, 设计不变.

11-13: D15 答复. 用户原话: "说实话我已经忘了之前和 codex 沟通时, 是如何设计 reviewer 的工作流程了. 我现在的看法是, reviewer 和其他 agent 没有任何区别, 不需要特别对待. 你基于这个决定, 再问我问题." Main Agent 据此改问剩下的一处, 用户在状态页 (11-13 07:22) 选 A: 取消 Main Agent 每轮抽查, 不改为所有 Agent 步骤的通用抽查; Reviewer 输出只经通用检查 (Engine 核对格式, 判断模型输出检查), 审核质量靠 Reviewer benchmark 跟踪. 依据是 ARW `.scratch` 中 13 次 Main Agent 抽查都没有发现漏检. 同日用户接着说: "做各个工作的 agent 的唯一区别, 就是先要判断某个工作适合什么模型, 然后就交给它一直做, 中途尽量不换模型, 充分利用模型的缓存." 据此本答案改为: Reviewer 是 graph 中的普通 Agent 步骤, 仍是与被审工作分开的会话 (审核本来就是别人来看); 删去 Coverage 节原有的审核单元清单, 覆盖清单与缺项追加回合, 删去由 Engine 随机选单元并由 worker 复查的抽查 (原 Spot checks and dispositions 节只保留处置), 每轮步骤由 8 步减为 7 步, 原情景 2, 3 (漏掉单元, 抽查发现漏检) 换成多轮审核沿用会话与 Reviewer 输出格式不符两个情景; 写明复审回到原 Reviewer 会话, 处置与修复回到原 worker 会话, 模型选择按 07 的 Model choice 节 (其中两处取舍待用户确认, 见 07 的 Comments). 原 "覆盖做法" 的三个选项都不再采用. 预检仍按单元出题, 但单元只用于出题, 不交给 Reviewer, 也不核对覆盖.

11-14 (D24 答复与两处遗留, 任务 v1-d24ans): 用户 11-13 选 A, 判断模型可选, 配了只做提示, 08 的复核, 屏障与回退随之删除. 本答案相应改写: 冻结与提交不再是 08 的屏障, 删去 "判断被推翻" 的失效条; 提示类在判断模型未配置或未按 11 启用时一律不出, 启用与停用改按 11 的 "离线评测过门槛就启用, 线上记无效率, 超门槛停用"; 范围类首版不启用, 原 D16 预留的 "放宽方向同步交高智能 Agent" 接口与 "08 例外" 做法依附已删的机制, 一并删去, 以后要缩小复审另开 issue (地图 Not yet specified 的对应条随之移出). 另两处: (1) 只为核对判为无效的发现而开的复审轮是否计入轮次 (v1-critfix 留下的待决点), Main Agent 定为计入, 循环有界, 规则简单, 写进第 6 步与 Dispositions 节; (2) 第 6 步的轮次规则原样照搬了 0.x 的 "第 3 轮起记录不修", 0.x 已在 ARW 提交 `b42278c` (effort 0121, G05) 修好: 实施开始后只涉及 issue subject 措辞, 重复或一致性的问题任何轮次都可记 "记录不修" 且不改 subject, 第 6 步按修好后的现行 `.agents/skills/commit/fix-rounds.md` 改写.

11-14 (任务 v1-d26ans, 承接 v1-critfix 的遗留): Role 拆出可机械判定的检查项后, 就绪记录的 Role 身份要把这些检查计入, 否则只改检查项不会使记录失效; 版本 8 的语义变化由两处改为三处 (`reviewerRole.sha256` 覆盖 Role 文档加关卡第 1 步检查所在的 graph 子流程文件), Freezing and invalidation 节相应注明. 另按 22 (Main Agent 定): Reviewer 可以经 Engine 问用户, 取代 `reviewer.md` 的禁止.

11-14 (任务 v1-wtfix, 依据墙钟研究 v1-walltime, D23): 三处写入, 数字都来自对 46 个已交付 issue 的回放. (1) 第 1, 3 步: 记录类事实 (实测量, 验证结果, `Status`, 验收勾选) 由 Engine 在冻结前生成并写入, worker 只写说明性 Comments; 冻结固定的是 `Status`, What to build 与 Acceptance criteria 两段 (现行 `verify` 已拦截的范围), 长测试结果与 Comments 仍可在第 7 步作为记录章节差异写入, 与 Freezing and invalidation 节的 Commit Audit 条一致. 取舍: 研究建议写 "冻结后改这些字段即视为新一轮", 但验证结果与 Comments 本来就允许在冻结后写入而不重审, 全部冻结会让与审核并行的长测试结果无处落笔, 所以只冻结 `verify` 已拦的字段. 验收勾选由 worker 步骤输出 schema 的必填字段给出, Engine 只负责写入, 不判断标准是否满足. (2) Review packet 节: Role 与规则副本内联注入, 验收量为原型中 Reviewer 回合时长至少降 10%. (3) 第 4, 5 步: 先返回有发现的一轴立即开处置, 下一轮仍等两轴都返回且处置完成, 一个会话一次只执行一个回合. 新增情景 6; 交接开销的预算与 Agent 不轮询 Reviewer 写在 07, 墙钟验收口径写在 14.

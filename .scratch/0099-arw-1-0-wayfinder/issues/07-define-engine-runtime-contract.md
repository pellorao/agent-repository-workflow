# 定义 Engine 驱动流程的运行合同

Type: grilling
Status: resolved
Blocked by: issue:0099:01, issue:0099:03, issue:0099:04, issue:0099:17

##### Question

Engine 提供与用户对话的入口, 并按用户选择的 Main Agent 模型把用户的话交给对应的 harness (Codex 或 Claude Code), 可同时控制多个 harness: 这个入口长什么样, 怎样在多个 harness 之间路由并保持一次对话的连续性? Engine 怎样拥有流程状态并选择下一个动作, 怎样启动, 继续和恢复 Agent 会话, 传递上下文, 等待用户, 处理超时与失败? 一个流程中途触发另一个流程时按栈执行, Main Agent 启动的多个 worker 各自运行流程时并行执行, 两种情形下 Engine 怎样保证仓库单一写入者? 哪些操作必须可观察, 可恢复?

## Answer

11-11 worker 分析, 交 Main Agent 综合. 依据: [核对当前 ARW 的流程驱动方式与 Engine 已有能力](01-research-current-flow-driver.md) 列出的 7 项受影响合同, [核对 Engine 控制 Agent 会话的平台能力](03-research-engine-session-control.md) 的平台事实, ARW HEAD `9fb4b5d` 的长期规格 (`docs/specs/agent-repository-workflow/spec.md` 的 Background Agent control 节) 与 `lib/background-agent/` 的实现, 以及用户在 [确定 ARW 1.0 首版覆盖的工作流与跨平台组合](17-decide-workflow-coverage-and-platform-mix.md) 和 [确定本地判断模型服务的运行责任](18-decide-local-judge-server-ownership.md) 中的答复. 入口的具体形态 (终端界面, 本地网页, 复用 harness 的交互会话) 是方向性取舍, 另列 [确定 Engine 对话入口的形态](19-decide-conversation-entry-form.md); 下面的合同对三种形态都成立.

### Engine process and roles

- Engine 是每个用户一个的常驻进程, 由现有用户级后台管理进程扩展而来, 共用它的安装目录, 私有 SQLite 状态库, 两个 harness 的会话层 (Codex App Server 线程, 每回合一个 `claude -p` 进程, 同一 `NativeSessions` 接口), 容量与崩溃识别 (PID 加进程创建时间). 理由: 这些正是 Engine 驱动所需的会话控制, 已在两个 harness 上对等实现; 另起进程会复制状态库, 容量和恢复. 代价: Engine 故障会同时中断对话入口, 全部运行中的回合和判断调用; 流程状态按步持久化, 重启后可以恢复 (见下). 扩展要改写现行合同中 "管理进程不调用模型", "只监听本机回环地址", "后台 Agent 归属启动它的 Main 会话" 等条款, 见 11-12 的 Comments.
- 对话入口是 Engine 的客户端, 不持有流程状态, 可以断开再连接; 同时可以有多个入口连接 (例如两个浏览器). 监听分两类: 现有的本机回环控制通道照旧, 只给本机命令行用; 另加一个 HTTPS 入口供网页使用, 未配对的请求除配对接口外一律拒绝, 配对与设备凭据见 [确定 Engine 对话入口的形态](19-decide-conversation-entry-form.md). 远程入口要求 Engine 在用户登录时自动启动, 不能只在第一次本机请求时启动; 这是新增的安装行为, Windows 与 Linux 做法不同, 写进安装规格.
- 判断模型可选 (D24, 见 [确定本地判断模型服务的运行责任](18-decide-local-judge-server-ownership.md)): Engine 开工不依赖判断模型. 配置了判断模型时按 16 调用, 只做提示 (08); 未配置或不可用时照常工作, 不出提示, 也不为此打断用户. 首版只需配置一个端点 (可不配), 本机开启与释放判断模型推迟到有合格模型时 (20).
- 角色: 用户选定的 Main Agent 模型在其 harness 中作为一个由 Engine 驱动的 "对话会话", 负责与用户的自由对话和流程中分给它的高智能步骤 (理解需求, 起草 issue 等); worker 与 Reviewer 是 Engine 按流程启动的其他会话. Reviewer 发现的处置与修复回到产出候选的那项工作的会话 (见 Model choice and session continuity 节与 09). 现行 "Main Agent 是与用户沟通者" 的身份定义改由 Engine 加对话会话承担, 术语改写见 [确定现有 ARW 合同在 1.0 中的继承范围](13-decide-legacy-contracts.md).
- 会话一视同仁 (用户 11-12 答复, 见 11-13 的 Comments): Engine 对所有 Agent 会话按同一套规则处理, 不区分对话会话, worker 会话与 Reviewer 会话. 各 Agent 之间的唯一区别是按工作选定的模型 (用户 11-13, 见 Model choice and session continuity 节); 本步指令, 权限与写入范围按步骤由流程定义给出 (如只读步骤拒绝写入), Git 检测与失败处理对所有会话相同. 任何会话都不读规则推进流程. 流程中要靠语义判断的分支由 Engine 写成正在干活的 Agent 步骤输出 schema 的必填字段, 由该会话在本步作答; 没有 Agent 步骤之处走保守分支; 判断模型配了只做提示 (D24, 见 [定义分流判断的复核与回退合同](08-define-routing-review-and-rollback.md)).
- Git 写入只由 Engine 执行 (暂存, 提交, 恢复, 合并), 作为流程中的确定性步骤; Agent 会话不做 Git 写入. 这延续现行 "Git 写入只由与用户沟通的一方执行" 的意图: 1.0 中与用户沟通并负责流程的是 Engine. 保证方式是检测而不是阻止: 两个 harness 上的 Agent 会话 (对话会话也一样) 沿用用户自己的原生权限, ARW 给的写入范围只增不减 (现行 ADR 0033 的决定), 而且能运行 `node`, 测试命令的会话总能间接执行 Git, 所以 Engine 在每个 Agent 步骤后核对 `HEAD` 的符号引用与提交, 全部引用, 按内容比较的索引 (`git ls-files -s` 的摘要, 不比索引文件字节), `.git/config` 与 hooks 目录, 有变化即停在可恢复状态; 另对所有会话加一层不覆盖用户设置的窄范围拒绝 (用户 11-13 定): Claude Code 会话加 `--disallowedTools Edit(.git/**)`, Codex 会话把 `.git` 设为只读 (`workspace-write` 默认如此, 需要时显式写 `".git" = "read"`). 这一层是尽力而为, 不是保证: 原生 Windows 的 Claude Code 无沙箱, 拒绝规则挡不住 `node -e` 一类间接写入, 用户选 `danger-full-access` 时 Codex 也无保护, 所以每步后的检测仍是唯一保证. `.git` 只读时会话内的 `git add`, `git commit` 与会写索引的命令会失败, 与 "Git 写入只由 Engine" 一致. 检测的时机: 步骤结束时 Engine 先终止该会话的命令子进程, 再做上述核对. Claude Code 每回合一个进程, 终止整个进程树 (Linux 用进程组或 cgroup, Windows 用 Job Object). Codex 的多个线程共用一个常驻 app-server 进程, 没有可单独终止的进程树, 终止 app-server 会中断其他线程; 只读核实 (11-13, `v1-critfix`, 依据 03 的报告和本机 `codex-cli 0.167.0` 生成的 app-server 协议 schema, 没有运行任何回合) 的结论: 协议带 `--experimental` 才有 `thread/backgroundTerminals/list` (返回该线程每个后台终端的 `processId`, 命令, `osPid`), `terminate` (按 `processId`) 和 `clean`, 所以按线程列出并终止命令子进程多半可行; 但它们只在实验接口里 (公开的 app-server README 没有记载, 要按版本核对), 只覆盖 Codex 自己登记的后台终端, 命令自行脱离 (`setsid`, `nohup`, 守护化) 的进程不在其内. 因此 Codex 侧先用 `list` 加 `terminate`; 接口不可用时改为 "等该线程没有运行中的命令再核对"; 两者都不能确认没有残留时记为不确定. 这一条列为 Codex 侧已知风险: 核对之后才发生的写入只能由下一次使用 Git 状态前的比较发现. 无法终止的脱离进程记为不确定并转等待用户; 每个写入步骤开始前和每次暂存提交前, 再与上次通过核对的摘要比较一次, 所以检测保证的是至少在下次使用 Git 状态之前发现, 不是写入发生时发现. Engine 自己的 Git 命令加 `-c gc.autoDetach=false`, 以免制造不受控的后台写入. Engine 与各会话的只读 Git 调用设 `GIT_OPTIONAL_LOCKS=0`, 以免 `git status` 写回索引造成误报或与 Engine 争抢索引锁. 恢复点记在 Engine 自有引用下 (见 [定义分流判断的复核与回退合同](08-define-routing-review-and-rollback.md)), 会话执行 `git reset --hard` 也毁不掉它.
- 提交步骤要有授权来源: 用户在流程中的请求, 或用户配置的自动提交. Engine 提交时会执行仓库的 hooks; hook 改动了文件时按流程定义的分支处理. 合并冲突由 Engine 执行合并, 冲突文件交给 Agent 步骤编辑, 再由 Engine 暂存并完成合并.
- "ARW 不自主发起 Agent 编码工作" 改为: Engine 只在用户发起或批准的流程中启动 Agent 会话; 流程内的下一步由 Engine 按流程定义推进, 不再逐步请用户确认, 用户批准点仍是流程中的等待用户步骤.

### Flow state and next action

- 每个工作流 (规划, 实施, Spec Readiness, Code Review, 提交与 Commit Audit, Application/JIRA, 源码仓库维护等) 有一个流程定义: 随 Engine 发布的 graph 数据 (由规则转换而来, 见 [定义规则到 graph 的转换与 Engine 按 graph 执行](22-define-rule-to-graph-conversion.md)), 加 Engine 代码中的原语; 内容是一组具名步骤和步骤间的转移. 步骤只有四类: 确定性操作 (Engine 代码执行, 如 `prepare`, 测试命令, Git 写入), 判断 (可选的提示: 判断模型配置了且该类提示已启用时提一组 `choice` 或 `noul` 题, 结果只决定是否把一条提示交给 Agent 核实, 否则结果为不提示; 见 08), Agent 步骤 (给指定角色的会话一条只含本步指令的消息, 用输出 schema 约束结果), 等待用户.
- Agent 步骤宜粗不宜细 (批判审读一.4): Engine 每次把控制交回 Agent 至少多一个请求和约 8 秒步骤延迟 (E2 中三个小流程的 worker 请求反而增加了), 步骤切太细会吃掉节省. 只在 Engine 必须介入处切分: 冻结, 门禁, Git 写入, 等用户. 例如 "实施并修到测试通过" 是一个 Agent 步骤, Engine 在步骤结束后再做机械核对; 不把实施, 跑测试, 读结果, 修复各写成一步.
- 下一动作由流程定义, 当前状态和上一步结果唯一决定. Agent 与判断模型只能通过本步输出 schema 中列出的字段或选项影响分支, 不能跳步或加步; 流程定义没有覆盖的情况一律转为等待用户. 这取代现行 "按触发点读规则, 由 Main Agent 记住顺序", 规则正文的归类见 13, 逐份去向见地图 Not yet specified.
- 流程实例状态写在 Engine 的私有状态库 (新增表, 与现有 `agents`, `messages` 同库), 字段至少有: 实例 ID, 流程定义名与版本, 仓库根, 关联 Artifact (effort 与 issue 的 Canonical ID), 当前步骤, 实例状态 (`running`, `waiting-user`, `waiting-subflow`, `waiting-writer`, `stopped`, `done`, `cancelled`), 父实例 (栈), 每步起止时间, 结果摘要, 所用会话与回合身份. 每步结束时先持久化再执行下一步.
- 仓库中的 Artifact (issue, spec, 就绪与审计记录) 仍是交付结果的权威; Engine 状态只是执行进度的权威. 两者不一致时 (例如用户手工改了 issue `Status`), 以仓库为准, 实例停下并请用户确认.
- 实例绑定启动时的流程定义版本. Engine 升级时先停止接受新步骤, 等执行中的步骤结束; 网页客户端断线后自动重连; 停在等待状态的实例在新版本中找得到同名步骤时继续, 否则停下报告用户.

### Model choice and session continuity

用户 11-13: 各 Agent 的唯一区别是先判断工作适合什么模型, 然后交给它一直做, 中途尽量不换模型, 充分利用模型的缓存. "谁选, 按什么选" 与 "会话被压缩" 两处已由用户 11-13 答复 (D22, 见 Comments).

- 一项工作: graph 中共用一个工作键的一组 Agent 节点 (22 的 Agent 节点的会话策略), 例如一个 issue 的实施 (含各轮处置与修复), 一个 Reviewer 角色对一组 issue 的审核 (含各轮复审, 跨流程实例沿用, 见 09; 跨实例时工作区的用法见 10 的 Temporary directories 节: 会话的工作目录与只读视图按回合传入, 取当前实例的, 不固定在会话创建时的实例上; Codex 的 `turn/start` 有 `cwd` 参数, Claude Code 每回合一个进程, 都做得到), 起草一组 issue. 对话会话是一项持续的工作, 模型由用户选定 (见 Conversation entry and harness routing 节). 审核与被审工作是两项工作, 所以 Reviewer 与作者是不同会话.
- 何时选: 每项工作的第一个 Agent 步骤开始前选定模型与推理强度, 写进步骤记录; 之后整项工作沿用同一会话与同一模型, 包括各轮处置与修复 (回到原 worker 会话), 各轮复审 (回到原 Reviewer 会话) 和子流程中属于同一工作的步骤, 不因轮次, 步骤或子流程换会话或模型. 理由: 同一会话保留已取得的理解, 并复用模型的提示缓存, 后续回合的费用与首个输出的延迟都下降; 换模型或换会话都使缓存失效.
- 谁选, 按什么选 (D22, 用户同意): 分两段, Engine 选, 会话不自选. 第一段: 工作模型只给出本项工作的任务概要, 不选模型; 写任务概要的那一步 (graph 中本来就有的 Agent 步骤, 不多一次请求) 按 Engine 固定的 schema 同时输出一组参数 (难度, 所需推理强度, 速度要求等数值). 用户 D22(1) 的原意是由判断模型按概要输出参数; D24 后判断模型可选, 配了只做提示, 首版不配, 所以参数由写概要的一步输出, 以后有合格判断模型时它在选档上怎样提示, 到时按 11 的离线评测再定. 第二段: Engine 用机械映射表把参数对到具体模型和推理强度 (理由: 以后模型库可能很大很复杂, 不让模型去记; 模型库变化只改映射表). 映射表来自配置 (全局加仓库两级, 位置随 21 的 B); 配置为某个角色指定了模型时 (如现行三个 Reviewer 角色键) 以它为准; 用户在请求中指定模型时以用户为准. 参数缺失或超出节点允许的智力档范围时用节点默认档位. 选档不经复核, 也不在工作开始后改档: 工作开始后改模型要丢掉缓存并重做, 正违背 "中途尽量不换模型"; 选错的代价是费用 (档位过高) 或审核轮数 (档位过低, 由正式关卡拦住), 不越过用户授权或正式关卡. 待测项: 参数估计的准确度没测过, 需要一组校准题 (用历史任务, 已知实际用的模型, 推理强度和结果), 测完前映射表按保守的节点默认档位起步; 选档的正误按工作结果统计 (审核轮数, 正式 Reviewer 报出的问题数, 请求数与墙钟).
- 会话被压缩 (D22, 用户同意): harness 自动压缩上下文后仍在原会话以原模型继续, Engine 不主动新开会话, 也不借压缩换模型. 压缩使缓存失效, 但新开会话同样失效, 还要由 Engine 另写交接; 1.0 中规则与流程大多不在会话上下文中 (13, 21), 现有样本中 worker 与 Reviewer 会话没有发生过压缩 (15), 所以压缩应很少; 档位是否合适取决于工作本身, 与压缩无关.
- 换模型或换会话只在以下情形: 用户选择换模型 (例如额度耗尽或认证失败按 Failures 节转为 `stopped` 后, 用户决定改用其他模型; Engine 不自动换), 同一 harness 内在原会话改用新模型, 跨 harness 时新建会话并以 Engine 生成的交接消息开始, 与对话会话换模型相同; 原会话无法继续 (harness 报告会话不可恢复, 或会话记录丢失) 时, 以同一模型新建会话并以交接消息开始.

### Agent sessions

- 模型到 harness: Engine 按选定的模型选 harness (GPT 类为 Codex, Claude 为 Claude Code, 本地或第三方模型按配置经任一 harness 的兼容端点), 各项工作的 harness 可以不同.
- 启动与继续: 每项工作在第一个 Agent 步骤新建会话, 之后的步骤在该会话中继续, 规则见 Model choice and session continuity 节. 会话身份与所选模型写进流程步骤记录.
- 上下文传递: 每条 Agent 步骤消息由 Engine 组装: 本步短指令 (来自流程定义), 本步输入的路径与必要摘要 (Engine 收集, 如 issue 路径, 就绪记录, 测试输出位置), 写入范围, 输出 schema. 不再让会话自己找规则.
- 恢复: 不承诺接回执行中的回合 (两个 harness 都没有保证). Engine 重启后按现有做法确认旧 harness 进程已退出, 再读会话记录: 回合已有最终输出则采用; 没有则该步视为中断. 只读步骤直接在原会话重发; 写入步骤在原会话发 "上一回合被中断, 先检查工作区再完成本步", 不回到基线重做, 以免丢失已完成的修改; 恢复点 (见下与 08) 只在用户要求时使用.
- 超时 (D22, 推广到所有 Agent 步骤): Agent 步骤按现有 Model work time 计量设预算 (按步骤类型配置), 到预算先提醒会话整理并交付, 再超出一段后向用户报告并询问, 不自行中断, 也不替用户取默认值; 等用户答复期间会话照常运行. 用户可选继续等待, 中断 (按失败处理) 或其他处置. 先看事件流是否仍在推进只用来在报告里附上状态, 不改变"先问用户". 现行 Reviewer "等到 30 分钟向用户报告并询问" 是这条规则的特例, 见 09.
- 改 spec 的提议 (D22): 任何 Agent 步骤 (worker, Reviewer, 对话会话) 提议修改 spec 时, 都由流程中处理该提议的步骤 (审核中为处置步骤) 与一个独立会话的 Agent 步骤共同决定, 两者不一致时等待用户; 提议者自己不决定.

### Waiting for the user

- 等待用户是一个流程步骤: Engine 记下待答事项 (问题, 选项, 背景, 所属实例与步骤) 并经入口展示和通知; 不设超时, 不替用户取默认值. 同一仓库中不依赖该答复的其他实例照常推进.
- 用户的一条话可能是: 对某个待答事项的回答, 对运行中流程的指令 (停止, 改方向), 新的工作请求, 或普通对话. 入口能让用户明确指向某个待答事项时直接绑定; 不能确定时交对话会话解释 (其输出 schema 含归类字段), 仍不确定就向用户确认. 归类为回答后才恢复对应实例.
- 用户随时可以停止某个实例: 运行中的 Agent 回合被中断, 实例转为 `cancelled`, 已写入的内容保留在工作区, 由用户决定是否回退到某个写入步骤前的恢复点 (08); Engine 不自动回退.

### Failures

失败按来源处理, 每类都有恢复路径, 不改由更强的模型代答, 也不静默跳步:

- harness 进程退出或连接中断: 重启 harness 进程, 按上文恢复同一步, 重试一次; 仍失败则实例转为 `stopped` (可恢复) 并报告用户.
- 模型服务错误: 限流按服务给出的等待时间退避; 额度耗尽或认证失败转为 `stopped` 并报告用户, 不自动改用其他模型或 harness (换模型是用户的选择, 用户换模型后按 Model choice and session continuity 节继续同一项工作).
- 输出不符 schema: 在同一会话要求按 schema 重答, 最多两次, 仍不符则 `stopped`.
- 判断模型失败: 不是运行故障, 该题不提示, 流程照常, 见 [定义 Engine 调用 Jev 类模型的接入方式](16-define-judge-model-integration.md) 的超时与失败部分.
- 确定性操作的失败结果 (测试不过, 检查报错, 审核发现问题) 不是运行故障, 是流程定义中的分支 (如进入修复循环).
- `stopped` 实例保留写入者令牌 (见下), 直到用户选择继续, 回退或放弃, 以免其他实例在未知状态的工作区上写入.

### Stacked and parallel flows

- 栈: 一个流程步骤需要另一个流程 (例如实施中遇到重要决定转入 grilling, 提交前需要 Spec Readiness 增量复审) 时, Engine 新建子实例并把父实例置为 `waiting-subflow`; 子实例结束后把结果交回父实例的当前步骤. 子实例与父实例同属一条写入链, 继承父实例的写入者令牌, 不会与父实例同时写入.
- 并行: 多个流程实例同时运行. 每个仓库只有一个写入者令牌, 由 Engine 发放给一个实例 (连同其子实例栈); 只有持有者的会话获得工作区写入范围, 其他实例的会话只读, 只能写自己的 `.tmp` 子目录. 需要写入而拿不到令牌的实例转为 `waiting-writer`, 期间不写已跟踪文件的步骤 (研究, 分析, 草稿写到 `.tmp`) 可以先做. 令牌在持有实例提交完成, 或停在没有未提交修改的状态时释放, 与现行 `docs/agents/agent-writes.md` 的 Issue concurrency 节一致. 非持有实例的草稿与落盘见 [定义并行流程的读取与写入隔离](10-define-parallel-flow-isolation.md).
- 写入步骤开始前 Engine 记下恢复点, 只供用户停止实例后手动恢复; 现行做法用暂存区, 但暂存区同时是 Code Review 与 Commit Audit 的候选, 恢复点的位置由 [定义分流判断的复核与回退合同](08-define-routing-review-and-rollback.md) 定.

### Observable and recoverable

- 可观察 (入口展示, 并有 JSON 机器入口供脚本和测试使用): 每个实例的当前步骤与状态, 等待原因, 待答事项, 写入者令牌持有者, 每步起止时间与结果摘要, 各会话的状态与最近消息, 判断调用记录. 每步起止时间同时是 [定义 Jev 类模型的评测与转正条件](11-define-evaluation-and-graduation.md) 所需的时长数据, 不再从会话记录推算.
- 可恢复 (Engine 重启后不丢): 流程实例状态与步骤记录, 待答事项, 写入者令牌, 会话身份绑定, 恢复点, 对话记录 (见下). 不承诺: 执行中的回合本身, 判断模型服务 (首版由用户或其部署方维护, 见 20).

### Conversation entry and harness routing

- Engine 对入口提供一个与形态无关的接口: 规范化的会话事件流 (把 Codex 的 `item/*`, `turn/*` 通知与 Claude 的 stream-json 事件归一为同一组显示事件: 文本增量, 工具调用, 文件改动, 批准请求, 流程事件, 待答事项) 加命令 (发消息, 应答批准与待答事项, 中断, 换模型, 停止实例). 终端界面, 本地网页或其他前端都只是这个接口的客户端; 事实见 [Engine 自有对话入口的形态比较](../research/engine-entry/report.md) (11-11).
- 批准请求: harness 会话发出的批准请求先按流程定义给该步的权限策略由 Engine 应答 (例如只读步骤拒绝写入); 策略之外的请求作为待答事项交给用户.
- 对话连续性由 Engine 拥有: Engine 保存每个对话的记录 (用户消息, 回复, 流程事件摘要) 和当前对话会话绑定 (harness, 模型, 会话 ID). 用户消息默认交给当前对话会话.
- 用户在对话中换 Main Agent 模型: 同一 harness 内在原会话继续并改用新模型 (Codex 按回合, Claude Code 按回合进程指定模型; Codex 线程的模型提供方在创建时固定, 换提供方要 `thread/fork`); 跨 harness 时新建目标 harness 的会话, Engine 用自己的对话记录和进行中实例的状态生成交接消息作为新会话的首条输入, 原会话保留, 切回时继续原会话并补上期间的交接. 不迁移原生会话记录, 因为两个 harness 的记录格式不同且都不承诺可导入.
- 入口形态由用户 11-11 定为 Engine 自带的网页, 局域网和远程设备也能连接, 首版不设账号密码, 设备第一次连接用一次性授权码配对后凭设备凭据访问, 见 [确定 Engine 对话入口的形态](19-decide-conversation-entry-form.md). 因此 Engine 对外监听网络连接, 入口的 TLS 与设备配对属于 Engine 的必备部分.

## Comments

11-12: 本答案中 "Engine 由现有用户级后台管理进程扩展" 和 "Git 写入只由 Engine 执行" 两项原是 worker 的架构判断, 已交一个与 Main Agent 同级模型的 Agent 只读独立复核 (ARW HEAD `79e2497`, 与 `9fb4b5d` 相比 `lib/background-agent/`, `docs/specs/`, `docs/adr/` 与 `docs/agents/agent-writes.md` 均未变). 结论:

- 扩展现有管理进程: 支持. 另起独立 Engine 进程会复制状态库, 容量与恢复; Engine 作为库无法持有写入者令牌与长驻会话; 每仓库一个进程与全局容量和共享 App Server 冲突; 单独的 TLS 网关进程要多管一个进程的生命周期, 首版不采用. 按复核意见补了故障域, 判断模型的开启时机, 两类监听, 登录时自启和升级的写法.
- Git 写入只由 Engine 执行: 方向支持 (由对话会话在 Engine 批准下执行 Git 会让提交内容不确定; 只把提交交给 Engine 而暂存留给会话, 会话就能改动恢复基线和审核候选). 但原文 "由 harness 权限限制" 与事实不符: Claude 后端只给 Reviewer 加只读 Git 与工具限制, 其他角色用默认工具, 写入路径只追加放行 (`lib/background-agent/claude-sessions.mjs`); Codex 后端没有把 `writePaths` 传给线程 (`lib/background-agent/codex-app-server.mjs` 的 `threadParams`); 这是 ADR 0033 有意的决定. 已改为以检测保证, 是否另加窄范围拒绝规则待用户决定.
- 1.0 规范要改写的现行合同: ADR 0013 (Git 写入与恢复归 Main Agent, 由 Main 暂存基线, 不增加运行锁与调度器), `docs/agents/agent-writes.md` (Prepare the baseline, Assign and hand off 中 "不引入文件锁或任务领取命令", Git and recovery), ADR 0023 (Main Agent 负责暂存), ADR 0017 (注明 "只改工作树不改索引" 只限 workflow 操作), ADR 0030 (管理进程不调用模型, 只监听回环地址, 后台 Agent 归属 Main 会话), ADR 0033 与长期规格 Seams and Adapters 节 (不收窄原生设置), 长期规格 Machine entry 节的归属与信任模型, `CONTEXT.md` 中 Main Agent 的定义, 安装规格 Background Agent management 节 (只绑定 `127.0.0.1`, 按需启动), `docs/agents/parallel-implementation.md`. 做法: 在 `arw-1.0` 分支写一份新 ADR 部分取代 ADR 0013 中 Git, 恢复, 基线与锁的部分 (单文件单写入者与 Reviewer 独立性保留), 在 0013, 0030, 0033 的状态行注明被取代的范围; 归属见 [确定现有 ARW 合同在 1.0 中的继承范围](13-decide-legacy-contracts.md).
- 未核实, 留给规范与实施验证: Codex 的权限配置能否在可写目录中单独把 `.git` 设为只读; Windows 上 Claude Code 的 Bash 限制; WSL NAT 网络模式下局域网设备能否连入; Windows 防火墙对非回环监听的提示; 会话启动的后台进程在步骤核对之后才写 Git 的可能.

11-13: 用户 11-12 对 "是否只为 worker 会话收紧原生权限" 的答复 (原话): "以 engine 为主之后, main agent 和 subagent 的界限可能没有原来那么清晰了. engine 要负责所有的 agent 的简单判断 (内部会交给判断模型). 所以不存在 man 和 sub 的处理方式不同的问题." 据此 Answer 改为 Engine 对所有 Agent 会话一视同仁 (Engine process and roles 节), 简单判断都经 Engine 交判断模型, 不再出现 "worker 一类会话" 的提法. 原问题中的三个做法 (只检测; 用 ARW 的权限配置强制; 检测加不覆盖用户设置的窄范围拒绝规则) 在 "所有会话统一" 的前提下仍是一项取舍, 改为对所有会话 (含对话会话) 提出, 交用户决定; 不论选哪一项, 每步后的检测都是唯一的保证.

11-13 (D14 答复): 用户问清背景后选 C: 每步后的检测是唯一保证, 另加不覆盖用户设置的窄范围拒绝 (Claude `--disallowedTools Edit(.git/**)`, Codex `.git` 只读), 对所有 Agent 会话一视同仁. 上面 11-12 "待用户决定" 与 11-13 第一条的三选一取舍因此已定, 本答案相应处已改. 同日核实 (任务 v1-verify) 的结果: Codex 可按路径把 `.git` 设为只读, 已证实 (Windows 原生沙箱是否同样生效文档未写); Windows 上 Claude Code 无沙箱, 拒绝规则不覆盖间接写入, 有风险; 后台进程在步骤核对之后写 Git, 有风险, 已按上面的检测时机补充处理. WSL NAT 下局域网连入与 Windows 防火墙提示两项属 19, 20 的安装规格, 不在本 issue.

11-13: D20 (用户选 A) 细化本答案: 流程定义不再写在 Engine 代码中, 而是随 Engine 发布的 graph 数据加 Engine 代码中的原语 (程序节点只调用原语), 实例绑定 graph 哈希. 步骤四类, 转移唯一确定等其余合同不变, 细节见 22.

11-13: 用户原话 (接 09 的 D15 答复): "做各个工作的 agent 的唯一区别, 就是先要判断某个工作适合什么模型, 然后就交给它一直做, 中途尽量不换模型, 充分利用模型的缓存." 据此新增 Model choice and session continuity 节, 改写 Agent sessions 节的前两条: 原 "每个角色配置一个模型" 改为每项工作开始时选定模型, 原 "上下文接近上限时新建会话" 改为压缩后仍沿用原会话; Reviewer 不再作为新建会话的特例, 它与作者分开是因为审核是另一项工作; Reviewer 发现的处置从对话会话的职责举例中移出, 与 09 一致, 回到产出候选的会话. 两处取舍待用户确认 (Main Agent 交用户决定, 答复后改写相应部分):

- 谁选, 按什么选. 选项: 只按 graph 节点的默认档位, 不做判断 (最简单, 零额外调用, 但难易不同的工作同档); 只按判断模型对每项工作的判断, 没有节点默认 (每项工作都要一次判断, 判断不可用或低于阈值时没有回落); 节点默认加允许范围, 范围不止一档时由判断模型选档, 低于阈值用默认 (本答案采用; 选档题未过 11 的离线评测与影子阶段前, 行为与第一项相同).
- 会话被压缩. 选项: 沿用原会话与原模型 (本答案采用); Engine 在上下文接近上限时以同一模型新开会话并写交接 (原答案的做法, 多一套交接, 缓存同样失效); 压缩时允许重新选模型 (缓存已失效, 换模型没有缓存损失, 但档位是否合适与压缩无关, 且多一次判断).

11-13 (D22 答复, 任务 v1-critfix): 用户原话见任务目录 README 的 D22. (1) 选模型改为两段, 判断模型输出参数, 机械映射表对到模型和推理强度, 判断模型未配置时由写概要的一步输出参数, 校准题列为待测项 (见 Model choice 节). (2) 压缩后沿用原会话和原模型. (3) 作者判 "无效" 的处置和证据带回原 Reviewer 会话下一轮复审, Reviewer 仍坚持则交用户 (见 09 Dispositions). (4) 任何 Agent 提议改 spec 由处置步骤加一个独立会话共同决定 (见 Agent sessions 节). 另: 等 Agent 超时先问用户不中断, 推广到所有 Agent 步骤 (Agent sessions 节的超时). 同日按批判审读加了 Agent 步骤宜粗的原则 (Flow state 节), 核实 Codex 能否按线程终止命令子进程 (Git 写入一条, 结论: 实验接口可列出并终止, 脱离进程除外, 列为已知风险), 并写明跨实例 Reviewer 会话的工作区 (见 10).

11-14 (D24 答复, 任务 v1-d24ans): 用户 11-13 选 A, 判断模型改为可选, 不配也完整工作, 配了只做提示, 推翻 11-11 "判断模型是必需组件". 本答案相应改写: 原 "开工条件" (判断模型就绪后流程才开始, 未就绪时不开始任何流程, 空闲后释放) 改为 "判断模型可选" 一条, "Engine 不开工" 的失败点删去; 流程中的简单判断不再都交判断模型, 改为正在干活的 Agent 步骤输出 schema 的必填字段, 没有 Agent 步骤处走保守分支 (Engine process and roles 节, Flow state 节的判断步骤); 选档参数一律由写任务概要的一步输出 (与 D22(1) 原意 "由判断模型输出参数" 的差别已在 Model choice 节写明); 用户消息归类不再用判断模型; 删去 "被推翻的判断正是交给哪个角色时新建会话"; 恢复基线改称恢复点, 只在用户停止实例后手动使用, 不做任何自动回退 (08). 11-12 Comments 中 "简单判断都经 Engine 交判断模型" 与 11-13 Comments 中选档三选项是当时的记录, 以本条为准.

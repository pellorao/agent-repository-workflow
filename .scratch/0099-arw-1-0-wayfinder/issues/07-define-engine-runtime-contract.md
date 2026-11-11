# 定义 Engine 驱动流程的运行合同

Type: grilling
Status: resolved
Blocked by: issue:0099:01, issue:0099:03, issue:0099:04, issue:0099:17

##### Question

Engine 提供与用户对话的入口, 并按用户选择的 Main Agent 模型把用户的话交给对应的 harness (Codex 或 Claude Code), 可同时控制多个 harness: 这个入口长什么样, 怎样在多个 harness 之间路由并保持一次对话的连续性? Engine 怎样拥有流程状态并选择下一个动作, 怎样启动, 继续和恢复 Agent 会话, 传递上下文, 等待用户, 处理超时与失败? 一个流程中途触发另一个流程时按栈执行, Main Agent 启动的多个 worker 各自运行流程时并行执行, 两种情形下 Engine 怎样保证仓库单一写入者? 哪些操作必须可观察, 可恢复?

## Answer

11-11 worker 分析, 交 Main Agent 综合. 依据: [核对当前 ARW 的流程驱动方式与 Engine 已有能力](01-research-current-flow-driver.md) 列出的 7 项受影响合同, [核对 Engine 控制 Agent 会话的平台能力](03-research-engine-session-control.md) 的平台事实, ARW HEAD `9fb4b5d` 的长期规格 (`docs/specs/agent-repository-workflow/spec.md` 的 Background Agent control 节) 与 `lib/background-agent/` 的实现, 以及用户在 [确定 ARW 1.0 首版覆盖的工作流与跨平台组合](17-decide-workflow-coverage-and-platform-mix.md) 和 [确定本地判断模型服务的运行责任](18-decide-local-judge-server-ownership.md) 中的答复. 入口的具体形态 (终端界面, 本地网页, 复用 harness 的交互会话) 是方向性取舍, 另列 [确定 Engine 对话入口的形态](19-decide-conversation-entry-form.md); 下面的合同对三种形态都成立.

### Engine process and roles

- Engine 是每个用户一个的常驻进程, 由现有用户级后台管理进程扩展而来, 共用它的安装目录, 私有 SQLite 状态库, 两个 harness 的会话层 (Codex App Server 线程, 每回合一个 `claude -p` 进程, 同一 `NativeSessions` 接口), 容量与崩溃识别 (PID 加进程创建时间). 理由: 这些正是 Engine 驱动所需的会话控制, 已在两个 harness 上对等实现; 另起进程会复制状态库, 容量和恢复. 代价: 一个进程故障影响该用户所有仓库的流程, 与现在后台 Agent 的情况相同.
- 对话入口是 Engine 的客户端, 不持有流程状态, 可以断开再连接; 同时可以有多个入口连接 (例如两个终端).
- 开工条件: Engine 启动后先执行判断模型的开启脚本 (见 [确定本地判断模型服务的运行责任](18-decide-local-judge-server-ownership.md)), 判断模型通过就绪检查后才接受新流程; 未就绪时入口只显示缺什么, 怎样配置, 不开始任何流程.
- 角色: 用户选定的 Main Agent 模型在其 harness 中作为一个由 Engine 驱动的 "对话会话", 负责与用户的自由对话和流程中分给它的高智能步骤 (理解需求, 起草 issue, 处置 Reviewer 发现等); 它不再自己读规则推进流程. worker 与 Reviewer 是 Engine 按流程启动的其他会话. 现行 "Main Agent 是与用户沟通者" 的身份定义改由 Engine 加对话会话承担, 怎样改写术语归 [确定现有 ARW 合同在 1.0 中的继承范围](13-decide-legacy-contracts.md).
- Git 写入只由 Engine 执行 (暂存, 提交, 恢复), 作为流程中的确定性步骤; Agent 会话不做 Git 写入, 由 harness 权限 (现有会话层已支持的按路径写入范围与只读 Git 命令) 限制, Engine 在每个 Agent 步骤后核对 `HEAD` 与暂存区未被会话改变, 变了即停在可恢复状态. 这延续现行 "Git 写入只由与用户沟通的一方执行" 的意图: 1.0 中与用户沟通并负责流程的是 Engine.
- "ARW 不自主发起 Agent 编码工作" 改为: Engine 只在用户发起或批准的流程中启动 Agent 会话; 流程内的下一步由 Engine 按流程定义推进, 不再逐步请用户确认, 用户批准点仍是流程中的等待用户步骤.

### Flow state and next action

- 每个工作流 (规划, 实施, Spec Readiness, Code Review, 提交与 Commit Audit, Application/JIRA, 源码仓库维护等) 在 Engine 代码中有一个流程定义: 一组具名步骤和步骤间的转移. 步骤只有四类: 确定性操作 (Engine 代码执行, 如 `prepare`, 测试命令, Git 写入), 判断 (向判断模型提一组 `choice` 或 `noul` 题), Agent 步骤 (给指定角色的会话一条只含本步指令的消息, 用输出 schema 约束结果), 等待用户.
- 下一动作由流程定义, 当前状态和上一步结果唯一决定. Agent 与判断模型只能通过本步输出 schema 中列出的字段或选项影响分支, 不能跳步或加步; 流程定义没有覆盖的情况一律转为等待用户. 这取代现行 "按触发点读规则, 由 Main Agent 记住顺序", 规则正文怎样拆成程序检查和本步短指令见地图 Not yet specified.
- 流程实例状态写在 Engine 的私有状态库 (新增表, 与现有 `agents`, `messages` 同库), 字段至少有: 实例 ID, 流程定义名与版本, 仓库根, 关联 Artifact (effort 与 issue 的 Canonical ID), 当前步骤, 实例状态 (`running`, `waiting-user`, `waiting-subflow`, `waiting-writer`, `stopped`, `done`, `cancelled`), 父实例 (栈), 每步起止时间, 结果摘要, 所用会话与回合身份. 每步结束时先持久化再执行下一步.
- 仓库中的 Artifact (issue, spec, 就绪与审计记录) 仍是交付结果的权威; Engine 状态只是执行进度的权威. 两者不一致时 (例如用户手工改了 issue `Status`), 以仓库为准, 实例停下并请用户确认.
- 实例绑定启动时的流程定义版本. Engine 升级前要求没有正在执行的步骤; 停在等待状态的实例在新版本中找得到同名步骤时继续, 否则停下报告用户.

### Agent sessions

- 角色到 harness: 每个角色 (对话会话, worker, 各 Reviewer) 配置一个模型; Engine 按模型选 harness (GPT 类为 Codex, Claude 为 Claude Code, 本地或第三方模型按配置经任一 harness 的兼容端点), 各角色的 harness 可以不同.
- 启动与继续: 同一流程实例中同一角色的连续 Agent 步骤复用一个会话, 保留已取得的理解; 需要独立判断 (Reviewer, 现行 `reviewer-launch` 规则), 上下文接近上限, 或会话已出错时新建. 会话身份写进流程步骤记录.
- 上下文传递: 每条 Agent 步骤消息由 Engine 组装: 本步短指令 (来自流程定义), 本步输入的路径与必要摘要 (Engine 收集, 如 issue 路径, 就绪记录, 测试输出位置), 写入范围, 输出 schema. 不再让会话自己找规则.
- 恢复: 不承诺接回执行中的回合 (两个 harness 都没有保证). Engine 重启后按现有做法确认旧 harness 进程已退出, 再读会话记录: 回合已有最终输出则采用; 没有则该步视为中断. 只读步骤直接在原会话重发; 写入步骤在原会话发 "上一回合被中断, 先检查工作区再完成本步", 不回到基线重做, 以免丢失已完成的修改; 恢复基线 (见下) 只在用户要求或复核否定时使用.
- 超时: Agent 步骤按现有 Model work time 计量设预算 (按步骤类型配置), 到预算先提醒会话整理并交付, 再超出一段才中断; 中断后按失败处理.

### Waiting for the user

- 等待用户是一个流程步骤: Engine 记下待答事项 (问题, 选项, 背景, 所属实例与步骤) 并经入口展示和通知; 不设超时, 不替用户取默认值. 同一仓库中不依赖该答复的其他实例照常推进.
- 用户的一条话可能是: 对某个待答事项的回答, 对运行中流程的指令 (停止, 改方向), 新的工作请求, 或普通对话. 入口能让用户明确指向某个待答事项时直接绑定; 不能确定时 Engine 用判断模型的 `choice` 题分类, 低于阈值时交对话会话解释, 仍不确定就向用户确认. 归类为回答后才恢复对应实例.
- 用户随时可以停止某个实例: 运行中的 Agent 回合被中断, 实例转为 `cancelled`, 已写入的内容保留在工作区, 由用户决定是否用恢复基线回退.

### Failures

失败按来源处理, 每类都有恢复路径, 不改由更强的模型代答, 也不静默跳步:

- harness 进程退出或连接中断: 重启 harness 进程, 按上文恢复同一步, 重试一次; 仍失败则实例转为 `stopped` (可恢复) 并报告用户.
- 模型服务错误: 限流按服务给出的等待时间退避; 额度耗尽或认证失败转为 `stopped` 并报告用户, 不自动改用其他模型或 harness (换模型是用户的选择).
- 输出不符 schema: 在同一会话要求按 schema 重答, 最多两次, 仍不符则 `stopped`.
- 判断模型失败: 按 [定义 Engine 调用 Jev 类模型的接入方式](16-define-judge-model-integration.md) 的超时与失败部分.
- 确定性操作的失败结果 (测试不过, 检查报错, 审核发现问题) 不是运行故障, 是流程定义中的分支 (如进入修复循环).
- `stopped` 实例保留写入者令牌 (见下), 直到用户选择继续, 回退或放弃, 以免其他实例在未知状态的工作区上写入.

### Stacked and parallel flows

- 栈: 一个流程步骤需要另一个流程 (例如实施中遇到重要决定转入 grilling, 提交前需要 Spec Readiness 增量复审) 时, Engine 新建子实例并把父实例置为 `waiting-subflow`; 子实例结束后把结果交回父实例的当前步骤. 子实例与父实例同属一条写入链, 继承父实例的写入者令牌, 不会与父实例同时写入.
- 并行: 多个 worker 各自运行流程实例. 每个仓库只有一个写入者令牌, 由 Engine 发放给一个实例 (连同其子实例栈); 只有持有者的会话获得工作区写入范围, 其他实例的会话只读, 只能写自己的 `.tmp` 子目录. 需要写入而拿不到令牌的实例转为 `waiting-writer`, 期间不写已跟踪文件的步骤 (研究, 分析, 草稿写到 `.tmp`) 可以先做. 令牌在持有实例提交完成, 或停在没有未提交修改的状态时释放, 与现行 `docs/agents/agent-writes.md` 的 Issue concurrency 节一致. 读取者的一致视图, 投机写入被否定时的回退与重做见 [定义并行流程的读取与写入隔离](10-define-parallel-flow-isolation.md).
- 写入步骤开始前 Engine 记下恢复基线; 现行做法用暂存区, 但暂存区同时是 Code Review 与 Commit Audit 的候选, 基线的具体位置由 [定义分流判断的复核与回退合同](08-define-routing-review-and-rollback.md) 定.

### Observable and recoverable

- 可观察 (入口展示, 并有 JSON 机器入口供脚本和测试使用): 每个实例的当前步骤与状态, 等待原因, 待答事项, 写入者令牌持有者, 每步起止时间与结果摘要, 各会话的状态与最近消息, 判断调用记录. 每步起止时间同时是 [定义 Jev 类模型的评测与转正条件](11-define-evaluation-and-graduation.md) 所需的时长数据, 不再从会话记录推算.
- 可恢复 (Engine 重启后不丢): 流程实例状态与步骤记录, 待答事项, 写入者令牌, 会话身份绑定, 恢复基线, 对话记录 (见下). 不承诺: 执行中的回合本身, 判断模型进程 (重启后重新执行开启脚本).

### Conversation entry and harness routing

- Engine 对入口提供一个与形态无关的接口: 规范化的会话事件流 (把 Codex 的 `item/*`, `turn/*` 通知与 Claude 的 stream-json 事件归一为同一组显示事件: 文本增量, 工具调用, 文件改动, 批准请求, 流程事件, 待答事项) 加命令 (发消息, 应答批准与待答事项, 中断, 换模型, 停止实例). 终端界面, 本地网页或其他前端都只是这个接口的客户端; 事实见 [Engine 自有对话入口的形态比较](../research/engine-entry/report.md) (11-11).
- 批准请求: harness 会话发出的批准请求先按流程定义给该步的权限策略由 Engine 应答 (例如只读步骤拒绝写入); 策略之外的请求作为待答事项交给用户.
- 对话连续性由 Engine 拥有: Engine 保存每个对话的记录 (用户消息, 回复, 流程事件摘要) 和当前对话会话绑定 (harness, 模型, 会话 ID). 用户消息默认交给当前对话会话.
- 用户在对话中换 Main Agent 模型: 同一 harness 内在原会话继续并改用新模型 (Codex 按回合, Claude Code 按回合进程指定模型; Codex 线程的模型提供方在创建时固定, 换提供方要 `thread/fork`); 跨 harness 时新建目标 harness 的会话, Engine 用自己的对话记录和进行中实例的状态生成交接消息作为新会话的首条输入, 原会话保留, 切回时继续原会话并补上期间的交接. 不迁移原生会话记录, 因为两个 harness 的记录格式不同且都不承诺可导入.
- 入口的形态, 流式展示, 批准请求的呈现, 通知方式见 [确定 Engine 对话入口的形态](19-decide-conversation-entry-form.md).

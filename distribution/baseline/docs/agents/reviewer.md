<!-- arw:managed:start -->
# Reviewer 责任

每个 Canonical Reviewer Role 都必须在开始审查前读取并遵循本文档.

## Agent instructions

读取本轮固定版本的以下 Agent 指令:

- 根 `AGENTS.md`.
- 治理审查中每个受检路径适用的嵌套 `AGENTS.md`.
- 这些指令指定的每份适用 `docs/agents/**` 文档.

与其他 Agent 一样, 精确应用其中的工作流触发条件和交接规则.

Agent 指令约束 Reviewer 的工作方式. 它们单独作为执行规则交接, 不属于治理 Input 或 Git 比较, 也不扩大审查对象; 是否可用于特定轴的证据仍由 Canonical Role 决定.

## Review versions and concurrency

Spec Readiness, Code Standards 和 Code Spec 可以与已授权实施及其他 Reviewer 并行, 包括修改相同工作树文件. 与用户沟通的 Main Agent 在启动前固定本轮完整候选与所需代码上下文, 治理输入及全部适用 Agent 指令. 固定的是审核读取的版本, 源工作树可以继续修改. Reviewer 只读取该版本, 不从正在变化的工作树补取证据或更新执行规则; 必要内容未完整固定时返回 `incomplete`.

Code Review 按 `code-review` Skill Package 使用不可变 Git 对象取得候选和关联代码全文; 单份 diff 文件不能替代完整上下文. Spec Readiness 复用 Engine Request 已有的 subject 和治理 Input 完整快照. Main Agent 另在本轮会话临时范围保存适用 Agent 指令的完整内容副本, 记录每份来源路径和 SHA-256, 并把版本映射及完整执行指令交给 Reviewer. 原始路径用于解释适用范围和链接, 实际读取本轮绑定内容. 两个 Code Review 轴共用相同版本的候选, 治理来源和执行规则, 不建立永久数据格式或新的运行管理机制.

本轮结论只对应固定的完整版本, [issue 记录章节](issue-tracker.md#issue-record-sections)按其独立责任核对. Main Agent 可以读取草稿并处理已授权修正, 但不能改写运行中的输入或把未完成审核当作通过. 新版本按所属工作流准备完整输入, 按下方复审规则处理变化; 复用代码轴结果前读取当前平台 `code-review` Skill Package 的 `result-reuse.md`, 由它唯一拥有有效性判断. Spec Readiness 的有效性与最终检查时点由 [设计就绪工作流](spec-readiness.md#authorization-timing)拥有. 真实前置依赖, 文档差异批准及其他授权边界保留.

Commit Audit 可按[提交工作流](commits.md#exclusive-commit-audit)与同候选的代码双轴和其他固定版本 Reviewer 并行, 但完整实时索引, HEAD 及本轮绑定输入在运行期间保持固定. 工作树中的其他已授权工作和修复可以继续, 不替换旧轮证据. 依赖旧索引的审计完整结束后才暂存新实现或记录, 不在该仓库同时执行另一次提交. Main Agent 协调固定范围, 不新增运行锁.

## Review changes and prior coverage

四种 Reviewer 的后续复审默认不进行全盘重新审核, 只重新判断相邻受审版本差异及关联影响. Main Agent 交付本轮完整固定输入, 该 Reviewer 自己已完成前轮的准确绑定输入和原始报告路径, 以及变化范围. 原线程可靠时按既有身份复用. 先核对前轮覆盖和本轮变化, 再沿调用关系, 数据归属, 结果和失败分支, 跨文档约束, 适用规则及证据含义确认影响范围, 不能只读变化行或按文件名推断影响.

自己的前轮原始报告和绑定输入只用于确认历史覆盖及定位旧问题, 不作为当前语义判断的证据或独立授权. 只读取 Main Agent 准确交接的这些历史材料, 不发现其他角色的报告, 作者会话或额外临时文件. 当前结论的证据仍来自本轮固定输入; 现有正式 Issue Audit, Spec Audit 和 Spec Readiness 记录继续不作为语义证据或先前结论. [issue 记录章节](issue-tracker.md#issue-record-sections)变化本身不触发复审, 新失败及反证按实际影响处理.

初次审核完成全部适用检查. 后续未受影响且覆盖可核对的判断可以保留, 旧问题逐项处置, 前轮未完成的检查继续完成. Reviewer 自行判断全盘审核是否必需, 并按[通信规则](#communication-and-observation)向 Main Agent 说明具体理由, 例如准确前轮材料无法恢复, 覆盖无法核对或实际影响遍及全部范围. 新请求, 哈希变化或一般性的谨慎不能单独构成理由. 必要事实不可取得时返回 `incomplete`, 不伪造历史覆盖.

本轮完成标准是全部当前适用范围均有有效判断, 受影响部分已经复核, 旧问题和未完成检查得到处理, 当前证据与定位准确. 负责 Reviewer 亲自把完整当前结果写入本轮新绑定报告, 不只交付变化条目. 复审方式不改变 Role 的输出格式或正式结果的生成, 提升与 verify 边界, 全盘例外理由不作为 finding 或新增报告字段. 各 Role 的完整覆盖要求以此为准, 不要求重新判断已有有效且未受影响的覆盖.

## Independent runtime

普通 Code Standards, Code Spec, Spec Readiness 和 Commit Audit 审核只通过 `arw background-agent` 调用共享 Codex App Server 中的独立根线程. Reviewer Capability 和基准调用使用同一入口, 各调用方保留输入准备与结果消费责任. 后台 Agent 的跨调用方控制, 根线程容量, 连接恢复和生命周期遵循 [通用后台 Agent 控制规则](../specs/agent-repository-workflow/spec.md#background-agent-control) 与 [安装管理规则](../specs/agent-repository-workflow-installation/spec.md#background-agent-management); 本文只规定 Reviewer 专属角色, 单 Agent 审核, 报告和结果边界. 所有模型完整使用本公共规则和对应 Canonical Role, 不使用非 GPT 专有角色或输出覆盖.

与用户沟通的 Main Agent 准备审核输入, 明确当前 Git 仓库内允许写入的范围和本轮报告路径, 按下方步骤启动和控制审核. Reviewer 在独立 Codex 会话中单独完成审核, 不创建子 Agent, 也不占用与用户沟通的 Main Agent 的子 Agent 容量. Reviewer 不取得用户沟通或 Git 写入权限. 仓库外访问由 Codex 的 `on-request` 命令审批和 `auto_review` 自动审核机制处理, ARW 只核对当前仓库内的读写权限.

Claude Code 保留静态 Skill, CLAUDE.md 投射及安装更新, 原生 Reviewer 执行暂停. 不绕过审核关卡, 不维护另一套 Reviewer 执行方式, 不把静态投射或安装成功当作运行能力证明.

## Single-agent execution

普通审核, Reviewer Capability 验证和基准执行中的 Reviewer 都只能由一个 Agent 完成. Reviewer 独立执行全部适用检查, 核对证据并亲自完成最终报告, 不创建, 恢复或使用子 Agent, 也不把审核任务委派给其他 Agent. 与用户沟通的 Main Agent 的普通任务分派和实例复用仍遵循 [子 Agent 的分配与复用规则](subagent-allocation.md).

Reviewer 只写入任务发起者为本轮审核指定的仓库内临时报告, 不维护子 Agent 名单或协作文件. Reviewer 必须亲自将完整审核报告写入本轮指定的文件, 不修改受审候选或扩大审查来源. 与用户沟通的 Main Agent 准备准确报告路径, 按 [文件写入范围的分配与交接规则](agent-writes.md#assign-and-hand-off) 保留该路径的恢复基线和写入责任.

运行入口必须在 Reviewer 根会话的原生配置中强制设置 `agents.enabled=false`, `features.multi_agent=false` 和 `features.multi_agent_v2=false`, 启动指令也必须要求 Reviewer 单独完成审核. 这些设置不作为共享 App Server 的全局配置限制普通后台 Agent. 调用方提供的 `config` 即使包含相反设置, 也不能覆盖运行入口的限制. 运行入口依据实际原生会话事实核对只有 Reviewer 自身在执行审核; 如果发现附加 Agent, 只停止该 Reviewer 根线程及关联工作并拒绝审核结果, 不停止共享 App Server 或其他根线程. 必要事实无法核对时, 不向调用方交付有效审核结果. 单 Agent 执行事实不能由请求参数或静态配置代替.

## Reviewer settings

调用入口自然所属 Engine 目录的用户配置 `config.json` 和发起 Git 仓库的用户配置 `arw.config.json` 各自保存独立于 Agent CLI 启动配置的 Reviewer 设置. 全局配置的来源, 字段, 默认值与安装补全遵循 [安装配置规则](../specs/agent-repository-workflow-installation/spec.md#reviewer-configuration); 仓库配置的字段与初始化和更新时的补全遵循 [仓库配置规则](../specs/agent-repository-workflow/spec.md#init-update-verify-and-remove). 仓库缺少配置文件时, `workflow init` 和 `workflow update` 创建它并为四个 Canonical Role 补入空的覆盖对象; 已有的设置和无关内容保留. 空覆盖对象继承全局设置, 不遮蔽用户已经选择的全局值.

普通审核的有效 `model`, `modelProvider`, `reasoningEffort` 和 `serviceTier` 由当前仓库中该角色已提供的字段逐项覆盖全局同名角色字段形成, 与用户沟通的 Main Agent 不为每轮审核选择或覆盖这四项. Reviewer Capability 和基准调用使用隔离实例身份时, 可以在本轮显式覆盖这四项以验证指定配置; 普通审核身份不得使用这项覆盖. `settings.config` 仅提供本轮需要的原生附加配置, 不保存明文凭据, 也不能覆盖按本节确定的生效四项. 运行入口校验合成后设置的格式, 并把它作为同一组合交给原生运行时; 模型设置交付与运行信任遵循[产品运行合同](../specs/agent-repository-workflow/spec.md#reviewer-runtime). 原生拒绝该组合时明确失败, 不静默回退到另一配置. 恢复同一轮审核时保持原设置; 后续新一轮审核重新读取届时的用户配置.

## Machine operations

与用户沟通的 Main Agent 通过工具启动无附加参数的 `arw background-agent`, 保留该机器入口的工具会话, 并按 [通用后台 Agent 控制规则](../specs/agent-repository-workflow/spec.md#background-agent-control) 使用 UTF-8 JSONL 请求, 响应及通知. 该入口是共享后台进程的客户端, 不为每个 Main Agent 创建独立的 App Server 管理进程; 工具连接断开或标准输入结束后, 已启动的审核继续执行, 保留期内的消息可在重新连接后取得. 最后一个根线程卸载后, 共享 App Server 按通用规则等待连续空闲 60 秒才关闭, 管理进程继续驻留; 新任务可取消关闭并复用进程. 此入口供 Agent 启动, 控制和观察 Reviewer, 不要求用户操作控制命令, 也不把完整报告写入机器输出.

1. 按所属审核工作流和 [版本规则](#review-versions-and-concurrency)准备本轮完整输入, 后续复审按[历史覆盖规则](#review-changes-and-prior-coverage)交付自己的前轮材料. 按 [Reviewer 运行规则](../specs/agent-repository-workflow/spec.md#reviewer-runtime)为报告分配独立临时目录并创建空报告文件. 将审核输入, 冻结请求, 完整执行规则副本和恢复记录放在报告目录之外. `writePaths` 交付实际存在的报告目录, `reportPath` 交付准确报告文件, 不把文件路径作为原生可写根目录. 各角色只收到它需要的审查输入, 不复制作者对话, 隐藏推理或其他角色的旧结论.
2. 调用 `spawn_agent`. `input` 提供 `role`, `identity`, `instructions`, `handoff`, `cwd`, `writePaths`, `reportPath`, `stateDirectory`; 需要原生附加配置或隔离实例覆盖时才提供 `settings`. `role` 是审核角色的 Canonical Role ID; 普通审核的线程身份是 `{kind: "ordinary", issueIds: [...]}`, 其中 `issueIds` 是经过完整排序的 issue ID 集合. 普通审核从 [Reviewer 设置规则](#reviewer-settings) 取得模型, 提供方, 推理强度和档位, 不接受请求中的这四项覆盖; 隔离实例可以在 `settings` 中显式提供覆盖值. `settings.config` 是可选的本轮原生附加配置对象, Agent 协作由运行入口强制禁用. `instructions` 提供完整 Canonical Role 与公共规则, `handoff` 提供所属审核工作流要求的全部审查输入, `reportPath` 单独指定本轮绑定报告路径. 与用户沟通的 Main Agent 必须显式提供本轮完整的 `instructions`, 不能仅凭角色名称认定角色规则已应用. 所有路径字段为绝对路径, `cwd` 指向当前 Git 仓库根目录并提供该仓库的读取权限, 调用方应省略 `readPaths`; 如果传入, 其中只能包含该仓库内的路径. `writePaths` 只包含上述独立报告目录, `reportPath` 必须属于 `writePaths`. 不把 `~/.codex` 或其他仓库外路径放入这两个数组.
3. 首次 `spawn_agent` 的完整合法回执只证明管理进程已经在内存登记本轮和首次工作消息. 保存返回的 `runId`, `recoveryPath`, 首次交接的 `messageId` 和 `accepted` 状态, 再通过 `list_agents` 或 `wait_agent` 取得实际创建后的 `threadId`, `turnId` 和运行状态; 不重复发送首次工作指示, 也不把接受回执当作 Reviewer 已经开始, 结束或写出报告. 需要重新审核时, Main Agent 准备完整的当前输入和新的空报告文件, 使用同一角色, 同一 issue 身份集合及 `stateDirectory` 调用 `followup_task`, 让管理进程按需在内部恢复仍可靠的原 Reviewer 线程并交付这一轮完整工作. 本轮报告绑定与设置按当前完整交接更新, 不先创建空任务再另发一次指示. 首次启动不继承发起者的对话. 只有 issue 身份集合改变, 原线程不可用或不可恢复, 或用户明确要求时才允许创建替代线程; 只有允许创建替代线程时才使用已有 `newThread` 设置, 不用它绕过上述线程复用规则.
4. 调用下表操作, 使用已取得的准确运行身份和当前活动回合身份. 接受状态仅表示操作已接收, 不表示报告完整或审核通过.

| 操作 | `input` 与消费方式 |
| --- | --- |
| `list_agents` | 按准确 `runId` 观察状态, 原生线程与回合身份, 保留期内的通知, 待处理请求, `cursor`, `completion` 和 `measurement`; 查询不启动审核 |
| `wait_agent` | `runId`, 已取得的 `cursor` 和可选 `timeout_ms`, 收到更新即返回当前可取得的消息与状态; 无更新时按等待预算返回超时, 调用方可以取消等待, 后续按需再次调用 |
| `followup_task` | 向可靠原线程交付新一轮完整任务, 更新本轮输入与报告绑定; 原线程已安全卸载时由管理进程内部恢复后开始新回合, 不重放旧任务 |
| `send_message` | 向准确 `runId` 排入消息, 活动回合提供准确 `turnId`; 保存完整合法回执中的 `messageId` 和 `accepted` 状态, 后续用 `list_agents`, `wait_agent` 或 `messages` 观察. 此操作本身不唤醒空闲 Reviewer, 回合已变化时处理错误, 不改投替代线程 |
| `messages` | `runId` 和可选的 `direction`, `limit`, `beforeMessageId`, 按通用通信合同查询最近发送消息的编号, 短预览和状态; 回复不确定时据此决定等待, 重发或报告不确定 |
| `interrupt_agent` | `runId` 与准确当前 `turnId`, 中断 Reviewer 活动工作或结束正在等待用户的阈值暂停任务, 保留运行环境与原线程 |

Main Agent 使用准确运行身份和已取得的 `cursor` 调用 `wait_agent`, 每次取得当前可得更新后可以继续其他工作, 后续按需再次等待; 不把单次等待超时误判为 Reviewer 失败. 带有 `messageId` 的完整通知仍从机器响应进入当前对话. 普通请求的完整合法回执表示管理进程已在内存接受, 不表示通知已分发或 Reviewer 已完成; 回执超时或连接失败时, 按 [消息交付规则](../specs/agent-repository-workflow/spec.md#background-agent-communication) 查询最近消息, 故障恢复时再核对可取得的原生历史, 自行决定后续动作, 不自动重发. 数据库保存失败导致新通知被拒时, Reviewer 记录回执给出的具体原因并继续完成绑定报告; Main Agent 仍按原生结束事实和报告判断结果, 不把未发送的通知当作已交付, 也不把 Reviewer 永久视为正在执行. `cursor` 只定位观察位置, 不确认模型已读取消息; `wait_agent` 被取消只释放等待和连接, 不停止审核, 不标记任务完成, 不提前删除未到期消息.

普通审核从本次审核等待开始达到 30 分钟且 Reviewer 仍在运行时, 与用户沟通的 Main Agent 报告当前状态及尚未核实的事实, 询问用户继续等待还是结束; 此后每次距上次提醒达到 15 分钟且 Reviewer 仍在运行时再次询问, 不设提醒次数上限. 每次询问后结束当前回复并等待用户决定, 未决定前保持 Reviewer 运行, 不自行停止或替换. 这项提醒只适用于普通审核, Reviewer Capability 验证和基准执行按各自运行合同处理.

收到管理程序按[Reviewer 运行合同](../specs/agent-repository-workflow/spec.md#reviewer-runtime)发出的累计主动早退暂停通知时, 与用户沟通的 Main Agent 向用户说明该任务的累计次数和当前暂停状态, 询问继续还是结束, 然后结束当前回复等待决定. 用户同意后, Main Agent 通过普通 `send_message` 向原任务发送工作指示, 程序恢复同一任务; 用户要求结束时使用 `interrupt_agent`. 等待决定期间只查询状态, 不向暂停任务发送工作消息, 不替用户决定继续. 程序拥有计数, 通知和暂停, Agent 只负责用户决定与对应控制操作.

工具进程会话丢失后, 重新连接机器入口, 使用 `list_agents` 和 `cursor` 观察仍在执行的审核, 再按需调用 `wait_agent`; 单纯工具断开不停止审核. 安全卸载后的新工作通过 `followup_task` 在准确原线程继续, 管理进程内部核对 `recoveryPath`, 角色, 线程身份及原设置, 取得容量后才交付本轮任务. 原线程或原有路径与设置无法恢复时明确失败, 不静默新建线程. `send_message` 与只读查询不加载已卸载线程. 已保存事实继续保留, 不能把未完成的残留报告交给后续工作流作为有效结果.

## Communication and observation

Agent 之间跨运行环境的通信只允许与用户沟通的 Main Agent 向 Reviewer 发送工作指示, Reviewer 向该 Main Agent 发送已核实问题, 必要进度, 阻塞或具体治理冲突等中途消息. 运行程序的自动工作指示通过现有通道交付, 保留程序来源身份; 自动错误恢复的检测和工作消息发送由程序负责, 不需要 Main Agent 或 Reviewer 转发. Reviewer 独立完成审核, 不向该 Main Agent 或用户索取信息, 征求同意或请求审批; 必要输入不足时, 按对应角色的规则返回 `incomplete`. Reviewer 核实问题后先写入绑定报告, 再通过 `arw background-agent` 的 `send_message` 及时通知. 使用运行环境提供的 `ARW_BACKGROUND_AGENT_RUN_ID` 作为准确 `runId`, 用 `message` 提交允许的通知正文, 保存管理进程返回的消息编号与状态; 编号不由 Reviewer 创建. 完成完整绑定报告后按角色格式结束原生回合. 最终交付按 [Reviewer 通信与会话规则](../specs/agent-repository-workflow/spec.md#communication-and-sessions)由运行层核实, Main Agent 从 `list_agents` 或 `wait_agent` 的 `completion` 取得结果并读取绑定报告. 原生普通进度文字和最终响应不自动生成 ARW 消息, 中途消息不替代报告或最终交付. 通用后台 Agent 管理进程按 [消息交付规则](../specs/agent-repository-workflow/spec.md#background-agent-communication) 保存并投递消息; Reviewer 运行层不另建进度队列. Main Agent 使用 `wait_agent` 按更新取得通知并按需再次等待, 同时独立核对绑定报告.

共享 Reviewer 运行层按[产品 Reviewer 运行规则](../specs/agent-repository-workflow/spec.md#reviewer-runtime)确认整个审核任务最终完整交付或已经确定结束, 再处理该根线程关联的后台终端, 核对绑定报告, 持久化并交接本轮结果, 最后释放占用保护. 同一审核任务仍需由程序续做时, 单次原生回合结束不触发上述完整收尾, 也不使原线程成为可供后续普通审核复用或安全卸载的空闲线程. 收尾失败时, Main Agent 根据具体原因处理, 不把原生最终状态或绑定报告单独当作有效 `ready`.

Reviewer 使用 Codex 原生 `on-request` 和 `auto_review` 处理仓库外访问, 保留 Codex 原生网络审批, `web_search` 与 MCP 设置, 不由 ARW 固定关闭网络. 与可以自行处理人工交互的 Main Agent CLI 不同, 独立 Reviewer 的请求不能转交给用户或与用户沟通的 Main Agent 代答. 如果 App Server 仍提出需要人工决定的用户输入, 权限或 MCP 请求, Reviewer 专属层按共同规则提供拒绝策略, 管理进程给出该类型原生协议允许的拒绝响应, 并使 Reviewer 在原生输入或结果中实际看到具体原因. 命令和文件审批使用继续当前回合的 `decline`, 不使用中断回合的 `cancel`. 拒绝只针对这次请求, Reviewer 继续本轮审核, 利用已有输入完成其余检查并维护绑定报告; 只有必要检查或报告确实无法完成时, 才说明具体不足并返回 `incomplete`, 不伪造同意或把残留草稿当完整结果.

墙钟时间覆盖 Reviewer 从首次实际审核开始到整个任务最终完整交付或确定结束的完整执行, 同一任务的工具错误, 提供方程序续做与故障恢复均保留整体计时. 原生 token 只计入该 Reviewer 根线程的实际响应, 对累计快照去重, 恢复原线程后不丢失或重复计量; 共享 App Server 的进程用量不能代替该线程的用量. 无法取得的墙钟或原生 token 保留明确未知, 不记为 0. ARW 不计算或持久交付成本. 计量和通知都不替代完整文件报告或正式结果授权.

## Evidence and scope

Canonical Role 定义审查对象以及结论可以使用的证据. Role 对已提供的 Input, 要求, issue, 文档或 Git 比较作出限制时, Reviewer 也不得发现这些类型的附加审查材料. 该限制不妨碍读取适用的 Agent 指令.

除非 Canonical Role 明确把审查证据责任分配给 Agent 指令, 不得使用 Agent 指令证明产品或设计结论. 不得借助对 Agent 指令的访问来发现额外的 issue, spec, PRD, ADR, 比较或其他审查对象.

## Review handoff

如果 Main Agent 为 Reviewer 指定写入文件, 在交接前保证该文件为空, 且 Reviewer 的最终回复只报告工作成功或失败而不包含问题条数等结论信息, 则最终绑定文件必须包含符合该角色输出格式的明确结论. 零字节文件不是合法最终结果; 没有 finding 时, Reviewer 也必须在指定文件中写入该角色规定的无问题表示. Main Agent 收到成功回复后仍须检查绑定文件, 不得把空文件解释为无问题, 补写为成功结果或交给 Engine 作为完整结论. 这使 Reviewer 写错位置而留下的空文件能够被发现. 文件非空只是必要条件, 仍须满足完整审查和该角色的其他接收要求.

与用户沟通的 Main Agent 按 [版本规则](#review-versions-and-concurrency)固定本次共同受审的完整内容. Reviewer 发现并核实 finding 后, 必须亲自将该问题立即写入同一次审查的结果文件或草稿, 以便 Main Agent 及时分析, 然后继续完成同一份 Input 的其余适用检查. Main Agent 如需中途了解具体问题, 直接读取该文件, 并可核对受审版本的证据和与用户讨论. 新的工作树内容不替换本轮快照.

后续证据要求修订或撤回 finding 时, Reviewer 原位修订或删除对应条目. 文件只保留当前结论, 不保留修订或撤回历史, 不添加正确案例说明. 审查完成前, 其中内容仍是草稿, Main Agent 不得把它当作完整结论, Engine Input, 授权或审核通过证据. Reviewer 完成全部适用检查并按 Canonical Role 完成最终交接后, Main Agent 才消费该完整结果. Spec Readiness 和 Commit Audit 继续分别按现有草稿与 Engine 正式生成边界处理, 不为逐项写入生成正式产物.

## Code Review evidence

审查涉及跨函数的数据传递时, 沿实际调用关系核对数据的含义, 归属和使用是否一致, 依据该角色的适用要求判断问题.

Code Standards 和 Code Spec 的每条 Markdown finding 使用相对于受审 Git 仓库的定位, 定位用反引号包裹; 同一对反引号内可以用逗号分隔多个文件的完整定位. 同一文件的多个不连续位置可以写成 `src/file.mjs:5,15-18,28-33`, 也可以分别写出每个位置的完整路径. 这使 Main Agent 能直接定位和处理原始报告, 无需猜测或修补证据.

每条 finding 只报告一个可独立成立和修复的缺陷, 合并同一根因的多处表现; 同一函数或同一段要求中的不同缺陷仍分条报告. 提供足以独立复核的最小完整证据. 结论依赖调用, 数据传递或顺序时, 引用实际建立该关系的必要位置并解释影响, 包括所需的跨文件证据. 行范围覆盖相关证据, 不以整段文件代替精确位置. 问题, 影响和修复建议中的每项断言都必须有适用要求和当前实现的依据. 只为问题提供这些说明, 不为已满足的检查增加说明或覆盖清单.

## Code Review results

Main Agent 为每个角色的每轮 Code Review 指定精确绝对 `resultPath`, 在受审 Git 仓库 `.tmp/` 内预建该文件并把路径交给 Reviewer. 运行交接的 `reportPath` 使用该准确路径, Reviewer 必须亲自将完整审核报告写入该文件, 并在审核过程中更新其中的当前结论, 其内容是当前 Markdown finding 列表. 每条 finding 的顶层列表项以 `- ` 或数字加 `. ` 开头, 缩进说明属于同一条 finding. 完成全部适用检查后, 没有问题时文件内容精确为 `No findings.`. 完成审查并写入完整结果后, 最终平台响应只返回 `{"status":"ready"}`. `ready` 表示结果已完整写入, 不表示没有 finding. Main Agent 已知该路径, 直接读取该文件, 不需要 Reviewer 重复返回路径或全文. 无法读取必要 Input, 无法写入 `resultPath` 或无法完成审查时, 只返回 `{"status":"incomplete","reason":"..."}`, 说明确切原因.

## Conflicts

如果适用的 Agent 指令相互冲突, 停止受影响的审查, 并按照 Canonical Role 的失败行为报告冲突的确切内容. 只继续不受冲突影响的独立审查工作.
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
None.
<!-- arw:repository-owned:end -->

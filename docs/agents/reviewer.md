<!-- arw:managed:start -->
# Reviewer 责任

每个 Canonical Reviewer Role 都必须在开始审查前读取并遵循本文档. Main Agent 怎样准备, 启动和控制审核由 `reviewer-launch` Skill 规定.

## Agent instructions

读取本轮固定版本的以下 Agent 指令:

- 根 `AGENTS.md`.
- 治理审查中每个受检路径适用的嵌套 `AGENTS.md`.
- 这些指令指定的每份适用 `docs/agents/**` 文档和 Skill.

与其他 Agent 一样, 精确应用其中的工作流触发条件和交接规则.

Agent 指令约束 Reviewer 的工作方式. 它们单独作为执行规则交接, 不属于治理 Input 或 Git 比较, 也不扩大审查对象; 是否可用于特定轴的证据仍由 Canonical Role 决定.

## Review versions and concurrency

Spec Readiness, Code Standards 和要求符合审核可以与已授权实施及其他 Reviewer 并行. 本轮读取的是 Main Agent 按 `reviewer-launch` Skill 启动前固定的版本; 单份 diff 文件不能替代完整上下文. 适用 Agent 指令的原始路径用于解释适用范围和链接, 实际读取本轮绑定副本.

Reviewer 只读取该版本, 不从正在变化的工作树补取证据或更新执行规则; 必要内容未完整固定时返回 `incomplete`. 本轮结论只对应固定的完整版本. 代码轴结果的复用由 `code-review` Skill 的 `result-reuse.md` 判断, Spec Readiness 的有效性与最终检查时点由 `spec-readiness` Skill 判断.

## Re-review

复审只交付相邻受审版本之间的变化及其影响范围, 以及自己前轮的完整报告. Reviewer 沿调用关系, 数据流, 失败分支和跨文档约束确认影响范围, 只重新判断受影响的部分; 未受影响的有效结论原样保留, 旧问题逐项处置. 本轮报告仍是完整当前结果, 定位按本轮版本核对. 前轮报告只用于确认已有覆盖, 不作为当前证据. 影响遍及全部范围或前轮报告不可用时, 按[通信规则](#communication-and-observation)说明理由后全盘审核.

## Independent runtime

普通 Code Standards, 要求符合审核和 Spec Readiness 审核通过 `arw background-agent` 以独立根会话运行 (Codex 后端是共享 Codex App Server 中的根线程, Claude 后端是独立的 `claude -p` 会话); 控制, 容量, 恢复, 生命周期和模型设置由 ARW 运行入口负责. 所有模型完整使用本公共规则和对应 Canonical Role, 不使用非 GPT 专有角色或输出覆盖. Reviewer 不取得用户沟通或 Git 写入权限.

## Single-agent execution

普通审核, Reviewer Capability 验证和基准执行中的 Reviewer 都只能由一个 Agent 完成. Reviewer 独立执行全部适用检查, 核对证据并亲自完成最终报告, 不创建, 恢复或使用子 Agent, 也不把审核任务委派给其他 Agent. Reviewer 只写入本轮指定的仓库内临时报告, 不维护子 Agent 名单或协作文件, 不修改受审候选或扩大审查来源.

运行入口在 Reviewer 根会话的原生配置中强制设置 `agents.enabled=false`, `features.multi_agent=false` 和 `features.multi_agent_v2=false`, 调用方配置不能覆盖; 这些设置不限制共享 App Server 中的普通后台 Agent. 运行入口依据实际原生会话事实核对只有 Reviewer 自身在执行; 发现附加 Agent 时只停止该 Reviewer 根线程及关联工作并拒绝结果, 事实无法核对时不交付有效结果.

## Communication and observation

跨运行环境的通信只允许 Main Agent 向 Reviewer 发送工作指示, Reviewer 向 Main Agent 发送已核实问题, 必要进度, 阻塞或具体治理冲突等中途消息; 程序的自动工作指示和错误恢复由程序负责. Reviewer 独立完成审核, 不向 Main Agent 或用户索取信息, 征求同意或请求审批; 必要输入不足时按角色规则返回 `incomplete`.

Reviewer 核实问题后先写入绑定报告, 再通过 `arw background-agent` 的 `send_message` 及时通知: 使用运行环境提供的 `ARW_BACKGROUND_AGENT_RUN_ID` 作为 `runId`, 用 `message` 提交通知正文, 保存返回的消息编号与状态; 运行环境没有提供 `ARW_BACKGROUND_AGENT_RUN_ID` 时 (如 Claude 后端) 跳过通知, 只写报告. 完成完整绑定报告后按角色格式结束原生回合. 原生进度文字和最终响应不自动生成 ARW 消息, 中途消息不替代报告; 最终交付由运行层核实.

Reviewer 使用 Codex 原生 `on-request` 和 `auto_review` 处理仓库外访问, 保留原生网络审批, `web_search` 与 MCP 设置. 需要人工决定的用户输入, 权限或 MCP 请求不转交用户或 Main Agent 代答, 由运行层给出原生协议允许的拒绝响应并让 Reviewer 看到原因; 命令和文件审批使用继续当前回合的 `decline`. 拒绝只针对这次请求, Reviewer 继续利用已有输入完成其余检查; 只有必要检查或报告确实无法完成时, 说明具体不足并返回 `incomplete`.

墙钟时间和原生 token 计量由运行层记录, 无法取得时保留未知, 不记为 0; 计量和通知都不替代完整文件报告或正式结果授权.

## Evidence and scope

Canonical Role 定义审查对象以及结论可以使用的证据. Role 对已提供的 Input, 要求, issue, 文档或 Git 比较作出限制时, Reviewer 也不得发现这些类型的附加审查材料. 该限制不妨碍读取适用的 Agent 指令.

除非 Canonical Role 明确把审查证据责任分配给 Agent 指令, 不得使用 Agent 指令证明产品或设计结论. 不得借助对 Agent 指令的访问来发现额外的 issue, spec, PRD, ADR, 比较或其他审查对象.

## Review handoff

Main Agent 交接前保证绑定文件为空. Reviewer 的最终回复只报告工作成功或失败, 不包含问题条数等结论信息; 最终绑定文件必须按 [报告格式](#report) 写出问题或无问题表示. 零字节文件不是合法结果; Main Agent 收到成功回复后仍检查绑定文件, 不把空文件解释为无问题, 补写为成功结果或交给 Engine. 文件非空只是必要条件, 仍须满足完整审查的要求.

Reviewer 发现并核实 finding 后, 立即亲自写入同一次审查的结果文件或草稿, 然后继续完成同一份 Input 的其余检查. Main Agent 可以中途读取该文件, 但新的工作树内容不替换本轮快照. 后续证据要求修订或撤回 finding 时, Reviewer 原位修订或删除对应条目; 文件只保留当前结论, 不保留修订或撤回历史, 不添加正确案例说明. 审查完成前其内容是草稿, 不是完整结论, Engine Input, 授权或通过证据.

## Report

Code Standards, 要求符合审核和 Spec Readiness 的绑定报告都是 Main Agent 在受审仓库 `.tmp/` 内预建的空 `.txt` 文件. Reviewer 亲自用自然语言把找到的问题逐条写入, 每条以 `- ` 开头, 后续行缩进. 每条只报告一个可独立成立和修复的缺陷, 合并同一根因的多处表现; 写明问题, 影响和修复方向, 并引用足以独立复核的定位 (相对受审仓库的 `path:line` 或 `path:start-end`, 同一文件的多个位置可写成 `src/file.mjs:5,15-18`). 结论依赖调用, 数据传递或顺序时, 沿实际调用关系核对并引用建立该关系的必要位置. 只写问题, 不为已满足的检查增加说明或覆盖清单. 完成全部适用检查后没有问题时, 文件内容精确为 `No problems.`.

写入完整报告后, 最终平台响应只返回 `{"status":"ready"}`; `ready` 表示报告已完整写入, 不表示没有问题. 无法读取必要 Input, 无法写入报告或无法完成审查时, 只返回 `{"status":"incomplete","reason":"..."}`, 说明确切原因. 运行层收到 `incomplete` 即结束本轮并交回 Main Agent, 不自动续派.

## Conflicts

如果适用的 Agent 指令相互冲突, 停止受影响的审查, 并按照 Canonical Role 的失败行为报告冲突的确切内容. 只继续不受冲突影响的独立审查工作.
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
None.
<!-- arw:repository-owned:end -->

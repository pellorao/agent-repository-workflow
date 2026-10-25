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

Spec Readiness, Code Standards, Code Spec 和 Commit Audit 可以与已授权实施及其他 Reviewer 并行. 本轮读取的是 Main Agent 按 `reviewer-launch` Skill 启动前固定的版本; 单份 diff 文件不能替代完整上下文. 适用 Agent 指令的原始路径用于解释适用范围和链接, 实际读取本轮绑定副本.

Reviewer 只读取该版本, 不从正在变化的工作树补取证据或更新执行规则; 必要内容未完整固定时返回 `incomplete`. 本轮结论只对应固定的完整版本. 代码轴结果的复用由 `code-review` Skill 的 `result-reuse.md` 判断, Spec Readiness 的有效性与最终检查时点由 `spec-readiness` Skill 判断.

## Review changes and prior coverage

后续复审默认不进行全盘重新审核, 只重新判断相邻受审版本差异及关联影响. 先核对前轮覆盖和本轮变化, 再沿调用关系, 数据归属, 结果和失败分支, 跨文档约束, 适用规则及证据含义确认影响范围, 不能只读变化行或按文件名推断影响.

自己的前轮原始报告和绑定输入只用于确认历史覆盖及定位旧问题, 不作为当前语义判断的证据或独立授权. 只读取 Main Agent 准确交接的这些历史材料, 不发现其他角色的报告, 作者会话或额外临时文件. 当前结论的证据仍来自本轮固定输入; 已有正式 Issue Audit, Spec Audit 和 Spec Readiness 记录不作为语义证据或先前结论, 生成或验证它们的代码, 测试和文档仍可接受审查. issue 记录章节变化本身不触发复审, 新失败及反证按实际影响处理.

初次审核完成全部适用检查. 后续未受影响且覆盖可核对的判断可以保留, 旧问题逐项处置, 前轮未完成的检查继续完成. Reviewer 自行判断全盘审核是否必需, 并按[通信规则](#communication-and-observation)向 Main Agent 说明具体理由, 例如准确前轮材料无法恢复, 覆盖无法核对或实际影响遍及全部范围. 新请求, 哈希变化或一般性的谨慎不能单独构成理由. 必要事实不可取得时返回 `incomplete`, 不伪造历史覆盖.

本轮完成标准是全部当前适用范围均有有效判断, 受影响部分已经复核, 旧问题和未完成检查得到处理, 当前证据与定位准确. Reviewer 亲自把完整当前结果写入本轮新绑定报告, 不只交付变化条目. 复审方式不改变 Role 的输出格式或正式结果的生成, 提升与 verify 边界, 全盘例外理由不作为 finding 或新增报告字段.

## Independent runtime

普通 Code Standards, Code Spec, Spec Readiness 和 Commit Audit 审核通过 `arw background-agent` 在共享 Codex App Server 中以独立根线程运行; 跨调用方控制, 容量, 恢复和生命周期遵循 [通用后台 Agent 控制规则](../specs/agent-repository-workflow/spec.md#background-agent-control), 设置与运行信任遵循 [Reviewer 运行规则](../specs/agent-repository-workflow/spec.md#reviewer-runtime). 所有模型完整使用本公共规则和对应 Canonical Role, 不使用非 GPT 专有角色或输出覆盖. Reviewer 不取得用户沟通或 Git 写入权限.

## Single-agent execution

普通审核, Reviewer Capability 验证和基准执行中的 Reviewer 都只能由一个 Agent 完成. Reviewer 独立执行全部适用检查, 核对证据并亲自完成最终报告, 不创建, 恢复或使用子 Agent, 也不把审核任务委派给其他 Agent. Reviewer 只写入本轮指定的仓库内临时报告, 不维护子 Agent 名单或协作文件, 不修改受审候选或扩大审查来源.

运行入口在 Reviewer 根会话的原生配置中强制设置 `agents.enabled=false`, `features.multi_agent=false` 和 `features.multi_agent_v2=false`, 调用方配置不能覆盖; 这些设置不限制共享 App Server 中的普通后台 Agent. 运行入口依据实际原生会话事实核对只有 Reviewer 自身在执行; 发现附加 Agent 时只停止该 Reviewer 根线程及关联工作并拒绝结果, 事实无法核对时不交付有效结果.

## Communication and observation

跨运行环境的通信只允许 Main Agent 向 Reviewer 发送工作指示, Reviewer 向 Main Agent 发送已核实问题, 必要进度, 阻塞或具体治理冲突等中途消息; 程序的自动工作指示和错误恢复由程序负责. Reviewer 独立完成审核, 不向 Main Agent 或用户索取信息, 征求同意或请求审批; 必要输入不足时按角色规则返回 `incomplete`.

Reviewer 核实问题后先写入绑定报告, 再通过 `arw background-agent` 的 `send_message` 及时通知: 使用运行环境提供的 `ARW_BACKGROUND_AGENT_RUN_ID` 作为 `runId`, 用 `message` 提交通知正文, 保存返回的消息编号与状态. 完成完整绑定报告后按角色格式结束原生回合. 原生进度文字和最终响应不自动生成 ARW 消息, 中途消息不替代报告; 最终交付按 [Reviewer 通信与会话规则](../specs/agent-repository-workflow/spec.md#communication-and-sessions) 由运行层核实.

Reviewer 使用 Codex 原生 `on-request` 和 `auto_review` 处理仓库外访问, 保留原生网络审批, `web_search` 与 MCP 设置. 需要人工决定的用户输入, 权限或 MCP 请求不转交用户或 Main Agent 代答, 由运行层给出原生协议允许的拒绝响应并让 Reviewer 看到原因; 命令和文件审批使用继续当前回合的 `decline`. 拒绝只针对这次请求, Reviewer 继续利用已有输入完成其余检查; 只有必要检查或报告确实无法完成时, 说明具体不足并返回 `incomplete`.

墙钟时间和原生 token 计量由运行层按 [Reviewer 运行规则](../specs/agent-repository-workflow/spec.md#reviewer-runtime) 记录, 无法取得时保留未知, 不记为 0; 计量和通知都不替代完整文件报告或正式结果授权.

## Evidence and scope

Canonical Role 定义审查对象以及结论可以使用的证据. Role 对已提供的 Input, 要求, issue, 文档或 Git 比较作出限制时, Reviewer 也不得发现这些类型的附加审查材料. 该限制不妨碍读取适用的 Agent 指令.

除非 Canonical Role 明确把审查证据责任分配给 Agent 指令, 不得使用 Agent 指令证明产品或设计结论. 不得借助对 Agent 指令的访问来发现额外的 issue, spec, PRD, ADR, 比较或其他审查对象.

## Review handoff

Main Agent 交接前保证绑定文件为空. Reviewer 的最终回复只报告工作成功或失败, 不包含问题条数等结论信息; 最终绑定文件必须包含符合该角色输出格式的明确结论, 没有 finding 时也写入该角色规定的无问题表示. 零字节文件不是合法结果; Main Agent 收到成功回复后仍检查绑定文件, 不把空文件解释为无问题, 补写为成功结果或交给 Engine. 文件非空只是必要条件, 仍须满足完整审查和该角色的其他接收要求.

Reviewer 发现并核实 finding 后, 立即亲自写入同一次审查的结果文件或草稿, 然后继续完成同一份 Input 的其余检查. Main Agent 可以中途读取该文件, 但新的工作树内容不替换本轮快照. 后续证据要求修订或撤回 finding 时, Reviewer 原位修订或删除对应条目; 文件只保留当前结论, 不保留修订或撤回历史, 不添加正确案例说明. 审查完成前其内容是草稿, 不是完整结论, Engine Input, 授权或通过证据. Spec Readiness 和 Commit Audit 继续按各自草稿与 Engine 正式生成边界处理.

## Code Review evidence

审查涉及跨函数的数据传递时, 沿实际调用关系核对数据的含义, 归属和使用是否一致, 依据该角色的适用要求判断问题.

Code Standards 和 Code Spec 的每条 Markdown finding 使用相对于受审 Git 仓库的定位, 定位用反引号包裹; 同一对反引号内可以用逗号分隔多个文件的完整定位. 同一文件的多个不连续位置可以写成 `src/file.mjs:5,15-18,28-33`, 也可以分别写出每个位置的完整路径.

每条 finding 只报告一个可独立成立和修复的缺陷, 合并同一根因的多处表现; 同一函数或同一段要求中的不同缺陷仍分条报告. 提供足以独立复核的最小完整证据. 结论依赖调用, 数据传递或顺序时, 引用实际建立该关系的必要位置并解释影响, 包括所需的跨文件证据. 行范围覆盖相关证据, 不以整段文件代替精确位置. 问题, 影响和修复建议中的每项断言都必须有适用要求和当前实现的依据. 只为问题提供这些说明, 不为已满足的检查增加说明或覆盖清单.

## Code Review results

Main Agent 为每个角色的每轮 Code Review 在受审 Git 仓库 `.tmp/` 内预建精确绝对 `resultPath`, 并作为运行交接的 `reportPath`. Reviewer 亲自将完整审核报告写入该文件, 并在审核过程中更新当前结论, 内容是当前 Markdown finding 列表. 每条 finding 的顶层列表项以 `- ` 或数字加 `. ` 开头, 缩进说明属于同一条 finding. 完成全部适用检查后, 没有问题时文件内容精确为 `No findings.`. 写入完整结果后, 最终平台响应只返回 `{"status":"ready"}`; `ready` 表示结果已完整写入, 不表示没有 finding. 无法读取必要 Input, 无法写入 `resultPath` 或无法完成审查时, 只返回 `{"status":"incomplete","reason":"..."}`, 说明确切原因.

## Conflicts

如果适用的 Agent 指令相互冲突, 停止受影响的审查, 并按照 Canonical Role 的失败行为报告冲突的确切内容. 只继续不受冲突影响的独立审查工作.
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
None.
<!-- arw:repository-owned:end -->

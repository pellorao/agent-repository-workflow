# 使用统一 Reviewer 配置与独立运行入口

本决定拥有规范 Reviewer Role, 两级用户配置, Reviewer 专属审核规则及其与独立后台运行入口的责任边界. [ADR 0026](0026-use-source-checkout-workflow-files-as-distribution-authority.md#decision) 拥有实际工作流来源与统一 Skill 投影配置; 通用 Repository-owned 初始文件仍由 Workflow Distribution 的配置声明. [ADR 0030](0030-use-user-wide-background-agent-management.md) 记录跨调用方后台 Agent 的架构选择; 准确控制和安装生命周期由 [产品规格](../specs/agent-repository-workflow/spec.md#background-agent-control) 与 [安装规格](../specs/agent-repository-workflow-installation/spec.md#background-agent-management) 拥有, 本决定不复制该通用合同.

## Context

规范 `Agent Role` 需要在 Codex 和 Claude Code 之间稳定保存职责, 输入, 指令, 输出, 约束和失败行为. Reviewer 的模型, 提供方, 推理强度与服务档位受用户配置和运行环境影响, 用户需要按仓库的质量, 延迟和成本目标调整它们.

将规范角色规则复制进用户配置会形成多份可编辑的业务规则权威, 将用户配置作为 Managed Content 又会妨碍正常的仓库定制. 普通审核与验证需要相同的运行合同, 原生会话控制和正式结果生成须分别拥有责任. 用户显式启动外部 Main Agent CLI 是另一项责任, 该启动器只执行用户配置的直接子进程, 不取得共享 Reviewer 运行控制或角色选择权.

静态配置无法证明固定 Codex Reviewer 的真实审核能力, 源码仓库发布仍需独立能力验证. Claude Code 保留静态 Skill, `CLAUDE.md`, 安装更新和平台投射的确定性支持, 原生 Reviewer 执行暂停, 不构成审核关卡豁免.

## Decision

每个分发的 `Agent Role` 都在 `docs/agents/roles/<role-name>.md` 安装一份由 ARW 管理的完整 Markdown 文件. `docs/agents/reviewer.md` 拥有所有 Reviewer 的共同责任, 每个规范 Role 拥有相应审核轴的行为. Role 文档使用固定的 `Responsibility`, `Inputs`, `Instructions`, `Output`, `Constraints`, `Failure behavior` 六段, 并要求先读取共同责任文档.

ARW 源码仓库把规范 Role 文档保存在它的已安装目标路径. 角色的稳定身份来自四份 Canonical Role 文档, 平台投射只传播完整文档与适用 Skill, 不另存平台原生 Reviewer 启动种子. 所有模型完整使用同一份公共 Reviewer 规则和对应规范 Role, 不另建非 GPT 专有规则.

Reviewer 用户设置保存在调用入口自然所属 Engine 目录的 `config.json` 与发起仓库的 `arw.config.json` 中, 两者的 `reviewers` 对象按四个 Canonical Role ID 保存运行设置, 配置来源, 字段格式与全局默认值由 [安装配置规格](../specs/agent-repository-workflow-installation/spec.md#reviewer-configuration) 拥有. 仓库配置为四个角色保留空对象, 各字段缺失时继承全局值, 使全局调整仍能影响没有覆盖这些字段的仓库. 安装与仓库工作流初始化或更新只补齐缺失的默认结构, 保留用户已有字段值; 仓库配置文件缺失时创建它. 这组设置独立于外部 Main Agent CLI 启动器的 Agent 条目.

普通审核消费合并后的用户设置, 不用角色名称查找旧平台配置或隐式覆盖用户选择. 能力验证和基准的隔离实例可以显式覆盖选定设置. 共享 Reviewer 入口把选定的模型, 提供方, 推理强度和服务档位传给原生线程与回合, 设置交付与运行信任由[产品运行合同](../specs/agent-repository-workflow/spec.md#reviewer-runtime)拥有; 配置默认值或请求参数都不证明实际服务权益和审核能力. Reviewer 只取得授权输入和临时写入范围, 不取得修改受审内容或 Git 暂存区的责任.

公开 `arw agent start <name> [agent-arguments...]` 可以从入口自然所属 Engine 目录的用户配置读取一个外部 Main Agent CLI 条目, 把 `<name>` 后的本次参数按原顺序追加到固定参数, 再在用户当前终端中启动可执行文件. 该命令不要求 `--` 分隔符, 不解释外部 CLI 选项, 也不读取, 选择或投影规范 Agent Role, 不把配置名称映射到 Reviewer 身份, 不创建命令解释器或新终端, 不承担共享 Reviewer 运行控制. 用户配置拥有可执行文件与固定参数; 用户拥有本次参数, 命令发起, 当前目录, 交互过程和外部 Main Agent 会话生命周期.

安装和仓库工作流分别维护所属的全局与仓库 Reviewer 配置. 缺失的文件或角色默认结构需要补齐, 才能让四个审核角色使用同一配置入口; 已有用户值保持不变, 不因默认值变化而刷新. 配置的语法和必需字段由各自的配置生命周期验证.

`arw workflow remove` 删除对应 Managed Content 时, 规范方案按仓库拥有的残留类别列出精确初始文件, 并要求对整批作出 `retain | delete` 选择. 用户明确授权后, ARW 可以删除这些精确文件; `retain` 时保留, 同一 Workflow Distribution 和相同输入的重新初始化可以复用这些仓库拥有的设置. 仓库自有表示没有未授权修改权, 不是 ARW 在得到显式方案授权后永远不能删除.

首期让一次操作对整批文件作出选择, 在明确授权与简单的方案和输入契约之间取平衡. 逐文件选择会增加交互式和非交互式协议; 需要分别处理时可以先选择 `retain`, 再由用户删除个别文件.

Reviewer 独立性由工作流约束, 不使用密码学. 普通四角色审核, 能力验证与基准执行通过用户级管理进程持有的共享 Codex App Server 中各自独立的根线程运行, 不通过与用户沟通的 Main Agent 的原生子 Agent 槽位启动. 独立 Reviewer 在自己的根线程中独自审核, 不创建子 Agent; 完整角色规则, 模型设置交付, 方向受限通信及根线程计量遵循[产品 Reviewer 工作流](../specs/agent-repository-workflow/spec.md#reviewer-workflow).

通用后台 Agent 运行负责跨仓库和多个 Main Agent 的单个共享 App Server, 独立根线程容量及恢复, 不按 Reviewer 角色限制所有后台任务. Reviewer 专属运行责任负责四个规范角色, 根线程内的单 Agent 审核, 人工审批后备, 报告绑定和该 Reviewer 根线程的墙钟与原生 token 观察. Reviewer 禁协作只作用于自身根会话, 违规时只停止该根线程及关联工作, 不终止其他根线程. 通用控制与 Reviewer 专属规则分别由上述产品规格和 [Reviewer 工作流](../specs/agent-repository-workflow/spec.md#reviewer-workflow) 拥有.

Reviewer 自己完成审核, 与用户沟通的 Main Agent 只提供工作指示, 接收角色允许的问题与进度通知及最终状态. Reviewer 不向用户或这位 Main Agent 索取信息或征求同意. 仓库外访问和网络审批由 Codex 原生 `on-request` 与 `auto_review` 处理; 如果 App Server 仍发来必须人工决定的原生请求, Reviewer 专属层提供拒绝策略, 管理进程给出该类型合法的拒绝响应, 让 Reviewer 在原生输入或结果中看到具体原因, 不转交人工或伪造授权. 拒绝只作用于该次请求, Reviewer 继续本轮审核; 只有必要检查或报告确实无法完成时才说明具体不足并返回 `incomplete`. 这项限制不替代 Codex 的安全策略.

普通线程身份由角色与完整排序后的 issue ID 集合组成, 第一次启动的 Reviewer 会话没有父对话, 同一身份的后续审核必须复用可靠原线程并消费完整当前输入. 候选字节, 摘要值, 文件哈希, 治理语义或结论变化不自动创建新线程. 只有 issue 集合改变, 原线程不可用或不可恢复, 或使用者明确要求时才新建线程, 恢复和活动指示不得静默改投. 能力验证和基准实例使用全新隔离会话, 不初始化或替代普通审核线程.

四种 Role 的后续复审按[当前版本与结果有效性合同](../specs/agent-repository-workflow/spec.md#review-versions-and-result-validity)默认检查相邻版本差异及关联影响. 自己已经完成的前轮原始报告和准确绑定输入可以证明历史覆盖, 当前语义证据仍取自完整当前输入. Reviewer 保留旧问题及未完成检查, 必要的全盘复审给出具体理由, 每轮亲自写入完整新报告. 可靠原线程与历史材料帮助减少重复审核, 不替代当前有效结果, 也不赋予通用后台管理程序历史语义覆盖或审核顺序的判断责任.

Reviewer 自行读取适用 Agent 指令, 指令不属于治理证据或审核对象. Reviewer 亲自把完整报告写入本轮绑定的文件, 最终平台状态只表示完整交付或不完整及适用理由. 共享 Reviewer 运行 Module 控制原生会话, 在启动模型回合前确认没有仍活动或会参与本轮的子 Agent, 并核对实际运行事实; 已结束且不参与本轮的历史线程不阻断可靠原线程复用. 既有 Engine 从报告机械生成正式结果, 再沿既有边界提升和验证. 两者不代写 Reviewer 的语义结论, 安装或外部 CLI 启动成功不成为运行能力证明.

源码仓库发布的 Reviewer Capability Conformance 使用共享 App Server 中独立的 Reviewer 根线程. 封闭的触发清单把共同 Reviewer 责任, 规范 Reviewer Role, 面向 Reviewer 的审计模式, 以及影响 Codex 的 Reviewer 工作流变化映射到受影响身份. 仅改变 Claude Code 的 Skill 或 `CLAUDE.md` 投射不产生实时移交, 只经过静态格式, 准确字节, 分发构建, 平台投射和变更检测的确定性验证.

一次完整准备冻结发布候选, 为每个受影响 Reviewer 的每个场景生成 3 个准确绑定且相互隔离的交接. 每个能力场景是已经准备的完整独立临时 Git 仓库, 包含场景适用的 Agent 指令, 共同责任与规范 Role, 运行入口不重复克隆或重映射. 每个实例只有 Reviewer 取得场景授权输入与临时写入范围, 不创建子 Agent, 不能读取源码仓库, 测试框架, 隐藏预期, 其他实例结果, 其他场景, 记忆或运行记录等禁止来源. 独立工作目录不等于配置或持久状态隔离.

发布结果绑定共同责任和规范 Role 的准确字节, 测试专属隔离说明由 `prepare` 交付, 不进入普通审核规则. 每个实例通过共享入口启动准确身份的无父对话新会话, Reviewer 亲自把完整报告写入本轮绑定的文件并返回现行状态, 再由维护入口按既有结果生成与验证合同消费完整报告, 根据隐藏预期评分并应用强制门禁. 能力线程不得转用于普通审核, 自动结果和会话证据均不能从摘要补造.

定向能力验证与发布能力验证使用相同的完整 Reviewer, 场景和重复边界, 但定向准备只检验当前优化方案, 不绑定发布候选或形成发布证据. 定向审查线程及结果不得复用为普通真实仓库审核. 发布是否执行实时关卡由该次发布的明确选择决定, 不把定向通过视为发布通过.

运行与验证交接必须保留每个实例中 Reviewer 原生线程的完整原生会话记录, 以准确线程 ID 唯一匹配并通过 `session_meta.payload.id` 验证完整 JSONL, 原生路径依据实际运行环境确定. 自动验证成功后, 与用户沟通的 Main Agent 检查全部受影响实例的 Reviewer 线程, 用严格允许列表核对读取, 写入, 工具调用和结果, 追加消息及最终状态, 只允许场景仓库和交接授权的准确绑定路径. 本轮没有子 Agent 参与及文件权限的事实仍须满足共享运行合同.

与用户沟通的 Main Agent 按[会话检查规则](../agents/reviewer-capability-session-inspection.md#inspection-boundary)核对交接与实际实例绑定. 工具结果或事件截断不自动使会话失败, 全部必需输入的覆盖观察仍仅作为优化证据. 发布报告记录 Reviewer 身份, Reviewer 原生线程 ID, 原生路径, 检查范围, 解析结果, 结论和必要问题; 原始记录保留在原生位置直到检查完成, 不自动清理或复制进已跟踪文件与自动验证器. Claude Code 不定义实时启动, 会话捕获或能力结果要求.

自动验证与全部会话检查都满足后才到达最终提交点. 每个 Reviewer 在当前有效候选上取得 3 次相互独立的完整重复; 每次包含全部适用场景, Spec Readiness 的两个场景按相同重复序号配对. 审核报告的错误处理, 各次重复的折减前与最终分数, 双平均分及最终分数门槛由[发布能力门禁](../specs/agent-repository-workflow-release/spec.md#reviewer-capability-gate)拥有. 每次独立运行的结果完整参与评分, 输入身份, 会话及来源隔离条件独立核对.

漏掉, 重复或增加规定 Reviewer, 重复或实例身份, 运行不可用, 输入绑定不匹配, 原生记录不可用, 无法解析或身份不匹配, 答案泄漏, 禁止来源或准备, 运行及传输故障使必要结果不可取得时, 整轮发布关闭式失败. 模型自身的报告内容错误与无法评分结果按发布能力评分合同处理. 本轮有子 Agent 参与或必要事实无法核对时不交接有效结果. 错误及候选, Role, 场景或评分合同变化后的恢复, 按[发布能力门禁](../specs/agent-repository-workflow-release/spec.md#reviewer-capability-gate)评估实际影响范围, 保留未受影响的有效结果, 并在需要时重新准备或重跑受影响范围. 会话观察不修补报告或进入自动评分, 少量原生试验不替代正式能力验证. 发布能力验证不成为每次普通审核, 提交, 初始化或更新的模型预检, 共享入口仍核对单 Reviewer 运行事实.

## Rejected alternatives

- 不把完整角色指令复制进用户配置. 可编辑配置中的副本会使角色规则分叉并阻止 Workflow Distribution 传播修正.
- 不把用户配置作为 Managed Content. 精确哈希归属会阻止用户适配模型, 成本和组织策略.
- 不为两个平台的工具和权限建立共享转换结构. 平台的语法和语义不同, 共享结构会变成第二份不完整的平台模型.
- 不用一个固定权限概况取代角色所需输入和默认值. Spec Readiness 读取请求快照, Code Review 与 Commit Audit 需要各自的 Git 读取和临时报告范围. 共享运行入口统一控制合同, 角色仍只取得职责所需输入和授权.
- 不把 Reviewer 运行设置保存在平台原生角色文件中. 两级用户配置为四个规范角色提供统一选择, 避免静态默认值与共享入口分别决定实际运行设置.
- 不为普通审核, 能力验证和基准分别维护执行器或增加管理模型. 共享原生入口避免规则与测量对象分叉, Reviewer 在自己的运行环境中独自审核并承担完整质量责任.
- 不把外部 Main Agent CLI 启动器当作 Reviewer 控制入口. 参数透传与直接子进程等待没有报告绑定, 单 Reviewer 运行核对或原线程指示责任, 两种入口分别拥有其生命周期.
- 不只依赖 Role 和 Projection 的静态测试作为 Codex 发布证明. 静态一致性不能发现固定 Codex Reviewer 实际无法完成审核的候选.
- 不把保留 Claude Code 静态投射解释为原生 Reviewer 执行支持. 维持格式, 字节和安装更新不取得真实启动, 会话捕获, 模型权益或能力关卡责任, 也不豁免任何必需审核.
- 不把验证器结果作为唯一发布证据. 正确响应不能证明 Reviewer 没有读取隐藏答案, 能力测试框架或其他禁止来源.
- 不规定仓库拥有的文件永远不能删除. 显式移除或卸载方案可以取得用户授权并安全删除精确目标.

## Consequences

规范角色行为通过 Managed Content 更新传播, 用户通过两级 Reviewer 配置调整运行设置. 安装与仓库工作流补齐缺失结构, 保留已有值. 共享 Reviewer 入口核对单 Reviewer 执行及授权文件范围的真实事实, 并拒绝违反这些约束的结果.

用户可以通过公开命令复用自己拥有的外部 Main Agent CLI 配置, 额外参数原样追加到固定参数, 启动器等待直接子进程并传播结果, 不解释恢复或其他平台选项, 不拥有该外部会话. 共享 Reviewer 运行 Module 控制独立 Reviewer 的原生会话, 与用户沟通的 Main Agent 交付完整输入并消费报告, Reviewer 独自完成审核. 这些责任不为多个可写 Main Agent 建立通用并发安全保证.

双平台静态安装共享一份规范 Role, Claude Code 保留 Skill 与 `CLAUDE.md` 投射. 模型默认不保证质量或延迟, 用户按环境调整, Reviewer 结果有效性来自工作流合同和实际核对. Reviewer 完整审核的墙钟及其根线程的原生 token 观察包括上下文压缩响应, 不可取得的观察保留未知. 共享 App Server 的进程用量不代替单个 Reviewer 的用量; ARW 不计算或持久交付成本, 成本比较由外部 `reviewer-model-benchmark` 工程负责.

原 Reviewer 的差异复审减少对未受影响范围的重复判断, 接受准确前轮输入和原报告需要能够核对的成本. 完整当前输入与完整新报告保持结果边界, 全盘复审由具体影响决定, 不为普通轮次增加持久覆盖格式或模型专有规则. 正式结果仍由所属 Engine 机械生成并按原边界提升与验证.

能力验证证明绑定角色字节, 场景版本, 发布候选与实际 Codex 环境的能力, 不证明其他环境或未来时间永久可用, 接受 Reviewer 原生线程记录, 隐私处理, 平台依赖与正式验证的延迟和费用. 运行入口保留原生事实, 与用户沟通的 Main Agent 完成会话检查与最终发布判定, Engine 的结果责任消费完整报告而不代写. Claude 静态验证不成为真实执行或能力证明, 不维护另一套 Reviewer 运行流程或承诺 Claude Main 已接入新入口.

受限工具, 授权输入和临时写入范围减少无关上下文与操作面, 工作目录与配置, 记忆和 MCP 的状态范围须分别处理. 这些约束是有界工作流保证, 不声称抵抗恶意运行环境.

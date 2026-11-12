# ARW 1.0 规范路线图

## Destination

一份可独立阅读, 足以指导后续实现的 ARW 1.0 完整规范 (Engine 运行合同, 规则到 graph 的转换, Jev 类模型的分流与复核, Reviewer 协议, 评测与转正, 并行流程隔离, 现有合同的取舍, 验收场景), 经独立审查; 附可行性结论, 写明哪些已经验证, 哪些仍有风险. 本 effort 到规范审查通过为止; 用户 11-08 定下规范通过后在单独分支上完整实现全部工作流, 定期合入 main, 全部实现后再合并回 main, 这一实施不属于本 effort.

## Notes

- 用户 11-07 定下的两个方向: 集成 Jev 类模型做任务分流; 不再以 Codex 为基础, 改为以 Engine 为基础工作. 按 10-25 讨论中用户的原话, 后者指 "代码中的确定性流程加 Jev 类模型的简单语义判断" 构成 ARW 的流程, 由它驱动用户和高智能 Agent, 而不是由 Codex (或 Claude Code) 中的 Main Agent 读规则推进; 用户 11-07 已确认这一理解, 见 [确定 ARW 1.0 的产品边界与 Agent 平台范围](issues/04-decide-product-and-platform-scope.md).
- 本 effort 只做可行性研究和方案起草: 不写运行时代码, 不改 main 上现行的 ARW 治理文档, 不增加 ADR 或项目术语表条目, 不发布. 规范正文写在单独克隆的 `arw-1.0` 分支上将来生效的位置, 见 [确定 ARW 1.0 规范的归属与交付形式](issues/06-decide-spec-home.md). 作为 Wayfinder 默认只规划的改写, 地图延伸到规范正文的编写与审查, 但不含实现.
- 10-25 的讨论记录, 旧路线图和旧研究只作参考. 其中的结论按当前 HEAD 或一手来源重新核实后才采用, 采用处注明 "参考 10-25 材料, 已于 MM-DD 核实". 10-25 时用户的表述 (例如待异步复核的写入动作上限为 3) 作为待用户重新确认的候选, 不直接计入 Decisions so far (写入动作上限 3 已于 11-12 由用户重新确认, 见 08); 其中 "Jev 类模型不担任正式 Reviewer" 已由用户 11-07 重新确认, "评测先用托管服务后用本地开源模型" 已被 11-07 的答复取代 (托管 Jev 只作评测基准).
- 需要用户决定的 grilling issue 不阻塞其他工作: Main Agent 把它写成自成一体的待决定事项交给用户, 先推进不依赖它的 issue, 用户答复后再记录 `## Answer`.
- 研究按 `research` Skill 使用一手来源. `domain-modeling` 与 `codebase-design` 只用于检验边界和情景, 不写入术语表或 ADR. 规范大纲用 `prototype`.
- 需要 GPU 或本地模型的可行性实验由 Main Agent 按本机资源规则另行排期, 下载和写盘量先报批.

## Decisions so far

- [核对当前 ARW 的流程驱动方式与 Engine 已有能力](issues/01-research-current-flow-driver.md): 现在由 Main Agent 按触发点读规则推进流程, Engine 只提供单项确定性操作, 没有调度命令; Engine 已有用户级后台管理进程, 可经 Codex App Server, `claude -p` 和 Strata 驱动 Reviewer 与后台 Agent; 改为 Engine 驱动会改变 7 项现行合同.
- [核对 Jev 类判别模型的能力与候选](issues/02-research-jev-class-models.md): Jev 只托管, 一次调用可批量回答多个固定选项问题, 价格极低, confidence 不等于答对概率, 官方未声明中文能力; 实测候选为托管 Jev, NeoHorse-Jev-4B, Laya multilingual 和一个未微调对照, 需带标签的 ARW 案例和约 10 GB 下载.
- [核对 Engine 控制 Agent 会话的平台能力](issues/03-research-engine-session-control.md): Codex App Server 与 `claude -p` stream-json 都能由程序启动, 继续, 观察, 中断会话并应答批准, ARW 已各有实现; 两边都不保证崩溃后接回执行中的回合; 第三方与本地模型只有 Codex 有官方路径 (Claude Code 一侧的实际可行性由下一项更正).
- [确定 ARW 1.0 的产品边界与 Agent 平台范围](issues/04-decide-product-and-platform-scope.md): 用户确认 "以 Engine 为基础" 即 Engine 中的确定性流程加 Jev 类模型的简单判断驱动用户和高智能 Agent; Codex 与 Claude Code 完全对等, 两边都支持本地与第三方模型. Claude Code 经 Anthropic Messages 兼容端点可接本地与第三方模型, 已有实例, 但 Anthropic 不支持且随版本漂移; 首版工作流覆盖与跨平台组合另列 issue.
- [确定 Jev 类模型在流程中的职责边界](issues/05-decide-jev-role-boundary.md): Jev 类模型不担任任何正式 Reviewer Role 或审核轴, 只做任务分流, 有明确检查项的预检和最终输出检查; 托管 Jev 只作速度与准确率基准, 正式方案优先找本地或其他托管替代.
- [确定 ARW 1.0 首版覆盖的工作流与跨平台组合](issues/17-decide-workflow-coverage-and-platform-mix.md): 规范覆盖全部现有工作流, 一次做完, 不设过渡期共存, 规范通过后在单独分支上实现; 与用户对话的入口由 Engine 提供, Engine 按用户选的 Main Agent 模型把话交给对应的 harness (Codex 或 Claude Code), 可同时控制多个 harness, 各角色所在 harness 不必相同.
- [定义 Engine 调用 Jev 类模型的接入方式](issues/16-define-judge-model-integration.md): Engine 在进程内直接调用 `/v1/systemone` 兼容接口, 不接成后台 Agent 提供方; 只用 choice 与 noul 题型, 托管与本地只靠配置切换, 密钥在仓库外私有文件, 判断模型是必需组件, 服务不可用时本机重新执行开启脚本后重试, 仍失败则流程停在可恢复状态并报告用户, 不交高智能 Agent 代答; 调用记录写在用户私有运行状态且默认不存原文.
- [定义 Jev 类模型的评测与转正条件](issues/11-define-evaluation-and-graduation.md): 以 Engine 关闭判断模型时的同类流程时长为对照, 质量守护沿用 Reviewer benchmark 与真实缺陷检出; 每类判断经离线评测, 影子, 全量复核, 抽样复核四步转正, 模型或题目变化即退回全量复核, 有害分歧超过 5% 或没有时间收益即停用; 托管模型只接收公开仓库案例.
- [确定本地判断模型服务的运行责任](issues/18-decide-local-judge-server-ownership.md): 判断模型是 Engine 必需组件, 不退化为交给高智能 Agent; 按本机, 机构内部部署, 公开部署的顺序选模型, 本机选能跑且够快的候选中智能最高的; ARW 配置时生成开启脚本, Engine 开工时执行并等就绪; 判断模型优先于同机 Strata; 用判断模型的整体任务执行要比不用时快很多.
- [确定 ARW 1.0 规范的归属与交付形式](issues/06-decide-spec-home.md): 规范写在单独克隆的 `arw-1.0` 分支上将来生效的位置, 合并回 main 时生效; 整体走一次按章分片加全局一致性的独立审查, 之后每个实施 issue 照常走 Spec Readiness.
- [定义 Engine 驱动流程的运行合同](issues/07-define-engine-runtime-contract.md): Engine 是由现有用户级后台管理进程扩展的常驻进程, 判断模型就绪后才开工; 流程定义是随 Engine 发布的 graph 数据加 Engine 代码中的原语 (由 22 细化), 步骤只有确定性操作, 判断, Agent 步骤和等待用户四类, 下一动作由定义和上一步结果唯一决定; 实例状态每步持久化, 仓库 Artifact 仍是交付权威; Engine 对所有 Agent 会话一视同仁, 不区分对话会话, worker 与 Reviewer 会话, 流程中的简单判断都经 Engine 交判断模型; 各 Agent 的唯一区别是工作开始时选定的模型, 整项工作 (含各轮修复与复审) 沿用同一会话与模型以利用缓存, 不自动换模型, 选模型分两段 (D22): 判断模型按任务概要输出难度, 推理强度, 速度要求等参数, 机械映射表把参数对到模型和推理强度, 判断模型未配置时由写概要的一步输出参数, 参数估计的校准题待测; 压缩后沿用原会话和原模型; Agent 步骤宜粗, 只在冻结, 门禁, Git 写入, 等用户处切分; 所有 Agent 步骤超时先问用户, 不中断; 任何 Agent 提议改 spec 由处置步骤加一个独立会话共同决定; Git 写入只由 Engine 执行, 以每个 Agent 步骤后的检测保证, 另对所有会话加不覆盖用户设置的窄范围拒绝 (用户 11-13 确认); Engine 对外提供配对后的 HTTPS 入口, 在用户登录时自启; 子流程压栈并继承写入者令牌, 并行实例按每仓库一个写入者令牌串行写入; 对话连续性由 Engine 的对话记录保持, 跨 harness 换模型时以交接消息开新会话.
- [确定 Engine 对话入口的形态](issues/19-decide-conversation-entry-form.md): 首版入口是 Engine 自带的网页, 局域网和远程设备也能连接; 不设账号密码, 设备第一次连接用本机生成的一次性授权码配对, 之后凭可撤销的设备凭据访问, 非回环访问走 TLS; 不复用 harness 的交互界面, 终端界面与 ACP 不进首版.
- [定义分流判断的复核与回退合同](issues/08-define-routing-review-and-rollback.md): 阈值以上的判断按阶段直接推进并由高智能 Agent 盲答异步复核, 阈值以下或影子阶段同步交高智能 Agent, 答错会跳过用户授权或正式关卡的单向题只在保守方向直接生效; 高智能 Agent 只答选项或 "交用户"; 投机写入每实例最多 3 个, 冻结审核候选, 提交, 外部操作和等待用户前须复核完毕; 恢复基线是 Engine 私有引用下的 Git 快照, 不用暂存区; 推翻时自动回退到第一个依赖写入之前并另存被撤销的状态, 回退范围内有用户改动就停下交用户. 上限 3 与推翻后自动回退 (不打断用户, 只撤本实例的投机写入, 撤销前另存快照可取回) 已由用户确认, 上限之后由实验校准.
- [定义 Reviewer 与正式关卡在 Engine 下的执行协议](issues/09-define-reviewer-protocol.md): 每个关卡按确定性检查, 提示类判断, 冻结 (屏障), 正式审核, 处置, 修复的顺序执行; 关卡结论只来自 Reviewer, 不经 08 复核; Reviewer 是 graph 中的普通 Agent 步骤, 与被审工作分开的会话, 复审回到原 Reviewer 会话, 处置与修复回到原 worker 会话; 不设覆盖清单, 逐单元送入或每轮抽查, Reviewer 输出只经通用检查, 审核质量靠 Reviewer benchmark (用户 11-13, D15); 结果失效与轴复用由 Engine 按冻结输入机械判断; 就绪记录升到版本 8, 删除 haiku 回退; 每轮交付审核包 (相邻 diff, 前轮发现和台账, 确定性检查结果, 改动文件列表), Role 中可机械判定的检查项移到第 1 步确定性检查; 作者判 "无效" 的处置带回原 Reviewer 会话复审, Reviewer 仍坚持才交用户. 判断模型在审核中只做提示类 (预检, 输出检查, "修复是否解决发现 X") 与范围类判断, 按用户 11-13 定下的四项目标 (高智能请求数, 整体墙钟, 上下文中规则与流程占比, 规则与流程误判率) 衡量; 审核内判断已由用户 11-13 确认 (提示类阈值以下不提示也不同步交高智能 Agent, 范围类首版不启用).
- [定义并行流程的读取与写入隔离](issues/10-define-parallel-flow-isolation.md): 视图一律是 Git 树对象; 持有令牌的写入链读工作区, 其他实例的正式依据是基准提交 (`HEAD`) 加自己的草稿, 冻结输入与判断 `state` 按对象 ID 固定, 所以推翻与回退只发生在写入链内部; 释放令牌是屏障; 令牌按全局先来先得发放, 多仓库一次取得; 等待令牌的实例在临时工作区起草并可先跑 Spec Readiness, 取得令牌后按与新 `HEAD` 的差异落盘; 步骤结果按输入对象 ID 复用, 被推翻的工作随快照交给重做步骤; 每个实例一个由 Engine 生成的 `.tmp/` 工作区, 不受令牌约束, 被忽略的共享路径只由写入链在工作区中写. 1.0 不提供 worktree 并行实施, 持有者等待用户时不让出令牌, 两处已由用户 11-13 确认.
- [确定现有 ARW 合同在 1.0 中的继承范围](issues/13-decide-legacy-contracts.md): 交付格式 (`.scratch` Artifact, Canonical ID, issue 格式) 与门禁语义 (Spec Readiness, Commit Audit, Reviewer 独立性) 原样保留, 执行机制改写, 旧握手与路径只作需求证据; 门禁与写入类命令从公开命令中删除, 改由 Engine 提供; Agent 要读的规则大幅减少, 大部分内置进 Engine, 其中多数机械执行, 少数由判断模型触发, 仓库仍经锁与受管区域分发缩减后的规则; 已采用的仓库在静止点一次性升级, 未完成的实施 issue 重跑 Spec Readiness; 锁升到 `lockSchemaVersion: 3` 使 0.x 关闭式失败; 保存 0.x 配置副本, 支持一次手工回退.
- [测量当前 ARW 流程的耗时分布](issues/12-research-flow-time-baseline.md): 本机近期实施交付中审核关卡耗时最多 (Claude Code 一侧等待 Reviewer 占 50%, Codex 一侧提交审核与 Spec Readiness 共 84%), 模型生成其次, 测试与命令约 12%; 每个实施 issue 中位数约 15 到 25 分钟; 提交审核通常 2 到 5 轮, 预检的收益主要在减少轮次.
- [确定判断模型与兼容端点的安装与配置](issues/20-decide-installation-and-configuration.md): 显式配置命令探测显卡 (只用整卡显存, 按进程不可见) 并按候选目录 (按 ARW 案例准确率排序, 固定运行时构建与模型文件的 SHA-256) 从高到低选第一个装得下且实测够快的本机候选, 否则机构内部端点, 公开端点需明确开启; 首版只收 llama.cpp 提供的 GGUF 判断模型, 由配置命令经用户确认后下载并校验; 生成的 Node.js 开启脚本有 `start` 与 `stop`, 只绑回环地址 (Engine 在 WSL 时判断模型在 Windows 侧, 需一次性管理员放行规则), 只让出登记的显卡占用者, Strata 经其 lease 让出且不抢占; harness 版本变化时对兼容端点角色先自检, 失败即停在可恢复状态. 四处已由用户 11-13 确认.
- [定义规则到 graph 的转换与 Engine 按 graph 执行](issues/22-define-rule-to-graph-conversion.md): 高智能模型在 ARW 源码仓库中按一个不分发的 Skill 把转换范围内的规则转成 graph 数据, 源映射和 Engine 代码中的新原语, 随 Engine 发布; graph 是声明式数据, 节点为程序 (调用原语), 判断 (一道 `choice` 或 `noul` 题), Agent (本步短指令与输出 schema), 等待用户, 子流程和终止, 每个结果值恰好一条边, 写入, 屏障, 正式关卡等属性由 Engine 机械使用; Engine 加载时静态校验, 实例绑定 graph 哈希后解释执行, 由此细化 07 的 "流程定义写在代码中"; 转换须过静态校验, 源映射完整, 独立会话写的分支夹具, 变异检查, 历史回放和常规 Spec Readiness 与 Commit Audit; 规则源是唯一权威, 段落哈希过期检查迫使规则改动后在同一提交中增量重新转换. 三处已由用户 11-13 确认.
- [确定现有规则正文迁入 Engine 的逐份去向](issues/21-decide-rule-migration.md): 分发的 156391 字符中, 流程定义 21%, 判断节点 0.6%, 程序检查 10%, 本步短指令 9% (合计 40% 进入转换范围, 不再分发), 保留的方法类 Skill 40%, 常读规则 3%, 原样交给 Reviewer 的文档 11%, 删除 5.5% (逐段写明理由); 9 个流程类 Skill 与 6 份 `docs/agents/` 文档不再分发, 根 `AGENTS.md` 缩到约 1.3K 字符; 一次实施流程读到的规则约少 70%, worker 读入内容中规则文档的占比由 31% 估计降到约 12% 到 13%, Reviewer 由 13% 降到约 9% 到 10% (待 E2 实测); 协作者经 Engine 创建, 机械参数移入 `arw.config.json`, 1.0 删除 Upstream Sync 流程及 `upstream/` (以后同步是普通任务, 改我们的 Skill 再转换或生成), `distribution/` 只删流程类 Skill 与 `docs/agents/` 相关部分; 三处取舍已按推荐定稿 (用户 11-13, D21).

## Not yet specified

- 审核循环中范围类判断 (按修复范围限定复审或复用另一轴) 是否启用, 以及放宽方向同步交高智能 Agent 还是作为 08 的例外: 历史统计中第 2 轮起的非记录类发现有 13 到 20% 落在上轮修复改动之外, 机械限定会漏掉它们, 范围类题在判断模型上尚无可用阈值; 是否启用取决于回放预测与端到端实测, 见 [定义 Reviewer 与正式关卡在 Engine 下的执行协议](issues/09-define-reviewer-protocol.md) 与 [本地 Jev 类候选的可行性小实验](issues/15-task-local-candidate-feasibility.md).
- 规范正文的编写顺序与分工, 取决于规范大纲.

## Out of scope

- 编写, 修改或发布 ARW 1.0 的运行时代码, 安装包和工作流投射文件.
- 修改 main 上现行的 ARW 治理文档, 增加 ADR 或项目术语表条目.

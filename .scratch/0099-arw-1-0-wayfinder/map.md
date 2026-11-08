# ARW 1.0 规范路线图

## Destination

一份可独立阅读, 足以指导后续实现的 ARW 1.0 完整规范 (Engine 运行合同, Jev 类模型的分流与复核, Reviewer 协议, 评测与转正, 并行流程隔离, 现有合同的取舍, 验收场景), 经独立审查; 附可行性结论, 写明哪些已经验证, 哪些仍有风险. 本 effort 到规范审查通过为止; 用户 11-08 定下规范通过后在单独分支上完整实现全部工作流, 定期合入 main, 全部实现后再合并回 main, 这一实施不属于本 effort.

## Notes

- 用户 11-07 定下的两个方向: 集成 Jev 类模型做任务分流; 不再以 Codex 为基础, 改为以 Engine 为基础工作. 按 10-25 讨论中用户的原话, 后者指 "代码中的确定性流程加 Jev 类模型的简单语义判断" 构成 ARW 的流程, 由它驱动用户和高智能 Agent, 而不是由 Codex (或 Claude Code) 中的 Main Agent 读规则推进; 用户 11-07 已确认这一理解, 见 [确定 ARW 1.0 的产品边界与 Agent 平台范围](issues/04-decide-product-and-platform-scope.md).
- 本 effort 只做可行性研究和方案起草: 不写运行时代码, 不改现有 ARW 治理文档, 不增加 ADR 或项目术语表条目, 不发布. 作为 Wayfinder 默认只规划的改写, 地图延伸到规范正文的编写与审查, 但不含实现.
- 10-25 的讨论记录, 旧路线图和旧研究只作参考. 其中的结论按当前 HEAD 或一手来源重新核实后才采用, 采用处注明 "参考 10-25 材料, 已于 MM-DD 核实". 10-25 时用户的表述 (例如待异步复核的写入动作上限为 3) 作为待用户重新确认的候选, 不直接计入 Decisions so far; 其中 "Jev 类模型不担任正式 Reviewer" 已由用户 11-07 重新确认, "评测先用托管服务后用本地开源模型" 已被 11-07 的答复取代 (托管 Jev 只作评测基准).
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
- [定义 Engine 调用 Jev 类模型的接入方式](issues/16-define-judge-model-integration.md): Engine 在进程内直接调用 `/v1/systemone` 兼容接口, 不接成后台 Agent 提供方; 只用 choice 与 noul 题型, 托管与本地只靠配置切换, 密钥在仓库外私有文件, 任何调用失败都按未分流交高智能 Agent, 调用记录写在用户私有运行状态且默认不存原文.
- [定义 Jev 类模型的评测与转正条件](issues/11-define-evaluation-and-graduation.md): 以 Engine 关闭判断模型时的同类流程时长为对照, 质量守护沿用 Reviewer benchmark 与真实缺陷检出; 每类判断经离线评测, 影子, 全量复核, 抽样复核四步转正, 模型或题目变化即退回全量复核, 有害分歧超过 5% 或没有时间收益即停用; 托管模型只接收公开仓库案例.
- [测量当前 ARW 流程的耗时分布](issues/12-research-flow-time-baseline.md): 本机近期实施交付中审核关卡耗时最多 (Claude Code 一侧等待 Reviewer 占 50%, Codex 一侧提交审核与 Spec Readiness 共 84%), 模型生成其次, 测试与命令约 12%; 每个实施 issue 中位数约 15 到 25 分钟; 提交审核通常 2 到 5 轮, 预检的收益主要在减少轮次.

## Not yet specified

- 现有约 19 万字符的 Skill 与规则正文怎样迁移: 哪些转为 Engine 代码, 哪些变成只给当前步骤的短指令, 哪些删除. 取决于运行合同和现有合同的取舍.
- 高智能 Agent 给出 0 到 1 置信度和解释的输出合同, 取决于分流与复核合同; 它与 Jev 类模型的分歧记在 Jev 类调用记录中 (见接入方式).
- 安装与配置: 本地候选模型的获取与版本固定, Claude Code 与 Codex 版本漂移后兼容端点失效的应对. 取决于运行合同和 [确定本地判断模型服务的运行责任](issues/18-decide-local-judge-server-ownership.md).
- 规范正文的编写与审查方式, 取决于规范归属和规范大纲.

## Out of scope

- 编写, 修改或发布 ARW 1.0 的运行时代码, 安装包和工作流投射文件.
- 修改当前 ARW 的治理文档, 增加 ADR 或项目术语表条目.

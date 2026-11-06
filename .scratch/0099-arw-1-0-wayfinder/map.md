# ARW 1.0 规范路线图

## Destination

一份可独立阅读, 足以指导后续实现的 ARW 1.0 完整规范 (Engine 运行合同, Jev 类模型的分流与复核, Reviewer 协议, 评测与转正, 并行流程隔离, 现有合同的取舍, 验收场景), 经独立审查; 附可行性结论, 写明哪些已经验证, 哪些仍有风险. 本 effort 不实施.

## Notes

- 用户 11-07 定下的两个方向: 集成 Jev 类模型做任务分流; 不再以 Codex 为基础, 改为以 Engine 为基础工作. 按 10-25 讨论中用户的原话, 后者指 "代码中的确定性流程加 Jev 类模型的简单语义判断" 构成 ARW 的流程, 由它驱动用户和高智能 Agent, 而不是由 Codex (或 Claude Code) 中的 Main Agent 读规则推进; 这一理解随 "确定 ARW 1.0 的产品边界与 Agent 平台范围" 一并交用户确认.
- 本 effort 只做可行性研究和方案起草: 不写运行时代码, 不改现有 ARW 治理文档, 不增加 ADR 或项目术语表条目, 不发布. 作为 Wayfinder 默认只规划的改写, 地图延伸到规范正文的编写与审查, 但不含实现.
- 10-25 的讨论记录, 旧路线图和旧研究只作参考. 其中的结论按当前 HEAD 或一手来源重新核实后才采用, 采用处注明 "参考 10-25 材料, 已于 MM-DD 核实". 10-25 时用户的表述 (例如 Jev 类模型不担任正式 Reviewer, 评测先用托管服务后用本地开源模型, 待异步复核的写入动作上限为 3) 作为待用户重新确认的候选, 不直接计入 Decisions so far.
- 需要用户决定的 grilling issue 不阻塞其他工作: Main Agent 把它写成自成一体的待决定事项交给用户, 先推进不依赖它的 issue, 用户答复后再记录 `## Answer`.
- 研究按 `research` Skill 使用一手来源. `domain-modeling` 与 `codebase-design` 只用于检验边界和情景, 不写入术语表或 ADR. 规范大纲用 `prototype`.
- 需要 GPU 或本地模型的可行性实验由 Main Agent 按本机资源规则另行排期, 下载和写盘量先报批.

## Decisions so far

- [核对当前 ARW 的流程驱动方式与 Engine 已有能力](issues/01-research-current-flow-driver.md): 现在由 Main Agent 按触发点读规则推进流程, Engine 只提供单项确定性操作, 没有调度命令; Engine 已有用户级后台管理进程, 可经 Codex App Server, `claude -p` 和 Strata 驱动 Reviewer 与后台 Agent; 改为 Engine 驱动会改变 7 项现行合同.
- [核对 Jev 类判别模型的能力与候选](issues/02-research-jev-class-models.md): Jev 只托管, 一次调用可批量回答多个固定选项问题, 价格极低, confidence 不等于答对概率, 官方未声明中文能力; 实测候选为托管 Jev, NeoHorse-Jev-4B, Laya multilingual 和一个未微调对照, 需带标签的 ARW 案例和约 10 GB 下载.
- [核对 Engine 控制 Agent 会话的平台能力](issues/03-research-engine-session-control.md): Codex App Server 与 `claude -p` stream-json 都能由程序启动, 继续, 观察, 中断会话并应答批准, ARW 已各有实现; 两边都不保证崩溃后接回执行中的回合; 第三方与本地模型只有 Codex 有官方路径.

## Not yet specified

- 现有约 19 万字符的 Skill 与规则正文怎样迁移: 哪些转为 Engine 代码, 哪些变成只给当前步骤的短指令, 哪些删除. 取决于运行合同和现有合同的取舍.
- 用户通过什么入口与 Engine 驱动的流程对话 (仍在 Codex 或 Claude Code 的交互会话里, 还是 Engine 自己的入口), 取决于产品边界与平台范围.
- 高智能 Agent 给出 0 到 1 置信度和解释的输出合同, 以及记录它与 Jev 类模型分歧的数据来源, 取决于分流与复核合同.
- 安装, 配置, 凭据, 以及托管 Jev 类服务可以接收哪些仓库内容, 取决于 Jev 类模型研究和评测设计.
- 规范正文的编写与审查方式, 取决于规范归属和规范大纲.

## Out of scope

- 编写, 修改或发布 ARW 1.0 的运行时代码, 安装包和工作流投射文件.
- 修改当前 ARW 的治理文档, 增加 ADR 或项目术语表条目.

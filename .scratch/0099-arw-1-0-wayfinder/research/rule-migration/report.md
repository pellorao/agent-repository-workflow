# 现有规则正文迁入 Engine 的逐份去向

## Scope

本记录是 Wayfinder issue [确定现有规则正文迁入 Engine 的逐份去向](../../issues/21-decide-rule-migration.md) 的归类清单. 对象是 1.0 之前的全部 Skill 与规则正文, 范围按 [确定现有 ARW 合同在 1.0 中的继承范围](../../issues/13-decide-legacy-contracts.md): 随 Workflow Distribution 分发的 Markdown (`distribution/baseline/` 与 `distribution/skills/`), 加上只在 ARW 源码仓库使用的规则 (根 `AGENTS.md` 与几份 `docs/agents/` 文档的仓库自有区域, 仓库自有 Skill). 不计入: 外部原样拷贝的上游来源, 模板和脚本等资产文件 (wizard 的 `template.sh`, hitl-loop 模板, `openai.yaml`, `.arwignore`), spec 与 ADR 等长期设计文档.

基准是 ARW 提交 `00f41f3`. 字符数是文件全文 (含 Skill 的 YAML front matter) 的 Unicode 字符数. 分发部分 82 份文件, 156391 字符; 源码仓库专用部分 17 项, 41367 字符; 合计 197758 字符 (约 19.8 万), 与 issue 中 "约 19 万" 一致. 同目录的 `classify.py` 记录每份文件的分段配额和去向说明, 运行即重算本记录的全部表格和合计.

## Classes

类别与 [定义规则到 graph 的转换与 Engine 按 graph 执行](../../issues/22-define-rule-to-graph-conversion.md) 的节点类型对齐. 前四类合称转换范围: 正文作为规则源留在 ARW 源码仓库, 由转换生成 graph 与源映射, 不再分发, Agent 不再阅读.

- F 流程定义: 步骤顺序, 分支, 路由, 等待用户, 子流程, 终止条件, 写入者令牌等, 转成 graph 的程序节点, 等待用户节点和边.
- Fj 判断节点: 规则中需要判断模型回答的 `choice` / `noul` 问题 (如 "这项改动是否需要用户决定").
- C 程序检查: 能由 Engine 或 `arw` 命令确定性执行的检查与操作 (字段, 路径, 格式, 命令退出码, Git 状态).
- S 本步短指令: 只有执行该步的 Agent 需要知道的做法, 随 Agent 节点下发, 连同输出 schema.
- K1 保留的 Skill: 方法类正文, 由需要它的步骤附带或按需读取.
- K2 常读规则: 每个 Agent 会话都读的少量原则与写作规则.
- K3 Reviewer 文档: 按 [定义 Reviewer 协议](../../issues/09-define-reviewer-protocol.md) 原样交给 Reviewer 的 Role 文档与通用 Reviewer 行为.
- D 删除: 1.0 中没有对应职责, 每段的理由见 Deletions 节.

## Totals

分发部分:

| 类别 | 字符 | 比例 |
|---|---|---|
| F | 32747 | 20.9% |
| Fj | 960 | 0.6% |
| C | 15072 | 9.6% |
| S | 13898 | 8.9% |
| K1 | 62862 | 40.2% |
| K2 | 4878 | 3.1% |
| K3 | 17347 | 11.1% |
| D | 8627 | 5.5% |
| 合计 | 156391 | 100% |

- 转换范围 (F+Fj+C+S) 62677 字符, 占分发部分 40.1%. 其中机械部分 (F+C) 占 76.3%, 判断节点占 1.5%, 本步短指令占 22.2%, 符合 D12 补充 "大多数规则机械运行, 少数由判断模型触发".
- 判断节点只占 1.5%, 因为现有规则中需要判断的地方大多要高智能判断 (如 Wayfinder 中 "是迷雾还是 issue"), 归入 S, 由 Agent 步骤输出; 只有能写成封闭问题的才归 Fj. 判断题的最终数量由转换与 E3 题集决定, 这里只是正文篇幅.
- 不计方法类 Skill (K1), 规则正文 93529 字符中 71304 字符 (76%) 离开 Agent 的阅读范围 (转换范围加删除).
- 1.0 仍分发的正文是 K1+K2+K3 共 85087 字符 (54%), 加上根 `AGENTS.md` 中一句 "ARW 流程只经 Engine 运行".

源码仓库专用部分 (示意): F 8400, C 6607, S 7529, K1 15904, K2 2927. 按 13 与 22 (用户 11-13 确认: 转换只在 ARW 源码仓库运行, 仓库自有规则仍是文本), 这部分在 1.0 中仍是仓库自有文本; 比例只表示若将来转换会落到哪里.

## Distributed files

比例一栏是各类在该文件中的字符比例; 一份文件跨类时按节拆分, 拆分依据写在去向一栏.

| 文件 | 字符 | 比例 | 1.0 去向 |
|---|---|---|---|
| `distribution/baseline/AGENTS.md` | 3582 | F 4% Fj 8% C 4% S 11% K2 33% D 41% | Efficiency First, Rule Conflicts, Output Text 常读; 体积预算的估算进写 issue 的短指令, 实测净增已由 `commit-audit prepare` 计算; Important Decisions 成为判断题 "是否需要用户决定" 与输出 schema 的 "交用户"; Workflow Triggers 与 Agent Writes 指针按 13 删除 |
| `distribution/baseline/docs/agents/agent-writes.md` | 2623 | F 78% C 8% S 14% | 写入范围, 恢复基线, 写入者令牌进流程定义 (07, 08, 10); 每步后的 Git 检测是程序检查; "需改范围外文件先报告" 与交付证据成为输出 schema 与短指令 |
| `distribution/baseline/docs/agents/environment.md` | 1002 | F 35% C 15% S 30% D 20% | 工作区路径由 Engine 生成 (13); "原样使用绑定路径" 成为短指令; 平台会话 ID 规则删除 |
| `distribution/baseline/docs/agents/parallel-implementation.md` | 918 | D 100% | 1.0 不提供 worktree 并行实施 (10, 用户 11-13 确认) |
| `distribution/baseline/docs/agents/repository-terminology.md` | 589 | K2 100% | 写作规则的一部分 |
| `distribution/baseline/docs/agents/reviewer.md` | 5009 | F 17% C 14% S 10% K3 57% D 1% | Re-review, Evidence, Report 格式, Conflicts 等 Reviewer 行为保留 (09); 独立运行, 单 Agent 强制, 拒绝转交, 空报告与 `ready`/`incomplete` 由 Engine 执行; 单命令规则与中途通知协议成为 Reviewer 步骤的短指令 |
| `distribution/baseline/docs/agents/roles/code-standards-reviewer.md` | 2466 | K3 100% | 按 09, 13 原样交给 Reviewer; 输出加覆盖清单 (09); 预检题由转换从检查项生成 |
| `distribution/baseline/docs/agents/roles/requirements-reviewer.md` | 2008 | K3 100% | 同上 |
| `distribution/baseline/docs/agents/roles/spec-readiness-reviewer.md` | 6804 | K3 100% | 同上 |
| `distribution/baseline/docs/agents/roles/spec-readiness-reviewer/challenges.md` | 457 | K3 100% | 同上 |
| `distribution/baseline/docs/agents/roles/spec-readiness-reviewer/findings.md` | 801 | K3 100% | 同上 |
| `distribution/baseline/docs/agents/roles/spec-readiness-reviewer/module-design.md` | 1933 | K3 100% | 同上 |
| `distribution/baseline/docs/agents/specification-presentation.md` | 1177 | K1 100% | 写 spec 的方法文档, 由写 spec 的步骤附带 |
| `distribution/baseline/docs/agents/subagent-allocation.md` | 2267 | F 93% D 7% | 会话的创建, 复用与按档位取模型进流程定义, 具体取决于决定 A |
| `distribution/baseline/docs/agents/subagent-findings.md` | 1761 | F 45% S 55% | 核对, 按来源分流, 质疑写法成为处置步骤的短指令 (09); 何时交用户, 授权结果不可覆盖, 质疑的路由进流程定义 |
| `distribution/baseline/docs/agents/subagent-model-setup.md` | 453 | F 56% S 44% | 档位映射的首次配置成为配置流程: 调研模型的 Agent 步骤, 等待用户批准, Engine 写配置 |
| `distribution/baseline/docs/agents/writing.md` | 3246 | F 10% C 11% K2 79% | 写作规则常读; `language inspect`, UTF-8 与 LF 等由程序检查; 指向其他文档的读取指令由流程定义按步骤附带 |
| `distribution/skills/application-workflow/SKILL.md` | 1197 | F 100% | 生命周期路由与 "需要相应授权" 成为流程定义中的分支与等待用户节点 |
| `distribution/skills/application-workflow/references/association-and-distribution.md` | 1311 | F 69% C 23% S 8% | 前提核对与发布顺序进流程定义 (外部写入是 08 的屏障); 关联命令已是确定性操作 |
| `distribution/skills/application-workflow/references/configuration.md` | 933 | F 25% C 32% S 43% | 起草 `arw.config.json` 是 Agent 步骤; 配置校验是程序检查 |
| `distribution/skills/application-workflow/references/jira-acceptance.md` | 892 | F 56% C 22% S 22% | 展示与授权是等待用户节点, 提交, 推送, `jira accept` 是确定性操作 |
| `distribution/skills/application-workflow/references/jira-completion.md` | 825 | F 73% C 27% | 同上, `jira complete` |
| `distribution/skills/application-workflow/references/module-correction.md` | 1200 | F 25% C 33% S 42% | 授权门是等待用户节点; `Downstream changes` 写法成为短指令, 结构由 `module check-correction` 检查 |
| `distribution/skills/application-workflow/references/recovery.md` | 803 | F 75% S 25% | 各失败点的恢复路径进流程定义 (07 的失败合同) |
| `distribution/skills/application-workflow/references/synchronization.md` | 980 | F 29% C 71% | `application sync` 的行为已在代码中; 前提与之后的提交进流程定义 |
| `distribution/skills/arw-commands/SKILL.md` | 3701 | F 2% K1 46% D 52% | 只读与检查类命令的参考保留, Agent 步骤可当工具运行 (13); 门禁与写入类命令说明删除 (13 从公开命令中删除), 用户可见命令的用法归用户手册 |
| `distribution/skills/arw-commands/post-init-handoff.md` | 1014 | F 49% S 51% | 升级后审核流程 (13): 顺序与 "恰好一个补全 issue" 进流程定义, 各审计项成为短指令 |
| `distribution/skills/code-maps/SKILL.md` | 1803 | F 14% C 14% K1 72% | 写 Code Map 的方法保留; 何时读由流程定义按 Repository Profile 附带; `code-map verify` 是程序检查 |
| `distribution/skills/code-review/SKILL.md` | 4236 | F 57% C 43% | 非提交 Code Review 流程: 比较解析, 路径过滤, 绑定副本是确定性操作; 启动两轴与汇总进流程定义 (09) |
| `distribution/skills/code-review/explicit-range.md` | 573 | C 100% | 确定性比较解析 |
| `distribution/skills/code-review/result-reuse.md` | 828 | F 75% C 12% S 13% | 轴结果复用由 Engine 按冻结输入机械判断 (09); 完成记录核对是程序检查 |
| `distribution/skills/codebase-design/DEEPENING.md` | 1327 | K1 100% | 方法保留 |
| `distribution/skills/codebase-design/DESIGN-IT-TWICE.md` | 1432 | F 17% K1 83% | 方法保留; 并行协作者的分配随决定 A 改写 |
| `distribution/skills/codebase-design/SKILL.md` | 3580 | K1 100% | 方法保留 |
| `distribution/skills/commit/SKILL.md` | 1113 | F 50% C 23% S 27% | 分类由 `verify --non-implementation` 机械完成; 提交说明由 Agent 步骤起草 |
| `distribution/skills/commit/fix-rounds.md` | 1096 | F 55% S 45% | 轮次计数, 第 3 轮规则, 台账交接进流程定义 (09); 台账条目写法, 行为缺陷与冲突裁决由处置步骤判断 |
| `distribution/skills/commit/implementation-workflow.md` | 3103 | F 52% C 39% S 10% | 步骤顺序进流程定义; `prepare` 摘要与 warning, 记录差异核对, `verify` 是程序检查; 启动前自查成为短指令 |
| `distribution/skills/commit/non-implementation-workflow.md` | 1659 | F 24% C 66% S 10% | 封闭分类与机械检查已在 `verify --non-implementation`; 规则文档例外的单轮 Reviewer 进流程定义 |
| `distribution/skills/diagnosing-bugs/SKILL.md` | 4202 | K1 100% | 方法保留 |
| `distribution/skills/domain-modeling/ADR-FORMAT.md` | 1272 | K1 100% | 方法保留 |
| `distribution/skills/domain-modeling/CONTEXT-FORMAT.md` | 1339 | K1 100% | 方法保留 |
| `distribution/skills/domain-modeling/SKILL.md` | 2659 | F 4% K1 96% | 方法保留; 写入前的指针改由流程定义给写入范围 |
| `distribution/skills/grill-me/SKILL.md` | 108 | K1 100% | 用户入口, 保留 |
| `distribution/skills/grill-with-docs/SKILL.md` | 384 | F 39% K1 61% | 保留; 写入前的指针改由流程定义给写入范围 |
| `distribution/skills/grilling/SKILL.md` | 1312 | F 34% K1 66% | 追问方法保留给对话会话; 决定项的选项, 推荐与 "只有用户明确选择才算确认" 由 Engine 的等待用户节点承担 (07) |
| `distribution/skills/implement/SKILL.md` | 2785 | F 47% Fj 7% C 20% S 21% D 5% | Entry 的授权条件 (Status, 阻断项, 就绪 `verify`) 进流程定义与程序检查; "配套修改是否增加行为" 成为单向判断题; 实施方法成为短指令 |
| `distribution/skills/improve-codebase-architecture/HTML-REPORT.md` | 3867 | K1 100% | 方法保留 |
| `distribution/skills/improve-codebase-architecture/SKILL.md` | 2778 | F 7% K1 93% | 方法保留; 协作者分配随决定 A 改写 |
| `distribution/skills/issue-tracking/SKILL.md` | 3001 | F 23% C 51% S 26% | 格式, `Status` 取值, 记录章节机械核对, Artifact 发现是程序检查; 状态转换与读取范围授权进流程定义; "写到最终状态, 对照用户原话" 等写法成为起草 issue 的短指令 |
| `distribution/skills/issue-tracking/artifact-model.md` | 1331 | F 18% C 62% S 20% | 编号与身份规则是程序检查; "一个 effort 一个主要目标" 等成为起草步骤的短指令; Wayfinding 规则进流程定义 |
| `distribution/skills/prototype/LOGIC.md` | 2384 | F 8% K1 92% | 方法保留 |
| `distribution/skills/prototype/SKILL.md` | 1094 | F 55% K1 45% | 原型方法保留; 由 Main Agent 分配与回交的句子改为子流程与输出 schema |
| `distribution/skills/prototype/UI.md` | 3233 | K1 100% | 方法保留 |
| `distribution/skills/research/SKILL.md` | 507 | F 41% K1 59% | 一手来源方法保留; 分配协作者进流程定义 |
| `distribution/skills/retro/SKILL.md` | 2156 | K1 100% | 保留; Files 节描述 0.x 的规则加载方式, 需按 1.0 (规则源, graph, 常读规则) 改写 |
| `distribution/skills/reviewer-launch/SKILL.md` | 2731 | F 33% D 67% | Agent 操作 `arw background-agent` 的平台说明, haiku 回退 (09 删除), 按需读取指针删除; 审核轮步骤, 抽查 (改由 Engine 随机选, 09), 30 分钟等待进流程定义 |
| `distribution/skills/reviewer-launch/capacity-priority.md` | 493 | F 100% | 关卡 Reviewer 优先与名额预留由 Engine 调度 |
| `distribution/skills/reviewer-launch/machine-operations.md` | 1266 | D 100% | Agent 控制后台 Agent 的机器接口说明; Engine 直接用会话层 (07), 不再给 Agent |
| `distribution/skills/reviewer-launch/other-reviews.md` | 947 | F 53% D 47% | 无 `prepare` 审核的请求组装由 Engine 完成; 字段清单删除 |
| `distribution/skills/rule-and-design-changes/SKILL.md` | 1728 | F 47% Fj 9% C 2% S 9% K2 32% | 受保护文档判断成为判断题, 用户确认成为等待用户节点, Reviewer 提出的 spec 修改按 09 的共同决定; 长期文档写法与 "不改受管区域" 并入常读写作规则 |
| `distribution/skills/spec-readiness/SKILL.md` | 4945 | F 38% Fj 3% C 31% S 23% D 4% | 授权时点 ("已开始实施" 按实例状态, 09), subject 规范化, `generate`/`promote`/`verify` 是程序与流程; "只涉及措辞" 成为单向判断题; Governing design 与 `prepare` 前自检成为写 spec 与处置步骤的短指令; Responsibilities 按 09 删除 |
| `distribution/skills/spec-readiness/exception-workflow.md` | 591 | F 59% C 41% | 用户确认是等待用户节点, 记录生成是确定性操作 |
| `distribution/skills/spec-readiness/respond-to-findings.md` | 1135 | F 30% S 70% | 修正后的自检清单成为处置步骤的短指令; 质疑与重新 `prepare` 进流程定义 |
| `distribution/skills/tdd/SKILL.md` | 1615 | K1 100% | 方法保留 |
| `distribution/skills/tdd/mocking.md` | 804 | K1 100% | 方法保留 |
| `distribution/skills/tdd/tests.md` | 1698 | K1 100% | 方法保留 |
| `distribution/skills/teach/GLOSSARY-FORMAT.md` | 788 | K1 100% | 方法保留 |
| `distribution/skills/teach/LEARNING-RECORD-FORMAT.md` | 1181 | K1 100% | 方法保留 |
| `distribution/skills/teach/MISSION-FORMAT.md` | 686 | K1 100% | 方法保留 |
| `distribution/skills/teach/RESOURCES-FORMAT.md` | 912 | K1 100% | 方法保留 |
| `distribution/skills/teach/SKILL.md` | 3194 | K1 100% | 方法保留 |
| `distribution/skills/test-performance-optimization/SKILL.md` | 3012 | F 11% K1 89% | 测量与优化方法保留; 开工授权与新损失交用户进流程定义 |
| `distribution/skills/test-value-cleanup/SKILL.md` | 3463 | F 27% K1 73% | 清理方法保留; 用户发起, 损失授权, 最终验收与审核进流程定义 |
| `distribution/skills/to-questionnaire/SKILL.md` | 1197 | K1 100% | 方法保留 |
| `distribution/skills/to-spec/SKILL.md` | 1538 | F 13% S 26% K1 61% | spec 模板与写法保留; 测试边界交用户核对进流程定义 |
| `distribution/skills/to-tickets/SKILL.md` | 1951 | F 21% C 15% S 64% | 切片方法成为拆分步骤的短指令, 交用户确认进流程定义, issue 格式由程序检查 |
| `distribution/skills/validation/SKILL.md` | 2435 | F 25% Fj 6% C 36% K1 33% | 必要检查与单回调耗时测量是程序检查; 结果复用与并行由 Engine 按输入身份; "失败是否由执行环境造成" 成为判断题; 覆盖原则保留给写测试的步骤 |
| `distribution/skills/wait-what/SKILL.md` | 187 | K1 100% | 用户入口, 保留 |
| `distribution/skills/wayfinder/SKILL.md` | 4578 | F 41% C 4% S 55% | 领取, 解决, 更新地图的顺序与 Ticket Types 对应的步骤类型进流程定义; 地图写法与 "迷雾还是 issue" 成为短指令 |
| `distribution/skills/wizard/SKILL.md` | 2264 | F 9% K1 91% | 方法保留; 开工授权指针改由流程定义 |
| `distribution/skills/writing-for-agents/SKILL-MECHANICS.md` | 1314 | K1 100% | 方法保留 |
| `distribution/skills/writing-for-agents/SKILL.md` | 4624 | K1 100% | 方法保留 |

## Source checkout files

示意, 1.0 中保留为仓库自有文本. `#repository-owned` 指该文件的仓库自有区域.

| 文件 | 字符 | 比例 | 1.0 去向 |
|---|---|---|---|
| `AGENTS.md#repository-owned` | 2653 | C 26% K2 74% | 仓库自有, 按 13 原样保留; 测试命令与单回调阈值是 Engine 要机械使用的参数, 见决定 B |
| `docs/agents/source-checkout-coverage.md` | 3585 | K1 100% | 仓库自有, 保留 |
| `docs/agents/source-checkout-issue-workflow.md` | 151 | K2 100% | 仓库自有, 保留 |
| `docs/agents/source-checkout-reviewer-testing.md` | 902 | K1 100% | 仓库自有, 保留 |
| `docs/agents/source-checkout-validation.md` | 1241 | C 100% | 验证命令清单, 见决定 B |
| `docs/agents/subagent-allocation.md#repository-owned` | 669 | F 100% | 模型映射表, 见决定 A, B |
| `docs/agents/writing.md#repository-owned` | 823 | K2 100% | 仓库自有写作例外, 保留 |
| `.agents/skills/platform-standards/SKILL.md` | 2311 | K1 100% | 维护者方法, 保留 |
| `.agents/skills/release/SKILL.md` | 5502 | F 45% C 27% S 27% | 仓库自有流程; 按 22 (用户 11-13 确认: 转换只在 ARW 源码仓库运行, 仓库自有规则仍是文本) 保留为 Skill, 比例只示意转换时会落到哪里 |
| `.agents/skills/release/references/fixtures.md` | 950 | S 100% | 同上 |
| `.agents/skills/release/references/publication.md` | 4041 | F 42% C 16% S 42% | 同上 |
| `.agents/skills/release/references/vm.md` | 5695 | K1 100% | 同上 |
| `.agents/skills/reviewer-capability/SKILL.md` | 7643 | F 41% C 20% S 39% | 同上 |
| `.agents/skills/reviewer-capability/drift-check.md` | 1020 | C 100% | 同上 |
| `.agents/skills/reviewer-capability/last-results.md` | 202 | K1 100% | 同上 |
| `.agents/skills/unattended-run/SKILL.md` | 770 | F 50% S 50% | 同上; 驱动程序扮演用户的文本协议在 1.0 应改接 Engine 的机器入口, 留给规范 |
| `.agents/skills/upstream-sync/SKILL.md` | 3209 | K1 100% | 维护者流程, 保留; 适用范围见决定 C |

## Distribution after 1.0

按 Skill 和文档汇总 1.0 中的去向. "不再分发" 指正文只作为 ARW 源码仓库中的规则源, 目标仓库不再安装.

- 不再分发 (全部进入转换范围或删除): `application-workflow`, `code-review`, `commit`, `implement`, `issue-tracking`, `reviewer-launch`, `spec-readiness`, `to-tickets`, `wayfinder` 这几个 Skill; `docs/agents/` 下的 `agent-writes.md`, `environment.md`, `parallel-implementation.md`, `subagent-allocation.md`, `subagent-findings.md`, `subagent-model-setup.md`. 这些 Skill 的 `openai.yaml` 随之删除.
- 缩减后仍分发 (流程段落进转换范围, 方法段落保留): `arw-commands` (只留只读与检查类命令的参考), `code-maps`, `validation` (只留 Coverage principles), `rule-and-design-changes` (两段常读写作规则, 可并入 `writing.md`), `to-spec`, `grilling`, `grill-with-docs`, `research`, `prototype`, `codebase-design`, `domain-modeling`, `improve-codebase-architecture`, `test-performance-optimization`, `test-value-cleanup`, `wizard`.
- 原样分发: `diagnosing-bugs`, `tdd`, `teach`, `to-questionnaire`, `wait-what`, `writing-for-agents`, `grill-me`, `docs/agents/specification-presentation.md`, `repository-terminology.md`, `reviewer.md` 的 Reviewer 行为部分, 全部 Reviewer Role 文档.
- 需要改写: `retro` 的 Files 节列的是 1.0 之前的记录位置, 按 1.0 的实例记录改写.
- 根 `AGENTS.md` 缩为 Efficiency First, Rule Conflicts, Output Text 三节, 加一句 "ARW 流程只经 Engine 运行"; 约 1.3K 字符.

## Rules read per step

以下是推断, 按正文字符数估算, 未按 token 测量; 由 [任务内候选可行性](../../issues/15-task-local-candidate-feasibility.md) 的 E2 回放实测.

现行一次实施到提交的 worker 流程 (目标仓库, 不含方法类 Skill) 按触发读取: 根 `AGENTS.md`, `implement`, `issue-tracking` (含 `artifact-model.md`), `validation`, `writing.md`, `agent-writes.md`, `environment.md`, `subagent-allocation.md`, `subagent-findings.md`, `commit` (含 `implementation-workflow.md`, `fix-rounds.md`), `reviewer-launch`, 合计约 32.1K 字符; ARW 源码仓库再加仓库自有区域与验证文档约 4.7K, 约 36.8K. 用 `tdd` 时再加 4.1K.

1.0 中同一流程的 Agent 只读到:

- 每个会话常读: 根 `AGENTS.md` 的常读部分约 1.3K.
- 本步短指令: 整条流程合计约 4.8K, 单步约 0.3K 到 1.8K, 只在该步下发.
- 写仓库文本的步骤附带 `writing.md` 的常读部分约 2.6K; 写测试的步骤附带 `validation` 的 Coverage principles 约 0.8K.

整条流程合计约 9.5K, 比现行少约 70% (源码仓库加上仓库自有常读部分约 2.8K, 约 12.3K, 少约 67%). 单个 Agent 步骤读到约 1.6K 到 5.7K.

对照 issue 15 的 11-13 元数据统计 (worker 读入内容中规则文档的中位数占 31%, 关卡与命令输出占 17%; Reviewer 读入内容中规则文档占 13%):

- worker: 规则文档减少约 70%, 其余内容不变时占比约 12%; 关卡与命令输出也因程序检查结果改由 Engine 汇总而减半时约 13%. 规则与流程合计 (规则文档加关卡与命令输出) 由约 48% 降到约 25%.
- Reviewer: Role 文档按 09 原样保留, 只减掉根 `AGENTS.md` 的流程段, `reviewer.md` 中改由 Engine 执行的部分和 `writing.md` 的程序检查部分. Code Standards 与要求符合审核读到的规则约少 33%, Spec Readiness 约少 22%; 13% 的占比降到约 9% 到 10%. Reviewer 的主要节省来自 09 (审核包, 不再自己找材料), 不来自规则缩减.
- 会话不再驱动流程, Main 会话压缩后重读触发规则 (issue 15 中占 Main 文本增量 6% 到 13%) 随之消失.

## Deletions

删除共 8627 字符. 按根 `AGENTS.md` 的 Efficiency First 第 6 条, 每段写明它守护的目标, 以及该目标已不存在或由何处覆盖.

| 段落 | 字符 | 守护的目标 | 1.0 中的覆盖 |
|---|---|---|---|
| 根 `AGENTS.md` 的 Workflow Triggers 与 Agent Writes 指针 | 1458 | Agent 在正确时点读到对应规则 | 13 删除触发表; Engine 按步骤下发短指令 |
| `parallel-implementation.md` | 918 | worktree 并行实施的隔离与清理 | 10 与用户 11-13 确认: 1.0 不提供 worktree 并行实施 |
| `environment.md` 的平台会话 ID 规则 | 200 | 临时路径不与其他会话冲突 | 工作区路径由 Engine 生成 (13) |
| `reviewer-launch` 的平台操作, haiku 回退与按需读取指针 | 1843 | Main Agent 正确启动与控制 Reviewer | Engine 启动 Reviewer (07, 09); haiku 回退由 09 删除 |
| `reviewer-launch/machine-operations.md` | 1266 | Main Agent 操作 `arw background-agent` | 同上; `background-agent` 从公开命令删除 (13) |
| `reviewer-launch/other-reviews.md` 的字段清单 | 447 | 其他审核的交接字段完整 | Engine 生成审核输入 (09) |
| `arw-commands` 的门禁与写入类命令说明 | 1934 | Agent 正确调用这些命令 | 13 把它们从公开命令中删除, 由 Engine 调用 |
| `spec-readiness` 的 Responsibilities | 177 | 审核各方职责 | 由 09 的 Reviewer 协议与流程定义承担 |
| `implement` 开头重复 Efficiency First 的一段 | 150 | 同根 `AGENTS.md` | 根 `AGENTS.md` 常读部分 |
| `subagent-allocation.md` 中 Main 转达的几句 | 164 | 子会话结果经 Main 转达 | 会话一视同仁, 结果直接回到 Engine (07) |
| `reviewer.md` 指向 `reviewer-launch` 的一句 | 70 | Main Agent 找到启动规则 | 同 `reviewer-launch` |

## Open decisions

清单中 "决定 A, B, C" 指 issue 21 Comments 中的三项待用户确认的决定: A 协作者 (subagent) 由谁创建, B 仓库自有规则中需机械使用的参数放在哪里, C 上游分叉的流程类 Skill 是否继续 Upstream Sync. 本清单按推荐方案归类; 用户改选时只影响 `subagent-allocation.md`, 仓库自有区域的命令与阈值, 以及四个流程类 Skill 的维护方式, 不改变各类合计的量级.

## Limits

- 字符数不等于 token, Agent 实际读入还取决于步骤切分; 读入占比的估算由 E2 实测校正.
- 分节配额按节和段落的字符数手工给出, 段落内跨类时按主要内容归入一类, 误差约在单份文件的 10% 以内.
- 判断节点与短指令的界线按 "能否写成封闭问题" 判断, 最终以转换 (22) 生成的 graph 和 E3 判断题集为准.
- 源码仓库专用部分只示意, 不在本次迁移范围.

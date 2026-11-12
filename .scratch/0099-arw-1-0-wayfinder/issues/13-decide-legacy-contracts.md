# 确定现有 ARW 合同在 1.0 中的继承范围

Type: grilling
Status: resolved
Blocked by: issue:0099:01, issue:0099:04, issue:0099:17

##### Question

改为 Engine 驱动后, 现有的用户可见命令, ARW Artifact 格式, Spec Readiness, Commit Audit, Reviewer 约束和安装更新方式, 哪些原样保留, 哪些改写, 哪些只作为需求证据而不承诺兼容? 已采用当前 ARW 的仓库与进行中的 effort 怎样进入 1.0? 1.0 覆盖全部现有工作流, 在单独分支上完整实现后一次合并回 main, 不设 Engine 驱动流程与现有规则驱动流程的过渡期共存; 因此这里要定义的是 1.0 发布时已采用仓库的一次性升级, 以及升级时进行中的 effort 怎样处理, 不是两种流程长期并存.

## Answer

用户 11-12 对五项方向性取舍 (公开命令面, 是否仍向仓库分发规则, 进行中的工作怎样进入 1.0, 多机或多成员时的版本门槛, 升级失败后能否退回 0.x) 全部选择建议做法, 并补充 (原话): "新版的一个最大的优点就是极大的减少 agent 要读的规则的数量. 大部分规则都会内置到 engine 里面. 内置的规则中一大半是机械执行. 另一小部分是由判断模型触发." 依据: ARW HEAD `79e2497` 的 `CONTEXT.md`, `docs/specs/`, `docs/adr/`, `docs/agents/`, `distribution/config.json` 与 `lib/` 实现, 以及 [核对当前 ARW 的流程驱动方式与 Engine 已有能力](01-research-current-flow-driver.md) 列出的 7 项受影响合同. 本答案以 [定义 Engine 驱动流程的运行合同](07-define-engine-runtime-contract.md) 为前提, 其中 "Engine 由现有用户级后台管理进程扩展" 与 "Git 写入只由 Engine 执行" 两项已经独立复核保留, 见 07 的 Comments.

### Inheritance principle

交付格式原样保留, 因为仓库 Artifact 仍是交付权威, 且 Application 关联中冻结了 Canonical ID; 门禁语义原样保留, 只改写执行者与触发方式; 只为旧机制存在的握手, 路径与手册只作需求证据, 不承诺兼容.

### Commands

日常只读命令 (`list`, `print`, `open`, `jira list|open|print`, `submodule switch-branch`, `--version`, `help`) 与检查类命令 (`text check|fix`, `terms check`, `language inspect`, `code-map verify`, `module check-correction`, `migrate artifacts`) 原样保留, Agent 步骤可以把它们当工具运行. `workflow init|update|verify|remove` 保留名称, 改写内容 (见 Upgrade of adopted repositories 节). `list background-agents` 改为展示 Engine 会话与流程实例. `agent start`, `background-agent`, `spec-readiness *`, `commit-audit *`, `application sync|associate`, `jira accept|complete` 从公开命令中删除, 改由 Engine 流程和 Engine 机器入口提供: 07 规定 Git 写入与门禁顺序由 Engine 掌握, 保留可写的门禁命令会在流程外形成第二条写入路径. 代价是用户在脚本或 CI 中调用这些命令的地方会失效, 目前没有这种用法的证据. 未采用: 全部保留为调用 Engine 的薄包装 (维护双份入口, 而且能绕过写入者令牌); 另外保留只读的 `spec-readiness verify` 与 `commit-audit verify` 作诊断 (要维护跨版本的输出合同).

### Artifacts and `.scratch`

保留: `.scratch/<NNNN>-<slug>/` 的 `issues/`, `map.md`, `spec.md`, `research/`, `prototype/`, Canonical ID, 实施 issue 与 Wayfinder issue 格式, `Status:` 取值, `## Validation` 与 `## Comments` 的记录身份, 以及编号和迁移规则. 改写: `<NN>.spec-readiness.json` 的模式随 [定义 Reviewer 与正式关卡在 Engine 下的执行协议](09-define-reviewer-protocol.md) 升版, 旧记录保留原字节作为历史, 不再授权. 临时工作区身份改由 Engine 提供 (流程实例或会话), 不再读 `CODEX_THREAD_ID` 或 `CLAUDE_CODE_SESSION_ID`. 旧 `.tmp` 目录按现行规则不迁移也不清理.

### Spec Readiness

保留: 术语定义 (`CONTEXT.md` 中的定义不涉及 Main Agent), 首次写实现前取得就绪, 审核对象范围与身份规范化, 失效规则, `not-applicable` 例外须用户确认, 行为保持重构例外 (ADR 0037) 与紧急修复例外, `prepare` 的三项机械预检. 改写: `prepare`, `generate`, `promote`, `verify` 成为 Engine 的确定性步骤, 原由 Main Agent 做的 "只提升生成字节" 与 "每轮抽查一两处" 改由流程定义分配, 具体归 09.

### Commit Audit

保留: Gate 1, 2, 3 的语义, 两个 Reviewer 并行, 冻结 `base` 与 `tree`, 提交门槛 (问题全部处理, 第 3 轮起只修行为缺陷), 非实施提交的封闭分类与 `verify --non-implementation` 的检查项, 体积摘要与警告. 改写: 暂存, 提交与恢复由 Engine 执行, 门禁顺序由 Engine 掌握, 审核轮存在 Engine 状态中. `input.json` 握手与 `_commit-audit/<n>/` 路径只作需求证据.

### Reviewer constraints

保留: 独立会话, 不建子 Agent, 关闭 memories, 不带作者对话, 三个角色键与全局加仓库的配置, 绑定报告与 `No problems.`, `ready | incomplete`, Jev 类模型不当 Reviewer. 改写: "单 Agent 完成全部检查" 与逐单元拆分的关系归 09. "由 Claude Code 中的 Main Agent 调用时改用 `haiku`" 的回退规则失去依据, 改为按角色显式配置模型 (归安装与配置).

### Installation and update

保留: 引导脚本, `install.mjs`, 固定安装目录, 安装清单, PATH 归属, 不降级, 配置版本的逐步转换机制, 安装维护前的静止核对, 控制与维护端口只绑定 `127.0.0.1`. [确定 Engine 对话入口的形态](19-decide-conversation-entry-form.md) 的网页入口另设监听, 不改变这两个端口. 改写: 新增配置版本, 加入 Engine 与判断模型两节; 维护交接还要求没有正在执行的流程步骤 (07). 升级后退回 0.x 见 Failure recovery 节.

### Terms and ADRs

Main Agent 改写为: 用户选定模型, 由 Engine 驱动的对话会话, 负责自由对话和分给它的高智能步骤; Engine 对它和其他 Agent 会话一视同仁 (07), 它不负责推进流程, 分配写入范围, 执行 Git 写入, 也不作流程中的简单判断. 新增 Engine 术语. ADR 0013 由新 ADR 取代: Engine 发放每仓库一个的写入者令牌, 并执行 Git 写入; 被取代的范围和需要同步注明的 ADR 0030, 0033 见 07 的 Comments. ADR 0006, 0023, 0034 中由 Main Agent 承担的职责相应修订. Spec Readiness, Workflow Distribution, Managed Content, Repository Profile, Application Leader/Member 的定义保留. Upstream Sync 只适用于继续以 Skill 形式分发的上游 Skill; 上游分叉的流程类 Skill (`implement`, `code-review`, `wayfinder`, `to-tickets`) 转成 Engine 代码后不再受 Upstream Sync 覆盖, 这是长期维护责任的变化, 在规范中写明.

### Rules move into the Engine

方向: Agent 要读的规则大幅减少, 大部分规则内置进 Engine; 内置规则中多数由 Engine 机械执行 (流程定义与程序检查), 少数由 Engine 在需要时向判断模型提题触发. 根 `AGENTS.md` 的 Workflow Triggers 节, 以及压缩后重读规则的要求, 一并删除. 规则正文按职责归类:

- 顺序, 门禁与跳过条件进入流程定义和程序检查 (`implement` 的 Entry, `spec-readiness`, `commit`, `reviewer-launch`, `issue-tracking` 的字段生命周期, `agent-writes.md`, `subagent-allocation.md`); 其中要靠语义判断的条件 (如 "这项改动是否需要用户决定") 写成流程定义中的判断题, 按 [定义分流判断的复核与回退合同](08-define-routing-review-and-rollback.md) 执行.
- 单步判断方法变成随流程定义版本化的本步短指令 (`subagent-findings.md`, Reviewer 发现的处置).
- Reviewer Role 正文保留为完整文档; 通用方法继续作为 Skill (`tdd`, `diagnosing-bugs`, `codebase-design`, `domain-modeling`, `research`, `prototype`, `writing-for-agents` 等); 写作与输出规则保留为常读规则.
- 只服务旧机制的内容删除. 仓库自有区域原样保留.

仍向仓库分发规则: 保留锁, 受管区域与投影机制, 分发内容缩减为常读的写作与输出规则, 一条 "ARW 流程只经 Engine 运行" 的声明, 方法类 Skill 和 Reviewer Role 文档; 顺序与门禁类 Skill 和文档由 `workflow update` 删除. 现有 update 已能删除不再分发的受管文件, 并把其中的仓库自有区域迁入 `AGENTS.md` (`lib/repository-workflow/workflow.mjs` 约 L1185-1200), 改动最小, 仓库自有规则也继续随 Git 版本化, 由 harness 原生加载. 用户绕过 Engine 直接在仓库中打开 Codex 或 Claude Code 时, 会话可以做普通协助, 不执行 issue 实施, 就绪或提交审核流程. 未采用: 全部规则随 Engine 安装, 在开会话时注入 (要改写仓库工作流和开发两份长期规格, 直接打开的会话失去原生 Skill, 团队规则不再随 Git 版本化).

### Upgrade of adopted repositories

一次性升级, 不设共存. 顺序: 安装 1.0; 在每个仓库运行 `arw workflow update`, 或由 Engine 首次打开仓库时引导运行. 预检: 锁为 v2; 没有旧 issue 或 `PRD.md` 格式 (否则先 `arw migrate artifacts`); 工作区和索引干净 (被忽略的 `.tmp` 除外), 没有运行中的后台 Agent. 更新内容: 改写受管内容, 删除不再分发的文件并迁移其中的仓库自有区域, 最后写入新锁 (见 Version gate 节). 用户确认计划后, Engine 把升级作为一次非实施提交写入, 每个仓库的升级只占这一个提交. 之后运行升级后审核流程: 找出与 1.0 冲突的仓库自有规则; 有缺口时恰好创建一个补全 issue, 沿用现行 Post-init handoff 规则.

进行中的工作在静止点进入 1.0: 正在实施, 已暂存待审或审核中的工作先在 0.x 完成或放弃; 旧审核轮不迁移; 未进入终态的实施 issue 在 1.0 下重跑 Spec Readiness, 可以做增量复审; Wayfinder issue, map, spec 和 Application Source Issue 直接沿用. 理由: 现行规则规定 Reviewer Role 字节变化后就绪记录失效 (完整 `verify`), 1.0 必然改写 Role, 重跑就绪是在执行现行规则, 不是新增成本. 未采用: Engine 从 Artifact, 工作区和暂存区推断并接管流程实例 (只用一次的重建逻辑, 而且未提交改动的归属和恢复基线都无法证明); 接受 0.x 的 `satisfied` 记录, 已开工的 issue 只核对 subject (Engine 无法可靠判断哪些已开工, 要逐个问用户).

ARW 源码仓库不运行 `workflow update`, 它的升级就是 `arw-1.0` 分支合并回 main, 合并时 main 上进行中的工作同样按静止点处理.

### Version gate

1.0 把锁升到 `lockSchemaVersion: 3`. 0.x 运行时拒绝高于 2 的版本 (`lib/repository-workflow/workflow-lock.mjs` L379-380), 所以另一台机器或另一成员的 0.x 对已升级仓库执行 `workflow *` 时关闭式失败, 不会把规则悄悄改回 0.x; 1.0 Engine 遇到 v2 锁时不开工, 提示先升级. 代价是一个很小的 v2 到 v3 迁移. 未采用: 在锁中恢复 `minimumArwVersion` (推翻 ADR 0009, 而且对已发布的 0.x 无效); 不设门槛, 靠文档约定 (规则可能被悄悄降级).

### Failure recovery

安装失败按现有安装事务恢复 (向前重试, 或按 `partial`/`unknown` 列出人工清理项). `workflow update` 只写工作区, 锁最后写入; 升级前工作区已经干净, 所以失败后恢复到 `HEAD` 即可. 状态库迁移在一个 SQLite 事务中完成, 失败时 Engine 不开工.

升级成功后支持一次手工退回 0.x: 1.0 首次升级配置前保存 0.x 配置副本; 文档写明步骤: 卸载 1.0 并保留数据, 恢复配置副本, 安装 0.x, 用 `git revert` 撤销各仓库的升级提交. 理由: 1.0 是整体改写, 出现严重缺陷的可能性不低, 而现行安装没有降级路径, ADR 0017 也不保留旧运行时. 代价是一个副本文件加一节文档. 未采用: 只支持向前修复 (严重缺陷时用户只能 `--reinitialize-config`, 丢失自定义配置).

### Interfaces

- 09: 就绪记录的新模式, Reviewer Role 的改写, "每轮抽查一两处" 的归属, haiku 回退规则的去向.
- [定义并行流程的读取与写入隔离](10-define-parallel-flow-isolation.md): 临时工作区由 Engine 提供身份; `docs/agents/parallel-implementation.md` 的 worktree 规则并入 10.
- [整理 ARW 1.0 规范的结构与验收场景](14-prototype-spec-outline.md): 大纲要有 "从 0.x 升级" 一章, 验收场景至少包括: 有未提交工作时升级被拒; 0.x 运行时在 v3 锁仓库上失败; v2 锁仓库上 Engine 不开工; 按 Failure recovery 节手工回退; 跨版本的 Application 关联仍可同步.
- 未核实的推断, 留给规范与实施验证: 0.x 管理进程遇到 1.0 新增的 SQLite 表时的行为; 用户是否在脚本或 CI 中调用门禁命令; 跨版本时 Application 关联只靠 Artifact 格式不变即可工作.

## Comments

11-12: 一个与 Main Agent 同级模型的 Agent 已按 ARW HEAD `79e2497` 起草分析, 原则是交付格式原样保留, 执行机制改写, 门禁语义保留, 只为旧机制存在的握手, 路径与手册只作需求证据. 五项方向性取舍交用户决定后写 `## Answer`: 公开命令面怎样改 (门禁命令是否从公开命令中删除), 1.0 是否仍向仓库分发规则以及直接打开 harness 时怎样, 进行中的工作怎样进入 1.0 (建议静止点升级, 未完成的实施 issue 重跑 Spec Readiness), 多机或多成员时的版本门槛 (建议锁升到 `lockSchemaVersion: 3`), 升级失败后能否退回 0.x (建议保留 0.x 配置副本并支持一次手工回退). 其中依赖 07 的两项架构判断已于同日经独立复核保留, 见 07 的 Comments.

11-13: 用户 11-12 对五项取舍全部选择建议做法, 并补充规则分发的方向 (大部分规则内置进 Engine). 按 11-12 的分析草稿写入 `## Answer`, 各项的未采用做法与理由一并记在对应节中; 07 的两项架构判断已保留, 草稿中 "若被推翻" 的分支不再保留. 术语一节按 07 的 "会话一视同仁" 改写.

# 定义并行流程的读取与写入隔离

Type: grilling
Status: resolved
Blocked by: issue:0099:07, issue:0099:08

##### Question

多个 worker 的流程在同一仓库并行时, Engine 怎样给每个读取者一致的仓库视图, 并按单一写入者原则排列修改? 一个 worker 的投机动作被复核否定, 而另一个 worker 已在其后写入时, 哪些动作必须回退或重做, 怎样避免丢失已验证的工作? 临时目录不受单一写入者约束时, 边界在哪里?

## Answer

11-13 worker 分析, 交 Main Agent 综合; 11-14 按用户 D24 答复与批判审读一.5 简化 (经过见 Comments). 依据: [定义 Engine 驱动流程的运行合同](07-define-engine-runtime-contract.md) (每仓库一个写入者令牌, 子实例继承, 会话一视同仁, Git 写入只由 Engine 执行), [定义分流判断的复核与回退合同](08-define-routing-review-and-rollback.md) (D24 后没有投机写入与自动回退, 只有写入步骤前的恢复点), [定义 Reviewer 与正式关卡在 Engine 下的执行协议](09-define-reviewer-protocol.md) (冻结候选, 按冻结输入机械判断失效), 以及 ARW HEAD `8637e9c` 的 `docs/agents/agent-writes.md` (Issue concurrency 节), `docs/agents/environment.md`, `docs/agents/parallel-implementation.md`, `docs/agents/reviewer.md` (Review versions and concurrency 节), `lib/commit-audit/commit-audit.mjs` (Reviewer 只用 `git show <tree>:<path>` 读取受审版本) 和 `lib/spec-readiness/spec-readiness.mjs` (subject 身份是登记路径加内容摘要). 原问题中的 "worker" 按 07 的会话一视同仁理解为流程实例: 隔离按实例是否持有令牌区分, 不按会话角色区分. 原问题中 "投机动作被复核否定" 的情形在 D24 后不存在, 见 08.

### Write token

- 每个仓库一个写入者令牌 (07). 已跟踪内容 (含未被忽略的未跟踪文件, 下同) 在任何时刻只由一条写入链写入, 即持有令牌的实例连同其子实例栈. 只有持有者的会话获得工作区写入范围; 其他实例的会话只读工作区, 只写自己的临时工作区.
- 令牌在持有实例提交完成, 或停在没有未提交修改的状态时释放 (07). 需要写入而拿不到令牌的实例转为 `waiting-writer`, 按进入等待的先后取得令牌. 首版不设优先级, 没有需要它的流程.
- 持有令牌的实例等待用户时继续持有令牌, 同仓库其他实例只能先做不写已跟踪内容的步骤 (用户 11-13 定, 理由见 Comments). Engine 记下每个实例处于 `waiting-writer` 的时长, 计入 [定义 Jev 类模型的评测与转正条件](11-define-evaluation-and-graduation.md) 的墙钟数据, 供以后判断是否值得改为让出令牌.
- 写入链内部可以同时运行多个写入步骤, 前提是流程定义给出的写入范围互不包含 (Engine 按路径包含关系检查), 与现行 `docs/agents/agent-writes.md` 的 Assign and hand off 节一致.
- 一个实例要同时写多个仓库时怎样取令牌 (如 Application 工作流写 Application 与 Module 两类仓库), 留到实现 Application 工作流时按实际需要再定.

### Drafts and landing

- 等待令牌时, 不写已跟踪内容的步骤照常推进: 研究, 分析, 起草 issue 或 spec, 对草稿运行 Spec Readiness. 草稿写在实例临时工作区, 步骤输出标明它将落到的仓库路径.
- 基准提交: 非持有实例开始时的 `HEAD`, 落盘前不变. 非持有实例的会话照常浏览工作区; 它的冻结输入 (如对草稿的 Spec Readiness) 由 Engine 用基准提交加草稿合成树对象, 不含写入链未提交的改动. 09 保留的 "Spec Readiness Reviewer 只读检索仓库" 例外因此检索本轮视图的树 (`git grep <模式> <树>`), 不是工作树.
- 落盘: 取得令牌后, Engine 比较基准提交与当前 `HEAD` 在本实例输入路径上的差异 (草稿目标路径, 冻结输入, 步骤消息给出的路径). 没有交集时直接把草稿写到目标路径, 作为本实例第一个写入步骤 (照 08 先建恢复点). 有交集时, 已冻结结果按 09 的失效规则机械处理 (例如实施开始前 Spec Readiness 的 Input 变化使记录失效, 做增量复审), 再由一个 Agent 步骤拿着交集的 diff 核对并修改草稿, 然后落盘. 就绪记录绑定 issue 的登记路径与 subject 内容摘要, 不绑定内容当时所在的位置, 所以对草稿得出的就绪结论在逐字节落盘后仍然有效.

### Temporary directories

- 位置: 每个实例一个临时工作区, 位于仓库 `.tmp/` 下, 路径由 Engine 生成并交给会话, 取代现行 `docs/agents/environment.md` 的按会话目录 `.tmp/<agent-platform>/<sessionId>/` (09 的就绪记录 `request.filePath` 已指向这里). 同一实例的会话 (含 Reviewer) 共用它; 跨实例沿用的 Reviewer 会话 (07, 09) 不固定在创建它的实例上: 每个回合 Engine 传入当前实例的工作目录和只读视图 (Codex `turn/start` 的 `cwd`, Claude Code 每回合新进程), 报告写当前实例的临时工作区, 前轮报告与台账由 Engine 作为审核包 (09) 的路径传入, 不依赖旧实例的目录, 旧实例工作区被清理不影响会话; 每次步骤执行写在以执行编号命名的子目录中, 重试是新的执行, 写新目录. 子实例有自己的工作区, 父实例的产物由 Engine 以路径传入.
- 不受约束: 临时工作区不受写入者令牌约束, 不进恢复点, 不进审核候选或提交. Engine 的全部 Git 操作 (快照, 冻结, 核对, 暂存) 都用路径排除 `.tmp/`, 不依赖目标仓库忽略它 (现行安装不为目标仓库添加这条忽略规则).
- 仍受约束: 会话只写本实例的工作区, Reviewer 只写绑定的报告. 每个步骤结束时, Engine 核对已跟踪内容的变化都落在写入链当前写入步骤的范围内; 范围外的变化无法归属任何步骤, 写入链在下一次冻结或提交前停下交用户判断. 这也覆盖其他实例的会话越权写工作区的情形, 两个 harness 上无法事前阻止 (见 07).
- 被忽略的共享路径: 构建输出, 依赖目录, 测试缓存等被忽略且不在 `.tmp/` 下的路径不进恢复点 (08), 却会被并行运行的命令争用. 只有写入链在工作区中运行会写这类路径的命令 (构建, 测试, 安装依赖); 其他实例需要时在自己工作区的普通快照中运行 (沿用现行 `docs/agents/environment.md` 不用 `git worktree` 的规定), 或等到取得令牌. 测试, 检查等产生验证事实的确定性操作不与同一写入链的写入步骤在工作区中并行; 需要并行时 (如 09 中审核进行期间的修复) 同样改在普通快照中运行. Engine 在步骤结束时删除它为该步创建的快照目录, 因为可以随时从树对象重建; 其余临时内容沿用现行不自动清理的规则.
- 仓库之外 (用户主目录, 全局缓存, harness 配置) 不在隔离范围内.
- 删除 `.tmp/`: 1.0 中实例状态与会话绑定都在 Engine 私有状态库 (07), `.tmp/` 只有中间产物, 删除不会使运行无法恢复. 现行 `docs/agents/parallel-implementation.md` 中删除 `.tmp` 前先卸载后台 Agent 的检查因此不再需要; 产物被删的实例在下一步读取时发现缺失, 停下报告.

### Worktrees

`docs/agents/parallel-implementation.md` 的并行实施 (用户开启后每个 issue 一个 Git worktree, 再合并回主分支) 按 [确定现有 ARW 合同在 1.0 中的继承范围](13-decide-legacy-contracts.md) 并入本 issue. 1.0 不提供 (用户 11-13 定, 理由见 Comments). 07 定为每仓库一个令牌; 改为按工作树发令牌, 合并冲突, 合并后的完整验证, 跨工作树的视图都要另立规则. 本 issue 的草稿与落盘已让研究, 起草和 Spec Readiness 与实施并行, 剩下串行的只有实施与提交审核. 先用 `waiting-writer` 时长衡量串行造成的等待, 等待显著时再按数据决定是否加回.

### Scenarios

1. 草稿与就绪并行: 实例 A 持有令牌实施一个 issue. 用户发起下一个 issue 的规划, 实例 B 在临时工作区起草并对草稿跑完 Spec Readiness, 输入取 B 的基准提交. A 提交后 B 取得令牌; A 的提交只改了 `lib/`, 与 B 的输入无交集, Engine 直接落盘, 就绪记录有效, B 开始实施.
2. 落盘时有交集: 同上, 但 A 的提交改了 B 的 issue 所引用的 `spec.md`. B 的实施尚未开始, 就绪记录按 09 失效; B 的会话拿着该 diff 核对草稿, 落盘后做增量复审.
3. 测试与修复并行: A 在审核进行期间按 09 继续修复, 同时要跑测试. Engine 用修复开始前的树在 A 的临时工作区建普通快照并在其中运行测试, 结果绑定该树, 修复写入工作区不影响它.
4. 越权写入: B 的会话误改了一个已跟踪文件. 步骤结束时 Engine 发现该变化不在 A 当前写入步骤的范围内, A 在下一次冻结或提交前停下, 交用户判断这处改动的去留.

### Interfaces

- 07: "其他实例的会话只能写自己的 `.tmp` 子目录" 具体为实例临时工作区; 令牌按进入 `waiting-writer` 的先后发放; 每步结束的核对加上已跟踪内容的归属检查.
- 08: 恢复点与 `.tmp/` 互不相干; 没有投机写入, 不需要释放令牌前的屏障.
- 09: 非持有实例的冻结输入按基准提交加草稿合成; Spec Readiness Reviewer 检索本轮视图的树.
- 11: `waiting-writer` 时长计入墙钟数据.
- 13: `docs/agents/environment.md` 的会话工作区, `docs/agents/parallel-implementation.md` 的 worktree 与删除前检查, `docs/agents/agent-writes.md` 的 Issue concurrency 节由本 issue 改写.
- 规则转为 Engine 工作依据 (用户 11-13 所说的 graph): 写入步骤的写入范围, 步骤是否产生验证事实, 是 graph 节点上由转换产出, 由 Engine 机械使用的属性.
- [整理 ARW 1.0 规范的结构与验收场景](14-prototype-spec-outline.md): 验收场景至少包括上面 4 个情景.

## Comments

11-13: 用户定下原先待确认的两处, 本答案已改为定稿.

- 并行实施 (每个 issue 一个 worktree) 不保留, 选 B. 用户倾向 B, 并请 Main Agent 比较哪种更简单. Main Agent 判断 B 更简单也更稳: 每个仓库只有一个写入令牌, 没有 worktree 的建立, 合并和删除, 没有合并冲突, 也不必另定跨 worktree 的视图与推翻规则; 保留则要在 B 的全部机制之上再加这些, 合并后还要重跑完整验证, 出错面更大. 以后按 `waiting-writer` 时长数据再决定是否加回.
- 持有令牌的实例等待用户时继续持有令牌 (选项 A), 规则最少, 已冻结的审核候选不受影响, 代价是用户不在时同仓库其他实例停在 `waiting-writer`. 未采用的让出方案: Engine 把未提交改动存为私有引用下的快照, 工作区恢复到 `HEAD`, 令牌交给下一个实例, 用户答复后重新排队并把快照合并到新的 `HEAD` 上; 代价是合并冲突要 Agent 步骤处理, `HEAD` 变化还使已冻结的 Commit Audit 候选重审, 高智能请求数与墙钟都可能变差. 以后同样按 `waiting-writer` 时长数据再看.

11-14 (D24 答复与批判审读一.5, 任务 v1-d24ans): D24 删去 08 的投机执行, 异步复核与自动回退, 本答案的复杂度大半是为在投机写入下给读取者一致视图而设, 按批判审读一.5 简化为每仓库一个写入令牌, 非持有者只读并把草稿写在 `.tmp`, 取得令牌后落盘. 删去: What the premises already settle 节 (含 "释放令牌是屏障"), Reversal across instances 节, 视图一律为 Git 树对象及 "工作区与基准提交不同的路径要用 `git show` 读" 的要求, 判断 `state` 用 `git hash-object -w` 固定来源 (16 的调用记录来源随之简化), 作为通用规则的 "步骤结果按输入对象 ID 复用" (09 的轴结果复用仍按 09), 被推翻工作的取回, 原情景 3. 全局多仓库队列与 "多仓库一次取得令牌" 留到 Application 工作流实际需要时再定. 保留: 每仓库一个令牌, 草稿与落盘 (原第 33-35 行的核心), 非持有实例的冻结输入取基准提交加草稿, 临时工作区, worktree 与等待用户时持有令牌两项用户决定.

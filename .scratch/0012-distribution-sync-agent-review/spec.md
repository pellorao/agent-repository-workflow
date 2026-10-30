# 发布前同步由 Agent 完成引用审核与计划确认

## Behavior

`node scripts/sync-workflow-distribution.mjs` 的引用审核与写入全程由运行发布前同步的 Main Agent 完成, 不再打开编辑器, 也不等待用户批准 `planDigest`.

- `review` 在当前 Platform Host 会话的固定 `.tmp` 工作区写入两份完整候选文件 (`additional-skill-references.txt` 与 `skill-reference-normalizations.jsonl`), 在 `stdout` 输出两个文件路径后以 `succeeded` 结束. 第二份文件包含当前范围内 Skill 与第一份文件全部候选身份的规范化候选. 不启动编辑器, 不输出哈希.
- 运行发布前同步的 Main Agent (与用户沟通, 负责 Git 写入的 Main Agent) 对每一行的判断负责, 判断工作可按 ADR-0013 的普通分工分派给子 Agent; 删除结果由 Main Agent 写入候选文件. 判断依据上下文: 第一份文件保留表示该身份是当前范围外的真实 Skill, 删除表示不是 Skill; 第二份文件保留表示该位置是真实 Skill 引用. 只做删除式编辑. 删除第一份文件中的身份时, 同时删除第二份文件中该身份的全部行.
- `review --complete` 验证两份文件都是对原始候选的删除式编辑, 第二份文件每个保留对象语法与字段有效, 且其身份只属于当前范围内 Skill 或第一份文件保留的身份; 不满足时返回 `blocked` 与 `diagnostics`, 不改写文件. 成功时把两个哈希写入同一工作区的 `completed-review.json`, 并按文件顺序在 `stdout` 输出两个哈希. 文件未发生变化也是合法的完成结果 (Agent 保留全部候选), 不再需要用户确认.
- `prepare` 与 `apply --plan-digest <plan-digest>` 的输入绑定, 失败边界和重建范围不变. Main Agent 检查 `prepare` 的结果后自行以同一 `planDigest` 调用 `apply`; `planDigest` 继续把 `apply` 绑定到已检查的计划输入, 输入变化时 `apply` 返回 `blocked`.
- 引用审核不再读取全局 Engine 配置的 `reviewEditor`. 该字段仍是 `configVersion: 3` 的必需字段, 安装与读取行为不变: 旧版本 ARW 读取 v3 配置时要求它存在, 本 effort 不升级配置版本, 移除留到下一次配置版本升级. `editor` 与 `arw open` 不变.

## Module Design

### Modules

- 引用审核 Interface (`lib/workflow-distribution/skill-reference-review.mjs`): 责任从 "写入候选, 启动等待式编辑器, 验证删除结果" 改为 "写入完整候选" 与 "验证该 Main Agent 的删除结果并形成完成审核结果" 两个操作. 不再依赖编辑器进程启动能力.
- 源码仓库维护入口 (`scripts/sync-workflow-distribution.mjs`): 解析 `review`, `review --complete`, `prepare`, `apply --plan-digest <plan-digest>` 四种封闭调用, 不再读取 `reviewEditor`.
- Workflow Distribution Sync Module 的 `prepare` 与 `apply` 不变.

### Interfaces

- `review`: 输入为当前准确输入产生的两个完整有序候选集合与固定 `.tmp` 工作区. 成功时写入两份候选文件, `stdout` 按固定顺序输出两个文件路径, 结果 `succeeded`. 本次实际读取的 Git 路径存在未暂存或未跟踪内容时 `blocked`, 零写入. 候选写入失败时 `failed`, `stage` 和 `diagnostics`. 重复调用以当前候选覆盖本轮临时文件, 并删除已有的 `completed-review.json`.
- `review --complete`: 读取同一工作区的两份文件, 并按 `review` 的同一规则从当前 Git 输入重新计算原始候选 (输入在 `review` 后变化时删除式校验失败, 返回 `blocked`). 两份文件都是删除式编辑 (保留行是原始行的有序子序列), 第二份文件的保留对象语法与字段有效, 且其身份属于当前范围内 Skill 或第一份文件保留的身份时, 写入 `completed-review.json` (两个哈希), `stdout` 按文件顺序输出两个哈希, 结果 `succeeded`; 未修改的文件同样合法. 否则 `blocked` 与完整 `diagnostics`, 不改写任何文件. 工作区或审核文件缺失 (未先运行 `review`) 时 `blocked`. 文件读取或 `completed-review.json` 写入失败时 `failed`, `stage` 和 `diagnostics`.
- `review --confirm` 删除; 不在上述四种调用中的参数为用法错误, 退出 2.
- `prepare` 读取 `completed-review.json` 的合同不变. `apply --plan-digest` 的参数由 Main Agent 在检查 `prepare` 结果后自行提供, 校验与失败边界不变.

### Seams and Adapters

不新增 Seam. 删除引用审核对编辑器进程启动能力的依赖; 该能力继续由 `arw open` 使用. 测试通过入口与引用审核的生产 Interface, 以内存或临时文件系统观察结果.

### Dependencies and Data Flow

数据流由 "候选 -> 编辑器中的用户删除 -> 哈希" 改为 "候选 -> Main Agent (或其分派的子 Agent) 判断, Main Agent 删除 -> `review --complete` 验证 -> 哈希". 引用身份判断与 `apply` 授权的权威从用户改为运行发布前同步的 Main Agent; `planDigest` 仍把 `apply` 绑定到 `prepare` 时的输入. 依赖方向只减少 (引用审核不再依赖进程启动与全局配置读取), 不新增.

### Module Design Rationale

用户 2026-10-30 决定: Agent 有足够上下文判断某个标记是否 Skill 引用, 人工编辑器步骤只增加等待, 曾使无人值守运行永久阻塞. `planDigest` 的用户批准同样不提供 Agent 无法完成的判断. 替代方案: 保留用户审核 (拒绝, 理由同上); 只去掉编辑器但保留 `apply` 前用户授权 (拒绝, 仍阻塞无人值守运行, 而生成范围可由 Git 暂存区完整恢复, 误写可撤销). 接受的成本: Agent 误判的身份会被转换或保持原文, 未修改即整体确认; 这些结果都进入普通 Git 提交, 由提交审核和用户复核 diff 发现, 恢复靠 Git. 逐行判断的语义正确性由该 Main Agent 负责, 程序只做机械校验; 判断工作的分派如 Behavior 所述沿用 ADR-0013, 本 effort 不另设复核步骤, 因为误判的代价与恢复方式已如上述由提交审核, diff 复核和 Git 承担, 再加一层逐行复核只重复同一判断. 保留两份文件与删除式校验而不是让 Agent 直接写最终配置, 是为了继续以完整候选为基准机械拒绝新增或改写的行. `reviewEditor` 暂不移除: 删除 v3 必需字段会使旧版本 ARW 读取新配置时关闭式失败, 升级配置版本的成本大于保留一个无使用者字段.

### ADR Evaluation

需要新 ADR (下一个编号 0034): 发布前同步的引用审核与写入授权主体由用户改为运行发布前同步的 Main Agent, 取代 [ADR-0026](../../docs/adr/0026-use-source-checkout-workflow-files-as-distribution-authority.md) `## Decision` 中 "经用户审核并授权写入" 这一条; ADR-0026 其余决定不变, 并在该句处指向新 ADR. 开发长期规格 ADR Evaluation 中 "两文件删除式 Skill 引用审核只是 ADR-0026 中用户审核派生内容的具体流程" 与 "Engine 写入继续服从适用的用户授权" 两句改为引用新 ADR. 不改变持久格式, 信任根或分发边界.

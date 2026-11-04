# 恢复发布验证与能力测试的七项保护

## Scope

本 spec 是已删规则价值复查 (用户 2026-11-04 同意) 中七项恢复的行为合同. 它们守护的目标在 2026-10-26 的迁移中随机制一起被删掉, 后来发现仍需要: 发布时验证 Agent 初始化后的交接是否可用, 发现两次发布之间 Reviewer 能力的漂移, 避免运行故障被计成模型零分, 在 Reviewer 运行时改动时也做能力对比, 逐字节核对每台受验系统上安装出的文件, 以及 Reviewer 规则改动的 A/B 对比如何定次数, 并要求同版本同期与先诊断再加规则. 七项都要尽量简单, 不恢复旧的 Registry, 归档或证据链机制.

后两项并入了原先单独排的两个小改动 (A/B 每组次数; A/B 同版本同期, 先诊断再加规则), 因为二者改动同一行, 且次数规则含设计决定. 次数规则的统计设计来自独立分析 (用户 2026-11-04 采纳: 第二阶段保留跑到 10 次, 用户曾提议只跑到 6 次, 说明 6 次的检出力提高有限后同意保留 10 次).

长期规格归属不变: 发布流程与 VM 验证范围由 `docs/specs/agent-repository-workflow-release/spec.md` (下称发布规格) 拥有, 步骤由 `$release` Skill 拥有; 能力测试步骤由 `$reviewer-capability` Skill 拥有; 触发条件由根 `AGENTS.md` 拥有. 本 spec 不改变这些归属; 新增的程序接口只有 `summary` 的 `compare` (见 `summary compare` 一节), 其合同由开发规格的 Module Design 节拥有.

## Reviewer runtime changes trigger capability tests

场景: 一次改动关闭了 Codex Reviewer 线程的 memories (运行时设置, 不是规则文本), 当时因为 "不是规则文本改动" 没有做能力对比, 这类改动同样可能改变 Reviewer 的行为. 现行触发 (根 `AGENTS.md` 的 Source Checkout Validation 一节) 的原文是: "Reviewer 能力测试在维护者显式调用 `$reviewer-capability` Skill 时进行; 改动 Reviewer 规则 (Reviewer 角色指令, `docs/agents/reviewer.md`, Reviewer 交接与 Request 内容, 各 Skill 中约束 Reviewer 行为或复审处置的规则) 时, 也视同维护者已调用: 用受影响角色的能力场景对比改动前后, 评分不降低才接受改动. 速度提升很大而评分略有降低时, 交用户决定. 只删除重复表述或改为引用, 不改变任何规则含义的改动不做能力测试." 只列出规则文本.

行为: 在第一个括号的最后一项之后增加 "Reviewer 运行时 (原生工具, 权限, 沙盒, 上下文, 默认模型与设置)", 并在 "速度提升很大而评分略有降低时, 交用户决定." 之后增加一句: 运行时改动频繁时可以减轻测试, 只用受影响角色的一个场景, 或把几次改动合并为一次测试 (对比最早一次改动前与最后一次改动后). 其余文字不变.

理由与接受的代价: 运行时改动不改变规则文字却改变 Reviewer 看到的环境, 所以和规则改动一样要对比前后. 合并测试时, 中间某次改动引入的回归若被后续改动抵消就看不到; 接受这一代价, 因为目标是最终状态不退化, 而运行时改动频繁时逐次测试的成本高于它能多发现的问题.

## Run failures are not model failures

场景: 额度耗尽, 守护进程崩溃, 提供方返回 5xx 或凭据缺失使 Reviewer 没有写出报告. `score` 对空报告按模型失败计 0 分, 于是一格 5 个实例的平均分因运行故障下降约 20%, A/B 可能因此拒绝好的改动或接受坏的.

行为: `$reviewer-capability` Skill 的计分步骤规定: 报告为空或缺失时, 计分前先看保存的 `agent.json` (`list_agents` 的结果), 判据只用其中既有的 `completion` 与 `state`. `completion` 非空 (`status` 为 `ready` 或 `incomplete`, 不论 `reason` 写了什么) 表示 Reviewer 自己交付了结论, 报告却没有可评分内容就是模型失败, 运行 `score` 记 0 并把理由写进结果表. `completion` 为 `null` (含状态为 `exited` 而没有结论) 或没有生成记录 (准备, 传输, 额度, 凭据错误使 Reviewer 没有启动) 是运行故障: 不运行 `score`, 修复后用新实例路径重跑. 两个判据按 `completion` 是否为 `null` 互斥, 没有重叠. 准备错误靠启动前预防而不靠事后识别: Skill 要求启动前确认场景文件和交接路径存在可读, 之后 `completion` 非空就按 Reviewer 的结论计, 不再按 `reason` 文本区分. 启动检查通过之后才出现的准备类失败仍会因 `incomplete` 记 0, 这一残余被接受: 它罕见, 且 Reviewer 在结果表里写明的理由让维护者可见. 持续的运行故障 (同一场景, 同一设置, 同一实例序号用新实例路径连续尝试三次, 每次都是 `completion` 为 `null`) 不记分, 停止并报告维护者, 因为额度耗尽, 守护进程崩溃与模型不写报告在字段上无法区分, 由维护者判断; 本规格不声称能自动区分这两类. `score` 代码与合同不变 (它只在被调用时按空报告返回模型失败), 与 qwen_strata 的结果保持可比.

## Optional Reviewer capability drift check at release

场景: 默认 Reviewer 模型 (`haiku`, `gpt-6-luna`) 由提供方更新, 或 Claude Code, Codex CLI 升级, 使 Reviewer 能力在两次发布之间明显下降. 能力测试只在改规则时运行, 没有其他检查证明 Reviewer 能力 (其他检查证明的是候选行为).

行为: `$release` Skill 第 3 节在全部 VM 通过之后增加可选的一步, 维护者选 run 或 skip, 不设默认值; skip 不阻断发布. run 时按 `$reviewer-capability` Skill 新增的 Drift check 节执行:

1. 四个场景 (`requirements-reviewer/code-spec`, `requirements-reviewer/commit-audit`, `code-standards-reviewer/code-standards`, `spec-readiness-reviewer/spec-readiness`) 在两个后端的默认设置 (Codex `gpt-6-luna` `xhigh`, Claude `haiku` `high`) 各跑 1 个实例, 共 8 个, 按该 Skill 的 Run 流程计分定稿.
2. 每格的 `final` 与 `last-results.md` (该 Skill 目录下的 "最近结果" 登记表) 中同场景, 同后端, 同设置的记录相对比较; 没有记录的格只登记, 不比较. 不使用绝对分数门槛, 因为场景和计分在演进, 相对上次才能看出这一期间的变化.
3. 某格 `final` 比记录低 0.15 以上时, 同格再跑 2 个实例; 3 个实例的平均仍低 0.15 以上才判定漂移, 停下排查 (模型版本, CLI 版本, Reviewer 运行时), 在发布准备 issue 的 `## Comments` 报告, 不自动修复. 该检查不是门禁: 判定漂移后继续或放弃发布由维护者决定, 检查结果本身不阻止任何发布步骤. 0.15 只用来决定是否多跑 2 个实例, 不是失败判定: 单个实例有波动, 只比较一次会误报.
4. 比较后把各格本次结果 (有加跑时用 3 个实例的平均) 写入登记表, 同一格只保留最新一行. 登记表的权威文件是 `.agents/skills/reviewer-capability/last-results.md`, 写入后重新运行 `node scripts/project-claude-skills.mjs` 生成 `.claude/skills/` 的投影. 检查可在全部 VM 通过之后运行, 但结果只在发布完成之后 (`$release` Skill 第 5 节, 与 fixture 更新同时) 写入登记表并提交, 因为发布候选必须是已提交且工作树干净的 commit, 登记表的改动不属于候选; 候选修复导致流程重来时丢弃本次结果, 重来后重新检查或选择 skip. 登记表只由这一检查维护, A/B 与回归的结果不写入. 写入或提交失败, 或检查在写入前中断时, 登记表保持原样 (已发布版本的登记可以缺失, 旧行保留); 下一次检查以表中仍有的行为基准, 没有则只登记, 不比较; 失败时在发布准备 issue 的 `## Comments` 报告维护者, 不阻止任何发布步骤, 也不重跑已完成的检查.

漂移检查同样写在 `Optional checks` 小节, 选择 skip 同样在 `## Comments` 记一行. 两次发布之间改动频繁时, 一次检查覆盖这期间的全部变化, 不逐次检查, 这是它设为可选且只在发布时运行的原因. 成本约 8 个实例加盲裁, 1 至 2 小时的额度; 不改 Reviewer 规则. 接受的限制: 每格只与上一次记录比较并覆盖它, 所以单次下降不足 0.15 的变化不会触发, 还会成为下一次的基准, 多期缓慢累积的下降不会被识别. 本检查的目标只是发现两次发布之间的明显下降, 不追踪长期趋势; 追踪趋势需要保留历史行和绝对标尺, 成本高于它在当前规模下能发现的问题.

## Optional post-init handoff smoke at release

场景: 分发规则或投影改动后, 安装与 `workflow init` 都没有问题, 但 Agent 在 `workflow init` 之后不按 `arw-commands` Skill 做冲突审计和交接, 或生成的 issue 格式不合规; 现行检查只证明投影的 Skill 名称被加载.

行为: `$release` Skill 第 3 节增加可选的一步, 在宿主上运行一次 (不在受验系统上重复), 维护者选 run 或 skip, 不设默认值, skip 不阻断发布. 因为可跳过, 它不放进发布规格 Validation coverage 的必测表 (那些表承诺 "所有情况都要测到"), 而写在新增的 `Optional checks` 小节, 说明选择 skip 时在发布准备 issue 的 `## Comments` 记录一行 "skip". run 时: 把 plain fixture 解压到 `<tmp>/handoff/repo`, 用 `$release` Skill 第 3 节 Agent CLI 检查一步已经建好的隔离 home 里的 `arw` 运行 `workflow init`. 随后在该仓库内用 `claude -p` 让 Agent 按已安装的 `arw-commands` Skill 的 Post-init handoff 完成交接, 遇到需要用户决定的事取默认并说明; 该进程用正常 HOME (登录凭据在那里), 但 `PATH` 前置隔离 home 的安装目录, 使它运行的 `arw` 就是候选的安装, 授予它在该仓库写文件和运行 `arw`, `git` 的权限. 通过条件, 全部满足才算通过: 在同样 `PATH` 下 `arw workflow verify` 退出 0; `arw list issues --all-statuses --full` 退出 0 且列出的 issue 行数等于仓库 `.scratch/*/issues/*.md` 的文件数 (结构无效的 issue 不会被列出, 所以行数不符就是产出的 issue 不合规; 没有 issue 文件时输出 `No matching` 开头的一行, 行数 0 等于文件数 0, 也算满足); `git diff --name-status --no-renames <fixture 初始提交>` (运行前用 `git rev-parse HEAD` 记下, 覆盖未提交和已提交的改动) 中状态不是 `A` 的文件只可能是 `AGENTS.md` 和 `CLAUDE.md`, README 与源码不得改动. 失败按 `$release` Skill 第 3 节末尾判断候选缺陷或环境问题. 成本约 10 至 30 分钟和一次 Agent 任务的额度. 它只检查交接没有破坏仓库且产出的 issue 可读, 不判断交接审计是否完整 (例如 `workflow init` 不创建的 `CONTEXT.md` 是否被补全), 也不运行 issue 的实施, 审核, 提交生命周期, 所以发布规格 `Not release gates` 表中 "初始化 issue 生命周期" 一行保持原文不变.

## Installed files are compared byte for byte

场景: Windows 的 rename 重试或访问控制路径悄悄写坏了一个不常用的运行文件; guest 检查只运行部分模块, 不会发现.

行为: `scripts/release-guest-check.mjs` 在 Bootstrap 安装候选之后, 读取安装目录中的 `manifest.json` 的 `managedFiles`, 把每个文件与解压出的载荷中同一相对路径的文件逐字节比较 (载荷是脚本在 `解压安装压缩包` 一步已解压到的 `extracted` 目录, 之后的同版本重装和卸载后重装也从它安装, 它在整个运行中保留, 不依赖 Bootstrap 已清理的临时目录), 步骤失败时列出不同的路径并以退出码 1 结束 (沿用 `step` 的规则). 每台受验系统都运行, 约 1 秒; 发布规格 `Every system` 表加一行. 步骤在 Bootstrap 安装候选之后运行, 并在之后每次写入安装目录的步骤 (同版本交互重装, 卸载后重装) 之后再运行一次, 因为所述风险正来自覆盖已有文件的写入路径; 从上一发布版升级时候选安装本身就是升级写入, 已被第一次运行覆盖. 这是 guest 脚本的一个步骤, 它本身就是在受验系统中运行的检查, 不另写单元测试, 用宿主 Linux 上隔离 `HOME` 的真实运行观察.

## A/B comparisons decide their run count in two fixed stages

场景: 改动 Reviewer 规则后用 A/B 比较评分. haiku 每次运行的分数有波动 (qwen_strata v0.1.45 haiku high 每格 5 个实例的样本标准差: code-spec 0.092, code-standards 0.047, commit-audit 0.023, spec-readiness 0.053), 单次对单次的差距可能只是波动, 会据此拒绝好改动或接受坏改动. 用户决定 (2026-11-04) 每组至少跑 3 次, 3 次仍分不出就加跑, 最多 10 次, 注意费用. 原先的写法 "两组各自的 95% 区间一旦分开就停, 到 10 次仍重叠按没有差异处理" 有两个问题: 两个区间不重叠的标准过于保守, 模拟显示 code-spec 上真实降幅 0.1 有约 63% 被当作没有差异接受; 而改看差值区间后逐次查看, 不校正会把误拒率从名义 2.5% 抬到约 6% 到 8% (边跑边看). 同时 `summary` 每格只统计前 5 个实例 (`MAIN_N`), 第 6 到第 10 次根本不进入统计.

行为: `$reviewer-capability` Skill 在 Run 第 1 步 (haiku 那句之后) 规定, 判定 Reviewer 规则改动的 A/B 按事先固定的两阶段进行, 改动前为对照组, 改动后为候选组:

1. 两组交替启动, 各先跑 3 次, 两组候选并入同一批盲裁, 用 `summary --compare` 看差值 (候选减对照) 的 95% 区间 (Welch). 区间整体低于 0 (上界小于 0) 就拒绝; 候选均值不低于对照均值就接受; 其余情况两组各加跑到 10 次.
2. 加跑期间不看结果, 不提前停. 跑满 10 次后用全部 10 次只再判一次: 区间整体低于 0 就拒绝, 否则接受.
3. 每个受测场景分别判定, 任一场景拒绝即拒绝. 结果表写出每阶段的差值与区间; 区间下界就是本次不能排除的降幅, 不把 "未拒绝" 写成 "没有降低". 不看两格各自区间是否重叠.
4. A/B 两组使用同一版场景, 答案键, 简报和评分器并同期运行, 不与旧版本的历史分数比较, 也不在同一改动里顺手修场景或答案键, 否则分数变化会被误归因于规则改动 (旧能力规则有此约束, 迁移时丢失). Reviewer 没遵循已有规则时先查原因, 不靠叠加同义指令代替诊断.

理由与接受的代价: 两个阶段的单侧显著性各取 0.025, 与 "差值 95% 区间整体低于 0" 对应, 总误拒率不超过 5% (模拟 3.3% 到 4.1%, 无害改动一半在第 3 次结束, 每组平均 6.4 次); 中间各次的逐次查看几乎不提高检出力, 只多耗误拒额度. 局限: 在 code-spec 的波动下 10 次也只能可靠查出约 0.1 以上的降幅 (真降 0.1 的检出约 62%, 真降 0.05 约 22%), 所以结果必须写出区间下界. 用户提议第二阶段只跑 6 次时, 可靠检出的降幅约 0.13 (10 次约 0.10), 省钱有限, 保留 10 次. 多场景任一拒绝使总误拒最高约 8%, 这是偏向保护质量的取舍. 不采用固定每组 10 次 (成本约 1.6 倍, 检出力只略高), 也不采用非劣效界值 (code-spec 上做到 0.05 的界值需要远多于 10 次). 不改变 "每格先跑一次, 只对结果接近的格加跑" 的通用规则, 它只约束 A/B 对比; 本规则不改 Reviewer 角色指令.

## `summary compare`

场景: 上一节的 A/B 判定要比较两格的差值, 而 `summary` 只给每格自己的区间, 且只取前 5 个实例.

行为: `summary` 增加可选输入 `compare: [对照标签, 候选标签]` (入口参数 `--compare <对照标签> <候选标签>`). 给出时, 除每格的主统计 (不变) 之外返回 `comparison: {control, candidate, nControl, nCandidate, meanControl, meanCandidate, diff, se, df, ci95}`, 取两格给出的全部文件的 `final` (不受 `MAIN_N` 限制, 样本量由 Skill 事先固定为 3 与 10 两个阶段, 调用方只给该阶段规定的个数): `diff` = 候选均值减对照均值; `se = sqrt(s1^2 / n1 + s2^2 / n2)` (`s` 为样本标准差); `df` 为 Welch-Satterthwaite 自由度 `(v1 + v2)^2 / (v1^2 / (n1 - 1) + v2^2 / (n2 - 1))`, `v = s^2 / n`; `ci95 = diff ± tQuantile(0.975, df) * se` (`tQuantile` 支持非整数自由度). `se` 为 0 时 `ci95 = [diff, diff]`, `df` 为 `null`. 返回 `blocked`: 两个标签不是 `cells` 中的标签, 两个标签相同, 任一格少于 2 个文件. `markdown: true` 时再加一个比较表 (比较, 对照 n, 候选 n, 差值, SE, df, 95% 区间). 理由: 两格交替运行的两阶段判定需要差值区间; 样本量事先固定, 没有按结果挑选实例, 所以不破坏 `MAIN_N` 对单格主统计的合同 (`MAIN_N` 保持 5, 单格行为不变).

## Validation

- 规则与 Skill 文字: `node scripts/project-claude-skills.mjs --check`, `node scripts/check-workflow-distribution.mjs`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0081-release-and-capability-restores/`, 对改动路径 `git diff --check`. 每处文字改动都能 grep 到原文位置, 不留另一处的旧写法.
- 逐字节核对步骤: 宿主 Linux 上隔离 `HOME` 运行 guest 检查, 新步骤输出 `ok`; 在载荷中构造一个被改动的安装文件副本时输出 `FAIL` 并列出该路径 (手工一次性观察).
- 交接冒烟与漂移检查只写文字, 不真实运行 (不使用 VM, 不运行能力测试, 不调用真实 Codex 或 Claude); 命令, 路径和通过条件由评审对照 `$release` 与 `arw-commands` Skill, `arw` 命令清单核对.
- `summary --compare`: 单元测试已知值用例 (对照 [0.5, 0.6, 0.7], 候选 [0.4, 0.5, 0.6]: `diff` -0.1, `se` 约 0.08165, `df` 4, `ci95` 约 [-0.3267, 0.1267], 其中 t(0.975, 4) = 2.7764) 与 `blocked` 用例 (标签不存在, 两标签相同, 任一格少于 2 个文件); `se` 为 0 的用例; 对 10 个文件的格 `compare` 取全部文件而主统计仍取前 5 个.
- A/B 规则和同版本同期规则只写文字, 由评审对照上文核对.
- `pnpm typecheck`, `pnpm test`.

## Module Design

### Modules

只改一个 Module 的一个操作: Reviewer Capability Module 的 `summary` 增加可选的差值比较 (`lib/reviewer-capability/statistics.mjs` 增加一个 Welch 差值函数, `operations.mjs` 和入口 `scripts/reviewer-capability.mjs` 增加 `compare` 的参数与输出). 其余六项只改规则, Skill, 发布规格文字和 `scripts/release-guest-check.mjs` 的一个步骤, 不改变任何 Module 的责任.

### Interfaces

`summary {cells, markdown?, compare?}` 新增 `compare` 及其 `comparison` 输出, 合同见 `summary compare` 一节, 也写入开发规格 Module Design 的 `summary` 条目; 无 `compare` 时输入, 输出, `blocked` 条件和 `MAIN_N` 行为不变.

### Seams and Adapters

没有新的 Seam; 差值比较是无 I/O 的纯计算, 复用现有 `tQuantile`.

### Dependencies and Data Flow

依赖方向不变: 入口调用 `lib/reviewer-capability/` 的 `summary`, 后者调用同 Module 的 `statistics.mjs`. 数据流多一步: 两格的 `score` 输出文件经 `summary` 读入后, 差值比较与单格统计共用已读入的行.

### Module Design Rationale

差值比较放在 `summary` 而不是让 Agent 手算, 因为 Welch 自由度与 t 分位数要用已有的 `tQuantile` 精确计算, 手算易错且无法测试; 作为 `summary` 的可选输入而不是新操作, 是因为它读同样的输入文件并共享校验与 `blocked` 条件. 它不受 `MAIN_N` 限制的理由见 `summary compare` 一节. 接受的成本: `summary` 因此承载两种输出形状 (无 `compare` 与有 `compare`), 且 `compare` 的样本量正确性依赖调用方 (Skill) 按阶段只给 3 个或 10 个文件, 程序不核对个数; 这是因为阶段划分是维护流程而不是统计合同, 在程序里写死 3 与 10 会让 `summary` 反映一个只属于 A/B 流程的政策.

### ADR Evaluation

不改变授权主体, 持久格式, 信任根, 恢复合同或分发边界 (能力测试套件只属于 Source Checkout, 不进入分发), `summary` 只读输入文件, 不写持久状态, 因此不需要新的 ADR. 可选的交接冒烟让 `claude -p` 在带正常 HOME (其中的登录凭据与现有 Agent CLI 检查相同) 的进程里获得在临时交接仓库写文件和运行 `arw`, `git` 的权限, 这一授权只存在于维护者显式运行 `$release` 并选择 run 的那一次运行内, 范围限于 `<tmp>` 下的临时仓库, 不写入任何持久配置, 不新增授权主体或信任根 (维护者经 `$release` 显式授权, 与已有的 Agent CLI 检查一致), 因此同样不需要 ADR; 登记表 `last-results.md` 是维护者经 Git 提交的普通文档, 不是该 Module 的持久状态.

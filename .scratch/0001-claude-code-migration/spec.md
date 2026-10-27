# ARW 迁移到 Claude Code 并精简规则与代码

## Problem Statement

ARW 由 Codex 开发和维护, 现在改由 Claude Code 维护, 并且今后 ARW 管理的仓库要同时在 Codex 和 Claude Code 中运行. 目前存在四个问题:

1. **Claude Code 下功能不全.** Claude Code 只能取得静态内容 (`CLAUDE.md` 引入 `AGENTS.md`, `.claude/skills/`). 独立 Reviewer 只能经 `arw background-agent` 由 Codex App Server 运行, ADR 0016 把 Claude Code 的 Reviewer 执行定为暂停; 调用者会话身份只认 `CODEX_THREAD_ID`, 因而 Spec Readiness 准备, 临时工作区和所有审核门禁在 Claude Code 中都无法完成.
2. **规则臃肿, Agent 经常遗忘规则.** `docs/agents/` 约 14 万 token. 一次 "实现一个 issue 并提交" 要加载约 7 万 token 的规则, 每个 Reviewer 会话还要另加. 同一要求在入口文件, 文档和 Skill 中重复出现, 大部分流程文档由读取型触发条件强制加载, 而不是按任务按需加载.
3. **审核流程重复.** 一次包含 issue 完成的提交要运行 Code Standards, Code Spec 和 Commit Audit Gate 1 三个 Reviewer, 其中 Code Spec 与 Gate 1 都在对照 issue 要求检查代码; 任何修改都可能触发完整重审.
4. **过度设计.** GPT 生成的代码约 5.1 万行, 其中只服务源码仓库维护的 release VM 验证, Reviewer 能力一致性与 benchmark, Upstream Sync 合计约占 `lib/` 的 35-40%. 大量手写校验链校验程序自己产生的数据, `isRecord`, `sha256`, `exactKeys` 等工具函数在多个模块重复定义. 现有 "最小充分合同" 条文留有 "具体可预见的风险", "不削弱必要保证" 等出口, 也没有体积约束, 无法阻止过度设计.

## Solution

迁移完成后:

- 在 Codex 和 Claude Code 中都能使用 ARW 的全部功能. `arw background-agent`, `arw lba` 等命令在两个环境中用法相同. 独立 Reviewer 由 ARW 后台运行, 不依附任何一个 harness 的原生 subagent 机制, 可以选择 Codex, Claude 或兼容 Anthropic 接口的第三方模型.
- 常驻规则不超过 8K token, 最重的日常流程 (实现一个 issue 并提交) 加载的规则不超过 40K token. 按任务使用的流程改为 Skill, 由 harness 按描述自动触发; 只在源码仓库偶尔执行的重型维护流程改为不自动触发的 Skill.
- 常驻规则最前面是 "效率与精简" 最高原则, 让 Agent 每做一件事前都对照它. 体积预算和 Code Standards 审核的删减职责把它落到每张 ticket 上.
- 每次提交最多两个并行 Reviewer; 修改后只复核改动部分; 证据记录只保留最少的机械校验.
- 现有代码中只服务源码维护的重型功能和重复的校验代码被删除或大幅压缩, 行为保持不变.

## User Stories

1. 作为 ARW 维护者, 我希望在 Claude Code 中维护 ARW 源码仓库, 以便不再依赖 Codex 完成日常开发.
2. 作为目标仓库的使用者, 我希望在 Claude Code 中执行 ARW 的全部工作流, 包括就绪审核和提交审核, 以便与 Codex 中的体验一致.
3. 作为目标仓库的使用者, 我希望在 Codex 中继续使用全部现有功能, 以便迁移不破坏现有工作方式.
4. 作为使用者, 我希望 `arw background-agent` 和 `arw lba` 在两个 harness 中用法相同, 以便用同一套命令查看和管理后台 Reviewer.
5. 作为使用者, 我希望 Reviewer 可以运行 Codex 模型, Claude 模型或兼容 Anthropic 接口的第三方模型, 以便按成本和能力选择审核模型.
6. 作为使用者, 我希望 Claude 侧 Reviewer 默认使用 Haiku, 推理强度 high, Codex 侧继续默认 `gpt-6-luna` xhigh, 以便先用低成本配置运行, 再按实际效果调整.
7. 作为使用者, 我希望第三方模型的凭据只保存在用户级配置中, 以便凭据不进入仓库.
8. 作为 Agent, 我希望常驻规则短小且最高原则放在最前面, 以便始终记得它们.
9. 作为 Agent, 我希望流程规则在我开始对应任务时才由 Skill 加载, 以便上下文只包含当前需要的规则.
10. 作为 Agent, 我希望同一要求只在一个地方定义, 以便不必在多份文档之间核对冲突.
11. 作为使用者, 我希望 Spec Readiness 只在 spec 定稿时审核一次, 不通过时修改后只复核改动部分, 以便缩短 "修改 -> 审核" 循环.
12. 作为使用者, 我希望提交审核合并为 "要求符合审核" 和 "代码质量审核" 两个并行 Reviewer, 以便减少重复审核又不让单个 Reviewer 上下文过大.
13. 作为使用者, 我希望观察 Haiku 在 Gate 2 effort 级审计中的漏报, 以便决定是否需要更强的模型.
14. 作为维护者, 我希望 release VM 验证, Reviewer 能力一致性与 benchmark, Upstream Sync 改为只在我要求时才使用的 Skill, 由 Agent 执行并达成各自目标, 以便它们不再占用日常上下文.
15. 作为维护者, 我希望删除重复工具函数和手写校验链, 以便代码量更小, 更容易维护.
16. 作为维护者, 我希望每张 ticket 预估净增行数, 超出一倍时 Agent 停下说明, 以便及早发现过度设计.
17. 作为维护者, 我希望 Code Standards Reviewer 专门检查可删除的代码, 以便在 Codex 和 Claude Code 中都能拦住过度设计.
18. 作为 ARW 源码仓库维护者, 我希望本仓库用 ARW 自己的投影生成 `.claude/skills/`, 以便同时检验 Claude 投影.
19. 作为使用者, 我希望 ARW 规则与我的用户级规则冲突时以用户级规则为准, 以便个人工作方式不被仓库规则覆盖.

## Implementation Decisions

### Platform and reviewer runtime

- Codex 和 Claude Code 都是一等平台. 平台差异继续集中在 Platform Adapter 与 Projection 配置中.
- `arw background-agent` 的 JSONL 机器接口和 `arw lba` 的输出保持不变, 两个 harness 中的 Main Agent 用同一种方式启动, 跟进和等待 Reviewer.
- 后台守护进程按 Reviewer 配置选择后端. Codex 后端就是现有的共享 Codex App Server. 新增 Claude 后端, 实现现有的 `NativeSessions` 接口, 每个 Reviewer 会话运行一次 headless `claude -p`:
  - 用 `--output-format stream-json` 读取事件, 用 `--session-id` 新建会话, 用 `--resume` 续接同一 Reviewer 会话进行复审.
  - 用 `--allowedTools`, `--permission-mode` 和工作目录限制 Reviewer 只读审核对象, 只写获准的报告路径.
  - Claude 后端不支持运行中追加指令: 跟进以续接会话的新一轮实现, 中断以结束进程实现.
- Codex 专有部分 (共享 App Server 生命周期, 模型目录合并, Strata key 租约) 只留在 Codex 后端内部, 不进入 Claude 后端.
- 第三方模型: Reviewer 模型配置可以带一组环境变量 (如 `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`), Claude 后端启动 `claude -p` 时注入. 凭据只允许出现在用户级配置中, 仓库配置中出现凭据时拒绝.
- Reviewer 默认值: Codex 后端 `gpt-6-luna`, `xhigh`; Claude 后端 `haiku`, `high`. Claude 后端 Reviewer 只用 `haiku`, 不用其他 Claude 模型 (见 `Review workflow`). 继续使用现有的用户级和仓库级两层配置.
- 调用者身份: Claude Code 环境中的 Main Agent 会话身份先尝试读取 Claude Code 提供的会话环境变量; 不存在时由 ARW 投影的 `SessionStart` hook 把 hook 输入中的 `session_id` 写入 `CLAUDE_ENV_FILE`. 第一张 ticket 用实测选定其中一种, 只实现选中的一种.
- 新 ADR 取代 ADR 0016 中 "Claude Code Reviewer 执行暂停" 的决定, 并修订 ADR 0030 中 "只管理 Codex App Server" 的范围.

### Projection

- `.agents/skills/` 是唯一的 Skill 来源. `.claude/skills/` 由 ARW 投影生成: `$name` 引用转为 `/name`, 不复制 Codex 专用的 `agents/openai.yaml`, Claude 的 `disable-model-invocation` 与 Codex 的 `allow_implicit_invocation` 并行保留.
- Claude Code 入口文件 `CLAUDE.md` 的内容是 `@AGENTS.md`, 两个 harness 共用同一份 `AGENTS.md`.
- 本仓库按 `codex` 和 `claude-code` 两个平台运行 ARW 投影, 生成结果提交到仓库, 现有同步检查覆盖 `.claude/skills/`.
- 不投影 `.claude/settings.json`. 等价于 `.codex/rules/default.rules` 的 `arw` 只读命令放行清单写进使用手册, 由使用者自行加入. 这是可撤销的取舍, 以后需要时再投影.

### Rule structure and context budget

- 常驻规则 (`AGENTS.md` 及其强制读取的文件) 不超过 8K token. 实现一个 issue 并提交的完整流程 (常驻规则加上该流程触发的 Skill 和文档) 不超过 40K token. 一个仓库内测试按字符数近似检查这两个上限, Reviewer 角色文件不计入 Main Agent 预算.
- 常驻规则最前面是 "效率与精简" 最高原则, 内容为:
  - 时间, token 和代码量都是宝贵资源.
  - 动手前判断与目标的相关性和投入产出比, 拿不准时交用户决定.
  - 只为当前验收标准写代码: 外部数据只在信任边界校验一次, 内部代码彼此信任, 不重复校验; 每条错误处理路径 (包括 `try`/`catch`) 都要对应一个现实失败场景.
  - 代码保持直白: 只用一次的逻辑不提前抽成函数, 除非复用或封装复杂逻辑; 一个函数能写清的不拆.
  - 为推测性或极不可能的竞态, 安全极端情况增加复杂度前, 先向用户说明故障模式, 概率和复杂度成本并取得同意.
  - 先删后加.
  - 体积预算: 按本任务净增行数 (新增减删除) 计, 只算为本任务所做的改动, 含被替换的旧代码; 净增为负没有问题. 与本任务无关的冗余代码删除受鼓励, 但不抵扣净增, 在交付说明 (Agent 最终报告和提交说明) 中单独列出, 能分开时单独提交. 实际净增超出预估一倍时停下说明.

  现有 `writing.md` 中 "最小充分合同" 一节的出口条文删除, 由此原则取代.

  这条原则主要针对 Codex (GPT) 作为 Agent 时的过度设计倾向. 因此除放在 `AGENTS.md` 最前面外, `implement` Skill 开头和 Code Standards 角色文件各用一句话重申, 让实施和审核时它都在上下文的显眼位置.
- 常驻规则此外只保留: 前置依赖, 重要决定交用户, Agent 写入范围, 输出文字的语言与格式, 以及 Skill 和文档的触发索引.
- 按任务使用的流程改为 Skill, 由 harness 按描述自动触发:
  - 实施: 把 issue 门禁并入 `implement`.
  - 提交: 合并 `commits`, `commit-audit-workflow` 和 `issue-audit-records`.
  - Spec Readiness: 合并现有三份文档.
  - Reviewer 启动: 从 `reviewer.md` 中拆出 Main Agent 部分.
  - issue 跟踪.
  - 验证.
  - 领域建模: 并入现有 `domain-modeling`.
  - ARW 命令.
  - Code Map.
  - 规则与设计修改.
  - 测试清理.
  - 测试性能优化.
- Reviewer 协议和角色文件仍由 Reviewer 运行时读取, 不进入 Main Agent 上下文.
- 规则文档或 Skill 中 Codex 与 Claude Code 实现不同的部分, 各写一个独立文件, 父文档只保留共同部分和指向两者的链接, 使每个 harness 只加载自己需要的部分. 预算按两者中较大的一份计算. 差异只需几行文字描述时直接写在父文档中, 不拆分, 因为拆分本身会多消耗 token.
- 删除或大幅压缩:
  - `user-communication.md`: 沟通格式和汇报渠道交给 harness 与用户级配置.
  - `subagent-allocation.md` 中的容量调度与空闲线程恢复: 并发与额度由 harness 和用户级配置管理.
  - 各文档之间重复的触发列表和重复陈述.
- 规则冲突: ARW 规则与用户级规则冲突时以用户级规则为准. ARW 文档之间冲突时报告给用户. 删除 "不得按路径或专用程度选择指令" 的条文.
- release VM 验证, release 发布与验证, Reviewer 能力一致性与 benchmark, Upstream Sync, Platform Standards 改为只在源码仓库中存在且不自动触发的 Skill (Claude 用 `disable-model-invocation: true`, Codex 用 `allow_implicit_invocation: false`). 仍由 Agent 执行, 执行方式可以改变, 只要达成各自目标:
  - release VM 验证: 证明安装, PATH 登记和初始化在 Windows 与 Linux 上真实可用.
  - Reviewer 能力一致性: 证明 Reviewer 角色能发现已知问题.
  - Upstream Sync: 人工审核后采用上游 Skill 新版本.
- 规则修改的审批粒度: 本仓库按 ticket 在状态页复核整体 diff. 分发给其他仓库的规则修改流程压缩为 "修改 Agent 指令前取得用户对改动内容的确认", 不再要求独立 Git 索引暂存.
- 本仓库在 `AGENTS.md` 的仓库自有区域声明 "按待办自主推进" 的工作方式 (重要决策先由不低于 Main 的独立 agent 分析, 仍拿不准的交状态页决定, 先做其他工作). 分发给其他仓库的默认方式仍是重要决定交用户确认.

### Review workflow

- Spec Readiness 只在 spec 定稿时审核一次. 不通过时修改后复审, 复审只看改动部分及其影响范围. 机械记录只保留审核对象绑定与 `verify` 校验, `verify` 在开始实施前和提交前运行.
- 提交审核最多两个并行 Reviewer:
  - 要求符合审核: 由 Code Spec 与 Commit Audit Gate 1 合并而成, 逐条对照 issue 要求和验收标准检查实现.
  - 代码质量审核: 即 Code Standards, 职责中增加 "指出可删除的代码": 未使用的通用性, 对内部数据的校验, 没有现实失败场景的错误处理, 净增行数超出预算.
- Gate 2 effort 级审计时机不变, 在 effort 的全部实施 issue 进入终态时运行.
- 任何复审只看改动部分及其影响范围; 未受影响的有效结论保留.
- Reviewer 输出格式减负, 以实测而不是格式严格程度防止偷懒:
  - 偷懒的真实表现是 "格式完整但没有实际检查" (例如用脚本按输入一次性生成每条结果), 格式检查拦不住它. 旧规则要求复述每条要求的细节就是为此; 但这类要求是否必要取决于模型, 例如 luna medium 会偷懒, luna xhigh 基本不会.
  - 规则面向默认 Reviewer 配置 (luna xhigh, haiku high) 编写, 先采用较轻的格式: 要求清单由程序生成, Reviewer 为每条填写结论和证据定位, 只有 `gap` 和 `uncertain` 写说明; 程序机械检查每项都有结论, 证据定位真实存在.
  - 格式放到多低由 Reviewer 能力测试决定: 用已知缺陷的测试场景比较轻格式下各默认模型的检出率, 检出率下降的模型恢复必要的复述要求. 测试至少包含最轻的一档: 不要求格式化输出, Reviewer 只把找到的问题用自然语言逐条写进一个 txt 文件. 若最终采用这一档, 提交门禁改为 "Reviewer 正常结束且问题都已处理", 不再由程序生成逐条要求记录.
  - 实测结论 (ticket 10): luna xhigh 和 haiku high 在最轻一档下检出率不低于清单格式, 采用最轻一档, 两个模型都不需要复述要求. 场景较易, 证据偏弱, 后续实际审核中继续观察.
- Main Agent 每轮自选一两处 Reviewer 应当检查的要求或代码位置抽查; 发现漏检时, 该轮结果作废并重审.
  - 三个 Reviewer (要求符合, 代码质量, Spec Readiness) 都使用 txt 报告, 无问题时写 `No problems.` (ticket 14).
- Haiku Gate 2 观察: Main Agent 发现某个问题本应在已通过的 Gate 2 中被发现时, 在该 effort 的 spec 末尾记录一行. 累计记录作为调整 Reviewer 模型的依据, 不建立额外机制.
- Claude 后端 Reviewer 只用 `haiku`, 不用其他 Claude 模型; 推理强度可调, 默认 `high` (用户决定, 2026-10-26). 这是规则约定, 程序不强制.

#### Program-prepared review rounds

ticket 16 的要求. ticket 15 冒烟中 Main Agent 每轮审核要手工拼 `spawn_agent` 请求 (含完整 Role 正文的 `instructions`), 复制规则副本并计算 SHA-256, 选择报告目录和 `stateDirectory`, 再反复 `wait_agent`. 这些步骤改由两个 `prepare` 完成, Main Agent 每轮只运行 `prepare` 和一条 `arw background-agent --wait` 命令:

- **审核轮目录.** `prepare` 为每轮新建一个轮目录, 写入:
  - 每个 Reviewer 的报告目录, 其中只有一个空 txt 报告.
  - 执行规则副本 `rules/`: 全部 `AGENTS.md` (含嵌套), `docs/agents/**`, `.agents/skills/**` 和 `.claude/skills/**`, 保持仓库相对路径, 另有 `sha256sum` 格式的 `rules/SHA256SUMS`. Spec Readiness 取工作树中已跟踪或未被忽略的文件字节, 提交审核取已暂存字节.
  - 每个 Reviewer 一个 `<role>.jsonl`, 只含一行可直接写给 `arw background-agent` 的请求: `instructions` 是该 Role 文件加 `docs/agents/reviewer.md` 的正文 (来自同一份规则副本), `cwd` 是仓库根目录, `writePaths` 只含报告目录, `stateDirectory` 是轮目录的上级 (同一工作流的各轮共用, 使复审能找到原线程), 身份是该 Role 加完整排序的 issue ID 集合. 该身份在 `stateDirectory` 中的恢复记录已有 `threadId` 且 `failure` 为 `null` 时, 原线程视为可用 (`failure` 是恢复记录已有字段, 运行层以具体错误 `{code, message}` 结束该运行, 即该运行没有交付 `ready` 而以运行层错误结束时写入; 正常结束, 正常停止和提前结束阈值暂停都保持 `null`. 审核轮准备只看它是否为 `null`, 不解释错误种类) (已卸载的原线程由 `followup_task` 在管理进程内恢复), 请求是带原 `runId` 的 `followup_task`, handoff 另给前轮报告路径和相邻版本变化; 没有恢复记录时是 `spawn_agent`; 有记录但原线程不可用时是带 `newThread: true` 的 `spawn_agent`. `newThread` 是 Reviewer 运行层已有的可选布尔输入: 同身份已有恢复记录时, 不带它的 `spawn_agent` 以 `reviewer-identity-exists` 拒绝, 带它则为同身份新建线程并改写恢复记录, 对应长期规格 "原线程不可用或不可恢复时才新建线程"; 本 ticket 把它写进长期规格的 `spawn_agent` 合同.

  `prepare` 只打印轮目录绝对路径. Main Agent 运行 `cat <轮目录>/*.jsonl | arw background-agent --wait` 并行运行本轮全部 Reviewer; 只需重审其中一个时只传它的文件.
- **Spec Readiness.** `arw spec-readiness prepare` 的 Input 只含 `inputs`, 不再含 `draftPath`. 轮目录是 issue `spec-readiness` 工作区下的 `rounds/<requestId>/`, 草稿固定为 `report/draft.txt`, 冻结的 Request 仍写在 `requests/` 下. 轮目录另有 `snapshot/` (subject 和每个 Input 快照的文件形式); 复审时 handoff 指向前轮 Request, 前轮草稿, 以及 `git diff --no-index` 生成的前后两轮 `snapshot/` 差异 `changes.diff`. `generate --input` 仍须传入该草稿路径.
- **提交审核.** `arw commit-audit prepare --input <input.json>` 的轮目录是当前会话工作区下的 `_commit-audit/<n>/` (`n` 从 1 递增), Main Agent 修复后用同一个 `input.json` 再次运行即得到下一轮. `request.json` 增加 `base` (`HEAD` 提交) 和 `tree` (`git write-tree` 固定的已暂存树); 两个 Reviewer 都读取 `git diff <base> <tree>` 和 `git show <tree>:<path>`, 不读实时索引, 所以审核期间 Main Agent 可以继续暂存修复. Code Standards 的 handoff 列出按 `.arwignore` 和 effort `prototype/**`, `research/**` 排除后的纳入路径, 并指向授权 issue 中写明的预估净增行数. 复审的相邻版本变化是 `git diff <前轮 tree> <tree>`. 提交前 Main Agent 核对最终暂存树相对受审 `tree` 只有获准的记录差异.
- **等到完成.** `arw background-agent --wait` 在每个 `spawn_agent` 或 `followup_task` 成功回执后, 对该运行反复 `wait_agent` 直到 `completion` 非空, 运行环境退出, 等待失败, 或等到程序产生的暂停通知 (消息来源为 `provider-program`, 即提前结束阈值暂停), 然后为该请求再输出一行 `{id: "<请求 id>:done", ok, result: {runId, state, completion, messages, providerError}}`, `messages` 是期间收集的全部发给 Main 的消息 (编号, 来源, 正文); Reviewer 自己发的问题或进度消息只收集, 不结束等待, 中途的状态变化不输出. 为此 `wait_agent` 的消息通知增加已存储的 `source` 字段. 标准输入结束后等这些行都输出才退出. `completion` 为 `null` 且 `messages` 含 `provider-program` 消息时, Main Agent 按暂停通知规则取得用户决定后用 `send_message` 或 `interrupt_agent` 处理, 再用 `wait_agent` 等待. 不加 `--wait` 时行为不变.
- **非实施提交检查.** `arw commit-audit verify --non-implementation` 一条命令完成长期规格 "轻量提交流程" 列出的全部机械检查, 替代 `commit` Skill 非实施工作流的手工步骤: 候选非空, 已暂存路径都属于非实施分类 (只接受分类内的安全路径) 且同属一个 effort, 条目是普通文件或 gitlink (拒绝符号链接等其他模式), 没有未暂存的替代内容 (含子模块 `HEAD`), 没有实施 issue 新进入终态, 已注册 ARW Artifact 的路径与记录类型可解析, 文本是无 BOM 的 UTF-8 和 LF, `git diff --cached --check` 通过, 以及普通 `verify` 的 Artifact 身份保留; 检查前后 `git write-tree` 相同, 证明候选对象身份在检查期间不变. 输出与退出码同普通 `verify`.
- **复审收敛.** 复审判断前轮问题是否解决, 以及本轮变化 (含其影响范围) 引入的新问题; 前轮未完成的检查继续完成. 前轮已完成且未变化, 不受影响的内容不再审核, 也不为其提出新问题, 即使前轮漏报. 准确前轮输入无法恢复或影响遍及整个适用范围时, Reviewer 写明理由后全盘复审 (长期规格 `Review versions and result validity` 不变). 代价是前轮漏报的问题可能留到提交审核或之后才被发现; 换来复审轮数收敛 (ticket 15 冒烟中 haiku 每轮对新补文字之外的旧文字提新问题).
- **Reviewer 命令.** Reviewer 每次 Bash 调用只运行一条命令, 不用 `cd`, `&&`, `;` 或管道; 工作目录就是仓库根目录, git 命令不加 `-C`. Claude 后端的只读放行规则按单条命令前缀匹配, 组合命令会被拒绝; 后端另外放行以本次工作目录为参数的 `git -C <cwd>` 只读命令, 其他路径的 `-C` 仍被拒绝. 理由: 这是两次不同的拒绝. ticket 15 冒烟 (issue 记录的事故) 被拒的是组合命令 `cd ... && git ...`, 由单条命令规则解决; 随后 ticket 16 的 Claude 冒烟中, 要求符合 Reviewer 照本条早先 "需要其他目录时用 `git -C <path>`" 的写法运行 `git -C <仓库根目录> show ...`, 该命令不匹配 `git show` 前缀而被拒, 连续两轮 `incomplete`. 所以指令删去 `-C` 的建议, 后端同时放行指向工作目录本身的 `-C`, 不依赖模型完全遵守指令.
- **实施前就绪.** `implement` Skill 的 Entry 在修改实现文件前要求 `arw spec-readiness verify` 退出码为 `0`; 不再允许实施与首次 Spec Readiness 并行. 长期规格和 `spec-readiness` Skill 的并行许可同步删除. 理由: ticket 15 冒烟中 Claude Main 先写代码, 就绪审核随后要求改设计, 已写代码返工; 替代方案是保留并行, 只在提交前要求 `verify`, 被拒绝, 因为设计问题越晚发现返工越多. 接受的成本是实施要等就绪审核结束 (通常一到两轮).
- **新仓库默认值.** 仓库 `AGENTS.md` 没有声明测试单回调耗时阈值时, 默认 100 毫秒, 都不需要询问用户. 默认值写在 `test-performance-optimization` 和 `validation` Skill 中, `workflow init` 不另写配置.
- **长期规格.** 上述公开合同 (CLI 列表, 机器入口 `--wait`, Spec Readiness `prepare` 输入与输出, Commit Audit 轮目录与 `base`/`tree`, 非实施检查, 复审收敛, 实施前就绪) 同步写入长期规格 `docs/specs/agent-repository-workflow/spec.md`, 审核轮目录的共同部分写在其 `Review rounds`.
- **Reviewer 的 spec 修改意见.** Reviewer (Spec Readiness 或提交审核) 的问题要求修改 spec 或 PRD 时, Main Agent 和一个独立 subagent 共同决定是否修改及怎样修改, 双方有分歧的问题才交用户. subagent 使用与 Main Agent 相同的模型和推理强度, 以此满足 issue 中 "智力与推理强度都不低于 Main Agent": 模型可能是任意兼容接口的第三方模型, 跨模型的档位没有统一顺序, 相同设置是唯一总能判定的选择. 这一设置是 `subagent-allocation.md` 所说的预定义角色配置, 不读仓库映射, 所以新仓库 (映射为空) 也不必先请用户批准映射 (ticket 16 的 Claude 冒烟曾因此停下). 代价是同模型的第二个判断可能与 Main Agent 有相同盲点, 独立性只来自不看 Main 结论的独立上下文; 接受它, 因为分歧仍交用户, 且 Main 与 subagent 一致但都错的意见仍会在复审中被 Reviewer 再次检查. 同一审核轮全部报告 (提交审核有两份) 中的此类问题合并为一次决定, 每轮只启动一个 subagent. 双方一致认为不应修改的问题按现有质疑规则 (`docs/agents/subagent-findings.md`) 交回原 Reviewer, 以共同决定的理由为证据; Reviewer 仍维持原问题时, 结果保持 `gap`, 该问题交用户决定: 用户要求修改则修改 spec 后复审, 或暂停该 issue; 用户认定问题无效时, 这一认定属于 `subagent-findings.md` 允许再次质疑的 "用户明确确认需要重新检查结论", Main Agent 可据此再质疑一次. 就绪结果始终只由 Reviewer 报告决定, 本规则只取代修改 spec 前的逐次用户确认. 同一问题已经质疑过时不再为它启动 subagent. 写在 `rule-and-design-changes` Skill (取代这类修改的逐次用户确认), `spec-readiness` Skill 的问题处理引用它 (用户决定 2026-10-26). 理由: ticket 16 的 Codex 冒烟中, 每轮 Spec Readiness gap 都要改 spec, Main 因逐次确认停下 2 次, 墙钟从 19 分钟增至 30 分钟; 独立 subagent 保留第二个判断, 分歧仍归用户. 合并为一次决定是为了让每轮最多多出一次 subagent 运行.
- **Claude Reviewer 模型.** `reviewer-launch` 写明 Claude 后端 Reviewer 只用 `haiku`, 不用其他 Claude 模型 (用户决定, 见本节上方); 只是规则, 程序不强制.
- **其他摩擦.** Claude 后端每回合的 `turnId` 改为唯一值 (原先进程内计数, 管理进程恢复会话后续接回合又从 `turn-1` 开始, 与前轮同名). `reviewer-launch` 写明 Codex 中管理进程须在沙盒外启动 (沙盒内启动的管理进程拉起的 App Server 无法写入状态, 报 `Read-only file system`): 管理进程按长期规格在首次请求时自动启动并常驻, 所以只有它未运行 (`arw lba` 报告未运行) 时第一条请求申请在沙盒外运行, 不能提权时停止并说明. 沙盒内请求能否连接已运行的管理进程取决于 Codex 沙盒的读取和网络范围, 属于平台事实, 由本 ticket 的 Codex 冒烟实测并写入 Skill, 本 spec 不规定. `reviewer-launch` 同时删除已由 `prepare` 承担的手工步骤.

### Code reduction

- 在 `lib/` 公共模块中只保留一份 `isRecord`, `isJsonObject`, `sha256`, `exactKeys` 等工具函数, 各模块改为引用它.
- 提供一个声明式结构校验函数, 替换手写的逐字段 `typeof` 校验链, 只用于外部输入 (文件, 命令行, 子进程输出).
- 删除校验程序自身刚产生数据的代码, 以及吞掉错误又不处理的 `catch`.
- 随前述 Skill 化重写或删除以下代码和测试, 只保留达成各自目标所需的最小实现:
  - release VM 验证.
  - Reviewer 能力一致性.
  - reviewer-benchmark.
  - Upstream Sync.
- 所有压缩保持对外行为不变, 以现有测试为准. 只为被删除的功能删除测试.

### Migration sequencing

- 迁移期间以临时 `CLAUDE.md` 为本仓库规则, 旧 ARW 门禁不适用. 每张 ticket 提交前由独立 agent 审查 diff.
- 最后一张 ticket:
  - 恢复新的 `AGENTS.md` 并生成 `CLAUDE.md`.
  - 在用户级 `~/.claude/CLAUDE.md` 加一句 "项目规则与本文件冲突时以本文件为准".
  - 删除临时规则.
  - 在真实的 Claude Code 和 Codex 会话中各跑一次 "实现一个 issue 并提交" 的完整流程.

### Smoke follow-ups

ticket 13 冒烟后的日常使用修正, 预期结果如下:

- 分发的 Skill 和 Baseline 规则只链接目标仓库中存在的文件. 原先链接 Source Checkout 长期规格的地方, 把 Agent 需要的规则直接写在原处, 或删除链接.
- `reviewer-launch` 和 `spec-readiness` Skill 写明报告目录约束: 报告目录只含本轮绑定报告并作为 `writePaths`, Spec Readiness 的 `draftPath` 位于 issue 临时工作区内的这样一个子目录, Request, Input, 规则副本和 `stateDirectory` 放在目录外; 违反时 `spawn_agent` 返回 `report-binding-invalid`. 长期规格 Spec Readiness 准备章节的 `draftPath` 合同同时写明这一要求.
- `reviewer-launch` 写明 `wait_agent` 的 `timeout_ms` 必须在 `10000` 到 `3600000` 之间, 同一 `arw background-agent` 进程内重复的请求 `id` 被拒绝 (`background-agent-request-duplicate`).
- `reviewer-launch` 的 Codex 用法写明长请求写入文件后用重定向单独调用 (PTY 规范模式会截断约 4 KB 以上的单行输入; 原 `stty -echo -icanon` 绕法由 ticket 16 删除).
- 没有 `CONTEXT.md`, `CONTEXT-MAP.md` 且 `arw.config.json` 未配置语言检查时 (新初始化仓库的默认状态), `arw terms check` 以退出码 `0` 通过并说明没有可检查的术语; 配置了语言检查但没有术语表时仍返回 `terms-glossary-missing`. 长期规格 Document Terms 章节中两处描述这一场景的句子都按此条件写.
- `arw background-agent` 标准输入结束时, 先等全部未返回的请求 (含 `wait_agent`) 写出响应再退出; `SIGINT` 和 `SIGTERM` 仍取消等待 (用户决定, 2026-10-26). `reviewer-launch` 删除 `sleep` 绕法.
- Spec Readiness 的新鲜度只绑定设计 Input (`governing-spec`, `governing-prd`, `adr`, `domain-context`), Reviewer Role 和审核对象. `architecture-evidence` 是 issue 本身要修改的实现事实, `promote` 和 `verify` 不检查它的字节, 实施后不需要复审. 实现事实的变化都在提交候选中: 要求符合审核逐项核对 issue 要求, 并把要求范围之外的行为写成问题; Code Standards 审核检查同一候选的实施质量. 未被要求的架构事实变化因此在提交前被拦下. 不需要 ADR: 只缩小新鲜度检查范围, 不新增持久状态, 字段或权威来源, 恢复这项检查即可撤销.
- 长期规格 Commit Audit Module 设计理由段中 "清单由程序生成, Reviewer 只填结论和定位" 改为: Reviewer 把问题逐条写进 txt 报告, 没有问题时写 `No problems.`, ARW 不生成或提升审核记录, 提交门禁是 Reviewer 正常结束且问题都已处理. 理由直接写在该段: 已知缺陷场景对比中, 默认 Reviewer 模型在最轻格式下检出率不低于逐项清单, 成本更低 (见上文 `Review workflow` 的实测结论). 长期规格不引用本 effort 的记录. Reviewer 不再写已检查内容, 因此长期规格和 `commit`, `spec-readiness` Skill 中的抽查改为 Main Agent 自选一两处 Reviewer 应当检查的要求或代码位置.
- 本仓库 `docs/agents/subagent-allocation.md` 的仓库自有区域在 Codex 映射外补充 Claude Code 映射: 智力需求低, 中, 高分别用 `haiku`, `sonnet`, `opus`; 低, 中, 高努力对 `haiku` 和 `sonnet` 是 `low`, `medium`, `high`, 对 `opus` 是 `medium`, `high`, `xhigh`.
- Claude 后端 Reviewer 只使用 ARW 交付的 `instructions` 和 handoff, 不加载任何 `CLAUDE.md` (项目, 祖先目录和用户级), auto memory, hook, plugin, 用户或项目 settings 和 MCP 配置. 先实测当前参数实际加载的上下文, 再在后端启动参数中强制排除.
- 冒烟后修正: 没有 Codex home 时, Claude 后端 Reviewer 仍可启动; 只有需要 Codex 模型目录的 Codex 后端失败.
- 修复后在隔离目标仓库, 用一个约 150 到 300 行, 带 spec 和测试的真实 issue, 在 Claude Code 和 Codex 各完整运行一次 "实现并提交", 记录墙钟耗时, Reviewer 会话与轮数, Main 工具调用数和卡住之处, 作为 ticket 16 的对比基线.

## Module Design

### Modules

- **Claude 后端** (`lib/background-agent/claude-sessions.mjs`): 新增. 每个 Reviewer 回合运行一次 headless `claude -p`, 把 stream-json 事件转成后台 Agent 管理 Module 已有的通知. 隐藏会话续接, 启动参数, 权限限制和上下文排除.
- **后端路由** (`lib/arw-background-agent-host.mjs`): 按解析后的 Reviewer 设置把会话交给 Codex 后端或 Claude 后端. 不负责设置解析, 也不持有会话状态. 共享 App Server 生命周期, 模型目录和 Strata key 租约仍只属于 Codex 后端.
- **Projection** (`lib/workflow-distribution/` 与 `scripts/project-claude-skills.mjs`): 从 `.agents/skills/` 生成 `.claude/skills/` 和 `CLAUDE.md`.
- **审核轮准备** (`lib/reviewer-runtime/reviewer-round.mjs`): 新增 (ticket 16). 为 Spec Readiness 和提交审核的 `prepare` 写出一轮的规则副本, 报告目录和每个 Reviewer 的机器请求, 并按 `stateDirectory` 中的恢复记录选择 `spawn_agent` 或 `followup_task`. 隐藏规则文件集合, `instructions` 的组成和恢复记录的位置; 不启动 Reviewer, 不解释审核结论.
- **公共工具** (`lib/common/`): 负责与领域无关, 被两个以上 Module 使用的通用函数 (JSON 与摘要等纯函数, 以及文件系统和 Git 进程的薄封装) 和外部输入的声明式结构校验函数. 不负责任何 ARW 领域规则, 不持有状态; 只被一个 Module 使用的函数留在该 Module 内.

### Interfaces

- Claude 后端实现现有 `NativeSessions` 接口, 不改变它. Claude 后端没有常驻服务, 它自己的 `ensureServer` 是空操作, `observeServer` 返回 `absent`, 两个 Adapter 满足同一接口. 管理 Module 只在打开 Codex 会话前调用 `ensureServer`, 打开 Claude 会话时跳过, 所以 Claude 回合不依赖 Codex 运行环境; `observeServer` 只在关闭共享 App Server 时调用. 共享服务只属于 Codex, 因此路由把这两项转给 Codex 后端, 只把 `open` 按设置分派, `close` 先结束全部 Claude 回合再关闭 Codex 后端. 跟进是续接会话的新回合, 中断是结束进程. 失败结果沿用 `NativeSessions` 已有的回合状态: 回合只在进程以 `0` 退出且取得 `is_error: false` 的最终结果事件时为 `completed`; 其余情况 (`claude` 无法启动, 非零退出, `is_error`, 流截断或进程被外部终止而没有结果事件) 都为 `failed`, 无法解析的输出行被忽略, 不自动重试, 由 Main Agent 按 `reviewer-launch` 决定跟进或重新启动; 运行中追加指令和客户端请求应答直接拒绝.
- `arw background-agent` JSONL 机器接口和 `arw lba` 输出不变. 行为变化只有两项: 标准输入结束时先等未返回的请求写出响应 (见 `Smoke follow-ups`); 新增 `--wait` 选项, 在启动或跟进回执后追加一行本轮完成结果 (见 `Review workflow`).
- 审核轮准备的 Interface 是 `prepareReviewerRound({repositoryRoot, roundDirectory, ruleFiles, reviewers})`: `ruleFiles` 是仓库相对路径到字节的映射, 每个 Reviewer 给出 Role, issue ID 集合, 报告路径和 handoff 正文, 复审附加内容由调用方按返回的前轮报告路径补充. `arw spec-readiness prepare` 的输入去掉 `draftPath`, 两个 `prepare` 都改为只打印轮目录; `arw commit-audit verify` 增加 `--non-implementation`. 失败时抛出错误, CLI 打印原因并以非零退出, Main Agent 处理原因后重新 `prepare`; 恢复记录由程序自己写入, 字段不再校验.
- Projection 的输入是 `.agents/skills/` 与平台列表, 输出是平台目录中的文件; `--check` 只比较不写入.

### Seams and Adapters

- `NativeSessions` 是后端 Seam, Codex App Server 和 `claude -p` 是两个 Adapter; 测试用假的 `claude` 可执行文件观察启动参数和事件转换.
- 平台差异只在 Projection 配置和后端路由两处.

### Dependencies and Data Flow

后台 Agent 管理 Module -> 后端路由 -> Codex 后端或 Claude 后端. Spec Readiness 与 Commit Audit 的 `prepare` -> 审核轮准备 -> Reviewer 恢复记录路径 (`reviewer-session-record.mjs`); 审核轮准备只读恢复记录中的 `runId`, `threadId`, `failure` 和前轮报告路径 (`reportPath`), 不写入它, 也不连接管理进程. 恢复记录的唯一写入者是管理进程内的 Reviewer 运行层: 受理 `spawn_agent` 时创建 (带 `newThread: true` 时改写为新运行), 取得原生线程后写 `threadId`, 以运行层错误结束时写 `failure`, 写入失败按长期规格 `Reviewer runtime` 处理. Claude 后端只依赖 `claude` 可执行文件, ARW 配置读取 (`lib/arw-common/config.mjs`) 和用量计量 (`usage.mjs`), 不依赖 Codex 后端代码. 后端只由解析后 Reviewer 设置的 `modelProvider` 决定 (`anthropic` 用 Claude 后端), 设置解析包括 ADR-0032 规定的调用平台默认值; 路由不另看调用方平台. Claude 会话标识 (`threadId`) 与其他后端一样由 Reviewer 运行层写在 `stateDirectory` 的恢复记录中, 重启后从该记录续接; 会话内容由 `claude` 自己保存在 Reviewer HOME 下. 凭据只从用户级配置读取, 每回合注入子进程环境, 不写入持久设置.

### Module Design Rationale

复用 `NativeSessions` 让管理, 恢复和计量逻辑不分平台; 每回合一个 `claude -p` 进程用会话续接代替常驻服务, 换取没有 Claude 专用生命周期代码, 代价是不支持运行中追加指令. Projection 保持单一 Skill 来源, 避免两份规则漂移. 公共工具只收被两个以上 Module 使用的函数: 替代方案是每个 Module 保留自己的副本, 已被 `Code reduction` 拒绝, 因为副本会各自漂移; 接受的成本是使用方与公共函数签名耦合, 公共函数因此只放无领域规则, 签名稳定的通用函数. 路由放在管理进程入口而不是管理 Module 或各后端内: 管理 Module 只认 `NativeSessions`, 后端彼此不知道对方; 代价是入口多一个很小的分派对象. 后端由设置而不是调用平台直接决定, 使同一配置在两个平台得到同一 Reviewer; 平台默认值只影响设置解析, 记录在 ADR-0032. 审核轮准备放在 Reviewer 运行时一侧而不是两个工作流各写一份: 两个 `prepare` 生成的请求必须满足同一 `spawn_agent` 合同和同一恢复记录位置规则, 一份实现避免两处漂移; 替代方案是新增一个统一的 `arw review` 命令, 被拒绝, 因为两个工作流的 Request 冻结和输入不同, 合并命令只会多一层分派. 代价是 `prepare` 依赖恢复记录文件格式中的四个字段. 体积预算只计本任务的净增, 不让无关的冗余删除抵扣: 替代方案是允许顺带清理抵扣, 被拒绝, 因为这会让阈值被无关清理放宽, 失去及早发现本任务过度设计的作用; 接受的成本是无关清理要单独列出, 能分开时单独提交, 多一步说明.

### ADR Evaluation

Claude Code Reviewer 执行和后台管理范围由 ADR-0032 记录, 它取代 ADR-0016 的暂停决定并修订 ADR-0030 的管理范围. 其余变化不新增持久状态或权威来源, 不需要 ADR. ticket 16 的审核轮准备, `--wait` 和非实施提交检查只把 Main Agent 原先手工执行的步骤交给程序, 轮目录在临时工作区, 不新增持久状态或权威来源; 复审收敛, 提交审核读取固定 `tree` 和实施前就绪检查是规则文字层面的取舍, 改回原文字即可撤销, 不需要 ADR; 体积预算的净增口径 (无关删除不抵扣) 同属规则文字层面的取舍, 不新增持久状态或权威来源, 改回原文字即可撤销, 不需要 ADR. `newThread: true` 改绑同身份线程是 Reviewer 运行层既有行为, 对应长期规格 "原线程不可用或不可恢复时才新建线程", 本 ticket 只把它写进 `spawn_agent` 合同, 也不需要 ADR.

## Testing Decisions

- **`arw` 命令行边界:** 沿用 `tests/helpers/arw-cli.mjs` 及安装和分发测试的做法.
  - 观察 `arw workflow init`, `update` 和 `verify` 对 `codex` 与 `claude-code` 两个平台写出的准确文件内容.
  - 防止的风险: 投影遗漏或错误转换 Skill 引用, 导致某个 harness 读不到规则.
  - 参考 `tests/workflow-distribution/` 和 `tests/installation/`.
- **后台 Reviewer 机器接口边界:** 通过注入的 `NativeSessions` 观察同一组 JSONL 请求在两种后端下得到相同的结果结构.
  - Claude 后端用一个按 `stream-json` 格式输出的假 `claude` 可执行脚本测试, 覆盖新建, 续接, 中断和失败退出.
  - 防止的风险: 命令在某个 harness 中不可用, 或复审丢失前轮上下文.
  - 参考 `tests/background-agent/` 和 `tests/helpers/reviewer-runtime-adapter.mjs`.
- **审核轮与提交检查边界:** 通过 `arw` 命令行和注入的机器运行时观察公开结果.
  - `prepare` 首轮写出 `spawn_agent`, 有可用原线程时写出带原 `runId` 的 `followup_task` 和复审 handoff, 记录有 `failure` 时写出带 `newThread: true` 的 `spawn_agent`, 恢复记录不是合法 JSON 时失败.
  - 同身份已有记录而不带 `newThread` 的 `spawn_agent` 以 `reviewer-identity-exists` 拒绝, 带 `newThread: true` 时得到新的运行.
  - `--wait` 收集 Reviewer 消息而不结束, 在 `completion` 或 `provider-program` 暂停通知时为每个请求输出一行 `:done`.
  - `verify --non-implementation` 接受合格候选, 拒绝实施路径和终态转换.
  - 防止的风险: Main 拿到的请求不能直接运行, 或等待提前结束.
  - 不新增测试的部分 (风险接受): 运行层写入 `failure` 和 `newThread` 改写恢复记录 (新 `runId`, `threadId` 和 `failure: null`) 是本 ticket 之前已有的运行层行为, 本 ticket 不改其代码, 不为它新增测试. 它出错时 `prepare` 会选错请求, 但运行层对错选显式拒绝 (`reviewer-identity-exists`, 或跟进不可用线程时报错), Main 在 `:done` 行看到错误, 不会静默沿错线程审核. 唯一不报错的是 `failure` 被错记为非 `null`: 带 `newThread: true` 的新运行被受理, 原线程上下文不再续接, 结果是一次不带前轮上下文的完整新审核, 只多花时间, 不会沿错线程给出结论. `prepare` 的其他失败 (记录无法读取, 报告已存在) 是文件系统错误原样抛出; 失败残留的部分轮目录只占临时空间, 不影响下一轮 (前轮只取自恢复记录). 这些成本小于逐条写测试, 接受.
  - 参考 `tests/commit-audit/`, `tests/spec-readiness/`, `tests/reviewer-runtime/` 和 `tests/background-agent/machine.test.mjs`.
- **规则预算:** 一个测试按字符数近似计算常驻规则和最重日常流程的总量, 超过上限即失败.
- **代码压缩:** 以现有完整测试套件保持通过作为行为不变的证据, 不为压缩新增测试.
- **真实环境:** 在真实 Claude Code 和 Codex 会话中各做一次完整流程的人工冒烟验证, 作为最后一张 ticket 的验收项. 自动测试不调用真实模型.

## Out of Scope

- 放弃或降级 Codex 支持.
- 修改用户级 `~/.claude/` 规则 (只在最后加一句优先级说明), 以及把用户级规则并入 ARW.
- 投影 `.claude/settings.json` 权限.
- 改变 Application / JIRA 工作流的行为. 它的规则只做压缩.
- 发布稳定版本 tag.

## Further Notes

- Haiku 作为 Gate 2 effort 级审计模型可能漏掉跨 issue 的问题, 按上文 "Haiku Gate 2 观察" 记录.
- Claude Code 会话身份的来源需要实测, 见 Platform and reviewer runtime 一节.
- 本 spec 未经 Spec Readiness 审核: Claude 侧 Reviewer 运行正是本次迁移要建立的能力, 迁移期间按临时 `CLAUDE.md` 由独立 agent 审查.

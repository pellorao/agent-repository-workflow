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
16. 作为维护者, 我希望每张 ticket 预估改动行数, 超出一倍时 Agent 停下说明, 以便及早发现过度设计.
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
- Reviewer 默认值: Codex 后端 `gpt-6-luna`, `xhigh`; Claude 后端 `haiku`, `high`. 继续使用现有的用户级和仓库级两层配置.
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
  - 只为当前验收标准写代码: 不校验内部产生的数据, 每条错误处理路径都要对应一个现实失败场景.
  - 为推测性或极不可能的竞态, 安全极端情况增加复杂度前, 先向用户说明故障模式, 概率和复杂度成本并取得同意.
  - 先删后加.
  - 体积预算.

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

- Spec Readiness 只在 spec 定稿时审核一次. 不通过时修改后复审, 复审只看改动部分及其影响范围. 机械记录只保留审核对象绑定与 `verify` 校验, `verify` 只在提交前运行.
- 提交审核最多两个并行 Reviewer:
  - 要求符合审核: 由 Code Spec 与 Commit Audit Gate 1 合并而成, 逐条对照 issue 要求和验收标准检查实现.
  - 代码质量审核: 即 Code Standards, 职责中增加 "指出可删除的代码": 未使用的通用性, 对内部数据的校验, 没有现实失败场景的错误处理, 改动行数超出预算.
- Gate 2 effort 级审计时机不变, 在 effort 的全部实施 issue 进入终态时运行.
- 任何复审只看改动部分及其影响范围; 未受影响的有效结论保留.
- Reviewer 输出格式减负, 以实测而不是格式严格程度防止偷懒:
  - 偷懒的真实表现是 "格式完整但没有实际检查" (例如用脚本按输入一次性生成每条结果), 格式检查拦不住它. 旧规则要求复述每条要求的细节就是为此; 但这类要求是否必要取决于模型, 例如 luna medium 会偷懒, luna xhigh 基本不会.
  - 规则面向默认 Reviewer 配置 (luna xhigh, haiku high) 编写, 先采用较轻的格式: 要求清单由程序生成, Reviewer 为每条填写结论和证据定位, 只有 `gap` 和 `uncertain` 写说明; 程序机械检查每项都有结论, 证据定位真实存在.
  - 格式放到多低由 Reviewer 能力测试决定: 用已知缺陷的测试场景比较轻格式下各默认模型的检出率, 检出率下降的模型恢复必要的复述要求. 测试至少包含最轻的一档: 不要求格式化输出, Reviewer 只把找到的问题用自然语言逐条写进一个 txt 文件. 若最终采用这一档, 提交门禁改为 "Reviewer 正常结束且问题都已处理", 不再由程序生成逐条要求记录.
  - 实测结论 (ticket 10): luna xhigh 和 haiku high 在最轻一档下检出率不低于清单格式, 采用最轻一档, 两个模型都不需要复述要求. 场景较易, 证据偏弱, 后续实际审核中继续观察.
- Main Agent 每轮从 `satisfied` 项中抽查一到两项的证据; 发现证据不支持结论时, 该轮结果作废并重审.
  - 代码质量审核保持现有的 "只列问题" Markdown 格式.
- Haiku Gate 2 观察: Main Agent 发现某个问题本应在已通过的 Gate 2 中被发现时, 在该 effort 的 spec 末尾记录一行. 累计记录作为调整 Reviewer 模型的依据, 不建立额外机制.

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

## Testing Decisions

- **`arw` 命令行边界:** 沿用 `tests/helpers/arw-cli.mjs` 及安装和分发测试的做法.
  - 观察 `arw workflow init`, `update` 和 `verify` 对 `codex` 与 `claude-code` 两个平台写出的准确文件内容.
  - 防止的风险: 投影遗漏或错误转换 Skill 引用, 导致某个 harness 读不到规则.
  - 参考 `tests/workflow-distribution/` 和 `tests/installation/`.
- **后台 Reviewer 机器接口边界:** 通过注入的 `NativeSessions` 观察同一组 JSONL 请求在两种后端下得到相同的结果结构.
  - Claude 后端用一个按 `stream-json` 格式输出的假 `claude` 可执行脚本测试, 覆盖新建, 续接, 中断和失败退出.
  - 防止的风险: 命令在某个 harness 中不可用, 或复审丢失前轮上下文.
  - 参考 `tests/background-agent/` 和 `tests/helpers/reviewer-runtime-adapter.mjs`.
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

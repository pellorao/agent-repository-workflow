# ARW Skill 手册

[English](skills.md) | [简体中文](skills.zh-CN.md)

在仓库中启用 ARW (见[根 README](../../README.zh-CN.md)) 后, `arw workflow init` 会按你选择的平台安装一组针对特定任务的操作说明, 即 Skill: Codex 读取 `.agents/skills`, Claude Code 读取 `.claude/skills`. 本手册帮助你查看随 ARW 安装的全部 Skill, 分清哪些由 Agent 自动调用, 哪些必须由你亲自点名, 避免你等待某个不会自动启动的工作流步骤.

多数 Skill 会自动使用: 只要当前任务与某项 Skill 的描述匹配, Agent 就会自行加载. 相反, 标为 "需显式点名" 的 Skill 带有 `disable-model-invocation: true`, 绝不会自行触发; 只有你在对话中直接点名时它才会运行, 例如在 Codex 中发送 `使用 $grill-with-docs 和我确认需求`, 或在 Claude Code 中输入 `/grill-with-docs`.

以下两节涵盖 `distribution/skills/` 中的全部 Skill: 先是改编自上游的通用工程与效率 Skill, 再是为 ARW 的本地记录, 独立审核与提交关卡专门编写的自定义 Skill. 本手册只作导航与速查, 不复制任何 Skill 的完整合同; 具体执行步骤始终以已安装的 `SKILL.md` 及其指向的 `docs/agents/**` 规则为准.

## 上游 Skill

为了支撑日常的问题拆解, 设计与编码, ARW 收录了来自 [mattpocock/skills](https://github.com/mattpocock/skills) (`skills/engineering/` 与 `skills/productivity/`) 的 21 个 Skill. ARW 维护着一个固定在特定上游提交的改编分支, 并为适配 ARW 的 issue, 记录和平台做过翻译与调整, 因此实际行为可能与上游原文不同. 下方每一项都链接到该固定提交下的上游说明, 便于你了解原始设计思路. 它们按一项任务通常推进的顺序分组: 先澄清意图, 再调查与设计, 接着把计划落成经过验证的代码, 最后改进工作环境.

### 讨论与澄清

在动笔写规范或代码之前, 这些 Skill 帮助你推敲想法, 抚平对话中的疑问.

- `grilling` (自动使用): 对计划或决定持续追问, 直到每个分支都清楚; 其他 Skill 会复用它. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/productivity/grilling/SKILL.md)
- `grill-me` (需显式点名): 由你主动发起的同类追问, 适合与代码无关的计划. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/productivity/grill-me/SKILL.md)
- `grill-with-docs` (需显式点名): 追问的同时, 把确认的术语和架构决定实时记入 `CONTEXT.md` 与 ADR. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/grill-with-docs/SKILL.md)
- `wait-what` (需显式点名): 上一条消息没有讲明白时使用, Agent 会用平实的话重新说明. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/productivity/wait-what/SKILL.md)
- `to-questionnaire` (需显式点名): 把自己无法单独决定的事项整理成问卷, 交给能拍板的人. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/productivity/to-questionnaire/SKILL.md)

### 调查与设计

当目标已经明确, 或者任务太大, 领域太陌生而难以一次规划完时, 这些 Skill 帮助你探索代码库, 查证一手资料并划分模块边界.

- `wayfinder` (需显式点名): 把单次会话装不下的大型工作整理成决定 issue 的地图, 并逐个解决. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/wayfinder/SKILL.md)
- `research` (自动使用): 依据一手资料调查问题, 并把带引用的结论保存为 Markdown 文件. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/research/SKILL.md)
- `prototype` (自动使用): 构建可丢弃的原型来回答设计问题. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/prototype/SKILL.md)
- `domain-modeling` (自动使用): 在命名概念或决定边界前, 读取并更新领域术语表和 ADR. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/domain-modeling/SKILL.md)
- `codebase-design` (自动使用): 提供设计深模块, 接缝和可测试接口时的共用词汇. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/codebase-design/SKILL.md)
- `improve-codebase-architecture` (需显式点名): 扫描代码库中可加深的模块, 以 HTML 报告呈现, 再针对你选中的那一项继续追问. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/improve-codebase-architecture/SKILL.md)

### 规划与实施

敲定设计后, 这些 Skill 把对话结论转化为规范和 issue, 随后引导编码, 测试, 排错与代码审查.

- `to-spec` (需显式点名): 把当前对话直接整理成规范, 不再开启新一轮访谈. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/to-spec/SKILL.md)
- `to-tickets` (需显式点名): 把计划或规范拆成声明阻断关系的纵向切片 issue. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/to-tickets/SKILL.md)
- `implement` (自动使用): 按实施 issue 的要求构建交付内容, 完成验证并记录结果. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/implement/SKILL.md)
- `tdd` (自动使用): 遵循红-绿-重构循环的测试驱动开发. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/tdd/SKILL.md)
- `diagnosing-bugs` (自动使用): 针对疑难缺陷和性能退化的严谨诊断循环. 修复后若想找出预防同类问题的方法, 可运行 `$retro`. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/diagnosing-bugs/SKILL.md)
- `code-review` (自动使用): 沿实施标准和要求符合两个独立维度审核一个 Git 比较. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/code-review/SKILL.md)

### 设置与学习

在日常功能开发之外, 这些 Skill 帮助你把人工配置步骤写成交互脚本, 学习新概念, 以及在会话结束后复盘并改进 Agent 的工作环境.

- `wizard` (自动使用): 生成交互式 shell 脚本, 一步步带你完成只有人才能执行的步骤. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/wizard/SKILL.md)
- `teach` (需显式点名): 在当前目录中分多个会话教你一项新技能或概念. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/productivity/teach/SKILL.md)
- `retro` (需显式点名): 复盘一次编码会话, 为 Agent 的工作环境 (导航, 自动检查, 编码规范, 指令文件) 提出改进建议. 建议经常运行 `$retro`, 每完成一个 issue 或一段较长会话后都执行一次. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/retro/SKILL.md)
- `writing-for-agents` (自动使用): 编写 Skill, `AGENTS.md`, `CLAUDE.md` 等供 Agent 阅读的文档时的写作指引. [上游说明](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/productivity/writing-for-agents/SKILL.md)

## ARW 自定义 Skill

上游 Skill 提供了通用的工程习惯, 而下面这 11 个 ARW 自定义 Skill 则把这些习惯接入 ARW 的本地工作流: 管理 `.scratch` 下的记录, 调度独立 Reviewer, 把守提交关卡, 保持测试快速高质, 以及协调跨仓库工作. 下方每一项都会说明它何时生效, 具体做什么, 在磁盘或 Git 中留下什么, 以及配合哪些命令和其他 Skill 使用.

### 命令与记录

ARW 中的一切工作都从运行 `arw` CLI 命令和维护 `.scratch` 下的工作记录 (以及源码树中可选的 Code Map) 开始.

#### `arw-commands` (自动使用)

- 何时: Agent 编写或运行 `arw` 命令, 查询 issue, map, spec 或后台 Agent, 判断命令针对哪个仓库, 或在 `arw workflow init` 刚完成后审计仓库.
- 做什么: 固定规范命令写法, 区分只读命令和会写入的命令 (`workflow init`, `workflow update`, `text fix`, `spec-readiness generate` 等). 在 `init` 完成后, 它还会审计领域文档, 与分发规则冲突的仓库自有规则, 以及非英文文件名.
- 留下什么: 审计发现缺口时只创建一个合并的工作流完成 issue; 没有缺口则不创建.
- 相关: `arw list issues`, `arw print`, `arw text check`, `arw terms check`; `validation`, `issue-tracking`.

#### `issue-tracking` (自动使用)

- 何时: Agent 读取, 创建或更新 effort, issue, map, spec 时, 以及报告 issue 完成之前.
- 做什么: 规定 `.scratch` 的目录布局与编号, 实施 issue 的必备章节, 状态与分流值, 以及证据的存放位置 (`## Validation`, `## Comments`). 它还限制 Agent 只能读取当前 effort, 除非你授权读取其他 effort.
- 留下什么: `.scratch/<NNNN>-<effort-slug>/` 下的 issue, map 和 spec 文件.
- 相关: `arw list issues`, `arw print`, `arw open`; `implement`, `spec-readiness`.

#### `code-maps` (自动使用, 仅在配置后)

- 何时: Repository Profile 配置了 Code Map 根目录, 且 Agent 修改覆盖范围内的源码, 或编写, 核对 Code Map.
- 做什么: 修改覆盖范围内的代码前先读 Code Map README, 在同一个 issue 中更新所有受影响的 Code Map, 并运行 `arw code-map verify`. 它绝不会仅仅因为某个目录存在就为其创建 Code Map.
- 留下什么: 带有固定前置元数据和章节顺序的 Code Map `README.md` 文件.
- 相关: `arw code-map verify`; `validation`.

### 规划, 审核与提交

当工作记入 `.scratch` 后, 这些 Skill 负责把控编码前的独立设计审核, 独立 Reviewer 的启动与跟进, 受保护规则与设计文档的修改确认, 以及代码完成后的提交门禁.

#### `spec-readiness` (自动使用)

- 何时: 实施 issue 的设计定稿 (或修订) 后, 开始任何实施工作前需要独立的设计审核.
- 做什么: 准备审核输入 (治理规范, ADR, 上下文文档), 通过 `reviewer-launch` 启动 Spec Readiness Reviewer, 再依次运行 `generate`, `promote` 和 `verify`. 修正问题后需要开启新一轮审核. "不需要治理设计" 的例外必须由你明确确认.
- 留下什么: `.scratch/<NNNN>-<effort-slug>/issues/<NN>.spec-readiness.json`. 记录缺失, 过期或结果为 `gap` 时会阻断开始实施, 但不阻断无关工作. 一旦开始实施, 只有 issue 自身的审核对象发生变化才会阻断提交 (`verify --subject-only`).
- 相关: `arw spec-readiness prepare|generate|promote|verify`; `implement`, `reviewer-launch`, `rule-and-design-changes`.

#### `reviewer-launch` (自动使用, 仅 Main Agent)

- 何时: 与你对话的 Agent 启动, 跟进, 等待, 中断或恢复独立 Reviewer (Code Standards, 要求符合, Spec Readiness). Reviewer 自身不使用它.
- 做什么: 用 `cat <轮目录>/*.jsonl | arw background-agent --wait` 运行已准备好的审核轮, 从 `completion` 读取报告, 并处理 Codex 与 Claude Code 之间的平台差异. 如果单次审核超过 30 分钟, 它会询问你要不要继续等待; Reviewer 反复提前退出时也会同样询问你.
- 留下什么: 保存在审核轮预设路径上的 Reviewer 报告.
- 相关: `arw background-agent`, `arw list background-agents`; `spec-readiness`, `commit`.

#### `commit` (自动使用, 仅在你要求提交后)

- 何时: 你明确要求执行 Git 提交. 仅仅完成 issue 本身绝不会触发提交.
- 做什么: 先对已暂存的文件分类. 包含实施工作的候选走完整流程: 更新 issue 记录, `arw commit-audit prepare`, 并行启动两个 Reviewer (要求符合和 Code Standards), 逐条核对发现的问题, `arw commit-audit verify`, `arw spec-readiness verify --subject-only` (属于行为保持重构例外的 issue 没有就绪记录, 跳过此项), 最后执行提交. 只含规划记录, Agent 规则和文档 (包括根 README, `CONTEXT.md` 和 `CLAUDE.md`) 的候选走较轻的路线, 由 `arw commit-audit verify --non-implementation` 检查. 提交说明遵循 Conventional Commits, 任何一个关卡失败都会立即停止提交.
- 留下什么: `.tmp` 下的审核轮记录以及 Git 提交本身.
- 相关: `code-review`, `reviewer-launch`, `spec-readiness`, `issue-tracking`.

#### `rule-and-design-changes` (自动使用)

- 何时: 修改 Agent 指令, Skill, 长期规范, ADR, 上下文文档或其他保存持久设计的文档之前.
- 做什么: 先向你说明目标路径和具体改动, 并等待你的明确确认 (如果你的请求本身已经写明具体改动, 则直接视为已确认). 独立 Reviewer 提出的规范修改由 Main Agent 与一个独立 subagent 共同决定, 只有出现分歧时才交给你定夺. 它还规定持久文档必须按当前有效规则书写, 而不是按时间顺序记叙历史.
- 留下什么: 仅留下经确认的文件修改; 它不会暂存或提交这些修改.
- 相关: `spec-readiness`, `commit`.

### 测试与验证

在实施和日常维护期间, 这些 Skill 决定必须运行哪些验证检查, 以及怎样让测试套件保持快速和精简.

#### `validation` (自动使用)

- 何时: 修改程序行为或测试之前, 以及运行验证之前.
- 做什么: 确定当前必须运行的检查 (`arw text check`, `arw terms check --include <effort 目录>`, 已配置时的 `arw code-map verify`, 以及仓库在根 `AGENTS.md` 中声明的测试命令), 采用最少充分测试覆盖 (包括按仓库阈值测量新增或修改的测试回调耗时, 默认阈值为 100 毫秒), 复用仍然有效的验证结果, 并规定纯文档变更需要运行哪些检查.
- 留下什么: 每条验收标准的具体验证证据, 通常记录在 issue 的 `## Validation` 章节中.
- 相关: `test-performance-optimization`, `test-value-cleanup`, `implement`.

#### `test-performance-optimization` (自动使用)

- 何时: 目标是加快现有测试套件的运行速度.
- 做什么: 开始优化前先确认有授权 issue, 记录性能基线 (总耗时和最慢的 10 个回调), 随后通过保留每种结果的最小代表案例, 把等价输入合并为表格驱动测试, 以及共享不可变的测试准备数据来缩短测试耗时.
- 留下什么: 记录在 issue 中的耗时测量值与优化前后对比.
- 相关: `validation`, `test-value-cleanup`.

#### `test-value-cleanup` (需显式点名)

- 何时: 你明确要求清理低价值测试. 它没有固定触发周期, 日常新增普通测试也绝不会触发它.
- 做什么: 确认授权 issue, 固定基线测试数量和清理目标, 按相对价值删除低价值测试 (默认至少删除 20%), 如实列出每项覆盖损失, 同时保留权限, 身份和数据安全等核心保证, 最后按耗时目标核对完整测试命令 (默认连续三次运行的中位数低于 5 秒, 你另定目标时按你的目标核对).
- 留下什么: 被删除的测试, 每项覆盖损失的记录, 以及记录在 issue 中的耗时测量值.
- 相关: `test-performance-optimization`, `validation`, `implement`.

### 多仓库

最后, 如果你的工作需要跨多个 Git 仓库协同推进并与 JIRA 同步, 而不是在单个仓库内完成, 请显式点名以下 Skill 来逐步引导该流程.

#### `application-workflow` (需显式点名)

- 何时: 你已经选择多仓库与 JIRA 路线 (见[在多个仓库中分发工作并同步 JIRA](application-jira.zh-CN.md)). 无论是仓库配置还是 JIRA 请求都不会自动触发它.
- 做什么: 要求 `arw.config.json` 中存在完整的 `application` 对象, 然后一次只引导一个阶段: 配置, 接受 JIRA 任务, 关联并分发 issue, 修正 Module issue, 同步, 在 JIRA 中完成, 以及从部分完成的结果中恢复. 它本身不授予任何操作权限; 每次文件写入, 提交, 推送或 JIRA 写入仍须取得仓库规则要求的授权.
- 留下什么: Application effort 和 issue, 已分发的 Module issue, 以及经你授权的 JIRA 更新.
- 相关: `arw workflow init`, `arw workflow verify`, `arw application associate`, `arw application sync`, `arw jira list|print|open|accept|complete`, `arw module check-correction`; `issue-tracking`.

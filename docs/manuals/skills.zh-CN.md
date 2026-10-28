# ARW Skill 手册

[English](skills.md) | [简体中文](skills.zh-CN.md)

本手册面向已经在仓库中启用 ARW (见[根 README](../../README.zh-CN.md)) 的用户, 帮助你了解随 ARW 安装了哪些 Skill, 哪些由 Agent 自动使用, 哪些必须由你点名. Skill 是 Agent 在特定任务中遵循的一组操作说明. 多数 Skill 自动使用: 任务与其描述匹配时, Agent 会自行加载. 标为 "需显式点名" 的 Skill 不会自动触发 (`disable-model-invocation: true`), 只有你在对话中点名才运行, 例如在 Codex 中写 `使用 $grill-with-docs 和我确认需求`, 在 Claude Code 中写 `/grill-with-docs`.

`arw workflow init` 按你选择的平台安装 Skill: Codex 读取 `.agents/skills`, Claude Code 读取 `.claude/skills`. 下面覆盖 `distribution/skills/` 中的全部 Skill, 但不复制任何 Skill 的完整合同; 实际步骤以已安装的 `SKILL.md` 及其指向的 `docs/agents/**` 规则为准.

## 上游 Skill

这 23 个 Skill 来自 [mattpocock/skills](https://github.com/mattpocock/skills) (`skills/engineering/` 与 `skills/productivity/`). ARW 维护一个固定在某个上游提交的改编分支, 为适配 ARW 的 issue, 记录和平台做过翻译与调整, 所以行为可能与上游原文不同. 每一项链接到固定提交下的上游说明, 想了解原始思路可以去读.

### 讨论与澄清

- `grilling` (自动使用): 对计划或决定持续追问, 直到每个分支都清楚; 其他 Skill 会复用它. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/productivity/grilling/SKILL.md)
- `grill-me` (需显式点名): 由你主动发起的同类追问, 适合与代码无关的计划. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/productivity/grill-me/SKILL.md)
- `grill-with-docs` (需显式点名): 追问的同时, 把确认的术语和架构决定记入 `CONTEXT.md` 与 ADR. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/grill-with-docs/SKILL.md)
- `wait-what` (需显式点名): 上一条消息没有讲明白时使用, Agent 会用平实的话重新说明. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/productivity/wait-what/SKILL.md)
- `to-questionnaire` (需显式点名): 把自己无法单独决定的事项整理成问卷, 交给能回答的人. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/productivity/to-questionnaire/SKILL.md)

### 调查与设计

- `wayfinder` (需显式点名): 把一个会话装不下的大工作整理成决定 issue 的地图, 并逐个解决. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/wayfinder/SKILL.md)
- `research` (自动使用): 依据一手资料调查问题, 并把带引用的结论保存为 Markdown 文件. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/research/SKILL.md)
- `prototype` (自动使用): 构建可丢弃的原型来回答设计问题. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/prototype/SKILL.md)
- `domain-modeling` (自动使用): 命名概念或决定边界前读取并更新领域术语表和 ADR. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/domain-modeling/SKILL.md)
- `codebase-design` (自动使用): 设计深模块, 接缝和可测试接口时共用的词汇. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/codebase-design/SKILL.md)
- `improve-codebase-architecture` (需显式点名): 扫描代码库中可加深的模块, 以 HTML 报告呈现, 再对你选中的一项继续追问. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/improve-codebase-architecture/SKILL.md)

### 规划与实施

- `to-spec` (需显式点名): 把当前对话整理成规范, 不再重新访谈. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/to-spec/SKILL.md)
- `to-tickets` (需显式点名): 把计划或规范拆成声明阻断关系的纵向切片 issue. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/to-tickets/SKILL.md)
- `triage` (需显式点名): 让 issue 经过分流状态流转, 并写出 Agent 可直接领取的说明. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/triage/SKILL.md)
- `implement` (自动使用): 按实施 issue 构建交付内容, 验证并记录结果. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/implement/SKILL.md)
- `tdd` (自动使用): 先写测试的开发方式, 遵循红-绿-重构循环. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/tdd/SKILL.md)
- `diagnosing-bugs` (自动使用): 针对难复现的缺陷和性能退化的有纪律的诊断循环. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/diagnosing-bugs/SKILL.md)
- `resolving-merge-conflicts` (自动使用): 逐处解决进行中的合并或变基冲突, 并完成该操作. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/resolving-merge-conflicts/SKILL.md)
- `code-review` (自动使用): 沿实施标准和要求符合两个独立维度审核一个 Git 比较. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/code-review/SKILL.md)

### 交接, 设置与学习

- `handoff` (需显式点名): 把当前对话压缩成交接文档, 供另一个 Agent 接手. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/productivity/handoff/SKILL.md)
- `wizard` (自动使用): 生成交互式 shell 脚本, 带你完成只有人能做的步骤. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/wizard/SKILL.md)
- `teach` (需显式点名): 在当前目录中分多个会话教你一项新技能或概念. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/productivity/teach/SKILL.md)
- `writing-for-agents` (自动使用): 编写 Skill, `AGENTS.md`, `CLAUDE.md` 等供 Agent 阅读的文档时的指引. [上游说明](https://github.com/mattpocock/skills/blob/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/productivity/writing-for-agents/SKILL.md)

## ARW 自定义 Skill

这 11 个 Skill 为 ARW 编写, 实现它的工作流: `.scratch` 下的记录, 独立 Reviewer 和提交关卡. 每一项说明何时适用, 做什么, 留下什么, 以及配合哪些命令和 Skill.

### 命令与记录

#### `arw-commands` (自动使用)

- 何时: Agent 编写或运行 `arw` 命令, 查询 issue, map, spec 或后台 Agent, 判断命令针对哪个仓库, 或在 `arw workflow init` 刚完成后审计仓库.
- 做什么: 固定规范命令写法, 区分只读命令和会写入的命令 (`workflow init`, `workflow update`, `text fix`, `spec-readiness generate` 等). `init` 之后审计领域文档, 与分发规则冲突的仓库自有规则, 以及使用本地语言的文件名.
- 留下什么: 审计发现缺口时精确一个合并的工作流完成 issue; 没有缺口则不创建.
- 相关: `arw list issues`, `arw print`, `arw text check`, `arw terms check`; `validation`, `issue-tracking`.

#### `issue-tracking` (自动使用)

- 何时: Agent 读取, 创建或更新 effort, issue, map, spec, 以及报告 issue 完成之前.
- 做什么: 规定 `.scratch` 的目录与编号, 实施 issue 的必备章节, 状态与分流值, `## Spec Requirement` 怎样指向治理文档, 以及证据写在哪里 (`## Validation`, `## Comments`). 它还限定 Agent 只读当前 effort, 读取其他 effort 需要你授权.
- 留下什么: `.scratch/<NNNN>-<effort-slug>/` 下的 issue, map 和 spec 文件.
- 相关: `arw list issues`, `arw print`, `arw open`; `implement`, `spec-readiness`.

#### `code-maps` (自动使用, 仅在配置后)

- 何时: Repository Profile 配置了 Code Map 根目录, 且 Agent 修改覆盖范围内的源码, 或编写, 核对 Code Map.
- 做什么: 修改覆盖范围内的代码前先读 Code Map README, 在同一个 issue 中更新受影响的 Code Map, 并运行 `arw code-map verify`. 不会仅因目录存在就创建 Code Map.
- 留下什么: 带固定前置元数据和章节顺序的 Code Map `README.md`.
- 相关: `arw code-map verify`; `validation`.

### 规划, 审核与提交

#### `spec-readiness` (自动使用)

- 何时: 实施 issue 的设计定稿 (或修订) 后, 实施之前需要独立的设计审核.
- 做什么: 准备输入 (治理规范, ADR, 上下文文档), 经 `reviewer-launch` 启动 Spec Readiness Reviewer, 再依次运行 `generate`, `promote` 和 `verify`. 修正问题后重新审核一轮. "不需要治理设计" 的例外必须由你明确确认.
- 留下什么: `.scratch/<NNNN>-<effort-slug>/issues/<NN>.spec-readiness.json`. 记录缺失, 过期或结果为 `gap` 时阻断实施和提交, 不阻断无关工作.
- 相关: `arw spec-readiness prepare|generate|promote|verify`; `implement`, `reviewer-launch`, `rule-and-design-changes`.

#### `reviewer-launch` (自动使用, 仅 Main Agent)

- 何时: 与你沟通的 Agent 启动, 跟进, 等待, 中断或恢复独立 Reviewer (Code Standards, 要求符合, Spec Readiness). Reviewer 自身不使用它.
- 做什么: 用 `cat <轮目录>/*.jsonl | arw background-agent --wait` 运行已准备好的审核轮, 从 `completion` 读取报告, 并处理 Codex 与 Claude Code 的平台差异. 审核超过 30 分钟时询问你继续等待还是结束; Reviewer 反复提前退出时同样询问.
- 留下什么: 审核轮预先指定路径上的 Reviewer 报告.
- 相关: `arw background-agent`, `arw list background-agents`; `spec-readiness`, `commit`.

#### `commit` (自动使用, 仅在你要求提交后)

- 何时: 你要求 Git 提交. 仅仅完成 issue 不会启动它.
- 做什么: 对已暂存内容分类. 含实施工作的候选走完整流程: 更新 issue 记录, `arw commit-audit prepare`, 并行两个 Reviewer (要求符合和 Code Standards), 逐条核对问题, `arw commit-audit verify`, `arw spec-readiness verify`, 然后提交. 只含规划记录, Agent 规则和文档 (包括根 README, `CONTEXT.md` 和 `CLAUDE.md`) 的候选走较轻的路线, 由 `arw commit-audit verify --non-implementation` 检查. 提交说明遵循 Conventional Commits. 任何关卡失败都会停止提交.
- 留下什么: `.tmp` 下的审核轮和提交本身.
- 相关: `code-review`, `reviewer-launch`, `spec-readiness`, `issue-tracking`.

#### `rule-and-design-changes` (自动使用)

- 何时: 修改 Agent 指令, Skill, 长期规范, ADR, 上下文文档或其他保存持久设计的文档之前.
- 做什么: 说明目标路径和具体改动, 等待你明确确认; 请求本身已给出具体改动时视为确认. 独立 Reviewer 提出的规范修改由 Main Agent 与一个独立 subagent 共同决定, 只有分歧才交给你. 它还规定持久文档按当前规则书写, 不叙述历史.
- 留下什么: 只有已确认的修改; 它不暂存也不提交.
- 相关: `spec-readiness`, `commit`.

### 测试与验证

#### `validation` (自动使用)

- 何时: 修改行为或测试之前, 以及运行验证之前.
- 做什么: 确定必要检查 (`arw text check`, `arw terms check --include <effort 目录>`, 已配置时的 `arw code-map verify`, 以及仓库在根 `AGENTS.md` 中声明的测试命令), 采用最少充分覆盖, 复用有效结果, 并规定纯文档变更需要哪些检查.
- 留下什么: 每条验收标准的具体证据, 通常写在 issue 的 `## Validation`.
- 相关: `test-performance-optimization`, `test-value-cleanup`, `implement`.

#### `test-performance-optimization` (自动使用)

- 何时: 创建或语义修改测试案例之后 (按仓库阈值测量每个回调, 默认 100 毫秒), 或目标是加快现有测试套件.
- 做什么: 做优化工作前先要有 issue, 记录基线 (总耗时和最慢 10 个回调), 然后保留每个结果的最小代表案例, 把等价输入合并为表格驱动, 共享不可变的准备结果来缩短测试.
- 留下什么: issue 中的测量值和前后对比.
- 相关: `validation`, `test-value-cleanup`.

#### `test-value-cleanup` (自动使用, 但只在你要求时)

- 何时: 你要求清理低价值测试. 它没有固定周期, 普通新增测试不会触发.
- 做什么: 确认授权 issue, 固定基线数量和目标, 按相对价值删除低价值测试 (默认至少 20%), 如实说明每项损失, 保留权限, 身份和数据安全等核心保证, 然后按耗时目标核对完整测试命令 (连续三次运行的中位数低于 5 秒, 你另定目标时从其规定).
- 留下什么: 被删除的测试, 每项损失的记录, 以及 issue 中的测量值.
- 相关: `test-performance-optimization`, `validation`, `implement`.

### 多仓库

#### `application-workflow` (需显式点名)

- 何时: 你已经选择多仓库与 JIRA 路线 (见[在多个仓库中分发工作并同步 JIRA](application-jira.zh-CN.md)). 仓库配置或 JIRA 请求都不会自动触发它.
- 做什么: 要求 `arw.config.json` 中有完整的 `application` 对象, 然后一次只引导一个阶段: 配置, 接受 JIRA 任务, 关联并分发 issue, 修正 Module issue, 同步, 在 JIRA 中完成, 以及部分完成后的恢复. 它自己不授予任何权限; 文件写入, 提交, 推送和 JIRA 写入仍须取得仓库规则要求的授权.
- 留下什么: Application effort 和 issue, 已分发的 Module issue, 以及你授权的 JIRA 更新.
- 相关: `arw workflow init`, `arw workflow verify`, `arw application associate`, `arw application sync`, `arw jira list|print|open|accept|complete`, `arw module check-correction`; `issue-tracking`.

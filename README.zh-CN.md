# Agent Repository Workflow

[English](README.md) | [简体中文](README.zh-CN.md)

Agent Repository Workflow, 简称 ARW, 是运行在本地 Git 仓库中的工作流管理器. 它把工作记录, 实施授权, Agent 协作规则, 仓库配置和发布维护连接起来, 但不替代用户对重要决定, commit 或外部发布的授权.

这份 README 面向会使用终端, Git 和 Node.js 基本操作, 但从未接触过 ARW 的初级开发者. Node.js 24 是最低运行版本. ARW 使用原生 JavaScript 和 ES Modules, 没有 npm 运行时依赖. Windows 和 Linux 是一等支持的平台, macOS 目前是实验性平台.

## ARW 解决的问题

ARW 适合希望让用户和 Agent 在同一个 Git 仓库中持续协作的团队. 它试图改善目前用于编写代码的 Agent 带来的这些问题:

- YOLO (You Only Live Once) 会让 Agent 跳过必要的理解, 授权和验证, 严重影响代码和文档质量.
- Agent 编写的代码即使看起来完整, 有效性也难以保证.
- Agent 生成代码的速度大大超过用户可以逐项审核的速度.
- 上下文过满时, Agent 智能会下降, 容易遗漏约束或错误连接信息.
- 为了弥补这些风险, 单个 Agent 反复读取和自审会消耗过多 token.
- Agent 生成的文档容易充满黑话, 让用户难以理解真实行为和责任.

ARW 目前尚未完全解决的问题:

- Agent 编写代码的长期可维护性仍然偏低. 持续重构可以改善它, 但成本高昂.
- 按 ARW 的严格流程工作的 Agent, 各项审核的时间大大超过实现需求的时间. 这就让 ARW 的投入产出比相对 YOLO 模式来说不那么显著.

如果你只想让 Agent 临时回答问题, 或不需要在 Git 仓库中保存工作授权和证据, ARW 可能过重. 如果你希望重要决定由用户确认, 实施范围由工作记录授权, 并在提交前由独立 Reviewer 检查, 下面的首次成功路线适合你.

## 快速开始

首次成功需要先安装当前用户共用的 ARW 程序, 再初始化一个准备长期使用 ARW 的目标 Git 仓库. 按下面的顺序操作, 可以避免把源码仓库, 安装目录和目标仓库混为一处.

初始化时会询问是否配置 Code Map. Code Map 是由 Agent 维护的源码目录说明, 让后续 Agent 能从目录 README 理解各部分责任, 也让验证能够发现配置的源码范围是否缺少说明. 如果项目不需要这类导航和覆盖检查, 可以不配置.

1. 准备 Node.js 24 或更高版本和 Git. 当前 GitHub 仓库尚无稳定版本, 所以从公开 GitHub 克隆 `main` 并从源码安装:
   ```text
   git clone -c core.autocrlf=false --branch main https://github.com/pellorao/agent-repository-workflow.git
   cd agent-repository-workflow
   node install.mjs
   ```
2. 安装程序可以为 Windows 或 Linux 注册 `arw`, 但当前终端仍可能保留旧 PATH, 所以安装后使用新终端验证 `arw --version`. 实验性 macOS 不自动注册 PATH. 当前源码安装身份为 `<version>-pre`.
3. 进入准备使用 ARW 的目标 Git 仓库, 运行 `arw workflow init`. 这一步根据选择的平台, 领域文档布局和可选 Code Map 配置写入仓库工作流内容, 不会安装 Agent CLI.
4. 把命令输出的完整 `Agent Post-init Handoff` 交给当前会话的 Main Agent. 这个 Agent 会审核机械检查无法判断的规则, 文档和验证缺口. 没有缺口时不创建 issue; 有缺口时恰好建立一张汇总的仓库工作流补全 issue, 并在普通实施前完成它.
5. 运行 `arw workflow verify`, 再运行交接审核要求的适用检查. 然后用 `arw list issues` 查看可以推进的工作. 如果仓库还没有工作记录, `.scratch` 不存在和列表为空都是正常状态, 不表示初始化失败.

完成这 5 步后, `arw` 已经可用, 目标仓库也具备自己的 Agent 工作规则. 后文解释每一步的原因, 再从第一次查看工作记录自然进入日常路线.

## 安装并配置 ARW

安装和初始化解决两个不同问题. 安装把 ARW 运行时与 Workflow Distribution 放入当前用户的固定目录. Workflow Distribution 是安装后供目标仓库初始化使用的共享 Agent 工作流内容; 初始化消费这份内容, 为最近的目标 Git 仓库建立工作流. 更新 ARW 安装目录也不等于 `arw workflow update`: 前者替换用户运行时, 后者只更新当前目标仓库的受管内容.

### 安装 ARW 程序

当前没有稳定版本 tag, 因此公开安装主路线是克隆 `main` 后从源码安装. 这条路线需要 Node.js 24 或更高版本和 Git, 不需要 GitLab 访问权限或 SSH 密钥:

```text
git clone -c core.autocrlf=false --branch main https://github.com/pellorao/agent-repository-workflow.git
cd agent-repository-workflow
node install.mjs
```

该安装使用本地来源模式, 身份为 `<version>-pre`. 执行 `node install.mjs` 不会访问远端. 目前不要使用 Bootstrap 稳定版安装命令: 没有稳定 tag 时 Bootstrap 会失败, 也不会自动回退到 `main`. 未来创建正式稳定 tag 后, 才可使用从 GitHub 获取的单文件 [`scripts/install-arw.mjs`](scripts/install-arw.mjs). 不要把远程响应直接通过管道交给 Node.js; 先检查下载内容. 引导脚本不接受远端覆盖值, 也不保存凭据.

ARW 安装会校验来源数据的准确字节. Git 不得在取得数据时把仓库文本的换行符转换为 Windows 形式, 否则安装会因为来源字节不一致而失败. 下载的 Bootstrap 会在自己的临时 Repository 中设置 `core.autocrlf=false`, 不修改用户的全局 Git 配置.

先确认运行时:

```text
node --version
```

版本必须是 24 或更高. 安装程序会在取得来源或写入安装内容前拒绝低于最低版本的运行时.

有正式稳定 tag 后, Bootstrap 交互式安装默认选择最高稳定 SemVer 发布. 当前仓库尚无这种 tag, 所以下列 Bootstrap 命令现在不可用:

```text
node install-arw.mjs
```

有稳定 tag 后, 如果需要无人值守地安装最高稳定版本并注册 PATH, 使用:

```text
node install-arw.mjs --non-interactive --register-path true
```

有稳定 tag 后, 只有明确要安装历史版本或降级时, 才选择远端存在的准确稳定版本:

```text
node install-arw.mjs --version MAJOR.MINOR.PATCH
```

源码维护者及当前安装者使用以下命令克隆完整公开仓库. 克隆操作自身的 `-c` 选项会在首次签出前关闭换行转换, 并只把设置保存在这个 Repository 中:

```text
git clone -c core.autocrlf=false --branch main https://github.com/pellorao/agent-repository-workflow.git
cd agent-repository-workflow
node install.mjs
```

不要从已经发生换行转换的工作树安装. 请重新执行上述克隆命令, 保证仓库数据保持原始字节. 当前仓库公开, 克隆不需要私有 GitLab 权限. 如果目标是修改 ARW 源码, 直接转到 [开发者指南](docs/manuals/development.zh-CN.md), 其中负责开发环境, 源码导航和维护路线.

安装目录固定为:

- Windows: `%USERPROFILE%\.agent-repository-workflow`, 即使从 Git Bash 安装也不改用 `$HOME`.
- Linux 和实验性 macOS: `$HOME/.agent-repository-workflow`.

PATH 行为取决于平台:

- Windows 只管理当前用户 Registry 中的 `Path`. 即使环境变化通知成功, 当前 PowerShell, CMD 或 Git Bash 也可能保留旧环境, 因而需要新终端, 注销登录或手工刷新当前命令解释器.
- Linux 只管理 `~/.profile` 中由 ARW 标记的准确 PATH 块, 不猜测其他 shell 配置文件.
- 实验性 macOS 不自动登记 PATH. 需要由用户自行配置, 或直接使用安装目录中的启动器.
- `--register-path false` 不改变 PATH 或配置文件, 也不释放以前已经取得的归属.

安装完成后验证:

```text
arw --version
```

安装程序不会复制 Node.js. `arw` 启动器每次都从当前 PATH 解析 `node`, 所以验证使用的是新终端实际可见的运行时.

不再使用 ARW 时, 进入安装目录运行 `node uninstall.mjs`. 默认保留用户拥有的 `config.json`; 只有明确运行 `node uninstall.mjs --remove-config true` 才删除它. 卸载只移除有效安装清单能够证明由 ARW 拥有的运行时和 PATH 或配置文件登记, 未知文件保持不变.

### 初始化或调整目标仓库中的配套文件

安装只让命令可用, 还没有告诉 ARW 具体项目使用哪些 Agent 平台和文档布局. 打开新终端, 进入准备使用 ARW 的目标 Git 仓库, 然后运行:

```text
arw workflow init
```

ARW 从当前目录向上寻找最近的 Git working-tree root, 并且只观察和修改这个根目录. 嵌套 Git 仓库不会回退到外层仓库, 每个需要 ARW 的仓库都要从自己的根目录或子目录单独初始化.

初始化会收集或复用 Repository Profile. 这个配置记录所选平台, 领域文档布局, 以及可选 Code Map 的根目录, 包含和排除规则. 用户选择的平台是安装哪些平台内容的唯一依据; ARW 不扫描用户级或平台内置 Skill, 也不下载或验证 Agent CLI.

写入完成后, 命令输出完整的 `Agent Post-init Handoff`. 把整个交接块原样发给 Main Agent, 因为 Engine 观察到的缺口只是审核输入, 不能证明其他语义缺口不存在. 审核会检查仓库工作流, 领域文档和长期术语, 受管区域与重复规则, 仓库自有验证, 写作和文件名规则, `.arwignore`, Agent 管理范围及旧 ARW Artifact 的迁移准备情况.

`workflow init` 本身不创建根 `CONTEXT.md`, `CONTEXT-MAP.md` 或 `.scratch`. 如果领域文档缺失, 或其他审核项存在缺口, Main Agent 会把全部缺口合并到恰好一张仓库工作流补全 issue. 尚有用户选择时使用 `Status: needs-info`; 选择和 blocker 都解决后才进入 `Status: ready-for-agent`. 如果完整审核没有缺口, 不创建 issue, 此时缺少 `.scratch` 是正常结果.

交接完成后运行:

```text
arw workflow verify
arw code-map verify
arw text check
arw terms check
```

`arw workflow verify` 只读核对锁文件, Repository Profile, 受管内容, 平台投影和已配置的 Code Map. 只有 Profile 配置了 Code Map 时才需要单独运行 `arw code-map verify`. `arw text check` 检查 Agent 管理文本的 UTF-8, BOM 和 LF. `arw terms check` 从仓库根发现术语表: 根 `CONTEXT-MAP.md` 存在时使用它引用的各 `CONTEXT.md`, 否则使用根 `CONTEXT.md`. 它检查受管 Markdown 并默认排除 `.scratch`; 检查当前 effort 时增加 `--include .scratch/<NNNN>-<effort-slug>/`. 这些命令各自只证明自己实际观察的合同, 不能互相替代.

以后安装新版 ARW 后, 已经初始化 ARW 工作流的目标仓库不会自动更新. 需要让某个目标仓库采用新版随附的工作流内容时, 进入该仓库, 先预览更新计划, 确认后应用, 再验证结果:

```text
arw workflow update --dry-run
arw workflow update
arw workflow verify
```

`--dry-run` 只显示新版工作流会怎样改变这个仓库. 确认计划后, 第二条命令写入更新, 最后一条命令只读核对结果.

不再让这个目标仓库使用 ARW 时运行 `arw workflow remove`. 命令会让用户明确选择如何处理平台 Agent 配置, `.arwignore`, Code Map 和混合 Agent 文档. ARW 不会把无法证明归属的文件当作可删除内容.

## 在多个仓库中完成一个 JIRA 需求

当一项工作只修改一个 Git 仓库时, 继续使用后面的日常主路线即可. 当同一条 JIRA 需求必须由多个 Git 仓库共同完成时, 单仓库路线无法清楚区分整体要求, 各仓库实际实施和最终 JIRA 状态.

ARW 的多仓库路线让 Application Repository 保存整体要求和协调记录, 让各 Module Repository 只拥有自己的实施与验证. 这会增加仓库配置, 两侧工作记录, 有顺序的 commit 和 push, 以及 JIRA 写入授权; 收益是每项事实有清楚的责任方, 失败后也能从准确边界重试.

如果你正在判断一项工作是否需要多仓库协作, 或已经选择这条路线但不了解仓库与记录关系, 请使用 [在多个仓库中分发工作并同步 JIRA](docs/manuals/application-jira.zh-CN.md). 需要 Agent 执行其中的协调操作时, 显式调用 `application-workflow` Skill; 仓库配置和 JIRA 请求不会自动触发它.

## 日常使用

仓库初始化完成后, 日常路线从判断当前有没有可推进的工作开始. 有记录时读取它的状态和 blocker; 没有记录时根据需求清晰程度先讨论或调查, 再形成实施 issue. 实施完成不自动产生 commit, 只有用户明确请求后才进入审核和提交流程.

如果你已经处于 Agent 对话中, 只想快速选择一段可以发送的请求, 使用 [与 Agent 对话的日常命令](docs/manuals/daily-agent-conversation-commands.zh-CN.md). 那是一份带判断提示的速查手册, 不替代下面的完整工作路线.

### 查找和查看工作记录

ARW 把登记的 `issue`, `map` 和 `spec` 统称为 ARW Artifact, 并把它们保存在最近 Git 仓库的 `.scratch` 中. 一个 effort 使用 `.scratch/<NNNN>-<effort-slug>/`; issue 使用 `issues/<NN>-<issue-slug>.md`. 数字编号承担稳定身份责任, 描述性 slug 只帮助阅读路径.

对应的本地 Canonical ID 是 `issue:<NNNN>:<NN>`, `map:<NNNN>` 和 `spec:<NNNN>`. Canonical ID 不包含 slug 或文件路径, 因而 effort 或 issue 改名后仍可稳定引用.

先查看当前可以推进且没有未完成 blocker 的 issue:

```text
arw list issues
```

用户在终端中也可以使用短别名 `arw li`. 默认结果可以包含 `ready-for-agent` 或 `ready-for-human` 的实施 issue, 以及开放且尚未领取的 Wayfinder issue; Application Source Issue 只镜像其他仓库状态, 不进入默认结果.

需要按状态或类型调查时再收窄结果:

```text
arw list issues --all-statuses
arw list issues --status ready-for-agent,needs-info
arw list issues --type implementation,application-source,wayfinder
```

查看调查路线图和本地 specs:

```text
arw list maps
arw list specs
```

对应的用户短别名是 `arw lm` 和 `arw ls`. 找到目标后, 使用完整 Canonical ID 打开或读取:

```text
arw open issue:0007:02
arw print issue:0007:02
arw open map:0007
arw print spec:0007
```

`open` 使用全局 `config.json` 中的 `editor`, 先输出仓库相对路径, 启动编辑器后立即返回. `print` 把原始 UTF-8 内容写到 stdout, 适合 Agent 或脚本读取. 两者都只接受本地 Canonical ID, 不读取 Git 历史或其他仓库.

仓库尚未创建任何 ARW Artifact 时, `.scratch` 可以不存在. `list` 成功返回空结果, `migrate artifacts` 成功且无变化, 具体 `open` 或 `print` 返回可控的 `not-found`. 只有创建具体记录时才创建它所需的父目录; 不要为了让命令成功而手工建立空 `.scratch`.

可以先让 Agent 只读判断下一步:

```text
请读取 <issue-canonical-ID>, 告诉我它当前处于什么状态, 有哪些 blocker, 以及下一步是什么. 暂时不要修改文件.
```

### 启动一个负责当前会话的 Agent

每个独立会话需要一个 Main Agent 与用户沟通, 协调分工并负责 Git 写入. ARW 不要求通过自己的命令启动它. 初次使用时, 在目标 Git 仓库中直接运行已经安装和登录的平台 CLI 通常最简单, 例如 `codex` 或 `claude`.

如果经常重复使用同一个 Agent CLI 和同一组固定参数, 可以在 ARW 的用户配置中给它保存一个名称, 再从目标 Git 仓库运行:

```text
arw agent start <name> [agent-arguments...]
```

命名配置解决重复输入的问题, 不把外部 CLI 变成 ARW 内部 Reviewer. 如果你决定采用这条路线, 请在实际编辑配置前转到 [Agent CLI 指南](docs/manuals/agent-cli.zh-CN.md). 它负责当前全局配置结构, Codex 和 Claude Code 示例, 逐次参数, 可执行程序, 退出码以及进程和会话边界. 同一个 working tree 同时只应有一个写入者; ARW 不提供自动写入锁.

<a id="create-and-plan-work"></a>

### 创建与规划工作

如果 `arw list issues` 已经显示可以实施的 issue, 可以直接进入下一节. 如果没有记录, 先根据未知程度选择最小充分的讨论路线, 因为实施 issue 只有在要求和重要决定已经清楚时才应授权写入.

边界较清楚但仍涉及产品行为或长期维护选择时, 使用 `grill-with-docs` 逐项讨论并保存已经确认的决定:

```text
我要给现有列表增加 CSV 导出. 使用 $grill-with-docs 和我讨论以达成共识. 在我确认讨论完成前不要实施.
```

范围很大, 会超过一个 Agent session, 或当前想法还不足以形成完整需求时, 使用 `wayfinder` 建立共享调查路线图, 一次解决一个问题:

```text
我想重新设计项目的权限系统, 但还不知道完整范围. 使用 $wayfinder 建立调查路线图. 暂时不要实施产品改动.
```

调查和讨论足够清楚后, `to-spec` 只把已经确认的内容整理为 spec, 不重新访谈:

```text
使用 $to-spec 把我们已经确认的需求整理成 spec. 不再开启新的访谈.
```

然后用 `to-tickets` 把计划或 spec 拆成具有 blocker 关系的 issues, 并在发布记录前审核拆分:

```text
使用 $to-tickets 把这个 spec 拆成可以逐个实施的 issues. 先把拆分方案给我审核, 我确认后再创建记录.
```

这些路线按需要组合, 不是每项工作都要从头经过一遍. 已有完整要求时可以直接拆 issue, 已有被授权的实施 issue 时可以直接实施, 只读回答通常不需要实施记录. 调查用 Wayfinder issue 不替代实施授权, Application Source Issue 也只镜像 Module 状态; 只有匹配且可执行的实施 issue 才授权修改正式交付内容.

常见实施状态帮助判断下一步:

- `needs-triage`: 需要分类和初步核对.
- `needs-info`: 仍然需要用户决定或外部事实.
- `ready-for-human`: 下一步必须由用户亲自处理.
- `ready-for-agent`: 用户决定和 blocker 已解决, Agent 可以开始实施.
- `completed`: 验收条件和必要验证已经完成并记录证据.
- `wontfix`: 这张 issue 已明确终止而不实施.

### 开始实施

选择一张 `ready-for-agent` 且 blocker 已完成的实施 issue, 再给 Agent 一条边界清楚的请求:

```text
使用 $implement 实现 issue:<NNNN>:<NN>. 如果出现尚未确认的重要决定, 停下来使用 $grilling 和我沟通.
```

`implement` 会先完整读取 issue 及其所属 effort spec. 接着通过 Issue Gate 检查 issue 状态, blocker 和当前授权是否允许开始实施, 再完成 `prepare -> independent review -> generate -> promote -> verify` 的 Spec Readiness. `spec-readiness-reviewer` 只判断 issue 选择的治理设计是否当前, 完整且足以实施; 通过记录只授权开始该 issue, 不证明最终实现正确.

授权成立后, Main Agent 为写入范围建立可恢复基线并协调分工. Subagent 可以在分配的互不重叠范围内直接交付, 但所有 Git 写入仍由 Main Agent 统一执行. 发现工作超出 issue, 遇到未解决的重要决定, 或仓库规则互相冲突时, 受影响的写入必须停止并交给用户决定.

实施按验收条件推进, 先运行最接近改动的聚焦验证, 完成前再运行仓库要求的完整验证. 每项验收条件需要对应的实际证据. 全部满足后, Agent 在 issue 的 `## Validation` 中记录证据, 标记完成项并把状态更新为 `completed`.

`completed` 只说明工作记录已经完成. 它不会自动暂存文件, 不会自动创建 commit, 也不会把用户工作树中的其他修改纳入当前范围.

### 审核并提交

只有用户明确请求 commit 时, Main Agent 才进入提交工作流. 请求中应指明准确 issue 和范围, 例如:

```text
审核并提交 issue:<NNNN>:<NN> 的实现. 只包含这张 issue 授权的修改, 保留其他工作树内容.
```

Main Agent 先确认完成证据和准确 staged candidate. `code-review` Skill 随后用同一 Git 比较分别启动 `code-standards-reviewer` 和适用的 `code-spec-reviewer`: 前者检查仓库标准, 后者检查 governing requirements. 只有两个方向的完整结果都通过, 且允许的收尾完成后, 才冻结最终实施字节.

冻结后, Main Agent 为候选准备 Commit Audit Request, `commit-audit-reviewer` 核对 issue 要求和本批次适用的长期要求, 并把完整结果写入绑定 JSONL. Reviewer 返回完成状态后, Main Agent 调用 ARW 生成正式记录, 只按返回映射提升准确字节, 再运行 `arw commit-audit verify` 和其余机械检查. 审计开始后, 任何冻结实施字节变化都会使原审核和审计失效.

只有调查, 设计或其他封闭的非实施内容组成的候选可以使用较轻的提交路线. 候选一旦包含当前仓库实施产物, 就使用完整实施提交流程. 具体比较准备, 结果复用和恢复规则由目标仓库的 `code-review` 与 `commit` Skill 拥有, README 不复制它们的完整协议.

## 常用命令

下面只汇总日常选择入口. 完整语法以当前安装版本直接运行 `arw` 后显示的 Usage 和适用长期规格为准. Main Agent 编写操作指令时使用完整规范命令, 用户在终端中可以使用已列出的短别名.

### 检查版本和仓库配置

| 命令 | 解决的问题 |
| --- | --- |
| `arw --version` | 当前运行的是哪个 ARW 版本. |
| `arw workflow init` | 怎样为最近的目标 Git 仓库首次建立工作流. |
| `arw workflow verify` | 受管内容和当前 Repository Profile 是否一致. |
| `arw workflow update --dry-run` | 更新会改变哪些目标仓库内容, 但暂不写入. |
| `arw workflow update` | 怎样应用已经确认的工作流更新. |
| `arw workflow remove` | 怎样按明确选择移除目标仓库中的受管内容. |
| `arw code-map verify` | 已配置的源码目录说明是否覆盖且结构有效. |
| `arw text check` | Agent 管理文本是否符合 UTF-8, BOM 和 LF 要求. |
| `arw text fix` | 怎样修复文本检查可以机械修复的问题. |
| `arw terms check [--strict] [--include <repository-relative-directory>]...` | 当前上下文中的文档术语是否正确; `--strict` 增加发布名称检查, `--include` 纳入选定 `.scratch` 目录. |
| `arw language inspect <repository-relative-path>...` | 显式 Markdown 文件或目录的语言组成是什么, 不判断合格与否. |

### 查找, 打开和读取工作记录

| 命令 | 用户短别名 | 解决的问题 |
| --- | --- | --- |
| `arw list issues` | `arw li` | 当前有哪些没有未完成 blocker 的可推进 issue. |
| `arw list issues --all-statuses` | `arw li -a` | 全部结构和状态有效的 issues 是什么. |
| `arw list issues --status <status>[,<status>...]` | `arw li -s <status>[,<status>...]` | 哪些 issues 使用指定状态. |
| `arw list issues --type <type>[,<type>...]` | `arw li -t <type>[,<type>...]` | 哪些 issues 属于 `implementation`, `application-source` 或 `wayfinder`. |
| `arw list maps` | `arw lm` | 已登记的 Wayfinder maps 是什么. |
| `arw list specs` | `arw ls` | 已登记的本地 specs 是什么. |
| `arw open <canonical-id>` | - | 怎样用配置的编辑器打开本地 ARW Artifact. |
| `arw print <canonical-id>` | - | 怎样向 stdout 读取本地 ARW Artifact 的准确原文. |

`--all-statuses` 与 `--status` 互斥. `--type` 可以和状态筛选组合. 当 `list`, `open` 或 `print` 报告旧 issue 或 `PRD.md` 格式时, 先检查完整预检范围; `arw migrate artifacts` 迁移的是最近仓库的整个 `.scratch`, 不是只迁移刚才提到的一份记录.

### 启动保存好的 Agent CLI 配置

```text
arw agent start <name> [agent-arguments...]
```

当你已经决定保存一套命名配置时, 使用这个入口启动它. 配置字段, 参数和进程行为见 [Agent CLI 指南](docs/manuals/agent-cli.zh-CN.md).

### 通常由 Agent 运行的审核命令

用户通常只需指定 issue 和目标, 由 Main Agent 按当前工作流组织这些命令:

| 命令 | 责任 |
| --- | --- |
| `arw spec-readiness prepare --issue issue:<NNNN>:<NN> [--input <temp-json-path>]` | 冻结当前治理输入, 审核对象和 Reviewer Role, 形成 Reviewer Request. |
| `arw spec-readiness generate --issue issue:<NNNN>:<NN> --input <temp-json-path>` | 验证独立 Reviewer 的最终草稿并生成临时规范结果. |
| `arw spec-readiness promote --input <generated-path>` | 重验绑定未变化后提升准确生成的 issue 结果. |
| `arw spec-readiness verify --issue issue:<NNNN>:<NN>` | 只读确认该 issue 的实施前授权仍然有效. |
| `arw commit-audit prepare --input <absolute-input-path>` | 从冻结的已暂存候选准备独立 Commit Audit Request. |
| `arw commit-audit generate --request <absolute-request-path>` | 根据 Reviewer 完成的绑定 JSONL 生成当前候选的正式提交前审核文件. |
| `arw commit-audit verify` | 只读确认最终 staged candidate 与已提升审核一致. |

### 命令失败时先看什么

一般命令的 exit `0` 表示成功或接受的空操作, `1` 表示发现项, 阻断问题或操作失败, `2` 表示命令用法错误. Agent CLI 启动的退出行为属于专门手册.

- `Not inside a Git working tree`: 进入目标 Git 仓库根目录或它的子目录后重试.
- `.scratch` 不存在: 如果你在执行 `list`, `migrate artifacts` 或仓库工作流, 这是允许的正常状态. 只有打开或读取具体身份时, 才应检查记录是否真的已经创建.
- Windows 安装后找不到 `arw`: 打开新终端. 如果环境刷新仍未生效, 注销再登录或手工刷新当前命令解释器.
- Linux 安装后找不到 `arw`: 确认安装时允许登记 PATH, 并确认当前 shell 实际读取 `~/.profile`; ARW 不修改其他 shell 配置.
- 实验性 macOS 找不到 `arw`: 安装不会自动登记 PATH, 使用安装目录启动器或自行配置 PATH.
- `open` 无法启动编辑器: 检查全局 `config.json` 中的编辑器设置; 详细配置结构见 [Agent CLI 指南](docs/manuals/agent-cli.zh-CN.md).
- `arw agent start` 失败: 按 [Agent CLI 指南](docs/manuals/agent-cli.zh-CN.md) 检查命名配置, 参数和启动边界.
- Spec Readiness 返回 `gap`, `uncertain` 或已经失效: 修正真正拥有该设计的治理来源或审核输入, 再完整重跑, 不绕过结果.
- `workflow update` 报告 unknown ownership 或状态漂移: 保留用户修改, 依据当前锁文件和 Git 恢复基线解决冲突, 再重跑完整操作.
- 多个 Agent 同时写入同一个 working tree: 停止额外写入者, 由 Main Agent 重新确认恢复基线和互不重叠的范围.

<a id="reviewers"></a>

## 为什么还要独立审核

Main Agent 与用户沟通, 选择范围, 协调实施, 运行验证并统一执行 Git 写入. 同一个 Agent 容易在审核自己的工作时保留原有假设, 所以 ARW 在不同阶段使用 4 个 Canonical Reviewer Role:

- `spec-readiness-reviewer`: 第一次实施写入前, 审核 issue 选择的治理设计是否当前, 完整且足以实施.
- `code-standards-reviewer`: 用户请求 implementation commit 后, 审核同一候选是否符合仓库标准和适用写作或代码规则.
- `code-spec-reviewer`: 同一阶段从另一个轴审核候选是否满足明确的 governing requirements.
- `commit-audit-reviewer`: 两个 Code Review 轴完成并冻结最终候选后, 核对 issue 要求和本批次适用的长期要求.

典型关系是:

```text
Main Agent
|-- 实施前: spec-readiness-reviewer
|-- 实施和验证: Main Agent 与获分配写入范围的 subagent
`-- 用户明确请求 implementation commit 后
    |-- code-standards-reviewer
    |-- code-spec-reviewer
    `-- 冻结最终候选后: commit-audit-reviewer
```

Reviewer 只对绑定的输入独立判断, 不选择工作范围, 不替用户作重要决定, 不修改实现, 也不创建 commit. Main Agent 可以核对 finding 的证据和影响, 但不能用自己的判断覆盖 Spec Readiness 或 Commit Audit 的授权结果.

这些 Reviewer 是当前平台在同一工作流中启动的临时 Agent, 不是全局 `config.json` 里由 `arw agent start` 启动的外部程序. 两者没有名称映射或共享 session. 独立审核会增加等待时间和模型用量, 因而只在对应阶段运行, 但它换来的是与实现者分离的判断来源.

### 让 Claude Reviewer 使用第三方模型

在 Claude Code 中, Reviewer 设置的 `modelProvider` 为 `"anthropic"` 时由 headless `claude -p` 运行. 要改用兼容 Anthropic API 的第三方模型, 在 ARW 安装目录的 `config.json` 中给对应角色加 `env`, 每轮启动 `claude -p` 时注入这些环境变量:

```json
"reviewers": {
  "code-spec-reviewer": {
    "model": "my-model",
    "modelProvider": "anthropic",
    "env": {
      "ANTHROPIC_BASE_URL": "https://models.example.com",
      "ANTHROPIC_AUTH_TOKEN": "<token>"
    }
  }
}
```

`env` 可能含凭据, 只能写在用户级 `config.json` 中. 仓库的 `arw.config.json` 出现 `env` 时配置校验失败并拒绝启动 Reviewer.

### 在 Claude Code 中放行常用 ARW 命令

ARW 不生成 `.claude/settings.json`. 要让 Claude Code 像 Codex 的 `.codex/rules/default.rules` 那样免确认运行这些 `arw` 命令, 把下面的 `permissions.allow` 合并进用户级 `~/.claude/settings.json` 或仓库的 `.claude/settings.json`. 在 ARW 源码仓库中以 `node arw.mjs` 运行时, 把每项的 `arw ` 换成 `node arw.mjs `.

```json
{
  "permissions": {
    "allow": [
      "Bash(arw list:*)",
      "Bash(arw li:*)",
      "Bash(arw lm:*)",
      "Bash(arw ls:*)",
      "Bash(arw print:*)",
      "Bash(arw spec-readiness prepare:*)",
      "Bash(arw spec-readiness verify:*)",
      "Bash(arw --version:*)",
      "Bash(arw migrate artifacts:*)",
      "Bash(arw code-map verify:*)",
      "Bash(arw text check:*)",
      "Bash(arw text fix:*)",
      "Bash(arw workflow verify:*)",
      "Bash(arw workflow update:*)"
    ]
  }
}
```

## 附带技能

`arw workflow init` 根据用户选择的平台安装适用 Skills. Codex 使用目标仓库中的 `.agents/skills`, Claude Code 使用 `.claude/skills`. Skill 是 Agent 在特定任务中遵循的操作说明; 用户可以在对话中直接点名, 例如 `使用 $grill-with-docs 和我确认需求`.

当前 Source Checkout 中的 Skill 身份按主要用途如下. 同一个 Skill 可能被其他 Skill 调用, 这里的分组只帮助发现入口, 不改变它的实际说明:

- 讨论和澄清: `grill-me`, `grilling`, `grill-with-docs`, `wait-what`, `to-questionnaire`.
- 调查和设计: `wayfinder`, `research`, `prototype`, `domain-modeling`, `codebase-design`, `improve-codebase-architecture`.
- 规划和实施: `to-spec`, `to-tickets`, `triage`, `implement`, `tdd`, `diagnosing-bugs`, `resolving-merge-conflicts`.
- 审核和跨仓库协调: `code-review`, `application-workflow`.
- 交接, 设置和学习: `handoff`, `wizard`, `teach`, `writing-for-agents`.

选择 Skill 时先从当前目标出发. 需要检验重要选择时用 `grilling` 或 `grill-with-docs`; 需要保存超过一个 session 的未知问题时用 `wayfinder`; 要把既有共识整理为规范时用 `to-spec`; 已有实施 issue 时用 `implement`; 已经决定进入多仓库与 JIRA 路线时显式使用 `application-workflow`.

这份目录是面向读者的发现入口, 不是机器清单或每个 Skill 的完整合同. 实际步骤以目标仓库中对应的 `SKILL.md` 和适用 `docs/agents/**` 为准. `distribution/` 是发布前同步并审核的安装载荷, 不是 Source Checkout 日常编写这些内容的位置.

## 开发 ARW

如果目标不是在自己的项目中使用 ARW, 而是修改 ARW Source Checkout, 不要对源码仓库运行 `arw workflow init`, `update`, `verify` 或 `remove`. Source Checkout 是 Workflow Distribution 的编写来源, 不是消费这份分发内容的目标仓库.

已经克隆 Source Checkout 并准备修改时, 先从仓库根目录确认 Node.js 24 或更高版本, 再转到 [开发者指南](docs/manuals/development.zh-CN.md). 它会根据修改目标引导你准备完整开发环境, 选择实现或维护路线, 运行聚焦与共享验证, 并按源码责任导航定位代码. 稳定产品行为和长期边界由 [ARW 长期规格](docs/specs/agent-repository-workflow/spec.md) 拥有, README 和开发手册都不复制这些合同.

## 最后提醒

流程越复杂, 开发过程越重, 开发速度越慢. 没有流程或者流程过于简单, 开发质量又无法保证. 因此, 每个项目都需要在流程成本与质量收益之间找到平衡点, 根据改动风险选择最小但足够的路线.

这个平衡点会随着 Agent 智能的进化而变化. 当一种机械检查不能再提供可靠保护, 或自然语言审核已经更适合承担责任时, 应重新审查它的成本与收益, 不因为历史存在就永久保留. 可能在不久的将来, ARW 就不再有任何实际价值.

## 进一步阅读

- [在多个仓库中分发工作并同步 JIRA](docs/manuals/application-jira.zh-CN.md): 当一项 JIRA 需求必须由多个 Git 仓库共同完成时, 从适用性判断进入仓库责任, 操作顺序和失败恢复.
- [Agent CLI 指南](docs/manuals/agent-cli.zh-CN.md): 当你已经决定用 ARW 保存并启动外部 Agent CLI 配置时, 查阅配置, 参数透传以及进程和会话边界.
- [与 Agent 对话的日常命令](docs/manuals/daily-agent-conversation-commands.zh-CN.md): 当你已经处于 Agent 对话中并希望快速选择可发送内容时, 使用带判断提示的速查内容.
- [开发者指南](docs/manuals/development.zh-CN.md): 当你已经克隆 ARW Source Checkout 并准备维护实现, 文档, Workflow Distribution 或发布候选时, 选择维护路线和验证入口.
- [ARW 长期规格](docs/specs/agent-repository-workflow/spec.md): 查证稳定产品行为, 安全边界和长期责任.
- [安装长期规格](docs/specs/agent-repository-workflow-installation/spec.md): 查证 Bootstrap, 全局配置, 安装目录, PATH 归属, 升级和卸载合同.
- [读者文档规范](docs/specs/arw-reader-documentation/spec.md): 查看根 README 与各手册的长期分工和路由边界.
- [项目上下文](CONTEXT.md): 查询 ARW Source Checkout 已经建立的名称和排除边界.

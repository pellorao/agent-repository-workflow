# Agent Repository Workflow

[English](README.md) | [简体中文](README.zh-CN.md)

Agent Repository Workflow (简称 ARW) 帮助你在本地 Git 仓库中与编码 Agent 持续协作, 同时牢牢掌控设计决定, 代码质量和提交边界. 作为运行在本地的工作流管理器, 它把工作记录, 实施授权, Agent 协作规则, 仓库配置和发布维护串联起来: Agent 负责调查, 实现和独立审核, 而重要决定, commit 与外部发布始终由你明确授权.

本指南面向熟悉基本终端, Git 和 Node.js 操作, 准备首次安装和使用 ARW 的开发者. 运行 ARW 需要 Node.js 24 或更高版本. 由于 ARW 采用原生 JavaScript 和 ES Modules 编写且没有任何 npm 运行时依赖, 装好 Node.js 即可直接运行. Windows 和 Linux 是一等支持平台, macOS 目前处于实验性支持阶段.

## ARW 解决的问题

当团队与编码 Agent 在同一个 Git 仓库中长期协作时, 高速生成代码会带来单靠临时提示词无法解决的风险:

- 放任 Agent 以 YOLO (You Only Live Once) 方式运行, 会让它跳过必要的理解, 授权和验证, 严重拉低代码与文档质量.
- Agent 编写的代码表面上往往很完整, 但实际是否有效却很难确认.
- Agent 产出代码的速度远超人类逐项审核的速度.
- 对话上下文过满时, Agent 的智能会明显下降, 容易遗漏约束或把信息错误关联起来.
- 如果靠同一个 Agent 反复重读和自审来弥补这些风险, 又会消耗过多 token.
- Agent 生成的文档容易堆砌黑话, 让用户很难看清真实行为和责任边界.

即便引入了 ARW, 仍有两个现实代价尚未完全解决:

- Agent 编写代码的长期可维护性依然偏低. 持续重构虽能改善, 但成本高昂.
- 在 ARW 的严格流程下, 各项审核耗时远超编码实现本身, 这让它的短期投入产出比看起来不如 YOLO 模式那么显著.

正因为存在这些审核成本, 如果你只想让 Agent 临时回答问题, 或不需要在 Git 仓库里留存工作授权和验证证据, ARW 会显得过重. 反之, 如果你希望重要决定先由用户拍板, 修改范围由工作记录明确授权, 并在每次提交前由独立 Reviewer 把关, 请按下面的快速开始完成首次接入.

## 快速开始

首次接入分为两步: 先为当前操作系统用户安装共用的 ARW 程序, 再初始化准备长期使用 ARW 的目标 Git 仓库. 把源码仓库, 用户安装目录和目标项目仓库分开, 可以避免混淆三者的职责.

初始化仓库时, ARW 会询问是否配置 Code Map. Code Map 是由 Agent 维护的一组源码目录 README 说明, 既能让后续 Agent 通过各目录的 README 快速理解职责边界, 也能让验证命令及时发现哪些源码目录缺少说明. 如果你的项目不需要目录级导航和覆盖检查, 可以选择不配置.

1. 准备 Node.js 24 或更高版本. 从 GitHub 下载单文件引导脚本 [`scripts/install-arw.mjs`](scripts/install-arw.mjs) (Bootstrap), 检查文件内容后安装最高稳定版本:
   ```text
   node install-arw.mjs
   ```
2. 安装程序可以为 Windows 或 Linux 自动注册 `arw` 到 PATH. 由于当前终端窗口可能仍保留旧 PATH, 请打开一个新终端并运行 `arw --version` 验证安装. 实验性 macOS 不会自动注册 PATH.
3. 进入准备使用 ARW 的目标 Git 仓库, 运行 `arw workflow init`. 该命令会根据你选择的平台, 领域文档布局和可选的 Code Map 配置写入仓库工作流文件, 但不会替你安装 Agent CLI.
4. 把命令输出的完整 `Agent Post-init Handoff` 原样发给当前会话的 Main Agent. Main Agent 会逐项排查机械检查无法判断的规则, 文档和验证缺口: 如果没有缺口, 不会创建任何 issue; 如果存在缺口, 会建立恰好一张汇总的仓库工作流补全 issue, 并在开展普通需求实施前先完成它.
5. 运行 `arw workflow verify` 以及交接审核要求的各项检查, 然后用 `arw list issues` 查看当前可以推进的工作. 如果仓库里还没有任何工作记录, `.scratch` 目录不存在或列表为空都属于正常状态, 不代表初始化失败.

走完这 5 步后, `arw` 命令已经就绪, 目标仓库也拥有了自己的 Agent 协作规则. 下一节将展开说明安装, 初始化与版本升级的各项细节; 如果你已经完成初始化, 可以顺着后文从第一条工作记录进入日常协作流程.

## 安装并配置 ARW

快速开始之所以把安装和初始化分成两步, 是因为它们解决不同层面的问题. 安装负责把 ARW 运行时和 Workflow Distribution 放入当前用户的固定目录; 其中 Workflow Distribution 是供各个目标仓库在初始化时复用的共享 Agent 工作流内容. 初始化则是消费这份 Workflow Distribution, 为最近的目标 Git 仓库建立具体工作流. 同样地, 更新 ARW 安装目录与运行 `arw workflow update` 也不是一回事: 前者升级当前用户的 ARW 运行时, 后者只更新当前目标仓库内的 Managed Content.

### 安装 ARW 程序

大多数用户应采用从 GitHub 下载单文件 [`scripts/install-arw.mjs`](scripts/install-arw.mjs) (Bootstrap) 的主路线来安装稳定版本. 这条路线只需 Node.js 24 或更高版本, 不需要 GitLab 访问权限, SSH 密钥或 Git. 请先下载并检查脚本内容, 不要把远程响应直接通过管道传给 Node.js. 引导脚本不接受远端地址覆盖参数, 也不保存任何凭据; 它只从 GitHub release 下载约 0.5 MB 的纯安装载荷压缩包 `arw.tar.gz`, 再调用系统自带的 `tar` 解压安装.

如果你是 ARW 的源码维护者或开发者, 也可以克隆 `main` 分支后从源码安装 (见下文). 源码安装使用本地来源模式, 版本身份标记为 `<version>-pre`, 运行 `node install.mjs` 时不会访问远端网络. 需要注意, 从源码安装时 ARW 会逐字节校验源文件; Git 检出源码时绝不能把文本换行符转换成 Windows 的 CRLF, 否则安装会因字节不一致而直接失败.

无论采用哪条路线, 安装前请先确认 Node.js 运行时版本:

```text
node --version
```

主版本必须达到 24 或更高. 如果运行时低于最低要求, 安装程序会在获取文件或写入磁盘前立即拒绝执行.

确认环境达标后, 直接运行 Bootstrap 即可进入交互式安装, 默认选中最高稳定 SemVer 版本:

```text
node install-arw.mjs
```

如果在脚本或无人值守环境中安装最高稳定版本并自动注册 PATH, 请运行:

```text
node install-arw.mjs --non-interactive --register-path true
```

只有在首次安装且确需指定某个历史版本时, 才传入远端已发布的准确稳定版本号. ARW 不支持直接降级: 一旦已安装版本高于目标版本, 安装就会报错退出且不写入任何文件; 如需回退旧版本, 请先执行卸载:

```text
node install-arw.mjs --version MAJOR.MINOR.PATCH
```

源码维护者和开发者请使用下面的命令克隆完整公开仓库. 其中 `-c core.autocrlf=false` 会在首次检出前关闭换行符转换, 且只把这项设置保存在当前克隆出的仓库中:

```text
git clone -c core.autocrlf=false --branch main https://github.com/pellorao/agent-repository-workflow.git
cd agent-repository-workflow
node install.mjs
```

切勿在已经发生过换行转换的工作树里运行安装; 若换行符已改变, 请重新执行上面的克隆命令以确保源文件保持原始字节. 由于仓库完全公开, 克隆不需要私有 GitLab 权限. 如果你的目标是修改 ARW 自身源码, 克隆后请直接转到 [开发者指南](docs/manuals/development.zh-CN.md) 了解开发环境配置, 源码导航和维护路线.

无论通过哪种方式安装, ARW 的安装目录都固定在当前用户目录下:

- Windows: `%USERPROFILE%\.agent-repository-workflow`, 即使从 Git Bash 启动安装也不会改用 `$HOME`.
- Linux 和实验性 macOS: `$HOME/.agent-repository-workflow`.

安装程序登记 PATH 的方式取决于操作系统:

- Windows 只修改当前用户 Registry 中的 `Path`. 即使系统环境变更通知成功发送, 当前已经打开的 PowerShell, CMD 或 Git Bash 窗口仍可能沿用旧环境变量, 因此需要打开新终端, 注销后重新登录, 或手动刷新当前命令解释器.
- Linux 只管理 `~/.profile` 中带有 ARW 标记的那一段准确 PATH 块, 不会猜测或改动其他 shell 配置文件. 由于只有新的登录 shell 才会自动读取 `~/.profile`, 安装后请注销并重新登录, 或在当前 shell 中执行 `. ~/.profile`. 如果你的主目录下存在 `~/.bash_profile` (这会让 bash 跳过 `~/.profile`) 或你平时使用 zsh, 请在自己的 shell 配置中主动加载 `~/.profile`.
- 实验性 macOS 不自动登记 PATH. 请自行配置 PATH, 或直接调用安装目录里的启动器.
- 传入 `--register-path false` 时不会修改 PATH 或配置文件, 同时也不会释放之前安装时已经建立的 PATH 归属.

接下来打开新终端, 验证命令是否已经生效:

```text
arw --version
```

安装程序不会复制一份独立的 Node.js. `arw` 启动器每次运行时都会从当前 PATH 解析 `node`, 因此这条验证命令检查的正是新终端实际可见的运行时.

如果以后不再使用 ARW, 进入安装目录运行 `node uninstall.mjs` 即可卸载. 卸载默认保留用户的 `config.json`; 只有显式执行 `node uninstall.mjs --remove-config true` 才会一并删除它. 卸载程序只会清理有效安装清单能够证明归属 ARW 的运行时文件及 PATH 或配置文件登记, 其它未知文件一律原样保留.

### 初始化或调整目标仓库中的配套文件

装好 `arw` 只是让命令在系统中可用, 你还需要告诉 ARW 具体项目采用哪些 Agent 平台和领域文档布局. 打开新终端, 进入准备启用 ARW 的目标 Git 仓库, 运行:

```text
arw workflow init
```

ARW 会从当前目录向上查找最近的 Git working-tree root, 并且只观察和修改这个根目录. 嵌套的 Git 仓库不会回退到外层仓库, 因此每个需要使用 ARW 的 Git 仓库都必须从它自己的根目录或子目录单独初始化.

供脚本或 Agent 调用时, 可以使用无提示的非交互模式. 非交互初始化要求要么传入 `--reuse-profile` 复用现有配置, 要么提供完整的 Profile 替换参数 (此时 `--platform`, `--domain-layout` 和三个 `--code-map-*` 选项必须同时给出, 选项后不带值表示空列表):

```text
arw workflow init --non-interactive --platform codex --platform claude-code --domain-layout single-context --code-map-root --code-map-include --code-map-exclude
```

初始化过程会收集或复用一份 Repository Profile, 用来记录所选平台, 领域文档布局, 以及可选 Code Map 的根目录, 包含规则和排除规则. 用户所选的平台是决定安装哪些平台文件的唯一依据; ARW 不会扫描用户级或平台内置 Skill, 也不会替你下载或验证 Agent CLI.

在 Windows 平台上使用时, 请留意两项环境细节:

- Windows 上的 Git 可能会以 CRLF 行尾检出文件. ARW 读取仓库文件时会忽略行尾差异, 所以 CRLF 检出不会引起误报的状态漂移. 若要让团队所有成员的工作树行尾保持一致, 请自行提交 `.gitattributes` 或设置 `core.autocrlf=false`; ARW 不会创建或修改这两项配置.
- Windows 上 ARW 只支持官方渠道安装的原生 `codex` 和 `claude` 可执行文件: Codex 请使用官方 PowerShell 安装脚本安装, Claude Code 请使用原生安装器或 WinGet 安装. 通过 npm 安装的 `.cmd` 包装脚本不受支持.

`arw workflow init` 写完文件后, 会在终端输出完整的 `Agent Post-init Handoff`. 请把整段交接内容原样发给当前会话的 Main Agent: 因为 Engine 在初始化时观察到的缺口只是初步线索, 不能证明没有其它语义层面的遗漏. Main Agent 会全面审核仓库工作流, 领域文档与长期术语, 受管区域与重复规则, 仓库自有验证, 写作和文件名规则, `.arwignore`, Agent 管理范围以及旧版 ARW Artifact 的迁移准备情况.

注意 `workflow init` 本身不会创建根目录下的 `CONTEXT.md`, `CONTEXT-MAP.md` 或 `.scratch`. 如果审核发现领域文档缺失或其它检查项有缺口, Main Agent 会把所有缺口合并进恰好一张仓库工作流补全 issue: 只要还有待用户拍板的选择, 状态就保持为 `Status: needs-info`; 等所有选择和 blocker 都解决后, 状态才会转为 `Status: ready-for-agent`. 如果完整审核没有发现任何缺口, 则不创建 issue, 此时仓库里没有 `.scratch` 目录完全正常.

交接审核 (以及必要的补全 issue) 完成后, 运行下面四条命令核对仓库状态:

```text
arw workflow verify
arw code-map verify
arw text check
arw terms check
```

这四条命令各自验证不同的合同边界, 不能互相替代:

- `arw workflow verify` 只读核对锁文件, Repository Profile, Managed Content, 平台投影和已配置的 Code Map.
- `arw code-map verify` 只在 Repository Profile 启用了 Code Map 时才需要单独运行.
- `arw text check` 检查 Agent 管理文本是否满足无 BOM 的 UTF-8 编码与 LF 换行符要求.
- `arw terms check` 从仓库根目录发现术语表 (存在根 `CONTEXT-MAP.md` 时读取它引用的各个 `CONTEXT.md`, 否则读取根 `CONTEXT.md`), 检查受管 Markdown 文档并默认排除 `.scratch`; 如果要连同当前 effort 一起检查, 请加上 `--include .scratch/<NNNN>-<effort-slug>/`.

日后当你在本机安装了新版本的 ARW 时, 之前已经初始化过的目标仓库不会自动跟着改变. 要把某个目标仓库升级到新版附带的工作流内容, 请进入该仓库, 先预览更新计划, 确认无误后再执行更新并核对结果:

```text
arw workflow update --dry-run
arw workflow update
arw workflow verify
```

`--dry-run` 只展示新版工作流将如何改动当前仓库而不实际写盘; 确认计划后运行第二条命令写入更新, 最后用 `arw workflow verify` 只读验证更新后的完整性.

如果是从较早的 ARW 版本升级上来, 还需要核对以下三项变更:

- `code-spec-reviewer` 和 `commit-audit-reviewer` 已合并为 `requirements-reviewer`. `config.json` 或 `arw.config.json` 中写在旧角色名下的配置会被忽略, 请把原先为它们配置的模型迁移到 `reviewers.requirements-reviewer` 下.
- Spec Readiness 记录格式已升级到版本 7. 对于尚未提交的 issue, `arw spec-readiness verify` 会把旧版记录 (包括 `not-applicable` 例外记录) 判定为过期. 请按正常的 `prepare -> review -> generate -> promote -> verify` 流程重新生成; 例外记录则按 `generate -> promote -> verify` 重新生成.
- 如果新版工作流移除了某个原本包含仓库自有内容的规则文档, `arw workflow update` 会把这部分内容迁入 `AGENTS.md` 的仓库自有区域 (放在标明原文件路径的标题下), 删除旧文件, 并在更新结束时列出这些路径. 请检查迁入的段落并合并或清理.

如果某个目标仓库不再需要使用 ARW, 运行 `arw workflow remove`. 命令会让你明确选择如何处理平台 Agent 配置, `.arwignore`, Code Map 以及混合 Agent 文档, 并且绝不会把无法证明归属的文件当作可删除内容清理掉.

## 在多个仓库中完成一个 JIRA 需求

目标仓库初始化完毕后, 接下来走哪条工作流取决于你的任务涉及几个 Git 仓库. 如果任务只修改一个 Git 仓库, 请直接进入下一节的日常使用. 但如果同一条 JIRA 需求必须跨越多个 Git 仓库协同完成, 单仓库路线就无法清晰切分整体需求, 各仓库的具体实现以及最终的 JIRA 状态.

为此, ARW 提供了多仓库协作路线: 由一个 Application Repository 集中保存整体需求与协调记录, 而各个 Module Repository 只负责各自范围内的编码实现和验证. 这种拆分会增加仓库配置, 两侧的工作记录, 按序执行的 commit 与 push 以及 JIRA 写入授权等步骤; 但换来的是每一项事实都有明确的责任归属, 即使中途失败也能从准确的边界重试恢复.

如果你正在判断当前任务是否需要多仓库协作, 或已经选定这条路线并需要了解各仓库与工作记录的配合顺序, 请阅读 [在多个仓库中分发工作并同步 JIRA](docs/manuals/application-jira.zh-CN.md). 需要让 Agent 执行多仓库协调操作时, 请在对话中显式点名调用 `application-workflow` Skill; 无论是仓库配置还是收到 JIRA 请求都不会自动触发它.

## 日常使用

在单个 Git 仓库内开展日常工作时, 完整流程按五个阶段推进: 先查看当前有没有可推进的工作记录, 启动负责本次会话的 Main Agent, 为尚无记录的需求讨论并建立实施 issue, 按验收条件完成实施与验证, 最后在确认完成时请求独立审核并提交 commit. 注意, 实施完成并不会自动产生 commit; 只有当你明确发出提交请求时, 审核与提交流程才会启动.

如果你此时已经打开了 Agent 对话窗口, 只想快速挑一段现成提示词发给 Agent, 可以先看 [与 Agent 对话的日常命令](docs/manuals/daily-agent-conversation-commands.zh-CN.md) 速查手册, 需要了解完整上下文时再回到本节.

### 查找和查看工作记录

每次开始工作前, 先看看仓库里已经登记了哪些记录. ARW 把登记在案的 `issue`, `map` 和 `spec` 统称为 ARW Artifact, 保存在最近 Git 仓库根目录下的 `.scratch` 中. 每个 effort 放在 `.scratch/<NNNN>-<effort-slug>/` 目录下, 每张 issue 放在 `issues/<NN>-<issue-slug>.md` 中. 其中数字编号提供稳定的唯一身份, 描述性 slug 则让你在浏览目录路径时一眼看懂内容.

在命令或对话中引用这些记录时, 请使用它们的本地 Canonical ID: `issue:<NNNN>:<NN>`, `map:<NNNN>` 和 `spec:<NNNN>`. 由于 Canonical ID 不包含 slug 或文件路径, 即使后续重命名了 effort 或 issue 文件, 原有 ID 依然稳定有效.

首先列出当前没有未完成 blocker, 可以直接推进的 issue:

```text
arw list issues
```

在终端里也可以输入短别名 `arw li`. 默认列表会展示状态为 `ready-for-agent` 或 `ready-for-human` 的实施 issue, 以及开放且尚未被领取的 Wayfinder 调查 issue; Application Source Issue 因为只用于镜像其它仓库的状态, 默认不会混入列表.

排查阻塞项或历史记录时, 可以按状态或类型过滤结果:

```text
arw list issues --all-statuses
arw list issues --status ready-for-agent,needs-info
arw list issues --type implementation,application-source,wayfinder
```

如果想查看调查路线图或本地规格说明, 运行:

```text
arw list maps
arw list specs
```

对应的终端短别名分别是 `arw lm` 和 `arw ls`. `li`, `lm`, `ls`, `lba` 和 `jl` 输出的表格默认按 100 个显示列排版, 超长时只截断名称列 (`Title`, 在 `lba` 中为会话标题) 并以 `...` 结尾; 需要看完整标题时加上 `--full` (`-f`), 例如 `arw li -a -f`.

从列表中找到目标记录后, 用它的完整 Canonical ID 打开编辑器或把原文输出到终端:

```text
arw open issue:0007:02
arw print issue:0007:02
arw open map:0007
arw print spec:0007
```

`open` 会读取全局 `config.json` 中配置的 `editor`, 先打印仓库相对路径, 拉起编辑器后立即返回终端. `print` 则把原始 UTF-8 内容原样写到 stdout, 方便 Agent 或脚本直接读取. 两个命令都只接受当前仓库的本地 Canonical ID, 不会读取 Git 历史或跨仓库查找.

当仓库还没有创建过任何 ARW Artifact 时, `.scratch` 目录可以不存在: 此时运行 `list` 会正常返回空列表, `migrate artifacts` 也会正常无操作退出, 而针对具体 ID 运行 `open` 或 `print` 则返回可控的 `not-found`. 只有在真正创建某条记录时, ARW 才会按需建立对应的父目录; 请不要为了让命令通过而手动创建空的 `.scratch` 目录.

拿到一条 issue ID 后, 你可以先让 Agent 以只读方式帮你梳理现状并给出下一步建议:

```text
请读取 <issue-canonical-ID>, 告诉我它当前处于什么状态, 有哪些 blocker, 以及下一步是什么. 暂时不要修改文件.
```

### 启动一个负责当前会话的 Agent

要对工作记录采取行动或规划新任务, 每个独立会话都需要一个 Main Agent 负责与你沟通, 协调任务分工并统一执行 Git 写入. ARW 并不要求你必须通过 `arw` 命令启动它: 初次使用时, 直接在目标 Git 仓库目录下运行已经安装并登录好的平台 CLI (如 `codex` 或 `claude`) 通常最省事.

如果你每天都要带同一组固定参数启动同一个 Agent CLI, 可以在 ARW 的用户级配置中将它保存为命名配置, 之后在目标 Git 仓库里运行:

```text
arw agent start <name> [agent-arguments...]
```

保存命名配置只是为了省去重复输入参数, 并不会把外部 CLI 变成 ARW 内部的独立 Reviewer. 如果准备采用这种方式, 请在修改配置前先阅读 [Agent CLI 指南](docs/manuals/agent-cli.zh-CN.md), 了解全局配置结构, Codex 与 Claude Code 配置示例, 单次运行参数透传, 可执行文件要求, 退出码以及进程和会话边界. 无论用哪种方式启动 Agent, 同一个 working tree 在同一时间都只应有一个写入者, 因为 ARW 不会提供自动写入锁.

<a id="create-and-plan-work"></a>

### 创建与规划工作

启动 Main Agent 后, 根据前面 `arw list issues` 的结果决定下一步: 如果列表里已经有处于 `ready-for-agent` 状态的实施 issue, 可以直接跳到下一节开始实施; 如果还没有记录, 请根据当前需求的未知程度选择最轻量的讨论路线. 之所以要先规划再建单, 是因为只有当需求边界和重要决定都明确之后, 实施 issue 才应该授权修改仓库文件.

当需求整体边界已经清楚, 但还存在产品行为或长期维护上的取舍时, 使用 `grill-with-docs` 与 Agent 逐项敲定并在你确认后保存决定:

```text
我要给现有列表增加 CSV 导出. 使用 $grill-with-docs 和我讨论以达成共识. 在我确认讨论完成前不要实施.
```

当改动范围很大, 预计会跨越多个 Agent 会话, 或者目前只有一个初步想法还不足以形成完整需求时, 使用 `wayfinder` 建立共享调查路线图, 每次聚焦解决一个问题:

```text
我想重新设计项目的权限系统, 但还不知道完整范围. 使用 $wayfinder 建立调查路线图. 暂时不要实施产品改动.
```

等调查和讨论把关键问题都理清后, 用 `to-spec` 把双方已经确认的结论整理成正式 spec, 无需再重新访谈一遍:

```text
使用 $to-spec 把我们已经确认的需求整理成 spec. 不再开启新的访谈.
```

接着用 `to-tickets` 把计划或 spec 拆分为带有 blocker 依赖关系的若干张 issues, 并在正式落盘前先审核拆分方案:

```text
使用 $to-tickets 把这个 spec 拆成可以逐个实施的 issues. 先把拆分方案给我审核, 我确认后再创建记录.
```

上面这几个规划工具可以按实际需要自由组合, 不必每项工作都从头走完四步: 需求已经完整清晰时可以直接拆解 issue; 已经有现成且获授权的实施 issue 时可以直接开始实施; 纯只读提问则根本不需要创建实施记录. 请注意区分记录类型: 用于调查的 Wayfinder issue 不能替代实施授权, Application Source Issue 也只用于镜像 Module 仓库状态; 只有匹配且可执行的实施 issue 才能授权修改项目的正式交付物.

阅读或跟进实施 issue 时, 可以根据以下常见 `Status` 判断当前球在谁手里:

- `needs-triage`: 新建或待整理, 需要分类和初步核对.
- `needs-info`: 仍缺少用户的关键决定或外部事实.
- `ready-for-human`: 下一步操作必须由用户亲自完成.
- `ready-for-agent`: 用户决定和前置 blocker 均已解决, Agent 可以开始实施.
- `completed`: 验收条件和必要验证均已完成并记录了证据.
- `wontfix`: 该 issue 已明确终止, 不再实施.

### 开始实施

选定一张状态为 `ready-for-agent` 且前置 blocker 均已完成的实施 issue 后, 向 Main Agent 发送一条边界清晰的实施指令:

```text
使用 $implement 实现 issue:<NNNN>:<NN>. 如果出现尚未确认的重要决定, 停下来使用 $grilling 和我沟通.
```

收到指令后, `implement` 会先完整读取该 issue 及其所属的 effort spec, 随后通过 Issue Gate 核对 issue 状态, blocker 和实施授权, 并依次执行 `prepare -> independent review -> generate -> promote -> verify` 完成 Spec Readiness 检查. 在这一步中, 独立的 `spec-readiness-reviewer` 只判断该 issue 所选定的治理设计是否反映现状, 完整且足以指导实施; 通过检查只代表允许开始编码这张 issue, 并不证明最终写出的代码一定正确.

取得实施授权后, Main Agent 会为本次写入范围建立可恢复的 Git 基线并协调任务分工. Subagent 可以在分配给它的互不重叠范围内直接修改文件, 但所有 Git 写入操作始终由 Main Agent 统一执行. 实施过程中一旦发现改动超出 issue 范围, 遇到尚未确认的重要决定, 或发现仓库规则之间相互冲突, 受影响的写入会立即停止并交由你来决定.

编码过程严格围绕验收条件推进: Agent 会先运行离改动最近的单测或聚焦验证, 全部通过并在结束前再跑一遍仓库要求的完整验证. 每一条验收条件都必须有对应的实际验证证据. 当所有条件都满足后, Agent 会在 issue 的 `## Validation` 章节记下验证证据, 勾选已完成项, 并将 issue 状态更新为 `completed`.

请注意, `completed` 仅仅代表这张工作记录上的实施与验证已经完成: 它不会自动暂存文件, 不会自动创建 Git commit, 更不会把你工作树里的其它无关修改卷入当前任务范围.

### 审核并提交

正因为实施完成不会自动提交, 只有当你明确要求创建 commit 时, Main Agent 才会启动提交工作流. 请在请求中指明准确的 issue ID 和提交范围:

```text
审核并提交 issue:<NNNN>:<NN> 的实现. 只包含这张 issue 授权的修改, 保留其他工作树内容.
```

Main Agent 会先核对完成证据并锁定准确的 staged candidate, 然后运行 `arw commit-audit prepare`. ARW 会根据该 issue 和适用 spec 推导出审核范围并生成空白的 txt 报告, 随后并行启动两个独立 Reviewer: `requirements-reviewer` 逐条核对并写下未满足的需求问题, `code-standards-reviewer` 则检查仓库代码与写作标准并指出可以删减的冗余代码 (两者在未发现问题时均写入 `No problems.`). 只有当两个 Reviewer 都正常结束且报告的所有问题都已妥善处理后, Main Agent 才会运行 `arw commit-audit verify` 及剩余的机械检查并完成提交. 如果修复问题后需要复审, Reviewer 只会审查变化部分及其影响范围, 未受影响的原结论保持有效.

如果某次提交候选只包含调查记录, 设计文档或其它封闭的非实施内容, Agent 可以走较轻量的提交路线; 但只要候选中包含了当前仓库的实施交付物, 就必须走完上述完整的实施提交流程. 至于具体的差异比较准备, 审核结果复用和异常恢复规则, 由目标仓库的 `code-review` 与 `commit` Skill 直接管理, 本 README 不再重复展开它们的完整协议.

## 常用命令

熟悉了从初始化到提交的完整链路后, 你可以把下面的分类表格当作日常速查表. 需要查看完整参数语法时, 直接在终端运行已安装的 `arw help` 查看用法 或查阅对应的长期规格说明即可. Main Agent 在编写操作指令时始终使用完整的规范命令, 而你在终端手动操作时可以使用表中列出的短别名.

### 检查版本和仓库配置

在安装验证, 初始化, 更新或卸载目标仓库工作流时使用以下命令:

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

在日常查看, 筛选和读取 `.scratch` 下的 ARW Artifact 时使用以下命令:

| 命令 | 用户短别名 | 解决的问题 |
| --- | --- | --- |
| `arw list issues` | `arw li` | 当前有哪些没有未完成 blocker 的可推进 issue. |
| `arw list issues --all-statuses` | `arw li -a` | 全部结构和状态有效的 issues 是什么. |
| `arw list issues --status <status>[,<status>...]` | `arw li -s <status>[,<status>...]` | 哪些 issues 使用指定状态. |
| `arw list issues --type <type>[,<type>...]` | `arw li -t <type>[,<type>...]` | 哪些 issues 属于 `implementation`, `application-source` 或 `wayfinder`. |
| `arw list issues --full` | `arw li -f` | 完整未截断的标题是什么. |
| `arw list maps` | `arw lm` | 已登记的 Wayfinder maps 是什么. |
| `arw list specs` | `arw ls` | 已登记的本地 specs 是什么. |
| `arw open <canonical-id>` | - | 怎样用配置的编辑器打开本地 ARW Artifact. |
| `arw print <canonical-id>` | - | 怎样向 stdout 读取本地 ARW Artifact 的准确原文. |

其中 `--all-statuses` 与 `--status` 互斥, 而 `--type` 可以和状态筛选组合使用. 如果运行 `list`, `open` 或 `print` 时提示存在旧版 issue 或 `PRD.md` 格式, 请先检查完整的预检范围: 因为 `arw migrate artifacts` 会一次性迁移最近仓库的整个 `.scratch` 目录, 而不是只迁移刚刚报错的那一条记录.

### 启动保存好的 Agent CLI 配置

当你已经在全局配置中保存好一套命名 Agent CLI 配置后, 可以通过下面的入口从目标仓库启动它:

```text
arw agent start <name> [agent-arguments...]
```

具体的配置字段, 参数透传规则和进程行为见 [Agent CLI 指南](docs/manuals/agent-cli.zh-CN.md).

### 通常由 Agent 运行的审核命令

在日常实施与提交审核中, 你通常只需在对话里指明 issue 和目标, 下面这些门禁命令会由 Main Agent 按工作流自动组织调用:

| 命令 | 责任 |
| --- | --- |
| `arw spec-readiness prepare --issue issue:<NNNN>:<NN> [--input <temp-json-path>]` | 冻结当前治理输入, 审核对象和 Reviewer Role, 形成 Reviewer Request. |
| `arw spec-readiness generate --issue issue:<NNNN>:<NN> --input <draft-path>` | 验证独立 Reviewer 的最终草稿并生成临时规范结果. |
| `arw spec-readiness promote --input <generated-path>` | 重验绑定未变化后提升准确生成的 issue 结果. |
| `arw spec-readiness verify --issue issue:<NNNN>:<NN> [--subject-only]` | 只读确认该 issue 的实施前授权仍然有效. 带 `--subject-only` (提交时使用) 时只核对 issue 的审核对象, 不核对治理输入与 Reviewer Role. |
| `arw commit-audit prepare --input <absolute-input-path>` | 从冻结的已暂存候选准备独立 Commit Audit Request. |
| `arw commit-audit verify` | 只读确认最终 staged candidate 保留每个已提交 ARW Artifact 身份. |

### 命令失败时先看什么

普通 `arw` 命令退出时, 退出码 `0` 表示执行成功或允许的空操作, `1` 表示存在审核发现项, 阻断问题或操作失败, `2` 表示命令行参数用法错误 (Agent CLI 启动命令的退出码规则见专属指南). 遇到报错时可以对照下列常见现象排查:

- `Not inside a Git working tree`: 先进入目标 Git 仓库根目录或它的子目录, 然后重新运行命令.
- `.scratch` 不存在: 在尚未创建任何记录的仓库里执行 `list`, `migrate artifacts` 或仓库工作流命令时, 这是完全正常的允许状态. 只有在用 `open` 或 `print` 读取某个具体 ID 报错时, 才需要检查该记录是否确实尚未创建.
- Windows 安装后找不到 `arw`: 先打开一个新终端窗口. 如果新环境变量仍未生效, 请注销并重新登录系统, 或手动刷新当前命令解释器.
- Linux 安装后找不到 `arw`: 先确认安装时允许了登记 PATH, 然后注销重登或在当前终端运行 `. ~/.profile`. 如果你的主目录存在 `~/.bash_profile` 或使用 zsh, shell 不会自动读取 `~/.profile`, 需要你在自己的 shell 配置中加载它; ARW 不会修改其它 shell 配置文件.
- 实验性 macOS 找不到 `arw`: macOS 安装过程不会自动登记 PATH, 请直接调用安装目录里的启动器或自行把路径加入 PATH.
- `open` 无法启动编辑器: 检查全局 `config.json` 中的 `editor` 设置; 完整配置结构见 [Agent CLI 指南](docs/manuals/agent-cli.zh-CN.md).
- `arw agent start` 失败: 对照 [Agent CLI 指南](docs/manuals/agent-cli.zh-CN.md) 检查命名配置名称, 传入参数和启动边界.
- Spec Readiness 返回 `gap`, `uncertain` 或结果已失效: 先修正真正拥有该设计的治理文档或审核输入, 然后完整重跑一遍就绪审核流程, 切勿绕过门禁结果.
- `workflow update` 报告 unknown ownership 或状态漂移: 先妥善保留用户的本地修改, 依据当前 `arw-lock.json` 锁文件和 Git 恢复基线解决冲突, 再重跑完整更新操作.
- 多个 Agent 同时写入同一个 working tree: 立即停止多余的写入进程, 由 Main Agent 重新核对 Git 恢复基线并确认互不重叠的写入范围.

<a id="reviewers"></a>

## 为什么还要独立审核

前面的工作流和门禁命令之所以专门引入独立 Reviewer, 是为了避免让同一个 Agent 既当运动员又当裁判员. 在一次会话里, Main Agent 负责与用户沟通, 划定范围, 协调实现, 运行验证并统一执行 Git 写入; 如果让它直接审核自己的产出, 很容易顺着原有的隐含假设漏掉问题. 因此, ARW 在实施前和提交前两个关键节点安排了 3 个 Canonical Reviewer Role:

- `spec-readiness-reviewer`: 在设计定稿, 准备开始编码前运行一次, 审核该 issue 所选的治理设计是否反映现状, 完整且足以实施; 后续若有修改则只复审变化部分.
- `requirements-reviewer`: 在用户明确请求 implementation commit 后运行, 逐项核对已暂存候选是否满足 issue 要求和适用的长期规范要求.
- `code-standards-reviewer`: 在提交审核阶段与 `requirements-reviewer` 并行运行, 检查已暂存候选是否符合仓库标准以及适用的写作与代码规则.

整个协作过程中, Main Agent 与各 Reviewer 的时间线和分工关系如下:

```text
Main Agent
|-- 实施前: spec-readiness-reviewer
|-- 实施和验证: Main Agent 与获分配写入范围的 subagent
`-- 用户明确请求 implementation commit 后
    |-- requirements-reviewer
    `-- code-standards-reviewer
```

每个 Reviewer 只针对绑定的输入作出独立判断: 它不会自行选择工作范围, 不替用户作重要决定, 不修改任何代码或文档实现, 也不创建 commit. Main Agent 可以核实 Reviewer finding 的具体证据和影响范围, 但不能用自己的判断去覆盖 Spec Readiness 或 Commit Audit 的门禁授权结果.

从运行机制上看, 这些 Reviewer 是当前工作流在需要时拉起的临时 Agent, 而不是全局 `config.json` 里通过 `arw agent start` 启动的外部 CLI 进程; 两者之间没有任何名称映射, 也不共享会话状态. 独立审核确实会增加等待时间和模型 token 消耗, 因此 ARW 只在实施前和提交前两个对应阶段按需启动它们, 用这点额外开销换取独立于实现者之外的客观把关.

### 让 Claude Reviewer 使用第三方模型

在 Claude Code 环境下, 当某个 Reviewer 的 `modelProvider` 设为 `"anthropic"` 时, ARW 会通过无头模式 `claude -p` 运行它. 如果你想让它接入兼容 Anthropic API 的第三方模型服务, 可以在 ARW 安装目录下的用户级 `config.json` 中为对应角色添加 `env` 字段; 之后每轮启动 `claude -p` 时都会自动注入这些环境变量:

```json
"reviewers": {
  "requirements-reviewer": {
    "model": "my-model",
    "modelProvider": "anthropic",
    "env": {
      "ANTHROPIC_BASE_URL": "https://models.example.com",
      "ANTHROPIC_AUTH_TOKEN": "<token>"
    }
  }
}
```

由于 `env` 中通常包含认证凭据, 这项配置只允许写在用户级 `config.json` 里. 一旦目标仓库内的 `arw.config.json` 出现 `env` 字段, 配置校验就会直接报错并拒绝启动 Reviewer.

### 在 Claude Code 中放行常用 ARW 命令

与 Codex 会通过 `.codex/rules/default.rules` 获得默认放行规则不同, ARW 不会自动生成 `.claude/settings.json`. 如果你希望 Claude Code 在运行日常只读或门禁 `arw` 命令时也免去逐次弹窗确认, 可以把下面的 `permissions.allow` 列表合并进用户级 `~/.claude/settings.json` 或仓库内的 `.claude/settings.json`. (如果在 ARW 源码仓库中通过 `node arw.mjs` 运行命令, 请把每一项里的 `arw ` 替换为 `node arw.mjs `.)

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

除了命令行工具和独立 Reviewer, `arw workflow init` 还会根据你选择的平台把配套的 Skills 安装到目标仓库中 (Codex 位于 `.agents/skills`, Claude Code 位于 `.claude/skills`). Skill 是供 Agent 在特定任务中遵循的操作说明: 大多数 Skill 会在任务匹配时由 Agent 自动启用, 其余不会自动触发的 Skill 则需要你在对话中显式点名, 例如 `使用 $grill-with-docs 和我确认需求`. 想了解 ARW 一共安装了哪些 Skill, 哪些自动触发, 哪些需要点名以及各自的适用时机, 请查阅 [Skill 手册](docs/manuals/skills.zh-CN.md).

## 开发 ARW

如果你的目标不是在自己的项目里使用 ARW, 而是修改 ARW Source Checkout 源码本身, 请切记不要对源码仓库运行 `arw workflow init`, `update`, `verify` 或 `remove`. Source Checkout 是编写和产出 Workflow Distribution 的源头仓库, 而不是消费这份分发内容的目标仓库.

克隆好 Source Checkout 并准备动手修改时, 请先在仓库根目录确认 Node.js 版本达到 24 或更高, 然后直接阅读 [开发者指南](docs/manuals/development.zh-CN.md). 该指南会根据你的修改目标引导你配置完整的开发环境, 选择实施或维护路线, 运行聚焦与共享验证, 并按源码职责快速定位模块. 至于稳定的产品行为和长期设计边界, 则由 [ARW 长期规格](docs/specs/agent-repository-workflow/spec.md) 权威定义, 本 README 和开发者指南都不会重复抄录这些合同.

## 最后提醒

任何工程流程都在速度与确定性之间做权衡: 流程越严密, 开发过程就越重, 推进速度也越慢; 可一旦没有流程或流程过于简陋, 交付质量又难以保障. 因此, 每个项目都需要在流程成本与质量收益之间找到适合自己的平衡点, 根据当前改动的风险选择最小但足够可靠的路线.

这个平衡点也会随着 Agent 智能水平的进化而不断移动. 当某项机械检查不再提供可靠的保护, 或者自然语言审核已经能更好地承担起原本的把关责任时, 就应该重新审视它的成本与收益, 而不是因为历史上一直存在就永久保留下去. 也许在不久的将来, ARW 本身就会彻底完成历史使命, 不再有任何实际价值.

## 进一步阅读

当你需要深入了解某条专门路线或查证底层规范时, 可以按当前任务进入对应的文档:

- [在多个仓库中分发工作并同步 JIRA](docs/manuals/application-jira.zh-CN.md): 当一项 JIRA 需求必须由多个 Git 仓库共同完成时, 从适用性判断进入仓库责任, 操作顺序和失败恢复.
- [Agent CLI 指南](docs/manuals/agent-cli.zh-CN.md): 当你已经决定用 ARW 保存并启动外部 Agent CLI 配置时, 查阅配置, 参数透传以及进程和会话边界.
- [与 Agent 对话的日常命令](docs/manuals/daily-agent-conversation-commands.zh-CN.md): 当你已经处于 Agent 对话中并希望快速选择可发送内容时, 使用带判断提示的速查内容.
- [开发者指南](docs/manuals/development.zh-CN.md): 当你已经克隆 ARW Source Checkout 并准备维护实现, 文档, Workflow Distribution 或发布候选时, 选择维护路线和验证入口.
- [Skill 手册](docs/manuals/skills.zh-CN.md): 当你想了解 ARW 安装了哪些 Skill, 哪些由 Agent 自动使用, 哪些需要你点名时, 查看带用途和触发时机的清单.
- [ARW 长期规格](docs/specs/agent-repository-workflow/spec.md): 查证稳定产品行为, 安全边界和长期责任.
- [安装长期规格](docs/specs/agent-repository-workflow-installation/spec.md): 查证 Bootstrap, 全局配置, 安装目录, PATH 归属, 升级和卸载合同.
- [读者文档规范](docs/specs/arw-reader-documentation/spec.md): 查看根 README 与各手册的长期分工和路由边界.
- [项目上下文](CONTEXT.md): 查询 ARW Source Checkout 已经建立的名称和排除边界.

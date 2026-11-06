# Agent Repository Workflow Release 长期规格

## Scope

本文定义 ARW 源码仓库验证和发布稳定版本的长期规则: 发布候选, 本地检查, 跨平台 VM 验证, tag, 公开 Bootstrap 验证, GitHub 托管发布对象和失败恢复. 具体操作步骤由源码仓库专用且只能显式调用的 `$release` Skill (`.agents/skills/release/`) 拥有. Agent Repository Workflow 长期规格 (`../agent-repository-workflow/spec.md`) 拥有产品和仓库工作流. 开发长期规格 (`../agent-repository-workflow-development/spec.md`) 拥有 Workflow Distribution 与平台投影. 安装长期规格 (`../agent-repository-workflow-installation/spec.md`) 拥有 Bootstrap, 安装来源与载荷, Identity, Installation Contract 和 ARW 安装目录.

## Release validation configuration

根 `release-validation.json` 只保存规范 HTTPS 远端 `repositories.sourceCheckout.url`. Bootstrap 生成物从它投影远端, 正式推送和 tag 后验证都使用它. 它没有版本字段, 因为配置与读取代码由同一 Git 提交绑定. VM 位置, 快照和凭据由维护者在仓库外的 VM JSON 中提供, 不进入仓库, issue 或发布证据. VM JSON 可以是单个文件, 也可以拆成共用机器文件和引用它的 ARW 发布配置, 格式与合并规则由 `$release` Skill 的 `references/vm.md` 拥有. ARW 专用的发布配置 (含共用机器文件路径和 fixture 目录路径) 记录在仓库根被 Git 忽略的本地文件 `.arw.local.json` 的 `release` 对象中, 不含秘密, `$release` 先读它, 缺失时才询问维护者.

## Release procedure

1. Main Agent 读取 `package.json.version`, 取得维护者对该准确版本进行发布验证的确认. 确认不授权任何外部写入. 版本必须高于候选可达的全部稳定 tag, 且该 tag 在本地和规范远端都不存在.
2. 候选是一个已提交, 工作树干净的 commit. 在候选上运行 pnpm frozen install, `pnpm typecheck`, `pnpm test`, Workflow Distribution 检查, Bootstrap 生成物检查, 文本检查, 严格术语检查和分发副本语言检查 (`arw language inspect distribution`, 只报告, 由 Agent 按 `docs/agents/writing.md` 判断).
3. 在每台受支持的 Windows 和 Linux 受验系统上从基线快照开始, 只通过宿主传入的候选 Git bundle 与宿主用 `scripts/pack-release.mjs` 为候选打成的安装压缩包取得候选, 按 Validation coverage 节运行 guest 检查, 并在宿主上完成该节的 "宿主一次" 情形. 结束后硬关机并还原快照.
4. 任一检查发现候选缺陷时, 修复并形成新候选, 从第 2 步重新开始. 环境问题修复后只重跑受影响的检查. 临时补偿后的结果只用于诊断.
5. 全部通过且维护者授权准确项目, `origin`, 分支和版本后, 推送分支, 创建并推送无前缀的版本 tag. 规范远端第一次看到的 tag 就必须指向已验证 commit, 回滚后重建的 tag 同样如此. 随后在已验证 commit 的干净检出上用 `scripts/pack-release.mjs` 生成安装压缩包 `arw.tar.gz`, 其内容由该 commit 的 `release-manifest.json` 决定.
6. 创建 GitHub 托管发布对象并上传 `arw.tar.gz` 为资产. 之后从公开 HTTPS 地址取得该 tag 的 `scripts/install-arw.mjs`, 在隔离 home 中带 `--version` 与不带 `--version` 各安装一次并确认版本 (Validation coverage 节的 "宿主一次" 情形).

## GitHub release publication

公告保存在 Repository 之外, title 和正文使用中文, 只描述在本次 tag 上可观察的变化, 并包含安装章节和 `Changelog`. Main Agent 向维护者展示准确 title 和完整公告文件, 批准绑定准确字节, 任何变化都需要重新批准.

写入前确认本地与规范远端的 tag 都指向已验证 commit, 并完成 `gh` 认证预检. 先只读查看同 tag 的 Release: 已存在且 tag, 经 Git 解析的 commit, title 和正文全部匹配, 并且是正式已发布对象, 且资产 `arw.tar.gz` 存在时, 视为幂等成功; 冲突或读取失败时停止. 只有明确不存在时才用 `--verify-tag` 创建, 不提供 `--target`. 创建后, 以及超时或结果不明时, 都只做只读核对, 不盲目重复创建. `targetCommitish` 不能证明 tag 提交.

发布资产是只含安装载荷的压缩包 `arw.tar.gz`, Bootstrap 按固定名称从该 release 下载. 创建 GitHub 托管发布对象是 Main Agent 使用外部维护者工具完成的操作, 不是 ARW runtime Module. ARW 代码不读取 `gh` 凭据.

## Reviewer capability tests

Reviewer 能力测试不是发布门禁. 维护者需要时显式调用源码专用的 `$reviewer-capability` Skill (`.agents/skills/reviewer-capability/`): 用 `tests/fixtures/reviewer-capability/<role>/<scenario>/` 中带隐藏预期的场景 (qwen_strata benchmark v2 (`benchmarks/multi-model-v2`) 的 4 个计划, 夹具直接保存物化结果, 不含补丁链), 通过 `arw background-agent` 在 Codex 和 Claude 后端运行 Reviewer, 再用 `scripts/reviewer-capability.mjs` 计分, 组盲池, 生成视图并统计, 由盲裁裁判 (至少 sonnet high) 裁决候选的召回和误报. 套件只属于 Source Checkout, 不进入 Workflow Distribution 和 release 安装包; 评分与盲裁工具的合同由 `../agent-repository-workflow-development/spec.md` 的 Module Design 节拥有. 结果用于评估角色指令, 模型和报告格式, 不授权审核, 提交或发布. 发布时可选的漂移检查见 Optional checks, 它不是门禁, 判定漂移后继续或放弃发布由维护者决定.

## Failure recovery and authorization

本地检查和 VM 验证不需要外部写入授权, 也不写规范远端. 外部写入授权只覆盖准确项目, `origin`, 分支和版本, 不允许强制推送, 修改其他分支或 tag, 也不允许原地移动已经推送的 tag. 唯一例外见下一段, 发布授权同时覆盖该例外.

压缩包生成, GitHub 托管发布对象的创建, 核对或随后的公开 Bootstrap 验证失败发生在 tag 推送之后时, 回滚的边界是维护者的对外公告. 公告只在 `$release` 流程结束之后由维护者发布, 所以流程自身运行期间的失败都发生在公告之前, 此时回滚并重试; 维护者此后告知已公告时, 再发现的失败不回滚: 保留 tag, 记录准确远端状态并停止, 后续创建, 更新或删除需要维护者重新决定.

回滚只删除本次发布运行自己创建的同版本 Release 与 tag, 其他对象一律不删, 并先记录同版本 Release 的准确远端状态 (Release 不存在是有效状态, 其他读取失败时停止); 删除后核对 Release, 远端 tag 和本地 tag 三者都不存在. 任一删除或核对失败时停止并报告准确状态. 修复产生新 commit 时回到第 2 步重新验证, 候选不变时回到推送 tag. 同一版本连续回滚 2 次仍失败时停止并报告. 具体步骤由 `$release` Skill 拥有.

## Validation coverage

发布验证要证明用户会遇到的全部情形可用: 安装, 升级, PATH 登记, 重装, 卸载, 仓库工作流初始化, 更新和移除, 后台管理进程, Agent CLI 对投影文件的加载. 维护者规则: 所有情况都要测到, 但不必在每台 VM 中都测一次, 是否每台都测取决于这个操作是否会因操作系统不同而有不同表现.

操作化为一条判断: 只看情形的代码路径是否因操作系统而不同.

- 路径经过平台专属代码的情形, 在每台受验系统运行. 平台专属代码包括 Windows Registry 与 PowerShell 适配器, `~/.profile` 与登录 shell 解析, 系统 `tar` (Windows 的 bsdtar 或 Git 自带的 GNU tar, Alpine 的 busybox, Ubuntu 的 GNU tar), 启动器 `arw` 与 `arw.cmd`, 后台管理进程的观察 (`/proc` 或 CIM) 与进程创建时间读取, Windows 私有状态访问控制, Windows rename 重试, Node.js 的 musl 构建 (`node:sqlite`).
- 只在一类系统存在的机制只在该类系统运行 (Windows Registry, Linux `~/.profile`).
- 与系统无关的情形由固定测试或宿主上的一次验证承担. 固定测试把平台 I/O 全部换成假适配器, 只在宿主 Linux 上运行, 所以 Windows 的真实路径只有 VM 能证明; 与系统无关的情形在每台 VM 重复只增加时间, 不增加证据.
- 只需几秒钟的步骤不为节省时间加系统条件.

### Every system

在每台受验系统上由 guest 检查运行:

| 情形 | 理由 |
|---|---|
| 候选经 Bootstrap 非交互安装: 注入宿主打包的候选压缩包代替 GitHub 下载, 其余 (系统 `tar` 按相对文件名解压, 交给解压出的 `install.mjs`) 是真实路径 | 系统 `tar` 与 Node.js 交接因系统而异 |
| 从上一发布版升级到候选 (VM 运行带 `--previous` 时; 首次发布没有上一版, 省略 `--previous`, 此情形不运行) | 安装写入与 PATH 重写走平台专属代码 |
| 新终端解析 `arw` 并报告候选版本 (Windows 的 cmd 与 PowerShell, Linux 的登录 bash) | 解析路径因系统而异 |
| 同版本交互重装 (管道应答, Windows 用 `y\r\n`), PATH 登记仍只有一项 | 交互应答的行尾和登记去重因系统而异 |
| 后台管理进程运行时重装和卸载都成功并使它结束; 能观察到进程存在与不存在; 能读取进程创建时间 | 进程观察和创建时间依赖 `/proc` 或 CIM, 管理进程的私有状态和 SQLite 依赖系统与 Node.js 构建 |
| 新 Git 仓库 `workflow init` 与 `verify`; `core.autocrlf=true` 克隆后 `verify`; 对该克隆 `workflow remove` 后受管文件消失, `verify` 不再通过; agent-assisted fixture 检出后 (有上一发布版时检出上一发布版标签, 首次发布检出默认分支最新状态; Windows 用 CRLF) 的 `workflow update` 与 `verify` | 行尾与文件系统行为因系统而异 |
| 安装后已安装的每个受管文件 (安装目录 `manifest.json` 的 `managedFiles`) 与解压出的载荷逐字节相同 | Windows rename 重试与访问控制路径可能悄悄写坏部分文件, 而 guest 检查只运行部分模块 |
| 保留配置的卸载后新终端不再解析 `arw`, 配置文件保留, 随后重装成功 | 卸载重写 PATH 登记与保留状态走平台专属代码 |
| 删除配置的卸载后 Installation 目录不剩文件 (后台管理进程运行过留下的私密凭据除外, 安装长期规范规定 `removeConfig` 不授权删除它) | 同上 |
| Node.js 满足 `package.json` 的 `engines.node` | 每台系统自带不同的 Node.js |
| 用户目录含空格和非 ASCII 字符 (Linux 的 `HOME`, Windows 的 `USERPROFILE`) 时, 以上全部情形仍通过 | 路径编码与引用在 Registry, shell 和启动器中因系统而异 |

### Windows only

只在 Windows 受验系统上运行:

| 情形 | 理由 |
|---|---|
| 用户 PATH 值类型为 ExpandString 且含未展开的 `%USERPROFILE%` 条目和非 ASCII 条目时, 安装和保留配置的卸载后类型与这两类条目都保留 | Registry 适配器只在 Windows |
| 用户 PATH 值原本不存在时, 安装创建只含 Installation 目录的 ExpandString 值, 卸载删除该值 | 同上 |
| 重装输出不含环境变化广播失败警告的稳定标识 `windows-environment-refresh-failed` 和消息 `Windows environment refresh failed` | 广播只在 Windows |
| `powershell.exe` 在新终端可解析; PowerShell 新会话经 `Get-Command` 解析 `arw` | 只在 Windows |
| Git Bash 解析 `arw` 并报告候选版本 | 安装规范写明支持 Git Bash, 它从 Windows PATH 解析 |
| Bootstrap 分别在系统自带 bsdtar 和 Git for Windows 自带 GNU tar 位于 `PATH` 最前时解压并安装候选 | Bootstrap 经 `PATH` 取 `tar`, GNU tar 把含 `C:` 的路径当作主机名, Bootstrap 因此使用相对文件名 |
| 在 cmd 与 PowerShell 中经 `arw.cmd` 传入含空格, 逗号和 `&` 的参数, 命令收到的参数不变 | `arw.cmd` 的参数转发只在 Windows |
| ARW 源码以 `core.autocrlf=true` 检出后分发文件仍为 LF (仓库根 `.gitattributes`), 能从该检出安装, 在新仓库 `workflow init` 与 `verify`, 在 agent-assisted fixture 上 `workflow update` 与 `verify`, 再卸载 | `core.autocrlf=true` 只在 Windows 的 Git 默认配置中出现 (guest 的主克隆固定 `core.autocrlf=false`) |

### Linux only

只在 Linux 受验系统上运行:

| 情形 | 理由 |
|---|---|
| 登录 `sh` (Ubuntu 的 dash, Alpine 的 busybox ash) 解析 `arw` 并报告候选版本 | `~/.profile` 由不同的 `sh` 实现读取 |
| 非登录 `sh` 执行 `. ~/.profile` 后解析 `arw` | 用户在脚本中手动加载 profile 的用法 |

### Host once

在宿主上各运行一次, 不在受验系统上重复:

| 情形 | 承担方式 |
|---|---|
| 本地检查: 类型, 测试, 分发与 Bootstrap 生成物检查, 文本, 术语和语言检查 | 与系统无关, `$release` Skill 第 2 节 |
| plain fixture 的 `workflow init` | 与系统无关, Skill 引用的 fixtures 参考 |
| 公开 Bootstrap 带 `--version` 与不带 `--version` 各安装一次并核对版本 | 下载与版本选择与系统无关, Release 创建后运行 |
| 候选在隔离 home 安装并初始化临时仓库后, 用 `claude -p` 和 `codex exec` 各问一句, 回答必须说出投影的 Skill 名与 `AGENTS.md` 标题 | 加载投影的行为与系统无关 |

### Optional checks

下列检查不在上面各表承诺的必测范围内, 是否运行由维护者在发布时选择, 选择 skip 时在发布准备 issue 的 `## Comments` 记一行; skip 不阻断发布, 都不是发布门禁; 步骤, 通过条件和 skip 的记录见 `$release` Skill 第 3 节第 9, 10 步.

| 情形 | 理由 |
|---|---|
| 初始化后交接冒烟 | 交接是用户在 `workflow init` 之后实际走的路径, 现行检查只证明投影的 Skill 名被加载; 它只检查交接没有破坏仓库且 issue 可读, 不判断交接审计是否完整, 也不运行 issue 的实施, 审核, 提交生命周期 ("初始化 issue 生命周期" 一行保持不变); 耗额度, 所以可选 |
| Reviewer 能力漂移检查 (`.agents/skills/reviewer-capability/drift-check.md`) | 其他检查证明候选行为, 不证明 Reviewer 能力; 耗额度, 所以可选 |

### Fixed tests

由固定测试在宿主 Linux 上用假适配器承担, 不在发布时运行:

| 情形, 观察的公开结果, 防止的错误 |
|---|
| 用假适配器让 Windows 用户 PATH 的读写, 通知和卸载重写依次出现成功, 等价空操作, 禁用注册, 整值删除, 通知返回零, 超时和异常; 观察安装与卸载的最终操作结果和 PATH 值. 防止某个分支让用户 PATH 被改坏, 丢失条目, 或让通知警告改变安装结果 |
| 在登录 profile 缺失受管块, 受管块重复或畸形时安装, 中断安装事务后恢复, 提供更低版本和被篡改的载荷或版本身份; 观察 `~/.profile` 的最终内容, 安装目录状态和拒绝信息. 防止重复登记, 事务残留, 降级安装和不可信载荷被安装 |
| 给 Bootstrap 各种参数, 运行时环境和交互应答, 给进程观察和进程身份各平台的输出样例, 给发布配置各种取值; 观察解析出的参数, 运行时判定, 进程存在性与创建时间, 配置读取结果. 防止解析在某个平台的输出格式上误判, 以及配置缺失或畸形时静默通过 |

### Not release gates

下列情形不属于发布门禁, 每项附理由:

| 情形 | 理由 |
|---|---|
| Windows 与 Alpine 上真实运行后台 Agent 和 Reviewer | 基线要安装并登录 Codex 与 Claude CLI, 要外网, 凭据进快照, 每次耗额度; 平台专属部分由每台的管理进程步骤覆盖 |
| `~/.bash_profile` 遮蔽, zsh | ARW 按规范不处理这些配置, README 已说明 |
| 从 Explorer 真实打开新终端 | SSH 没有交互桌面; 每台的新终端解析重新读取 Registry 并启动新进程, 效果等价 |
| Ubuntu 桌面重新登录后的终端 | 需要 GUI 会话, 机制与 ARW 无关 (ARW 只写 `~/.profile`) |
| Windows 真 TTY (ConPTY) 交互 | 时序不稳定, 语义已有固定测试, 管道应答由同版本交互重装覆盖 |
| macOS, ARM, PowerShell 7 | 没有 VM; macOS 是实验性平台; ARW 固定调用 `powershell.exe` (5.1) |
| 降级, 真实目标仓库矩阵 | 降级被版本策略拒绝, 矩阵成本高于它发现的问题, 需要时由维护者另行要求 |
| 初始化 issue 生命周期 | 与操作系统无关, 需要时由维护者另行要求 |

## Design rationale
已存在 Release 的资产字节不由发布核对比较, 公开 Bootstrap 验证用该资产实际安装并核对版本, 证明其可安装且身份正确.

公告之前无人下载该 tag 与 Release, 所以失败后整体回滚重试比停下等待更安全也更快; 公告之后 tag 可能已被依赖, 仍然保留. 回滚是删除后重建, 不是原地移动, 是对"不移动已推送 tag"的受限例外. 接受的成本: 公开 Bootstrap 验证与公告前可能的偶然获取者, 其持有的旧 tag 可能与重建的 tag 不一致, 公告前不预期有消费者, 接受该残余风险. 本例外的决定见 `docs/adr/0031-use-github-and-local-validation-sources.md`.

Reviewer 能力测试只在角色指令, 模型或报告格式变化时才有意义, 不随每次发布运行. 旧的发布能力门禁用程序准备, 评分, 折减和会话检查, 这些代码大多校验程序自己产生的数据; 现在由 Agent 按 Skill 运行场景; 保留场景, 隐藏预期, 一个入口脚本及其评分, 报告修复, 格式罚, 暂停扣分与盲裁实现, 这些是评估角色指令的方法本身 (与 qwen_strata 的评分体系一致, 结果可比), 不是对 ARW 程序产物的发布门禁. 残差折减, 暂停计数与基线归档校验是评分体系的一部分: 归档基线是固定标尺, 其校验保证评分尺度不被意外改动, 不是校验程序运行时自己产生的数据.

VM 验证的范围由 Validation coverage 节按 "情形的代码路径是否因操作系统而不同" 分配. 它由 Agent 按 Skill 运行一个短检查脚本, 程序不维护场景登记表, 归档和一致性校验, 因为这些机制校验的大多是验证程序自己产生的数据, 维护成本远高于它们发现问题的价值.

## Validation strategy

固定测试验证发布配置读取, 以及 Bootstrap 生成物与配置一致. VM 验证和公开 Bootstrap 验证只在真实发布时由 `$release` Skill 执行, 不作为 implementation issue 的完成测试, 常规测试不访问公网. 源码仓库确定性测试矩阵由 `docs/agents/source-checkout-coverage.md` 的 Source Checkout deterministic coverage 节承担.

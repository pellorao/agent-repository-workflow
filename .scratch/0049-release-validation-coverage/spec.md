# 发布验证覆盖规则

## Behavior

### 背景与规则

发布验证要证明用户会遇到的全部情形可用: 安装, 升级, PATH 登记, 重装, 卸载, 仓库工作流初始化, 更新和移除, 后台管理进程, Agent CLI 对投影文件的加载. 维护者 2026-11-03 的规则: 所有情况都要测到, 但不必在每台 VM 中都测一次, 是否每台都测取决于这个操作是否会因操作系统不同而有不同表现.

操作化为一条判断: 只看情形的代码路径是否因操作系统而不同.

- 路径经过平台专属代码的情形, 在每台受验系统运行. 平台专属代码包括 Windows Registry 与 PowerShell 适配器, `~/.profile` 与登录 shell 解析, 系统 `tar` (Windows 的 bsdtar 或 Git 自带的 GNU tar, Alpine 的 busybox, Ubuntu 的 GNU tar), 启动器 `arw` 与 `arw.cmd`, 后台管理进程的观察 (`/proc` 或 CIM) 与进程创建时间读取, Windows 私有状态访问控制, Windows rename 重试, Node.js 的 musl 构建 (`node:sqlite`).
- 只在一类系统存在的机制只在该类系统运行 (Windows Registry, Linux `~/.profile`).
- 与系统无关的情形由固定测试或宿主上的一次验证承担. 固定测试把平台 I/O 全部换成假适配器, 只在宿主 Linux 上运行, 所以 Windows 的真实路径只有 VM 能证明; 与系统无关的情形在每台 VM 重复只增加时间, 不增加证据.
- 只需几秒钟的步骤不为节省时间加系统条件.

### 长期规范的新节

`docs/specs/agent-repository-workflow-release/spec.md` 新增 `## Validation coverage` 节 (放在 `## Design rationale` 之前), 写出上面的规则, 然后分六类列出情形. 每类一个表格, 列为 "情形" 和 "归入本类的理由或承担方式". "不属于发布门禁" 表共八行: 前六行是六个被排除的环境情形 (Agent 后台运行, `~/.bash_profile` 与 zsh, Explorer, Ubuntu 桌面, ConPTY, macOS 与 ARM 与 PowerShell 7), 第七行是降级与真实目标仓库矩阵, 第八行是初始化 issue 生命周期; 后两行沿用原 Design rationale 中的排除.

每台 (guest 检查在每台 Windows 和 Linux 受验系统运行):

| 情形 | 理由 |
|---|---|
| 候选经 Bootstrap 非交互安装: 注入宿主打包的候选压缩包代替 GitHub 下载, 其余 (系统 `tar` 按相对文件名解压, 交给解压出的 `install.mjs`) 是真实路径 | 系统 `tar` 与 Node.js 交接因系统而异 |
| 从上一发布版升级到候选 (VM 运行带 `--previous` 时; 首次发布没有上一版, 省略 `--previous`, 此情形不运行) | 安装写入与 PATH 重写走平台专属代码 |
| 新终端解析 `arw` 并报告候选版本 (Windows 的 cmd 与 PowerShell, Linux 的登录 bash) | 解析路径因系统而异 |
| 同版本交互重装 (管道应答, Windows 用 `y\r\n`), PATH 登记仍只有一项 | 交互应答的行尾和登记去重因系统而异 |
| 后台管理进程运行时重装和卸载都成功并使它结束; 能观察到进程存在与不存在; 能读取进程创建时间 | 进程观察和创建时间依赖 `/proc` 或 CIM, 管理进程的私有状态和 SQLite 依赖系统与 Node.js 构建 |
| 新 Git 仓库 `workflow init` 与 `verify`; `core.autocrlf=true` 克隆后 `verify`; 对该克隆 `workflow remove` 后受管文件消失, `verify` 不再通过; agent-assisted fixture 检出后 (有上一发布版时检出上一发布版标签, 首次发布检出默认分支最新状态; Windows 用 CRLF) 的 `workflow update` 与 `verify` | 行尾与文件系统行为因系统而异 |
| 保留配置的卸载后新终端不再解析 `arw`, 配置文件保留, 随后重装成功 | 卸载重写 PATH 登记与保留状态走平台专属代码 |
| 删除配置的卸载后 Installation 目录不剩文件 (后台管理进程运行过留下的私密凭据除外, 安装长期规范规定 `removeConfig` 不授权删除它) | 同上 |
| Node.js 满足 `package.json` 的 `engines.node` | 每台系统自带不同的 Node.js |
| 用户目录含空格和非 ASCII 字符 (Linux 的 `HOME`, Windows 的 `USERPROFILE`) 时, 以上全部情形仍通过 | 路径编码与引用在 Registry, shell 和启动器中因系统而异 |

仅 Windows:

| 情形 | 理由 |
|---|---|
| 用户 PATH 值类型为 ExpandString 且含未展开的 `%USERPROFILE%` 条目和非 ASCII 条目时, 安装和保留配置的卸载后类型与这两类条目都保留 | Registry 适配器只在 Windows |
| 用户 PATH 值原本不存在时, 安装创建只含 Installation 目录的 ExpandString 值, 卸载删除该值 | 同上 |
| 重装输出不含环境变化广播失败警告的稳定标识 `windows-environment-refresh-failed` 和消息 `Windows environment refresh failed` | 广播只在 Windows |
| `powershell.exe` 在新终端可解析; PowerShell 新会话经 `Get-Command` 解析 `arw` | 只在 Windows |
| Git Bash 解析 `arw` 并报告候选版本 | 安装规范写明支持 Git Bash, 它从 Windows PATH 解析 |
| Bootstrap 分别在系统自带 bsdtar 和 Git for Windows 自带 GNU tar 位于 `PATH` 最前时解压并安装候选 | Bootstrap 经 `PATH` 取 `tar`, GNU tar 把含 `C:` 的路径当作主机名, Bootstrap 因此使用相对文件名 |
| 在 cmd 与 PowerShell 中经 `arw.cmd` 传入含空格, 逗号和 `&` 的参数, 命令收到的参数不变 | `arw.cmd` 的参数转发只在 Windows |

仅 Linux:

| 情形 | 理由 |
|---|---|
| 登录 `sh` (Ubuntu 的 dash, Alpine 的 busybox ash) 解析 `arw` 并报告候选版本 | `~/.profile` 由不同的 `sh` 实现读取 |
| 非登录 `sh` 执行 `. ~/.profile` 后解析 `arw` | 用户在脚本中手动加载 profile 的用法 |

宿主一次:

| 情形 | 承担方式 |
|---|---|
| 本地检查: 类型, 测试, 分发与 Bootstrap 生成物检查, 文本, 术语和语言检查 | 与系统无关, `$release` Skill 第 2 节 |
| plain fixture 的 `workflow init` | 与系统无关, Skill 引用的 fixtures 参考 |
| 公开 Bootstrap 带 `--version` 与不带 `--version` 各安装一次并核对版本 | 下载与版本选择与系统无关, Release 创建后运行 |
| 候选在隔离 home 安装并初始化临时仓库后, 用 `claude -p` 和 `codex exec` 各问一句, 回答必须说出投影的 Skill 名与 `AGENTS.md` 标题 | 受验系统不安装 Agent CLI, 加载投影的行为与系统无关 |

固定测试 (不在发布时运行, 宿主 Linux 上用假适配器):

| 情形 |
|---|
| Windows PATH Registry 与 PowerShell 适配器的每个分支 (写入, 等价空操作, 禁用注册, 卸载重写, 整值删除, 通知成功, 返回零, 超时, 异常) |
| 登录 profile 受管块的缺失, 重复与畸形, 安装事务与恢复, 降级拒绝, 载荷与版本身份校验 |
| Bootstrap 参数, 运行时检查和交互提示解析; 进程观察与进程身份在各平台输出样例下的解析; 发布配置读取 |

不属于发布门禁 (每项一句理由):

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

### 发布规范其他段落

- `## Release procedure` 第 3 步改为: 在每台受支持的 Windows 和 Linux 受验系统上从基线快照开始, 只通过宿主传入的候选 Git bundle 与宿主用 `scripts/pack-release.mjs` 为候选打成的安装压缩包取得候选, 按 `Validation coverage` 节运行 guest 检查, 并在宿主上完成该节的宿主一次情形; 结束后硬关机并还原快照; 受验系统不安装或启动 Agent CLI, 也不安装源码仓库开发依赖. 第 6 步补充: 公开 Bootstrap 验证带 `--version` 与不带 `--version` 各一次.
- `## Design rationale` 的 VM 验证段缩为一段: 指向 `Validation coverage` 节, 保留 "由 Agent 按 Skill 运行一个短检查脚本, 不再由程序维护场景登记表, 归档和一致性校验" 的理由; 其中降级与矩阵的排除句已并入上表, 删去重复.
- `docs/agents/source-checkout-validation.md` 的 Windows PATH 一段中 "真实 Windows 验证在安装和卸载后, 从正在运行的 Explorer 启动新 PowerShell 进程" 与实际不符 (guest 检查没有 Explorer 会话), 改为 "真实 Windows 验证 (发布 VM 验证, 见发布长期规范的 Validation coverage 节) 在安装和卸载后新开 PowerShell 与 cmd 进程并重新读取 Registry 的 Machine 与 User PATH, 验证 Installation 目录是否按要求参与 `arw` 解析".
- `$release` Skill: 第 2 节之后的第 3 节开头改为引用 `Validation coverage` 节; 第 3 节第 2 步增加 `node scripts/pack-release.mjs <tmp>/arw.tar.gz`; 第 3 步 `check` 命令加 `--archive <tmp>/arw.tar.gz`; 增加宿主 Agent CLI 检查一步; `references/publication.md` 的公开 Bootstrap 验证增加不带 `--version` 的一次; `references/vm.md` 的 WSL 示例命令加 `--archive`. 运行 `node scripts/project-claude-skills.mjs` 更新 `.claude/skills/` 投影.

### Agent CLI 检查步骤 (写入 Skill)

Skill 第 3 节在 VM 全部通过后增加一步, 在宿主上执行: 解压 `<tmp>/arw.tar.gz` 到 `<tmp>/agent/extracted`; 以 `HOME=<tmp>/agent/home` 运行解压出的 `install.mjs --release-tag <version> --non-interactive --register-path false`; 在 `<tmp>/agent/repo` 里 `git init`, 用隔离 home 里安装的 `arw` 运行与 guest 检查相同参数的 `workflow init`; 在该仓库内用正常 HOME 运行 `claude -p "<问题>"` 与 `codex exec "<问题>"`, 问题为 "列出本仓库可用的 Skill 名称, 并给出 AGENTS.md 的一级标题". 两个回答都必须含 `implement` 与 `Agent Repository Workflow`, 否则不通过. 初始化在隔离 home 与临时仓库进行是为了不改动维护者的真实安装; Agent CLI 用正常 HOME 是因为登录凭据在那里. 每次消耗一个问题的额度, 这是该步骤接受的成本.

### guest 检查 (`scripts/release-guest-check.mjs`)

新增必选参数 `--archive <arw.tar.gz>`, 与 `--fixture` 同样校验为文件; 候选不再由 guest 自己打包 (上一发布版仍由 guest 经 `git archive` 打包), 改为消费宿主打好的压缩包, 这与真实发布产物的来源一致. 步骤按顺序:

1. 读取本进程创建时间 (候选 `lib/background-agent/process-identity.mjs` 的 `readOperatingSystemProcessCreationTime`), 必须是数字串.
2. 把压缩包复制进解压目录, 以相对文件名运行 `tar -xzf arw.tar.gz` (系统默认 `tar`), 供后面的交互重装使用 `install.mjs`.
3. Windows: 在候选安装之前 (有上一发布版时在其安装之后), 把用户 PATH 写成 ExpandString, 在原值后追加未展开条目 `%USERPROFILE%\arw-expand-check` 和非 ASCII 条目.
4. 候选经候选 `lib/installation/bootstrap.mjs` 的 `runBootstrap(Array, {download})` 安装, 参数为 `--version <版本> --non-interactive --register-path true`, `download` 返回 `--archive` 文件的字节, 不下载. Bootstrap 经本进程 `PATH` 取 `node` 和 `tar`: 先把受验 node 所在目录放到 `PATH` 前面; Windows 上再把 `%SystemRoot%\System32` (bsdtar) 放到最前运行一次, 之后把 Git 根目录 `usr/bin` (GNU tar, 根目录取 `where git` 首行的上两级) 放到最前再运行一次 (第二次是同版本非交互重装, 结果与第一次相同).
5. Windows: 检查用户 PATH 值类型仍是 ExpandString, 两个条目都在. 解析检查沿用现有 (cmd, PowerShell), 另 Windows 增加 Git Bash (`<Git 根>/bin/bash.exe -lc 'command -v arw && arw --version'`, 输出路径含 `.agent-repository-workflow/arw` 且含版本), Linux 增加登录 `sh -lc` 与非登录 `sh -c '. "$HOME/.profile"; ...'`.
6. 现有的 init, verify, CRLF 克隆 verify 之后, 对 CRLF 克隆运行 `arw workflow remove --non-interactive --arwignore delete`. guest 的 init 参数固定为 `workflow init --non-interactive --platform codex --platform claude-code --domain-layout single-context --code-map-root --code-map-include --code-map-exclude` (即脚本常量 `INIT_ARGUMENTS`), 产物没有 Code Map 与混合 Agent 文档. 本步骤按实现行为验证: 在本地临时仓库用这些参数实测, 该 init 之后 `workflow remove --non-interactive` 只要求 `--arwignore` 一类选择 (缺少时只输出该类别的预览, 不执行移除), 给出 `--arwignore delete` 后移除执行, 仓库只剩 `arw.config.json` 和 `.codex/`. 必填与不适用的判定位置是 `lib/repository-workflow/workflow.mjs` 的 `validateRemovalChoices` (诊断码 `missing-removal-choice` 与 `inapplicable-removal-choice`), 已作为 architecture-evidence Input 引用. 产品规范 `docs/specs/agent-repository-workflow/spec.md` 的 `workflow remove` 一段只规定按类别选择 `retain | delete` 并最后处理锁文件, 没有写明哪些类别必填; 这一缺口不在本 issue 补, 另立 issue. 步骤检查命令退出码为 0, `AGENTS.md` (受管文件) 已不存在, `workflow verify` 退出码非零 (锁文件已移除). 产品之后改变所需选择时, 命令的结果变化使步骤失败, 由维护者更新脚本. 现有的 fixture update 与 verify 保留.
7. 后台管理进程: 设置 `CODEX_THREAD_ID=release-guest-check` (受验系统没有 Agent CLI, `arw background-agent` 需要会话身份), 用 `arw background-agent < <含 {"id":"1","operation":"list_agents","input":{}} 的文件>` 在目标仓库启动管理进程, 回答含 `"ok":true`; 用候选 `lib/background-agent/manager-process.mjs` 的 `observeBackgroundAgentManagerProcess` 观察到 `present`.
8. 管理进程运行时同版本交互重装 (`install.mjs --release-tag <版本>`, 不带 `--non-interactive`, 标准输入 `y\n`, Windows `y\r\n`; 安装器只在 PATH 登记上提问); 重装后观察到 `absent`; PATH 登记仍只有一项 (Linux `~/.profile` 里受管块只出现一次, Windows 用户 PATH 里 Installation 条目恰好一个); 新终端仍能解析 `arw`.
9. 再次启动管理进程, 用 `uninstall.mjs --non-interactive --remove-config false` 卸载 (非交互调用, 不读标准输入; 管理进程空闲, 没有后台 Agent, 不需要 `--stop-background-agents`): 观察到 `absent`, 新终端不再解析 `arw`, `config.json` 仍在; Windows 检查 ExpandString 类型与两个条目仍在, 然后删除用户 PATH 值.
10. 重装 (`install.mjs --release-tag <版本> --non-interactive --register-path true`) 成功, 输出既不含 `windows-environment-refresh-failed` 也不含 `Windows environment refresh failed`; Windows 检查用户 PATH 值被创建为 ExpandString 且只含 Installation 目录; 新终端解析 `arw`.
11. 现有的最终卸载 (`uninstall.mjs --non-interactive --remove-config true`) 之后: 新终端不再解析 `arw`; Windows 用户 PATH 值已删除; Installation 目录除 `credential` 外不剩文件.
12. Windows: 在目标仓库放一个名为 `a b,c&d.md` 的文件, 分别在 cmd (`arw language inspect "a b,c&d.md"`) 和 PowerShell (`arw language inspect 'a b,c&d.md'`) 的新会话运行, 输出必须含该文件名 (`language inspect` 原样列出收到的文件参数). 这一步需要安装在位, 所以放在第 10 步重装之后, 最终卸载之前.
13. 以上全部通过后 (最后一步), 若环境变量 `ARW_NESTED_GUEST_CHECK` 未设置, 把 `HOME` 与 `USERPROFILE` 设为临时目录下名为 `用户 home` (含空格和非 ASCII 字符) 的新目录, 并设置 `ARW_NESTED_GUEST_CHECK=1`, 用相同参数重新运行本脚本一次, 必须成功; 这样含空格和非 ASCII 字符的用户目录下的每个情形都被验证. 嵌套运行不再嵌套.



### release-vm (`scripts/release-vm.mjs`)

`check` 增加必选 `--archive <path>`: 缺失或没有值时按用法错误以退出码 2 结束. 与 bundle 和 fixture 一样先复制到本地临时目录再 `scp` (Windows 路径里的 `C:` 会被 `scp` 当作主机名), 并让 guest 命令带 `--archive <客户机上的文件名>`. 其余行为不变.

## Testing

- `tests/release/release-vm.test.mjs`: 现有 `check` 调用都加 `--archive`; 观察 `scp` 参数含压缩包, guest 命令含 `--archive arw-archive.tar.gz`; 新增用例: 缺少 `--archive` 或没有值时退出 2 且 stderr 含 `--archive <arw.tar.gz> is required`.
- guest 检查不进入固定测试 (它修改当前用户的 HOME 与 PATH 登记, 按发布 spec 只在真实发布时运行). 实施时在宿主 Linux 用 `env -i HOME=<临时目录> PATH=/usr/bin:/bin node scripts/release-guest-check.mjs ...` 本地真实运行一次, 带与不带 `--previous` 各一次 (含第 13 步嵌套的含空格和非 ASCII 的 `HOME`), 证明 Linux 步骤可用, 运行后无残留进程; `language inspect` 的参数原样列出这一点也在 Linux 用同名文件确认. Windows 步骤 (含第 12 步) 的 PowerShell 片段只做语法解析检查 (不执行), 真实 VM 验证留到下次发布.
- 文档改动由 `node arw.mjs text check`, `node arw.mjs language inspect`, `node scripts/project-claude-skills.mjs --check` 和 `node scripts/check-workflow-distribution.mjs` 检查.

## ADR Evaluation

不新增 ADR. 发布验证按操作系统分配的规则是对既有验证流程的细化: 产品的权威来源不变 (安装压缩包仍由 `scripts/pack-release.mjs` 从 `release-manifest.json` 生成, 该脚本已接受输出路径参数, 见 `$release` Skill 的 `references/publication.md`), 不引入持久状态或恢复合同, 易于逆转 (改表格和 guest 步骤即可). 它与 `docs/adr/0031-use-github-and-local-validation-sources.md` 不冲突 (那里规定发布验证的来源和授权, 不规定步骤清单).

安全与授权边界: 本地验证仍不写规范远端, 也不改变发布授权. 新增的宿主 Agent CLI 检查有一处新的边界变化, 如实记录: 它使用维护者本机已有的 Claude 与 Codex 登录凭据 (用正常 `HOME`), 向各自的模型服务发出一次出站请求并消耗额度. 这是发布者本地的行为, 凭据留在维护者本机, 不进入仓库, VM 快照, issue 或报告, 也不新增仓库内的凭据存储; 请求内容只含一个固定问题和一个由候选初始化的临时仓库. 由于它只是维护者每次发布在自己机器上运行的一次性本地步骤, 没有持久状态和难以逆转的结果, 不需要 ADR.

决定的其他取舍:

- guest 检查消费宿主打的压缩包而不是自己打包: 替代方案是保留 guest 自己打包 (现状). 现状证明不了真实发布产物 (宿主打包, Release 上传) 能在 guest 安装, 也让 Windows 的 `tar` 打包路径参与而与用户路径无关. 接受的成本: `check` 多一个必选参数, 宿主多打一次包 (约 0.5 MB, 秒级). 这改变的是验证流程里候选压缩包的来源, 不是产品数据: 压缩包的权威来源和内容仍由 `pack-release.mjs` 与 `release-manifest.json` 决定.
- 含空格和非 ASCII 的用户目录用嵌套重跑整个检查来覆盖: 替代方案是只为这些路径单独写几步检查. 嵌套重跑用约几行代码覆盖所有情形, 接受的成本是该次发布验证的耗时翻倍 (每台约增加 1 到 2 分钟).
- `credential` 在最终卸载后被允许残留: 安装长期规范明确 `removeConfig` 不授权删除私密凭据, 所以不是缺陷, 检查按规范放行, 而不是改产品行为.
- 管理进程由 `list_agents` 请求启动并只在卸载与重装时检查, 不运行真实 Agent: 见规则表 "不属于发布门禁" 第一行.

## Module Design

Not required: 本次改动只涉及发布验证脚本 (`scripts/release-guest-check.mjs`, `scripts/release-vm.mjs`), 文档和 Skill, 它们是维护者在发布时运行的验证工具, 不是产品 Module. 产品 Module 的责任, Interface, Seam, 依赖方向, 权威来源和数据流都不变: 安装压缩包的权威来源仍是 `pack-release.mjs` 与 `release-manifest.json`, 变化的只是验证脚本取得候选压缩包的方式 (消费宿主打好的文件而不是在 guest 内再打包). `release-vm.mjs` 的命令行新增一个必选参数, 它是维护者脚本入口, 不是 Module Interface.

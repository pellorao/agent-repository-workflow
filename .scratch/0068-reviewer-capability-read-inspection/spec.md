# 能力测试运行后读取检查

## Problem Statement

维护者用 Reviewer 能力测试比较模型, 或比较规则改动前后的评分. 测试用的 Reviewer 在 Codex 后端读取整个磁盘, 不受沙盒限制 (这是长期规格已确认的平台差异), 在 Claude 后端也只受放行规则约束. 因此它可能读到不该读的内容: 隐藏答案键, 其他场景或同一轮其他实例的目录, 源码仓库, 以前运行的会话记录. 一旦读到, 它的报告不再测量审核能力, 分数却照常进入统计和 A/B 结论. 目前禁止这类读取只靠指令约束, 违规既无从发现, 也无从排除. ARW 早先有过会话检查, 在能力测试改为 Skill 驱动时随程序化门禁一起删除, 之后没有等价物.

## Solution

维护者在每个实例完成并保存 `agent.json` (Reviewer 运行的 `list_agents` 结果) 之后, 对该实例运行 `inspect`. `inspect` 读取该 Reviewer 的原生执行记录, 先确认记录完整可信, 再列出 Reviewer 实际执行的落在实例之外的路径访问, 未列入允许清单的工具, 以及原生环境返回给模型的内容中出现答案键内容的位置. 记录不完整时返回 `blocked`; 完整时返回 `succeeded` 和 `flags` 清单. `reviewer-capability` Skill 规定处置: `blocked` 或 `flags` 非空的实例作废, 不计分, 不入盲池, 用新实例重跑; 只有 Main 从所列条目确认没有读到禁止内容时才可保留, 并把理由写进结果表.

检查在运行结束后进行, 不阻止读取. 事前阻止不可行: 把答案键搬出可读范围挡不住 Git 对象中的历史副本, 其他克隆和旧盲池; Linux 上收紧 Codex 读取范围虽然可行, 却使被测环境与生产配置不一致, 测量失去代表性 (长期规格已选择不采用). 评分本来只在运行结束后读答案键, 问题只在 Reviewer 运行期间自己去读, 所以事后核对原生记录是成本最低且不改变被测环境的防线.

## User Stories

1. 作为维护者, 我希望在 Reviewer 运行后得知它是否读过禁止来源, 以便不把受污染的运行计入统计.
2. 作为维护者, 我希望记录缺失, 被截断或身份不符时检查直接失败, 以便不会因为取不到证据而静默放行.
3. 作为维护者, 我希望 Codex 和 Claude 两个后端使用同一个命令和同一种输出, 以便两个平台的能力测试按同一规则作废与重跑.
4. 作为维护者, 我希望每条标记带位置, 种类和摘录, 以便能判断是否误报并有理由地保留该运行.
5. 作为维护者, 我希望同一格因同一原因连续作废两次就停下并报告, 以便发现是解析器过期还是 Reviewer 配置有问题, 而不是无限重跑.

## Implementation Decisions

### 证据来源

Reviewer 实际读了什么, 以原生执行记录为准: Codex 是该线程的 rollout 记录, Claude 是该线程的 transcript. `inspect` 不另行搜索它们, 而是读取 `agent.json` 中 `result.threadId` 和 `result.snapshot.members[]` 每个成员的 `sessionPath` (两个后端的 Background Agent 层都已在快照里给出), 因此只依赖 Skill 本来就要求保存的 `agent.json`. 它只读取 `result` 对象, 不依赖外层包装字段.

Codex 记录里, 最可靠的证据是 "命令执行完成" 条目: 它带 JS 拼接之后实际执行的命令和工作目录. 模型看到的内容在对应调用的输出条目中. Claude 记录里, 证据是助手消息中的 `tool_use` (工具名与输入) 和用户消息中配对的 `tool_result` (内容). 两者的记录保存的都是模型实际看到的内容, 所以工具输出被截断不是失败: 检查的语义是 "禁止内容是否进入了模型上下文".

解析依赖的记录形状 (取自 Codex 0.165 与 Claude Code 2.1.317 的真实记录, 是本设计的外部事实):

- Codex rollout 是每行一个 JSON 对象的文件, 对象有 `type` 和 `payload`. 第一行 `type` 为 `session_meta`, `payload.id` 是线程 id. `type` 为 `response_item` 的行中, `payload.type` 为 `custom_tool_call` 或 `function_call` 的是模型发出的调用 (带 `call_id`, `name`; 自定义调用的 `input` 是一段 JS 文本, 其中以 `tools.<名>` 调用嵌套工具), `custom_tool_call_output` 或 `function_call_output` 的是同一 `call_id` 的输出 (`output` 是文本数组或字符串). `type` 为 `event_msg` 的行中, `payload.type` 为 `task_complete` 表示回合结束, `payload.item.type` 为 `CommandExecution` 的行带最终执行的 `command` (字符串数组), 和 `cwd` (`file://` URL).
- Claude transcript 是每行一个 JSON 对象的文件, 含多种记录类型. 只有 `type` 为 `assistant` 的记录里 `message.content[]` 的 `tool_use` 块 (`id`, `name`, `input`), 和 `type` 为 `user` 的记录里的 `tool_result` 块 (`tool_use_id`, `content` 为字符串或文本块数组) 是调用与输出; 其他类型 (含重复保存请求内容的记录) 忽略. 带 `sessionId` 的记录的值是线程 id, 子 Agent 记录的 `isSidechain` 为 `true`.
- `agent.json` 的 `result.threadId` 是线程 id, `result.snapshot.members[]` 每项有 `threadId` 和 `sessionPath`, `sessionPath` 就是上述两种文件的绝对路径.

### 记录不完整时关闭式失败

下列任一情况返回 `blocked`, 不产出 `flags`, 因为此时无法证明 Reviewer 没有读过禁止来源:

- `agent.json` 缺失, 不是 JSON, 没有 `result` 对象, 没有 `threadId`, 成员没有 `sessionPath`, 或记录文件不存在.
- `snapshot.members` 不是恰好一个成员 (多于一个说明有子 Agent 参与, 违反单 Agent 执行).
- 记录身份与 `threadId` 不符, 或缺少身份, 或有一行不是合法 JSON. 身份的来源: Codex 的第一行必须是 `session_meta` 且 `payload.id` 等于 `threadId`; 不是 `session_meta` 开头的记录按 Claude 处理, 此时至少一条记录带 `sessionId` 且没有任何记录的 `sessionId` 不同于 `threadId`.
- 有工具调用找不到配对的输出.
- Codex: 没有 `task_complete` 条目, 或 JS 中出现过 `tools.exec_command` 却没有任何 "命令执行完成" 条目 (记录格式变了的信号). 这里按整体而不是逐调用核对: 一次 JS 调用可以并发发出多条命令 (实测一次调用对应多条命令执行条目, 且条目与调用不按顺序一一对应), 被拒绝或未执行的命令也可能没有条目, 逐调用配对会误阻断. 接受的残余风险: 部分命令缺少条目时检查仍会通过, 这些命令的路径不被路径检查覆盖.
- Claude: 记录中有子 Agent 分支条目.

`inspect` 不写任何文件, 记录与夹具不变时重复运行结果相同. 记录格式随原生客户端版本变化时, 解析器会以 `blocked` 暴露, 不会放行.

### 禁止来源与匹配

Reviewer 只被允许观察实例根目录 (实例在会话临时目录下, 路径本身暴露了源码仓库位置). 禁止的有: 答案键 (各场景的答案键, 锚点和盲裁简报), 同一轮的其他实例及其恢复记录, 盲池与裁决库, 源码仓库其余部分 (含 Git 历史), 其他克隆与 worktree, 以前运行的会话记录. 检查用两种互补的方式匹配, 以免只靠路径被混淆绕过, 或只靠内容漏掉没读成功的尝试:

- 路径检查只看 Reviewer 的调用 (Codex 的最终命令与工作目录, Claude 的 `tool_use` 中除写入内容 `content`, `old_string`, `new_string` 之外的全部字符串输入), 不看模型自己写的文字. 取调用文本中含 `/` 的词以及 `..`, `~`, `$HOME` 开头的词 (按空白, 引号和 `;|&(){}<>=,` 切词), 相对路径按该调用的工作目录解析, 含通配符的取通配符之前的前缀. 同一调用中解析为同一路径的只标记一次. 解析结果在实例之外, 并且 (现在存在, 或是实例的上级目录), 并且不是 Reviewer 自己的原生记录 (`sessionPath` 文件, Claude 还含它所在的逐实例转录目录, Reviewer 读自己的运行记录不算越界), 并且不在系统目录 (`/usr`, `/bin`, `/sbin`, `/lib*`, `/etc`, `/dev`, `/proc`, `/sys`) 下, 就标记. "现在存在" 排除 `sed` 或 `awk` 正则 (如 `/a/,/b/p`) 之类的误报; "是上级目录" 抓 `find / -name ...`, `cd ..` 或 `rg ~` 这类整盘搜索; 读另一个仓库的 `git -C <路径>` 和 `--git-dir=` 同样落入路径检查.
- 工具检查 (允许清单不区分调用层级, 只比对名称): Codex 的顶层调用名或调用 JS 文本中字面出现的 `tools.<名>` 不在 `exec`, `wait`, `exec_command`, `write_stdin`, `apply_patch`, `update_plan` 内 (真实记录中 `exec` 与 `wait` 是顶层调用, 其余是 JS 内的嵌套工具), 或 Claude 的工具名不在 `Read`, `Grep`, `Glob`, `Bash`, `Edit`, `Write`, `StructuredOutput` 内, 标记 (它们能读文件或访问网络, 而路径检查看不到).
- 答案键内容检查: 从各场景的答案键和锚点取长度不少于 40 个字符且含空白的字符串值 (不含空白的长字符串多是文件路径, 会出现在任何目录列表里), 从盲裁简报取长度不少于 40 个字符的行 (对答案键与锚点的字符串值和简报行一视同仁: 每条取原文与 JSON 转义形式两种文字, 因为 `cat` 答案键文件得到的是转义后的文字; 指纹与被查的输出两侧都先转小写并合并空白), 剔除实例中本来就有的文本 (遍历实例目录, 不进入 Git 目录, 临时目录和 `agent.json`, 因为把答案抄进报告不应成为漏洞). 只在 "环境返回给模型的文本" 中查找: Codex 的调用输出条目 (模型实际看到的输出), Claude 的 `tool_result` 内容; 每条输出至多一个 `answer-key` 标记 (首个命中), 以免一次 `cat` 答案键产生上百条标记. 不查模型自己写的话, 因为锚点中含以前模型的原话, 新报告可能措辞巧合.

范围的边界: 夹具来自 `inspect` 所在仓库的场景目录 (与 `score` 取夹具的方式一致), 所以能力测试始终拿本仓库的答案键做指纹. 在 `.tmp` 中的实例自己的文件 (含报告目录) 属于实例内, 不会被路径检查标记.

已知缺口 (权威文字在开发规格的 `inspect` 接口, 长期规格只引用): 路径检查抓不到 shell 层面的混淆 (如先拼出路径再读) 和交互 shell 里 `write_stdin` 动态拼出的命令; 工具检查只认 JS 文本中字面的 `tools.<名>`, 别名或 `tools["名"]` 这类动态访问识别不到; 这两种情形下读取答案键仍由内容检查覆盖; 偷看同一轮其他实例的报告, 若不经过上述路径形式, 则只靠指令约束.

### 输出

- `{status: "blocked", diagnostics}` (记录问题, 退出 `1`); 所有结果都带 `diagnostics` 数组 (无诊断时为空数组), 与该 Module 其他操作一致.
- `{status: "succeeded", threadId, sessionPath, calls, flags}`: `calls` 是检查的调用数, `flags` 是数组 (无标记时为空), 每项 `{position, kind, text, match}`: `position` 是记录中的行号 (从 1 起), `kind` 为 `path`, `tool` 或 `answer-key`, `text` 是触发的调用或输出的摘录 (不超过 200 个字符), `match` 是命中的路径, 工具名或指纹. 退出 `0`.

标记只是证据清单, 不判定对错; 判定由 Main 按 Skill 作出.

### 作废与重跑 (Skill 规则)

1. 每个实例完成并存好 `agent.json` 后, 对实例目录运行 `inspect`.
2. `blocked`, 或 `flags` 非空的实例默认作废: 不计分, 不入盲池, 用相同设置换新实例路径重跑. 作废发生在计分之前, 没有评分记录需要撤销; 新实例从 `setup` 重新开始.
3. 只有 Main 从所列条目确认实际没有读到禁止内容 (例如 `/` 只是分隔符, 命令读取被拒绝, 读回自己的报告时措辞巧合) 时才可保留该实例, 把理由写进结果表.
4. 结果表增加作废数及原因.
5. 同一格因同一原因连续作废 2 次, 停止并向用户报告 (多半是记录格式变化需要更新解析器, 或被测 Reviewer 配置有问题).

## Testing Decisions

测试都在 `inspect` 的公开输入输出上进行, 使用测试内临时目录里合成的 Codex rollout 与 Claude transcript 夹具, 不启动真实 Codex 或 Claude, 夹具场景的答案键也在临时目录合成.

- 正常路径: 只读实例内文件和使用允许的 Git 命令的两种合成记录返回 `succeeded` 且无标记; 以此证明检查不会对正常审核误报.
- 记录不完整: 缺失 `agent.json`, `agent.json` 不是 JSON 或没有 `result`, 缺少 `threadId` 或 `sessionPath`, 零个或多于一个成员, 记录文件不存在, 身份不符或缺少身份 (Codex 不以 `session_meta` 开头, Claude 没有 `sessionId`), 坏 JSON 行, 调用缺少输出, Codex 缺少 `task_complete`, 调用过 `exec_command` 却没有命令执行条目, 各自返回 `blocked`; 这些防止取不到证据时静默放行.
- 标记: 越出实例的相对路径, `git -C` 其他仓库, 整盘 `find`, 指向相邻实例的绝对路径, Claude 的 `Read` 读实例外文件, 未列入允许清单的工具, 工具输出含答案键指纹 (含 JSON 转义形式) 各产生对应标记; 防止遗漏真实违规.
- 不误报: `sed` 正则形式的 `/a/,/b/p`, `/dev/null`, 答案键文本只出现在 Reviewer 自己写的报告内容里, 实例内本来就有的长文本和不含空白的长路径出现在工具输出中, 都不产生标记.
- 公开错误结果与不变量: 夹具缺失或不可读 (夹具根目录不是目录) 时返回 `failed` (`stage` 为 `fixture-read`), `agent.json` 存在但读取失败 (它是一个目录) 时返回 `failed` (`stage` 为 `report-read`); 所有结果带 `diagnostics`; 多处命中时标记按行号升序, 同一调用中同一路径只标记一次, 一条输出含多个指纹时只有一个 `answer-key` 标记; 重复调用结果相同且不改动实例; 入口对缺少参数的 `inspect` 退出 `2`, 对 `blocked` 退出 `1`.
- 测试与已有套件测试一样不依赖真实进程 (入口的退出值测试沿用该套件已有的入口测试方式); 单个测试回调耗时不超过 100 毫秒.
- 真实记录的对接由一次真实 Codex 和一次真实 Claude 能力实例各运行一次 `inspect` 验证, 它不属于确定性测试, 结果记入 issue.

## Out of Scope

- 不阻止读取, 不收紧 Codex 或 Claude 的读取权限, 不移动或加密答案键.
- 不检查盲裁裁判的运行 (裁判只读 `adj/`), 不对非能力测试的 Reviewer 运行做读取检查.
- 不并入 `score`: `score` 每个实例会多次运行, 并入会牵动全部现有 `score` 测试; `inspect` 是单独的运行后检查.
- 不恢复已被删除的程序化门禁, 只恢复它的要点 (记录核对, 允许清单, 关闭式失败, 无子 Agent).
- 不处理 shell 层面混淆的路径, `write_stdin` 动态命令中的路径, 以及 JS 中别名或动态访问的工具名 (见已知缺口).

## Further Notes

`score` 要求的 `agent.json` 外层带 `status: "succeeded"`, 而 `arw background-agent` 的 `list_agents` 原始输出外层是 `ok`. `inspect` 只读 `result`, 不受这个差异影响; 差异本身不在本 effort 处理.

## Module Design

### Modules

Reviewer Capability Module 新增一项责任: 对一个已完成的能力测试实例, 基于该 Reviewer 的原生执行记录给出 "是否读取禁止来源" 的证据清单. 它只读取实例目录, `agent.json`, 原生记录和本仓库的场景夹具, 不写任何文件, 不启动 Reviewer, 不授权计分, 重跑, 审核, 提交或发布 (这些由 `reviewer-capability` Skill 经 Main 完成). 记录定位, 完整性核对, 路径匹配, 工具允许清单和答案键指纹只属于这个操作, 不在 `score` 或 `setup` 中重复. 原生记录的格式知识 (Codex rollout, Claude transcript) 只由这一个操作持有.

### Interfaces

`inspect {instance}` (入口子命令 `inspect <instance-directory>`, 其余入口约定同该 Module 现有操作: 载荷 JSON 写 `stdout`, 诊断写 `stderr`, `succeeded` 退出 `0`, `blocked` 或 `failed` 退出 `1`, 用法错误退出 `2`):

- 输入: `instance` 是已完成实例的目录, 其中有 Main 保存的 `agent.json`; 可选的 `fixtures` 是场景夹具根目录, 缺省为所在仓库的夹具目录 (只有测试传入, 入口不暴露).
- 输出: 见上文 "输出". `blocked` 条件见上文 "记录不完整时关闭式失败", 外加参数形状无效为用法错误. `failed` 只用于读取已存在文件时的 I/O 失败: 读 `agent.json`, 原生记录或实例目录失败的 `stage` 为 `report-read`, 夹具缺失或不可读的 `stage` 为 `fixture-read`; `agent.json` 和原生记录不存在是 `blocked`. `failed` 结果同样带 `diagnostics`, 不带 `flags`.
- 不变量: 只读, 记录与夹具不变时重复调用得到相同结果; 标记按记录行号升序; 同一调用中同一路径只标记一次, 每条输出至多一个 `answer-key` 标记.
- 外部输入 (`agent.json`, 原生记录) 只在该操作内校验一次, 内部各层信任; 夹具是受信任的已提交文件, 只检查它能否读到.

### Seams and Adapters

没有新增 Seam. 本 effort 改写开发规格中该 Module 的 Seams and Adapters 一段: 直接使用 `node:fs` 而不经公共 I/O 的例外, 从 "受信任的已提交夹具" 扩大到 "该 Module 读取的维护者本机只读证据 (Reviewer 报告, `agent.json`, 原生记录, 实例目录)"; `score` 已经这样读取报告与 `agent.json`, 所以这是把既有做法写进规格, 对 "业务 Module 不绕过公共 I/O" 一般规则的例外仍只限这个源码专用 Module. 原生记录, `agent.json` 和实例目录直接用 `node:fs` 读取, 与该 Module 的 `score` 读取 Reviewer 报告和 `agent.json` 的方式一致: 这是源码专用的维护工具, 读的是维护者本机上 Reviewer 留下的只读证据, 不是对用户仓库的受限访问, 因而不经过公共 Filesystem Module 的路径范围与符号链接检查 (代价是不获得这些检查, 接受它是因为 `inspect` 不写任何文件). 路径 "是否在实例之外" 与 "是否是实例的上级目录" 都用公共 Filesystem Module 的绝对路径范围判断 (纯计算, 没有 I/O) 回答, 前者以实例为范围, 后者以被审路径为范围判断实例是否落在其中, 不在业务实现里重复范围判断; 确定性测试在临时目录写入合成记录和答案键. 两个后端的记录是同一操作内的两种解析, 它们产出同一种内部形式 (调用列表, 输出文本列表), 之后的路径检查与指纹检查不区分后端, 所以不需要抽象出可替换的 Adapter 层, 也不是为未来后端预留的扩展点.

### Dependencies and Data Flow

依赖方向不变: 入口脚本调用 `lib/reviewer-capability/` 的操作, 该目录只依赖公共 JSON Module, 公共 Filesystem Module 的路径范围判断, node 内置模块与夹具. 数据流: Main 保存的 `agent.json` 给出记录位置和线程身份, 原生记录经完整性核对得到调用与环境输出两条序列, 路径检查和工具检查作用于调用序列, 指纹检查作用于输出序列, 汇成 `flags`; Main 据此按 Skill 决定作废或保留. 权威来源:

| 事实 | 唯一来源 | 说明 |
| --- | --- | --- |
| Reviewer 实际执行的调用与看到的输出 | 原生执行记录 | `inspect` 只读, 不复制 |
| 记录位置与线程身份 | `agent.json` | 由 Main 在 Reviewer 完成后保存 |
| 答案键指纹 | 场景夹具 (`expected.json`, `anchors.json`, `brief.md`) | 每次检查现取, 不持久化 |
| 路径检查的系统目录清单 | `inspect` | 只是排除误报的固定清单, 不对应运行层配置 |
| 工具允许清单 | `inspect` | 运行层 (Claude 后端启动时给 Reviewer 的工具集, Codex 的原生工具) 是另一份事实; 运行层新增工具时 `inspect` 会把它标记为 `tool`, 维护者据此更新清单, 方向是误报而不是漏报 |
| 作废, 保留与重跑的决定 | `reviewer-capability` Skill 与 Main | `inspect` 不写决定 |

`inspect` 没有持久状态, 也没有最终提交时点: 它的结果不被任何后续操作读取, 只由 Main 阅读. 失败 (记录不完整) 发生在读取与核对阶段, 此时没有任何写入; 修正输入 (重新保存 `agent.json`, 等记录写完) 后重新运行即可, 或按 Skill 作废该实例重跑.

### Module Design Rationale

新增独立子命令, 而不并入 `score`. 替代方案是让 `score` 在计分时一并检查. 并入的好处是少一个命令; 代价是 `score` 对每个实例会多次运行 (含重新裁决后的重算), 每次都重新解析记录, 并且所有现有 `score` 测试都要补会话夹具. 选择独立命令的代价是 Main 多运行一条命令, 靠 Skill 步骤保证它被运行.

检查放在实例结束之后, 而不是运行期间拦截. 替代方案是收紧读取权限 (Linux 收紧 Codex 读取范围, 移走或加密答案键). 它们被拒绝: 移走或加密挡不住 Git 对象和其他克隆里的副本, 还破坏 `anchor-add` 与 diff 流程; Linux 收紧已被长期规格判为不采用, 因为被测环境与生产不一致. 事后检查接受的代价是违规已经发生, 须作废重跑, 多花一次运行.

路径检查用 "现在存在或是实例上级目录" 的判据而非 "凡实例外的路径都标记". 前者抓真实的越界读取并排除正则等误报. 代价是判据在检查时而不是在 Reviewer 读取时观察: 运行中读过而检查前已被删除的路径会漏报, 运行中不存在而检查前被别处创建的路径会误报. 接受它是因为 Skill 要求实例完成后立即检查, 此时实例周围的目录基本不变, 误报由 Main 阅读标记后保留, 漏报只发生在需要有人在两步之间删除文件的情形. 工具允许清单由 `inspect` 自己持有, 而不引用运行层的共享常量 (Claude 后端的只读工具集在通用运行层). 引用会让源码专用的能力测试 Module 依赖产品运行层, 违反其只依赖公共 Module 与 node 内置模块的方向; 共享常量也只覆盖 Claude, Codex 的原生工具没有对应常量. 代价是两份清单可能分叉, 分叉的方向是运行层新增工具时 `inspect` 误报 `tool`, 由维护者更新清单, 不会漏报. 答案键指纹每次现取, 不在 `setup` 时固化: 固化需要新增一份持久状态并让 `setup` 与 `inspect` 共享, 而夹具本身是权威来源. 代价是夹具变化 (如 `pool anchor-add` 新增锚点) 后同一实例的结果可能变化, 这正是对当前答案键做检查所要的. 内容检查另外补上路径混淆的漏洞, 它只查环境返回的文本, 代价是 Reviewer 读到后用自己的话转述不会被内容检查发现, 但读取动作本身仍被路径检查看到.

### ADR Evaluation

`inspect` 是只属于 Source Checkout 维护的能力测试工具的一项只读操作, 不进入 Workflow Distribution 或 release 安装包. 逐项评估:

- 授权与安全边界: 不改变任何授权主体; `inspect` 的输出不授权计分, 保留, 审核或提交, 只是 Main 的证据. 不新增对用户机器的访问, 它读取的是 Reviewer 本来就留下的原生记录.
- 调用方可见的结果合同: 沿用该 Module 的 `status` 与退出值约定, 新增 `flags` 载荷, 不改变其他操作的输出.
- 失败与恢复合同: 关闭式失败, 无写入, 重跑即恢复; 不新增恢复记录.
- 持久状态与权威来源: 不新增持久状态; 原生记录和 `agent.json` 的权威归属不变 (前者归客户端, 后者归 Main 与 Skill).
- 布局与依赖方向: 遵守 `docs/adr/0022-place-source-checkout-scripts-under-scripts.md` 的入口与 `lib/` 分层, 不增加业务实现之间的依赖. 它读取的原生记录来自 `docs/adr/0030-use-user-wide-background-agent-management.md` 的管理层与 `docs/adr/0032-run-claude-reviewers-through-headless-claude.md` 的 Claude 后端所产生的会话文件, 不改变这些决定.

因此不需要新的 ADR.

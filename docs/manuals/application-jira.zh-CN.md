# 在多个仓库中分发工作并同步 JIRA

[English](application-jira.md) | [简体中文](application-jira.zh-CN.md)

当一条 JIRA Story 需要跨越多个 Git 仓库协同改动时, 靠人工同步需求描述, 实施进度和集成测试既繁琐又容易出错. ARW 的多仓库工作流把这些职责拆开: 由一个 Application 仓库统一拥有跨仓库需求, JIRA 协调和最终集成验证, 而每个 Module 仓库只保留各自的代码改动与本地验证证据.

本手册面向熟悉终端和 Git, 并已通过 [项目入口](../../README.zh-CN.md) 了解单仓库 ARW 安装与日常工作的读者 (本手册不再重复单仓库路线). 下文将按实际操作顺序带你走完整个流程: 先判断当前任务是否适合多仓库路线, 理清 Application 与 Module 工作记录的分工, 接着完成仓库准备, JIRA 接收, 跨仓库关联, 按序发布和状态同步, 最后完成 Application 级集成验证并关闭 JIRA 闭环.

需要 Agent 协调 Application 仓库, Module 仓库和 JIRA 时, 请明确要求它使用 [`application-workflow` Skill](../../.agents/skills/application-workflow/SKILL.md). 无论是仓库配置还是 JIRA 请求, 都不会自动触发这项 Skill. 调用该 Skill 只会让 Agent 掌握这条路线的工作方法, 不能代替文件写入, Git 操作, 浏览器动作或 JIRA 写入各自所需的独立授权.

## 判断这条路线是否适用

当一条 JIRA Story 需要多个 Git 仓库共同交付, 且你希望达到以下目标时, 适合采用这条路线:

- 跨仓库的整体要求只保存在一个权威位置, 避免在多个仓库间复制需求.
- 每个实施仓库只保存自己的代码修改和验证证据.
- 由一个顶层仓库汇总各仓库已发布的结果并统一执行最终集成验证, 防止跨仓库状态漂移.

这种跨仓库一致性也伴随着明确的协调成本: 你需要同时维护 Application 配置和两侧工作记录, 严格按依赖顺序提交并推送, 在产生任何外部影响前逐次确认准确候选内容, 并在所有 Module 发布后执行一次 Application 级验证. 如果需求只改动一个仓库, 直接使用普通单仓库 ARW 工作流即可, 不必引入这套协调层.

决定采用多仓库路线后, 先不动代码, 明确以下四项前提:

- **Application Repository:** 哪个仓库保存跨 Module 的整体要求并负责协调 JIRA.
- **Module Repository:** 哪些仓库拥有实际产品代码改动和各自的本地验证证据.
- **JIRA 生命周期映射:** 哪个 JIRA 项目, Story 工作项类型以及哪三个状态名称分别代表候选, 已接收和已完成.
- **Module 发布目标:** 所有 Module 把可供 Application 读取的结果发布到哪个 Git 远端和分支.

确定这四项边界后, 下一步不是立刻拆分代码, 而是先弄清两类仓库各自维护什么工作记录, 以及它们如何互相引用.

## 理解 Application 和 Module 的责任关系

ARW 根据仓库根目录 `arw.config.json` 的内容区分两类仓库及其角色:

- **Application 仓库 (`Application Leader` 角色):** 负责跨仓库设计, 整体规格, 工作拆分和最终集成验证. 当根 `arw.config.json` 中包含完整有效的 `application` 对象时, ARW 就把当前仓库视为 Application 类型仓库, 并赋予它 Application Leader 角色. Application Leader 只负责协调, 绝不在 Application Source Issue 中直接实施 Module 代码.
- **Module 仓库 (`Application Member` 角色):** 负责单个 Module 的实际产品代码, 本地实施工作记录, 工作过程和验证证据. 当仓库没有 `application` 对象时, ARW 把它视为 Module 类型仓库, 并赋予它 Application Member 角色. 这两种角色只规定当前仓库允许承担什么工作, 不对操作人员做身份认证.

在 Application 仓库中, 围绕同一目标组织的一组工作称为一个 effort (工作组), 保存在 `.scratch/<NNNN>-<effort-slug>/` 目录下. 其中 `spec.md` 规定整项需求最终必须达成的结果, `issues/` 下的文件则把该结果拆分为具体的工作记录. 4 位 effort 编号是稳定身份标识; 在命令中, ARW 使用形如 `spec:0007` 的 Canonical ID 稳定指向一份已登记记录.

例如, 一个 Application 工作组可以包含以下文件:

~~~text
.scratch/0007-payment-retry/spec.md
.scratch/0007-payment-retry/issues/01-prepare-billing.md
.scratch/0007-payment-retry/issues/02-validate-application.md
~~~

当你把第一份 Application 工作记录 (`01-prepare-billing.md`) 分发给名为 `billing` 的 Module 后, 两侧记录会建立一对一的双向关联:

~~~text
Module implementation issue: `issue:billing:0013:07`
Application source issue: `issue:payments:0007:01`
~~~

这两行分别写入不同仓库, 划定了两侧的职责边界:

- 第一行 (`Module implementation issue: ...`) 写入 Application 仓库的工作记录, 把它从普通工作记录转化为 **Application Source Issue**. 从此以后, 这份记录只保留它在整体计划中的位置, 阻断关系, 从 Module 镜像过来的 `Status:` 以及当前下游修正.
- 第二行 (`Application source issue: ...`) 写入 Module 仓库的工作记录. 它只记录这项任务源自哪里, 而实际代码修改, 状态推进, 工作过程和验证证据仍然完全归 Module 实施工作记录所有.

除了分发给各 Module 的记录外, Application 工作组还必须在 `spec.md` 中指定一份不对外分发的本地实施工作记录 (如上例中的 `02-validate-application.md`), 作为 **Application validation issue**. 它会等待同一工作组中的所有其他工作结束, 然后对各 Module 组合后的整体结果做集成验证. 这样一来, 单模块证据留在 Module, 整体验证留在 Application, 而 JIRA 只记录已发布且已验证结果的接收与完成状态.

在实际仓库布局中, Module 通常作为 Git submodule 挂载在 Application 仓库下. Git submodule 是嵌套在外层仓库路径中的独立 Git 仓库, 拥有自己独立的工作树, 暂存区, 分支, 提交和远端; 外层 Application 仓库只保存一个指向 Module 当前提交的指针, 称为 **gitlink**. 正因为外层仓库记录的是 gitlink, 你必须先把 Module 提交发布到远端, 然后才能在 Application 仓库中记录相应的 gitlink 和汇总状态.

## 准备 Application 仓库

理清两类仓库的职责后, 就可以动手准备本地环境了. 在开始读取 JIRA 或关联工作记录之前, 需要依次备齐四项前提: Application 配置文件 (`arw.config.json`), JIRA 列表显示上限, JIRA 访问凭据, 以及各 Module 的发布分支. 请注意, ARW 的配置验证只检查配置文件本身的结构是否合格, 不会替你探测 Git 远端, 分支, Git submodule 或 JIRA 服务是否真实连通, 因此这些外部前提需要你逐项确认到位.

### 配置参与仓库和 JIRA

在首次运行 `arw workflow init` 之前, 先在 Application 仓库根目录创建完整的 `arw.config.json`. 下面的示例将名为 `payments` 的 Application 连接到 `modules/billing`, 并声明 JIRA 中对应的项目键, 工作项类型和状态名称:

~~~json
{
  "configVersion": 2,
  "application": {
    "name": "payments",
    "submoduleRemote": "origin",
    "submoduleDistributionBranch": "dev",
    "modules": [
      {
        "name": "billing",
        "path": "modules/billing"
      }
    ],
    "jira": {
      "baseUrl": "https://jira.example.test/",
      "projectKey": "PAY",
      "issueType": "Story",
      "candidateStatus": "Candidate",
      "acceptedStatus": "Accepted",
      "completedStatus": "Completed"
    }
  }
}
~~~

配置文件中的各个字段分别规定了以下协作约束:

- `configVersion`: 当前仅支持 `configVersion: 2`, 不提供从旧配置版本自动迁移的流程.
- `application.name` 与 `application.modules`: `application.name` 是关联字段和 JIRA 评论中使用的 Application 名称. `application.modules` 列出所有参与实施的 Module 仓库, 其中 `name` 是关联标识符中使用的短名称, `path` 是从 Application 仓库根目录出发的安全相对路径. 名称只能使用小写英文字母, 数字和连字符, 且不能以连字符开头; Module 的名称和路径都必须唯一, 且不同 Module 的路径不能互相包含.
- `application.submoduleRemote` 与 `application.submoduleDistributionBranch`: 共同指定所有 Module 发布结果的远端和分支. 它们只约束 Module, 不规定 Application 仓库自身使用哪个远端或分支.
- `application.jira`: 指定 JIRA 地址, 项目键, 工作项类型和 3 个生命周期状态. `issueType` 与各个状态名称必须和 JIRA 接口返回的字符串完全一致. `baseUrl` 必须是 HTTP 或 HTTPS 绝对地址, 可以包含路径, 但不能包含用户名, 密码, 查询参数或片段.

写好 `arw.config.json` 后, 首次启用仓库工作流时需执行另行获授权的 `arw workflow init`; 初始化会在同一事务中写入仓库工作流文件并验证现有配置. 如果 Application 仓库此前已经完成初始化, 可以运行以下命令只读验证当前配置 (该命令不会访问 JIRA):

~~~text
arw workflow verify
~~~

再次提醒, 配置验证不会检查所填的远端, 分支或 Module 路径是否真实可用. 一旦配置本身无效, 后续所有 Application 操作都会在业务写入前直接停止; 请先修正配置并重新运行验证, 通过后再继续.

### 准备列表显示和访问凭据

配置好仓库后, 接下来设置 JIRA 列表显示条数和访问令牌. ARW 安装目录中的全局 `config.json` 控制 `arw jira list` 单次显示的条目上限:

~~~json
{
  "jira": {
    "listLimit": 50
  }
}
~~~

`jira.listLimit` 必须是正的安全整数, 默认值为 `50`. 如果只想在某次查询时临时调整显示条数, 可以使用 `arw jira list --limit <N>`, 该参数只对当次命令生效.

在访问凭据方面, 除 `arw jira open` 外, 所有 JIRA 命令都会从当前进程环境中读取非空的 `JIRA_ACCESS_TOKEN`, 并通过 Bearer 认证发送请求. 访问令牌只能保存在当前进程环境中, 切勿写入仓库配置, 全局配置, 规格, 工作记录, 评论, 日志或提交说明.

在 Bash 中, 为当前终端会话设置令牌:

~~~text
export JIRA_ACCESS_TOKEN="<token>"
~~~

在 PowerShell 中, 为当前会话设置令牌:

~~~powershell
$env:JIRA_ACCESS_TOKEN = "<token>"
~~~

每个 JIRA REST 请求的超时时间均为 10 秒, 且 ARW 不会自动重试. 如果环境变量中缺少令牌, 命令会在发起网络请求前直接停止; 如果 JIRA 返回重定向响应, ARW 也会立即停止, 绝不会把令牌转发到其他地址. 由于网络报错时远端可能已经处理了请求, 命令失败后请先核对当前 JIRA 状态, 再决定是否重试, 不要假设失败的请求一定没有生效.

### 让 Module 进入发布分支

准备工作的最后一步, 是确保每个已配置的 Module 都处于 `application.submoduleDistributionBranch` 分支上. 无论是后续的跨仓库关联还是状态同步, 都要求全部 Module 位于该分支, 以保证关联记录和后续实施结果始终落在 Application 约定的同一条发布线上.

如果需要让全部已配置 Module 一起切换分支, 先确认每个 Module 的工作树和 Git 暂存区都干净无改动, 然后运行:

~~~text
arw submodule switch-branch <branch>
~~~

该命令会先检查所有 Module, 全部通过后才开始切换, 且不会拉取远端更新. 如果某个 Module 本地已有目标分支, 命令会直接切换过去; 如果本地还没有, 则只有当配置远端上已经存在同名分支时, 命令才会创建本地跟踪分支.

一旦写入前检查失败, 任何 Module 都不会被切换. 如果在开始切换后中途失败, 命令会按相反顺序尝试把已切换的 Module 恢复原状, 并输出每个 Module 最终所在的分支和 `HEAD`. 排查切换失败时, 请以命令最后报告的实际分支和 `HEAD` 为准, 不要凭原计划假设所有仓库都已自动恢复.

## 从 JIRA 建立并接收整体要求

当配置文件, 访问令牌和 Module 分支都准备就绪后, 就可以从 JIRA 查找候选 Story, 并把它转化为 Application 工作组了. 先列出候选 Story, 再读取目标 Story 的完整内容:

~~~text
arw jira list
arw jira list --limit 20
arw jira print PAY-123
arw jira open PAY-123
~~~

这几条命令各司其职:

- `arw jira list` 严格按配置中的项目, 工作项类型和候选状态 (`candidateStatus`) 筛选, 按键排序, 并只读取第一页. 输出会先显示 JIRA 返回的总匹配数, 再列出当前页的键和标题 (标题默认按 100 列排版截断, 传入 `arw jira list --full` 或 `-f` 可输出完整标题). 当总匹配数大于当前显示条数时, 说明后面还有未列出的候选 Story.
- `arw jira print` 会读取工作项详情及所需的全部分页数据, 只有所有分页都读取成功时才输出完整 JSON; 只要任一分页失败, 就不会输出残缺结果.
- `arw jira open` 只尝试在系统默认浏览器中打开该工作项页面, 不读取访问令牌, 也不预先验证该工作项是否存在.

这些命令只做只读查询, 不会根据 JIRA 描述自动生成 ARW 文件. 你需要和 Agent 一起讨论需求, 确认该 JIRA 工作项的项目, 类型和当前状态依然与 `arw.config.json` 完全一致, 然后确定 Application 工作组的名称, 整体规格 (`spec.md`) 和工作拆分. 一个 JIRA Story 对应一个 Application 工作组; 刚接收时工作组里可以先只有 `spec.md`, 但在工作组最终完成前至少要包含一份工作记录.

为了把 Application 工作组与 JIRA 绑定, 需要在 Application `spec.md` 的一级标题 (H1) 下方第一行元数据中写入准确的 JIRA 链接:

~~~text
JIRA issue: [`PAY-123`](https://jira.example.test/browse/PAY-123)
~~~

Agent 会按普通的规格和工作记录流程准备好完整修改差异, 交由你审核并批准准确的路径和内容. 在向 JIRA 标记接收之前, 已批准的 Application 工作组必须先完成提交并推送到远端, 确保当前分支的 upstream (即当前本地分支所跟踪的远端分支) 包含与本地当前提交 (`HEAD`) 完全一致的工作组目录树.

由于提交, 推送和 JIRA 接收共同构成一次连续的外部变更, 动手前 Agent 会向你展示准确的已暂存路径, upstream, JIRA 键, 完整的接收评论以及目标状态, 并向你取得一次明确授权. 只要其中任何一项输入发生变化, 都必须重新取得授权. 当提交和推送成功后, 运行:

~~~text
arw jira accept spec:0007
~~~

`arw jira accept` 不会替 Agent 执行提交或推送. 它先验证 upstream 中的工作组目录树是否与本地一致, 验证通过后向 JIRA 添加准确的接收评论, 最后把 JIRA 状态从 `candidateStatus` 推进到 `acceptedStatus`. 命令成功意味着整体要求已经发布到 Git 远端, 且 JIRA 中同时具备准确的接收评论和目标状态. 由于添加评论和转换状态是两次独立的请求, 如果评论已写入但状态转换失败, 已写入的评论会保留在 JIRA 中; 排查并修复原因后重新运行同一条 `arw jira accept spec:0007` 命令, 它会识别已有评论并只补齐缺失的状态转换步骤.

## 把实施工作关联到 Module 仓库

整体要求在 JIRA 中接收完毕后, Application Leader 就可以把具体实施工作分发到各个 Module 仓库了. 首先, 在 Application 仓库和目标 Module 仓库中分别准备一份普通实施工作记录. 这两份记录可以使用不同的工作组编号和工作记录编号, 但必须具有完全相同的非终态 `Status:`. 同时注意保持治理边界独立: Module 工作记录只引用其自身仓库内适用的治理资料, Application 规格不会跨越仓库边界成为 Module 的实施授权.

执行关联命令前, 请确认满足以下四项条件:

- 每个已配置 Module 都处于分发分支 (`application.submoduleDistributionBranch`).
- 受影响的 Application 工作组和所有相关 Module 工作组中都没有未暂存修改或未跟踪文件.
- 各仓库的 Git 暂存区要么保持干净, 要么保存着 Agent 预先准备好的已暂存基线. 任何新增或修改的工作记录都必须在关联前先暂存进 Git 暂存区, 作为恢复基线的一部分.
- 从同一个 Application 工作组分发到同一个 Module 的多份工作记录, 必须放在同一个 Module 工作组中.

之所以要先暂存工作记录, 是因为关联命令始终把调用时刻各仓库 Git 暂存区中的字节当作恢复基线. 命令会先完整分析受影响的全部记录, 确认所有替换都能成立后, 才开始向工作树写入修改.

在 Application Repository 中运行:

~~~text
arw application associate issue:0007:01 issue:billing:0013:07
~~~

第一个参数 (`issue:0007:01`) 是 Application 仓库的本地工作记录 Canonical ID, 第二个参数 (`issue:billing:0013:07`) 则包含配置中的 Module 名称 (`billing`) 和该 Module 的工作记录 Canonical ID (`issue:0013:07`). 命令分析完所有受影响记录后, 会在两侧仓库中同时写入双向关联. 在改写 Module 工作记录的阻断关系 (`Blocked by`) 时, 如果阻断项位于同一个 Module 工作组内, Module 工作记录会直接使用本地编号; 如果阻断项留在其他仓库, 则会改写为带非空说明的 `External dependency`, 指明实际工作所在的位置.

命令成功后, Application 侧的工作记录正式变为 Application Source Issue, 而 Module 侧的工作记录仍然是普通实施工作记录. 所有替换后的文件内容都留在各仓库的工作树中且处于未暂存状态, 供你审核后按受影响的工作组分别暂存; 命令本身不会运行 `git add`, 提交或推送.

如果关联写入过程中出现任何失败, 命令会尝试把所有受影响文件恢复为调用时刻各自 Git 暂存区中的基线字节, 而暂存区本身保持不变. 如果自动恢复未能完全成功, 命令会列出仍与基线不一致的文件路径. 此时请逐一核对这些路径并恢复到可确认的基线, 重新满足工作树清洁和分支前提后再重试关联; 切勿在恢复结果不明确时强行暂存或发布.

## 按正确顺序发布关联结果

由于关联结果横跨多个独立的 Git 仓库, 且 Application 仓库只允许记录已经发布到远端的 Module 提交, 因此发布关联结果时必须先发布 Module, 再提交 Application, 顺序不可倒置:

1. 在每个受影响的 Module 仓库中审核完整的关联结果, 并暂存相应工作组的文件.
2. 在每个 Module 仓库中分别提交各自的分发结果.
3. 取得独立的推送授权, 把这些 Module 提交推送到 `application.submoduleRemote` 和 `application.submoduleDistributionBranch`.
4. 确认配置远端上已经包含每个 Module 的最新提交.
5. 回到 Application 仓库, 审核并暂存 Application Source Issue 的替换内容. 如果 Module 是作为 Git submodule 挂载的, 同时审核外层仓库观察到的 gitlink 变化.
6. 按普通提交工作流提交 Application 仓库中的结果.

遵循这一顺序可以确保 Application 仓库所记录的每一条 Module 事实都已经在远端公开可取. 反之, 如果先提交了 Application 仓库, 它的 gitlink 或来源记录就可能指向一个其他人根本无法从远端拉取的本地 Module 提交.

一旦 Module 的分发提交推送到远端, 两侧的双向关联即永久冻结, 此后不能修改关联字段, 也不能提议更换关联目标. Application Source Issue 中的交付目标, 要求, 验收条件和阻断项同样一并冻结, 之后只有同步命令才能从 Module 镜像更新它的 `Status:` 和当前 `Downstream changes`. 而在 Module 仓库中, 工作记录的普通状态, 验证证据和普通评论继续按常规实施流程推进; 其既定范围除非遇到下一节所述的真实阻塞, 否则不得更改.

## 在 Module 实施中记录必要修正

发布后的 Module 工作记录应当严格按原有要求实施. 只有当实施过程中发现 `## What to build`, `## Acceptance criteria`, `## Blocked by` 或同工作组受 Git 跟踪的 `spec.md` 存在真实问题, 且该问题直接阻碍既定范围继续推进时, 才允许走修正路线. 这条路线仅用于解除既定范围的真实阻塞, 不能用来借机扩大需求范围.

需要修正时, Module Agent 会先向你说明遇到的真实问题及具体的拟议修改内容, 并取得你的明确授权. 在这条路线中, 你不需要显式调用 `application-workflow`, 但 Agent 自己必须读取该 Skill 中的 Module 修正指引. 即便在修正流程中, `Application source issue:` 依然是不可触碰的硬锁: 既不能修改该字段, 也不能建议更换新的关联目标.

获得你的授权后, Agent 会修改实际的 Module 工作记录或受跟踪的本地 `spec.md`, 并在该工作记录唯一的 `## Comments` 章节最末尾维护唯一的 `### Downstream changes` 子章节 (所有普通评论都必须放在这个末尾子章节之前). `### Downstream changes` 中的每个当前列表项分别记录当前仍有效的问题, 必要修改以及你的授权依据; 如果某条旧修正后来被撤销或被新修正取代, 应当将其删除. 当没有任何有效修正时, 该子章节唯一合法的空列表写法是 `- None.`.

修改完成后, 在 Module 仓库中运行以下只读检查命令:

~~~text
arw module check-correction issue:0013:07
~~~

该命令会将当前 `HEAD` 与磁盘上的工作记录及适用的受跟踪本地 `spec.md` 进行比对 (工作树中可以同时包含已暂存和未暂存的修改). 检查通过需要同时满足四个条件: 至少有一处受保护内容发生了实质修改, 跨仓库关联字段保持未变, `Downstream changes` 章节已更新, 且其中包含至少一个当前有效条目.

请注意, `arw module check-correction` 只检查文件结构和改动范围, 不会替你判断问题是否真实, 是否已获授权或列表说明是否充分, 也不会写入文件或改动 Git 暂存区. 如果检查报错, 请先按诊断提示修正文件并重新运行检查, 通过后再进入普通的差异审核和提交流程.

## 同步已经发布的 Module 结果

当各个 Module 完成阶段性工作并把提交推送到配置的分发分支 (`application.submoduleDistributionBranch`) 后, Application Leader 就可以把这些已发布的进展拉取并汇总回 Application 仓库了. 开始同步前, 请确认每个已配置 Module 的工作树和 Git 暂存区都干净无改动, 且当前分支正好是 `application.submoduleDistributionBranch`.

在 Application Repository 中运行:

~~~text
arw application sync
~~~

该命令每次都会统一处理全部已配置 Module 和全部 Application Source Issue, 不支持只同步其中一个子集. 它会先显式拉取每个 Module 在 `submoduleRemote/submoduleDistributionBranch` 上的远端状态, 然后根据各 Module 本地分支与远端分支的关系分别处理:

| 观察到的关系 | 结果和下一步 |
| --- | --- |
| 本地等于远端 | 保持当前 Module, 继续检查下一个. |
| 本地落后远端 | 只执行 fast-forward 快进, 并验证最终 `HEAD` 等于远端末端. |
| 本地领先远端 | 停止. 审核本地提交, 取得推送授权并发布后重试. |
| 本地和远端分叉 | 停止. 先决定并完成 Git 历史整理, 再重试. |
| 获取远端, 快进或最终验证失败 | 保留已确认结果, 修复失败原因后从当前状态重试. |

如果排在前面的 Module 已经成功完成 fast-forward 快进, 而排在后面的 Module 报错停止, 那么前面已完成的快进会原地保留 (此时 Application 仓库中对应的 gitlink 可能已经显示出变化), 命令不会把已经快进的 Module 往回退. 只有当全部已配置 Module 都顺利到达各自配置远端的末端后, 命令才会开始更新 Application Source Issue.

更新 Application Source Issue 时, 命令会执行以下镜像操作:

- 把每个 Module 工作记录当前的 `Status:` 原样镜像到对应的 Application Source Issue, 无论是处于非终态的前进或回退, 还是进入 `completed` 或 `wontfix`.
- 用 Module 当前完整的 `Downstream changes` 列表替换 Application 侧的旧列表 (如果 Module 当前没有任何修正条目, 则在 Application 侧写入 `- None.`), 同时把普通的 Application 评论保留在该末尾子章节之前.
- 同步过程不会复制 Module 的普通工作日志或验证证据, 也不会因为存在下游修正就自动修改 Application 规格或改变完成资格.

在真正替换磁盘文件前, ARW 会先完整验证所有 Application Source Issue 的替换内容; 只要任意一处关联或列表结构存在问题, 就会在写文件前直接阻断整批更新. 该文件事务同样以 Application 仓库 Git 暂存区中的字节作为恢复基线: 写入成功后, 工作记录的替换内容以及因 Module 快进而产生的 gitlink 变化都会留在工作树中且保持未暂存状态, 暂存区本身不变. 请先审核这批变更, 再按普通提交工作流提交保存.

如果 Application 文件事务在开始写入后中途失败, 命令会详细报告哪些写入已完成以及每个文件的恢复结果. 当全部文件都恢复成功时, Application 文件会回到暂存区基线; 如果有文件未能完整恢复, 请先将报告列出的路径与暂存区比对修复. 注意, 此前已经完成的 Module 快进及其 gitlink 变化不会被这个文件事务回滚.

## 完成 Application 级验证并更新 JIRA

同步命令能把各 Module 已发布的状态汇总回 Application 仓库, 但单个 Module 通过验证并不等于组合后的整体产品结果一定正确. 因此, 每个包含 Application Source Issue 的 Application 工作组都必须在 `spec.md` 中指定唯一一份不对外分发的本地工作记录, 作为 **Application validation issue**:

~~~text
Application validation issue: 02
~~~

这份记录是留在 Application 仓库本地的普通实施工作记录. 它的 `Blocked by` 字段列出了同一工作组内的全部其他工作记录, 所以只有当所有其他工作记录都进入 `completed` 或 `wontfix` 后, 它才能开始实施. 此外, Application validation issue 自身最终必须以 `completed` 结束; 如果将它标为 `wontfix`, 整个工作组将无法完成.

收尾验证并更新 JIRA 的完整步骤如下:

1. 先运行 `arw application sync`, 审核镜像回来的各 Module 状态与 `Downstream changes`. (`Downstream changes` 可以帮助 Application Leader 判断是否需要安排新的上层工作, 但它本身并不是额外的完成阻塞条件.)
2. 执行 Application validation issue 要求的跨模块整体集成验证, 并将少量必要的验证证据保存在这份本地工作记录中.
3. 提交并推送已获批准的完整工作组及验证证据, 确保当前分支的 upstream 包含与本地 `HEAD` 完全相同的工作组目录树. 与接收 JIRA 时一样, Agent 会再次向你展示准确的已暂存路径, upstream, JIRA 键, 完整的完成评论和目标状态, 并为这组准确的提交, 推送和 JIRA 写入取得你的明确授权.
4. 提交和推送成功后, 运行:

~~~text
arw jira complete spec:0007
~~~

`arw jira complete` 不会自动运行 `arw application sync`, 也不会替你提交或推送. 它会根据已提交的配置和工作组文件重新计算完成资格, 再验证实时 upstream 中的工作组目录树是否一致; 确认符合条件后, 它先向 JIRA 写入准确的完成评论, 再把 JIRA 状态从 `acceptedStatus` 推进到 `completedStatus`, 最后再次核实评论和目标状态均已在 JIRA 中生效.

完成后, 三个层次各自保存自己的权威事实, 全程无需人工复制状态: Module 仓库保留各自的代码实施和本地证据, Application 工作组保留整体要求和集成验证证据, 而 JIRA 则准确反映已发布结果的接收与完成状态.

## 从最后一个已确认结果继续

由于跨仓库的 Git 操作与 JIRA 请求横跨多个独立系统, 一旦中途出错, 无法靠一次通用的回滚命令撤销所有影响. 凡是已经成功的提交, 推送, Module 快进, JIRA 评论或状态转换都会保留下来. 因此, 遇到失败时, 请先核实最后一个可以确认的成功结果, 修复失败原因后, 从第一个未完成的步骤继续往前走:

| 失败位置 | 保留或核对的事实 | 恢复动作 |
| --- | --- | --- |
| 配置或业务写入前检查 | 业务文件尚未由该命令修改 | 修正配置, 分支, 清洁状态或输入, 重新运行相应检查. |
| `application associate` 文件写入 | Git 暂存区保持不变, 诊断列出未恢复路径 | 比较每个具名路径和暂存区, 审核并恢复准确基线后再关联. |
| Module 分支切换 | 命令报告每个 Module 最终分支和 `HEAD` | 以最终状态为起点修复, 不假设反向恢复全部成功. |
| `application sync` 的 Module 收敛 | 较早完成的快进保留 | 修复后续 Module 的超前, 分叉或访问问题, 从当前状态重试全部同步. |
| `application sync` 的 Application 文件事务 | 暂存区不变, Module 快进和 gitlink 变化保留 | 检查每项恢复结果, 比较未恢复路径和暂存区, 再重试同步. |
| 提交或推送结果不确定 | 已成功的 Git 写入不会自动撤销 | 读取本地 `HEAD`, upstream, Module 分发分支和 gitlink, 从首个未确认步骤继续. |
| JIRA 评论或状态更新 | 评论和状态是两个独立请求 | 重新读取 JIRA. 保留已存在的准确评论或目标状态, 重试同一 `accept` 或 `complete` 命令补齐缺少的部分. |
| HTTP 请求结果不确定 | 不能由错误响应推断远端未写入 | 再次写入前先读取当前 Git 与 JIRA 状态, 不删除有效评论, 不反转有效状态. |

恢复过程中只要涉及新的提交, 推送, JIRA 写入或破坏性恢复操作, 仍然需要取得相应的授权. 如果修复后导致候选字节, upstream 或 JIRA 目标发生了变化, 请先重新取得授权, 再继续执行.

本手册涵盖了跑通这条多仓库与 JIRA 协同路线所需的全部日常操作与结果处理. 关于准确字段定义, 完整长期行为及所有边界约束, 请参阅 [多个仓库与 JIRA 同步的长期规格](../specs/agent-repository-workflow-application-jira/spec.md); Agent 在实际执行时还必须同时遵循当前仓库规则和 [`application-workflow` Skill](../../.agents/skills/application-workflow/SKILL.md).

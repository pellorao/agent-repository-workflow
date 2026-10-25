# 在多个仓库中分发工作并同步 JIRA

[English](application-jira.md) | [简体中文](application-jira.zh-CN.md)

本手册面向会使用终端和 Git, 但不了解 ARW 多仓库方式的读者. 它从是否应当采用这条路线开始, 说明各仓库和工作记录分别负责什么, 再带你依次完成准备, JIRA 接收, 跨仓库关联, 发布, 同步和 Application 级验证. 一般 ARW 安装和日常工作从 [项目入口](../../README.zh-CN.md) 开始, 本手册不重复那条路线.

需要 Agent 协调 Application 仓库, Module 仓库和 JIRA 时, 你必须明确要求它使用 [`application-workflow` Skill](../../.agents/skills/application-workflow/SKILL.md). 仓库配置或 JIRA 请求不会自动触发这项 Skill. 调用 Skill 只让 Agent 取得这条路线的工作方法, 不代替文件写入, Git 操作, 浏览器动作或 JIRA 写入各自需要的授权.

## 判断这条路线是否适用

当一条 JIRA Story 需要多个 Git 仓库共同交付, 而你希望整体要求只有一个权威位置, 每个实施仓库只保存自己的修改和证据, 再由一个仓库汇总发布结果时, 使用这条路线. 它解决的是跨仓库要求容易复制, 状态容易漂移, 最终验证缺少统一入口的问题.

这项收益伴随明确成本. 你需要维护 Application 配置和两侧工作记录, 按依赖顺序提交并推送, 在产生外部影响前多次确认准确候选, 并在所有 Module 发布后执行一次 Application 级验证. 如果需求只修改一个仓库, 使用普通 ARW 工作流即可, 不要引入这套协调层.

决定采用后, 先确定:

- 哪个仓库保存跨 Module 的整体要求并负责 JIRA 协调. 这是 Application Repository.
- 哪些仓库拥有实际产品修改和各自的验证证据. 这些是 Module Repository.
- 哪个 JIRA 项目, Story 类型和状态变化代表候选, 已接收和已完成.
- 所有 Module 把可供 Application 读取的结果发布到哪个远端和分支.

这些选择形成后, 下一步不是立即分发代码, 而是先理解两类仓库为什么需要不同的工作记录.

## 理解 Application 和 Module 的责任关系

Application 仓库保存跨仓库设计, 整体规格, 工作拆分和最终集成验证. 根 `arw.config.json` 中存在完整有效的 `application` 对象时, ARW 把当前仓库视为 Application 类型仓库, 并让它采用 Application Leader 角色. Application Leader 负责协调, 但不在 Application Source Issue 中实施 Module 代码.

Module 仓库保存一个 Module 的实际产品代码, 本地实施工作记录, 工作过程和验证证据. 仓库缺少 `application` 对象时, ARW 把它视为 Module 类型仓库, 并让它采用 Application Member 角色. 这些角色表示当前仓库允许承担的工作, 不是对操作人员的身份认证.

Application 仓库在 `.scratch/<NNNN>-<effort-slug>/` 下保存一个 effort, 也就是围绕同一目标组织的一组工作. 其中 `spec.md` 说明整项需求最后必须达到的结果, `issues/` 中的文件把结果拆成工作记录. 4 位 effort 编号是稳定身份, 命令使用的规格 Canonical ID 形如 `spec:0007`. Canonical ID 是 ARW 在命令中稳定指向一份已登记记录的标识符.

例如, 一个 Application 工作组可以包含:

~~~text
.scratch/0007-payment-retry/spec.md
.scratch/0007-payment-retry/issues/01-prepare-billing.md
.scratch/0007-payment-retry/issues/02-validate-application.md
~~~

当第一份 Application 工作记录被分发到名为 `billing` 的 Module 后, 两侧记录形成一对一关联:

~~~text
Module implementation issue: `issue:billing:0013:07`
Application source issue: `issue:payments:0007:01`
~~~

第一行位于 Application 仓库. 它使原来的普通工作记录成为 Application Source Issue, 以后只保留整体计划中的位置, 阻断关系, 从 Module 镜像的 `Status:` 和当前下游修正. 第二行位于 Module 仓库. 它只记录这项实施来自哪里, Module 实施工作记录仍然拥有实际修改, 状态, 过程和证据.

Module 通常以 Git submodule 放在 Application 仓库中. Git submodule 是位于外层仓库路径中的独立 Git 仓库, 有自己的工作树, 暂存区, 分支, 提交和远端. 外层仓库只记录 Module 当前指向的提交, 这个指针称为 gitlink. 因此必须先发布 Module 提交, Application 才能安全记录相应 gitlink 和汇总状态.

Application 工作组还要在 `spec.md` 中指定一份没有分发的本地实施工作记录作为 Application validation issue. 它等待同一工作组的其他工作结束, 再验证各 Module 组合后的整体结果. 这样, Module 证据留在 Module, 整体验证留在 Application, JIRA 只接收已经发布并验证的整体状态.

## 准备 Application 仓库

开始 JIRA 读取或工作记录关联前, 先让 Application 配置, 显示限制, 凭据和 Module 分支分别到位. 配置验证只证明文件结构合格, 不证明远端, 分支, Git submodule 或 JIRA 服务真实可用, 所以这些前提需要分开准备.

### 配置参与仓库和 JIRA

在第一次运行 `arw workflow init` 前, 在 Application 仓库根目录创建完整的 `arw.config.json`. 下面的示例把 `payments` Application 连接到 `modules/billing`, 并声明 JIRA 中的准确项目和状态名称:

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

`application.name` 是关联字段和 JIRA 评论中使用的 Application 名称. `application.modules` 列出参与实施的仓库, 每项 `name` 是关联标识中的短名称, `path` 是从 Application 仓库根目录出发的安全相对路径. 名称只能使用小写英文字母, 数字和连字符, 且不能以连字符开头. Module 名称和路径不能重复, 路径也不能互相包含.

`application.submoduleRemote` 和 `application.submoduleDistributionBranch` 共同指定全部 Module 发布结果的位置. 它们不规定 Application 仓库自己使用哪个远端或分支.

`application.jira` 指定 JIRA 地址, 项目, 工作项类型和 3 个生命周期状态. `issueType` 与各状态必须和 JIRA 返回的字串完全相同. `baseUrl` 必须是 HTTP 或 HTTPS 绝对地址, 可以包含路径, 但不能包含用户名, 密码, 查询参数或片段.

配置准备好后, 首次使用仓库工作流仍需另行执行获授权的 `arw workflow init`. 初始化会写入仓库工作流文件, 并在同一事务中验证已有配置. 对已初始化的 Application 仓库, 以下命令只读验证现有配置, 且不访问 JIRA:

~~~text
arw workflow verify
~~~

当前配置只支持 `configVersion: 2`, 不存在旧配置版本迁移流程. 配置验证不检查配置中的远端, 分支或 Module 路径是否真实可用. 配置无效时, 后续 Application 操作会在业务写入前停止; 修正配置并重新验证后再继续.

### 准备列表显示和访问凭据

ARW 安装目录中的全局 `config.json` 可以设置 `arw jira list` 一次显示的数量:

~~~json
{
  "jira": {
    "listLimit": 50
  }
}
~~~

`jira.listLimit` 必须是正的安全整数, 默认值是 `50`. 需要临时查看不同数量时, 使用 `arw jira list --limit <N>`, 它只覆盖本次命令.

除 `arw jira open` 外, JIRA 命令都从当前进程读取非空的 `JIRA_ACCESS_TOKEN`, 并使用 Bearer 认证. 令牌只应存在于当前进程环境, 不要写入仓库配置, 全局配置, 规格, 工作记录, 评论, 日志或提交说明.

在 Bash 中可以为当前终端会话设置:

~~~text
export JIRA_ACCESS_TOKEN="<token>"
~~~

在 PowerShell 中可以设置:

~~~powershell
$env:JIRA_ACCESS_TOKEN = "<token>"
~~~

每个 JIRA REST 请求的超时是 10 秒, ARW 不自动重试. 令牌缺失会在网络请求前停止. JIRA 返回重定向时, ARW 也会停止, 不会把令牌发送到另一个地址. 因此命令失败后先确认当前 JIRA 状态, 再决定是否重试, 不要假设请求一定没有生效.

### 让 Module 进入发布分支

关联和同步都要求每个已配置 Module 当前位于 `application.submoduleDistributionBranch`. 这保证关联记录和后续实施结果来自 Application 约定的同一条发布线.

需要让全部配置 Module 一起切换时, 先确认每个 Module 的工作树和 Git 暂存区都没有变化, 再运行:

~~~text
arw submodule switch-branch <branch>
~~~

命令先检查全部 Module, 再开始切换, 并且不会获取远端更新. 本地已有目标分支时直接使用; 本地没有时, 只有配置远端上存在该分支才创建跟踪分支. 写入前检查失败时不会切换任何 Module. 实际切换失败时, 命令按相反顺序尝试恢复已经切换的 Module, 并报告每个 Module 最终的分支和 `HEAD`. 以这些最终结果为准解决问题, 不要根据原计划猜测仓库已经恢复.

## 从 JIRA 建立并接收整体要求

配置, 令牌和 JIRA 连接准备好后, 先发现候选 Story, 再读取选中 Story 的完整信息:

~~~text
arw jira list
arw jira list --limit 20
arw jira print PAY-123
arw jira open PAY-123
~~~

`arw jira list` 严格使用配置的项目, 工作项类型和候选状态筛选, 按键排序, 只读取一页. 输出先显示 JIRA 返回的总匹配数, 再显示本页的键和标题, 所以总数大于显示数时表示仍有候选未列出. `arw jira print` 读取工作项详情和所需的全部分页数据, 只有全部成功时才输出完整 JSON; 任一分页失败都不会输出不完整结果. `arw jira open` 只尝试在默认浏览器打开页面, 不读取令牌, 也不预先证明工作项存在.

命令只负责读取, 不会根据 JIRA 正文自动创建 ARW 文件. Agent 需要和你讨论需求, 确认 JIRA 工作项的项目, 类型和状态仍与配置完全一致, 再决定 Application 工作组的名称, 规格和工作拆分. 一个 JIRA Story 对应一个 Application 工作组. 接收时工作组可以先只有规格, 但最终完成前至少要有一个工作记录.

Application `spec.md` 的 H1 后第一条元数据保存准确的 JIRA 链接:

~~~text
JIRA issue: [`PAY-123`](https://jira.example.test/browse/PAY-123)
~~~

Agent 按普通规格和工作记录流程准备完整差异, 由你审核并批准准确路径和内容. 接收 JIRA 前, 已批准的 Application 工作组必须已经提交并推送, 使当前分支的 upstream 包含 `HEAD` 中完全相同的工作组目录树. Upstream 是当前本地分支跟踪的远端分支, `HEAD` 是本地当前提交.

提交, 推送和 JIRA 接收被视为一个连续结果. 操作前, Agent 会向你展示准确的已暂存路径, upstream, JIRA 键, 完整接收评论和目标状态, 并取得一次明确授权. 输入发生变化时需要重新授权. 提交和推送成功后运行:

~~~text
arw jira accept spec:0007
~~~

命令不会替 Agent 提交或推送. 它先验证 upstream 中的工作组目录树, 再添加准确接收评论, 最后把 JIRA 状态从 `candidateStatus` 推进到 `acceptedStatus`. 成功结果是 Git 上已经发布整体要求, JIRA 中同时存在准确评论和目标状态. 如果评论已成功但状态转换失败, 评论会保留; 修复原因后重试同一命令, 它会识别现有评论并只补齐缺少的步骤.

## 把实施工作关联到 Module 仓库

整体要求被接收后, Application Leader 可以把具体实施工作分发给 Module. 先在 Application 仓库和目标 Module 仓库中分别准备一份普通实施工作记录. 两份记录可以使用不同的工作组和编号, 但必须使用完全相同的非终态 `Status:`. Module 工作记录只引用其自身仓库内适用的治理来源, Application 规格不会跨仓库成为 Module 的实施授权.

关联前需要满足:

- 每个已配置 Module 都在分发分支.
- 受影响的 Application 工作组和所有相关 Module 工作组中都没有未暂存或未跟踪内容.
- 各仓库的 Git 暂存区可以干净, 也可以保存 Agent 已准备的已暂存基线. 不需要只为运行关联命令额外暂存两侧工作记录.
- 同一个 Application 工作组分发到同一个 Module 的工作记录使用同一个 Module 工作组.

命令始终把调用时各仓库 Git 暂存区中的字节作为恢复基线. 它先分析完整影响范围, 确认可以形成全部替换后才写工作树.

在 Application Repository 中运行:

~~~text
arw application associate issue:0007:01 issue:billing:0013:07
~~~

第一个参数是 Application 仓库的本地工作记录 Canonical ID. 第二个参数包含配置中的 Module 名称和 Module 工作记录 Canonical ID. 命令先分析全部可能受影响的记录, 再写入双向关联. 如果阻断工作位于同一 Module 工作组, Module 工作记录使用本地编号; 如果工作仍在另一个仓库, 它使用带非空说明的 `External dependency` 指向实际工作位置.

成功后, Application 工作记录成为 Application Source Issue, Module 工作记录仍是普通实施工作记录. 全部替换内容留在工作树中且未暂存, 供你审核后按受影响工作组分别暂存. 命令不会运行 `git add`, 提交或推送.

任何关联写入失败时, 命令尝试把所有受影响文件恢复为调用时各自 Git 暂存区中的字节, 暂存区本身不变. 如果恢复不完整, 它会列出仍与基线不同的路径. 先逐一审核这些路径并恢复可确认的基线, 再重新满足清洁状态和分支前提; 不要在结果不明时暂存或发布.

## 按正确顺序发布关联结果

关联结果跨越多个独立 Git 仓库. Module 是实施事实的来源, Application 只记录已经发布的 Module 提交, 所以发布顺序不能倒置:

1. 审核每个受影响 Module 中完整的关联结果, 并暂存相应工作组文件.
2. 分别提交每个 Module 的分发结果.
3. 取得独立的推送授权, 把这些提交推送到 `application.submoduleRemote` 和 `application.submoduleDistributionBranch`.
4. 确认配置远端已经包含每个 Module 提交.
5. 回到 Application 仓库, 审核并暂存 Application Source Issue 的替换内容. Module 是 Git submodule 时, 同时审核外层仓库观察到的 gitlink.
6. 通过普通提交工作流提交 Application 仓库中的结果.

这个顺序让 Application 只记录远端已经存在的 Module 事实. 如果先提交 Application, gitlink 或来源记录可能指向其他人无法取得的 Module 提交.

Module 分发提交已推送后, 两侧关联永久冻结, 不能修改或建议更换目标. Application Source Issue 的交付目标, 要求, 验收条件和阻断项也保持冻结. 它的 `Status:` 和当前 `Downstream changes` 只能由后面的同步命令从 Module 镜像. Module 工作记录的普通状态, 验证和评论继续按普通实施流程更新; 已约定范围只有在下一节所述的真实阻塞下才允许修正.

## 在 Module 实施中记录必要修正

发布后的 Module 工作记录应按原有要求实施. 只有 `## What to build`, `## Spec Requirement`, `## Acceptance criteria`, `## Blocked by` 或同工作组已由 Git 跟踪的 `spec.md` 存在真实问题, 并且这个问题阻止既定范围继续时, 才进入修正路线. 这不是一般范围扩张入口.

Module Agent 先解释问题和准确拟议修改, 再取得你的明确授权. 这条路线不要求你显式调用 `application-workflow`, 但 Agent 必须读取该 Skill 的 Module 修正指引. `Application source issue:` 是硬锁, 不能修改, 也不能建议新的关联目标.

获授权后, Agent 修改实际 Module 工作记录或本地规格, 并在该记录唯一的 `## Comments` 末尾维护唯一的 `### Downstream changes`. 每个实际列表项记录当前仍有效的问题, 必要修改和用户授权. 被撤销或取代的旧修正应删除, 没有当前修正时唯一的空列表写法是 `- None.`. 普通评论始终放在这个末尾子章节之前.

修改完成后运行只读检查:

~~~text
arw module check-correction issue:0013:07
~~~

该命令比较 `HEAD` 和文件系统中的当前工作记录, 以及适用的已跟踪本地规格. 当前文件可以同时包含已暂存和未暂存修改. 检查要求至少一个受保护内容真实变化, 关联未变, `Downstream changes` 已变化且包含至少一个当前实际条目.

命令只检查结构和变化范围. 它不判断问题是否真实, 是否获得授权, 或列表项是否完整解释修改, 也不会写文件或改变 Git 暂存区. 检查失败时根据诊断修正文件并重跑, 然后再进入普通差异审核和提交.

## 同步已经发布的 Module 结果

每个 Module 完成阶段性工作并把提交推送到配置的分发分支后, Application Leader 才能取得可共享的状态. 同步前, 每个已配置 Module 的工作树和 Git 暂存区必须没有变化, 当前分支必须等于 `application.submoduleDistributionBranch`.

在 Application Repository 中运行:

~~~text
arw application sync
~~~

命令总是处理全部配置 Module 和全部 Application Source Issue, 不能只选一个子集. 它显式获取 `submoduleRemote/submoduleDistributionBranch` 的远端状态, 再根据每个 Module 的本地和远端关系继续:

| 观察到的关系 | 结果和下一步 |
| --- | --- |
| 本地等于远端 | 保持当前 Module, 继续检查下一个. |
| 本地落后远端 | 只执行 fast-forward 快进, 并验证最终 `HEAD` 等于远端末端. |
| 本地领先远端 | 停止. 审核本地提交, 取得推送授权并发布后重试. |
| 本地和远端分叉 | 停止. 先决定并完成 Git 历史整理, 再重试. |
| 获取远端, 快进或最终验证失败 | 保留已确认结果, 修复失败原因后从当前状态重试. |

如果较早的 Module 已经快进, 后续 Module 才失败, 已完成的快进会保留, Application 中相应 gitlink 也可能先显示变化. 命令不会向后移动这些 Module. 只有全部 Module 都到达配置远端末端后, 才开始更新 Application Source Issue.

更新时, 每个 Module 工作记录的当前 `Status:` 原样镜像到对应 Application Source Issue, 包括非终态的前进或回退, `completed` 和 `wontfix`. Module 中当前完整的 `Downstream changes` 同样替换 Application 侧旧列表; Module 没有当前条目时, Application 侧写入 `- None.`. 普通 Application 评论保留在该末尾子章节之前. 同步不复制 Module 的普通工作日志或验证证据, 也不根据下游修正自动改变 Application 规格或完成资格.

所有 Application Source Issue 替换先完整验证, 任一关联或列表结构问题都会在文件替换前阻断整批修改. 文件事务以 Application Git 暂存区中的字节为恢复基线, 成功后工作记录替换和已快进 Module 形成的 gitlink 都保持未暂存, 暂存区不变. 审核这批结果后, 再通过普通提交工作流保存 Application 状态.

如果 Application 文件写入开始后失败, 命令会报告已完成的写入和每项恢复结果. 全部恢复成功时, Application 文件回到暂存区基线; 恢复不完整时, 先比较列出的路径和暂存区. 已完成的 Module 快进及 gitlink 变化不会被这个文件事务撤销.

## 完成 Application 级验证并更新 JIRA

同步结果说明各 Module 已经发布什么, 但还不能证明组合后的产品结果正确. 每个包含 Application Source Issue 的工作组都必须在 `spec.md` 中指定唯一的本地 Application validation issue:

~~~text
Application validation issue: 02
~~~

这份记录是 Application 仓库中没有分发的普通实施工作记录. 它的 `Blocked by` 包含同一工作组的全部其他工作记录, 因此只有其他工作都进入 `completed` 或 `wontfix` 后才开始. Application validation issue 自身必须以 `completed` 结束; `wontfix` 不能使整个工作组完成.

先运行 `arw application sync` 并审核镜像后的状态和 `Downstream changes`, 再执行 Application validation issue 要求的整体集成验证, 把少量必要证据保存在这份本地工作记录中. `Downstream changes` 帮助 Application Leader 判断是否需要新的上层工作, 但它本身不是额外完成条件.

完成 JIRA 前, 已批准的完整工作组和验证证据必须已经提交并推送, 使当前分支的 upstream 包含 `HEAD` 中完全相同的工作组目录树. Agent 会再次展示准确的已暂存路径, upstream, JIRA 键, 完整完成评论和目标状态, 并为这组准确的提交, 推送和 JIRA 写入取得明确授权.

提交和推送完成后运行:

~~~text
arw jira complete spec:0007
~~~

命令不会自动运行 `arw application sync`, 提交或推送. 它从已提交配置和工作组文件重新计算完成资格, 再验证实时 upstream 中的工作组目录树. 符合条件后, 它先创建准确完成评论, 再把 JIRA 从 `acceptedStatus` 推进到 `completedStatus`, 最后重新确认评论和状态都已存在.

成功后, Module 仓库仍拥有各自实施和证据, Application 工作组拥有整体要求和验证证据, JIRA 拥有已发布结果的接收与完成状态. 这三个层次各保留自己的事实, 不需要手工复制状态.

## 从最后一个已确认结果继续

跨仓库 Git 和 JIRA 操作不能依靠一次通用回滚恢复. 已经成功的提交, 推送, Module 快进, JIRA 评论或状态转换都会保留. 失败后先确定最后一个可确认结果, 再从第一个未完成步骤向前继续:

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

新的提交, 推送, JIRA 写入或破坏性恢复仍需要相应授权. 候选字节, upstream 或 JIRA 目标发生变化时, 先重新取得授权, 再继续.

本手册保存完成这条新手路线所需的操作和结果. 准确字段, 完整长期行为及全部边界由 [多个仓库与 JIRA 同步的长期规格](../specs/agent-repository-workflow-application-jira/spec.md) 拥有; Agent 实际执行时还必须遵循当前仓库规则和 [`application-workflow` Skill](../../.agents/skills/application-workflow/SKILL.md).

# Agent Repository Workflow Application 与 JIRA 长期规格

## Terms introduced in this document

- **Canonical ID**: ARW 在命令和输出中用来唯一指向一个已登记工作记录的稳定标识符.
- **Application Sync Module**: 从已收敛 Module 的 issue 读取状态和当前下游改动, 并形成 Application Source Issue 替换内容的运行时 Module.
- **Module Correction Check Module**: 比较已关联 Module issue 和同 effort 本地 spec 的 `HEAD` 与当前工作树状态, 并只读判断获授权纠错是否满足机械边界的运行时 Module.

## Scope

本文定义 ARW 在 Application Repository 与 Module Repository 之间分发实施 issue, 汇总状态, 完成 Application 级验证, 并与一个 JIRA 项目同步 Story 接收和完成状态的长期行为.

本文拥有 Application Repository 配置的 Application 与 JIRA 字段, Application Leader 和 Application Member 在该工作流中的责任, `application-workflow` Skill 的触发与内容边界, Application Source Issue 的关联与冻结, 已关联 Module issue 的纠错检查, 子模块分支和远端收敛, JIRA 只读命令, JIRA 评论与状态转换收敛, 以及 Application effort 的最终完成条件.

总长期规格继续拥有普通仓库中的 issue, spec, effort 和 Git 工作流. 开发长期规格拥有通用 JSON 与版本化配置转换 Module. Installation 长期规格拥有全局 Engine 配置的版本升级和安装事务. 本文只说明这些能力如何服务 Application 与 JIRA 工作流, 不复制其通用实现合同.

## Application Repository and roles

Application Repository 管理一个 Application 的跨 Module 设计, 文档, 测试和 Git 子模块. Module Repository 管理 Application 中一个 Module 的实际产品代码与实施 issue. Application Repository 可以没有实际产品实现代码.

每个参与该工作流的仓库都具有 `application` 或 `module` 类型. 根 `arw.config.json` 中存在完整有效的 `application` 时, 仓库类型是 `application`, 并固定绑定 Application Leader 角色. 缺少 `application` 时, 仓库类型是 `module`, 并固定绑定 Application Member 角色. `application` 存在但无效时, 相关操作关闭式失败. 仓库类型和角色不根据 `multi-context`, 实际 Git 子模块, gitlink 或目录扫描推断. 这些角色只表示当前仓库上下文允许的操作, ARW 不验证调用者是否具有某个具体人员身份.

Application Leader 负责:

- 从配置 JIRA 项目发现候选 Story.
- 与 Agent 逐个讨论候选 Story, 并在用户授权后建立 Application effort 与 spec.
- 设计 Application issue, 为目标 Module 准备对应 spec 和实施 issue, 并建立双向关联.
- 提交并推送 Module 分发结果, 再提交 Application Source Issue 和 gitlink.
- 同步所有 Module 的已发布状态.
- 在全部实施工作进入终态后完成 Application 级验证.
- 提交并推送 Application 接收或完成状态, 再同步 JIRA 评论和状态.

Application Member 负责:

- 在一个 Module Repository 中实施普通实施 issue.
- 按普通治理流程维护工作记录, 验证证据和 issue 状态.
- 提交并推送 Module 实施结果, 使 Application Leader 能够读取远端上的真实状态.

Application Leader 不实施 Application Source Issue. Module 分发提交推送后, 双方记录使用不同的编辑边界:

| 记录与内容 | 编辑边界 |
| --- | --- |
| Application Source Issue 的关联, `## What to build`, `## Spec Requirement`, `## Acceptance criteria`, `## Blocked by` | 冻结, Application Leader 不直接编辑. |
| Module 实施 issue 的关联 | 绝对冻结. |
| Module 实施 issue 的对应 4 个章节, 以及同 effort 中现有且已由 Git 跟踪的本地 `spec.md` | 使用允许获授权纠错的软锁. 只有真实问题阻止既定实施范围继续时, 才可以纠正. |
| Module issue 的其他内容, 包括 `Status:`, `## Validation` 和普通评论 | 仍可按普通实施治理更新. |
| Application Source Issue 的 `Status:` 和当前 Downstream changes | 只由 `application sync` 从 Module 镜像, Application Leader 不直接编辑状态. |

需要纠正软锁内容时, Module Agent 先说明问题并取得用户对准确修改的授权, 再直接修改文件, 在 `## Comments` 下维护 `### Downstream changes`, 最后运行只读纠错检查.

Application Leader 仍可修改 Application spec, 在 Application Repository 中创建新的 issue, 并根据同步得到的下游改动另行决定是否需要上层工作.

## Application workflow Skill

`application-workflow` Skill Package 同时投影到 Application 与 Module 目标仓库. Application 工作只有在用户显式调用该 Skill 时才能加载. Codex 的 `agents/openai.yaml` 准确保存 `policy.allow_implicit_invocation: false`; Claude Code 的 `SKILL.md` 前置元数据准确保存 `disable-model-invocation: true`. Workflow Distribution 保留统一来源中的两个原生配置位置, 不转换前置元数据, Claude Code 投影继续排除 Codex 的 `agents/openai.yaml`. 不要求其他平台识别这两个调用配置.

主 `SKILL.md` 只说明适用环境, 授权边界和生命周期路由. 按需读取的参考文档分别拥有 Application 配置, 关联与 Module 分发, Application 同步, JIRA 接收, JIRA 完成和恢复方法. Skill 必须覆盖现有全部 Application, JIRA, 子模块协调, Git 发布, 验证和恢复操作, 但只提供工作方法, 不授予文件写入, 提交, 推送, JIRA 写入或其他外部操作权限. 需要用户触发或精确授权的既有步骤继续保持原合同.

普通 Application 操作要求当前仓库具有完整有效的 `application` 配置. 唯一例外是用户显式请求 Application 设置: Skill 可以在配置不存在的仓库提供初始设置指导并准备用户拥有的 `arw.config.json`, 但该请求不产生文件写入授权, 也不自动运行 `arw workflow init`. 无效 `application` 配置不适用该例外并继续关闭式失败.

目标仓库共享 Agent 规则不得包含 `arw jira`, `arw application`, 子模块协调, Git 发布或恢复的操作方法. 它只保留 Module 纠错的最小治理交接: 已关联 Module issue 的软锁出现真实阻塞时, Agent 先说明问题并请求精确用户授权, 然后直接读取本仓库 Skill 目录中名为 `application-workflow` 的 `references/module-correction.md`, 并只遵循 Module 纠错规则. 该规则不写平台路径, 不使用 `$` 或 `/` 前缀, 不把读取 Skill 文档解释为 Skill 调用. Source Checkout 专用验证规则可以继续保存 Application/JIRA 覆盖矩阵, 因为它不会投影到目标仓库.

## Repository application configuration

仓库配置文件是仓库根目录的 `arw.config.json`, 由 `lib/arw-common/` 的通用仓库配置模块统一负责读取, 校验和运行时转换. 本节只拥有 Application 字段语义. 它与 Engine 管理的 `arw-lock.json` 分离, 由用户拥有, 使用独立 `configVersion`.

当前 Application 配置结构是:

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
      "baseUrl": "http://172.17.80.222:31538/",
      "projectKey": "P20274",
      "issueType": "故事Story",
      "candidateStatus": "需求待办",
      "acceptedStatus": "需求开发中",
      "completedStatus": "上线成功"
    }
  }
}
~~~

通用仓库配置模块导出的 v2 规则对象使用以下准确字段顺序. `-` 表示不声明 `defaultValue`:

| 路径 | 必需 | 默认值 |
| --- | --- | --- |
| `configVersion` | true | `2` |
| `application` | false | - |
| `application.name` | true | - |
| `application.submoduleRemote` | true | `"origin"` |
| `application.submoduleDistributionBranch` | true | `"dev"` |
| `application.modules` | true | - |
| `application.jira` | true | - |
| `application.jira.baseUrl` | true | - |
| `application.jira.projectKey` | true | - |
| `application.jira.issueType` | true | `"故事Story"` |
| `application.jira.candidateStatus` | true | `"需求待办"` |
| `application.jira.acceptedStatus` | true | `"需求开发中"` |
| `application.jira.completedStatus` | true | `"上线成功"` |

`application` 是可以不存在且没有默认值的父路径. 它不存在时, 全部后代都不活动, 仓库是 Application Member. 它存在时, 后代的 `required: true` 要求字段在来源配置中实际存在; 默认值不修复缺失的必需来源字段. `modules` 作为数组叶字段处理, 条目的名称/路径结构由 v2 验证器检查. `application.jira` 是父路径, 没有自己的默认值.

只接受 v2, 其他版本明确失败, 不提供版本转换. v2 验证器是 Application 字段类型, Module 条目, 名称/路径, URL 和准确 JIRA 字串约束的唯一权威. 字段路径, 默认值, 顺序和转换静态一致性由通用仓库配置模块负责.

`application` 可以缺失. 一旦存在, `name`, `submoduleRemote`, `submoduleDistributionBranch`, `modules` 和 `jira` 都必须实际存在. `jira` 下的全部字段也必须存在. `modules` 可以是空数组.

Application 名称和 Module 名称使用 `^[a-z0-9][a-z0-9-]*$`. Module 路径使用安全的仓库相对路径, 使用斜杠分隔. Module 名称唯一, Module 路径唯一, 且任意两个 Module 路径不得相同或互相包含. 配置验证不要求路径当前已经是 gitlink.

`submoduleRemote` 的默认值是 `origin`. `submoduleDistributionBranch` 的默认值是 `dev`. 两者统一适用于所有配置 Module, 不描述 Application Repository 自身的远端或分支.

JIRA 项目只以 `projectKey` 标识. Application 配置不保存 JIRA 项目数字 ID. JIRA issue 类型与 3 个状态都是需要与 JIRA API 返回值严格相等的准确字串. 默认值为:

| 字段 | 默认值 |
| --- | --- |
| `issueType` | `故事Story` |
| `candidateStatus` | `需求待办` |
| `acceptedStatus` | `需求开发中` |
| `completedStatus` | `上线成功` |

`baseUrl` 必须是绝对 HTTP 或 HTTPS URL. 它不允许用户信息, 查询参数或片段, 可以包含路径. ARW 在内存中统一末尾斜杠, 不因格式规范化回写用户配置.

用户在第一次 `workflow init` 前创建完整 `arw.config.json`. 初始化不提问, 不推断 Application, 不生成配置模板. Application Member 仓库没有该文件时, `workflow init` 和 `workflow update` 不创建只包含 `configVersion` 的空配置. 用户创建的完整 Application 配置与升级形成的目标配置都显式包含当前默认字段.

`workflow init` 和 `workflow update` 是仓库配置版本转换的唯一写入时机. 它们把已存在配置的验证或转换放入同一计划和事务, `--dry-run` 显示同一转换计划. 这两个操作不读取 `JIRA_ACCESS_TOKEN`, 不调用 JIRA, 也不通过远端, 分支或实际 Git 子模块状态补充配置验证.

`workflow verify` 只读检查配置版本, 声明字段, Application 验证器约束, 以及由有效 `application` 决定的 Application Leader 或 Application Member 身份. 它不转换或写入配置, 不读取令牌, 不调用 JIRA, 也不检查配置远端, 当前分支或真实子模块.

## Global JIRA display configuration

Engine 安装目录的全局 `config.json` 保存 JIRA 列表显示限制:

~~~json
{
  "jira": {
    "listLimit": 50
  }
}
~~~

`jira.listLimit` 是十进制正安全整数, 默认值为 50. `arw jira list --limit <N>` 接受相同数值范围并覆盖全局值. ARW 不规定更小的产品级上限.

全局配置的持久版本, v1 到 v3 升级, `reviewEditor` 和 `jira.listLimit` 默认值, 未知字段保留与安装事务由 Installation 长期规格拥有.

## JIRA credentials and request boundary

所有 JIRA REST 命令从当前进程读取非空 `JIRA_ACCESS_TOKEN`, 并使用 Bearer 认证. 令牌不得写入 `arw.config.json`, `config.json`, 锁文件, spec, issue, 评论, 日志或错误.

`arw jira open` 不调用 REST, 不需要令牌. 其他 JIRA 命令在令牌缺失时于网络请求前失败. ARW 不读取操作系统凭据存储, 不提供用户名密码或 Basic 认证模式.

每个 REST 请求的超时是 10 秒. ARW 不自动重试. 重定向不得继续携带令牌, 并作为请求失败处理.

安全错误提供请求方法, 相对端点, HTTP 状态, JIRA `errorMessages` 与 `errors`. 它不输出令牌, Authorization 请求头, 完整请求头或原始 HTML 响应.

## JIRA discovery

### Public commands

JIRA 命令是:

- `arw jira list [--limit <N>]`
- `arw jl [--limit <N>]`
- `arw jira print <issue-key>`
- `arw jira open <issue-key>`
- `arw jo <issue-key>`
- `arw jira accept <spec-id>`
- `arw jira complete <spec-id>`

所有公开 JIRA 命令都要求当前仓库拥有有效 Application 配置. `jl` 是 `list` 的准确别名. `jo` 是 `open` 的准确别名. `print` 和 `open` 把 JIRA issue 键作为不透明字符串, 要求它非空, 没有首尾空白字符或控制字符, 但不预先限制它所属项目或使用严格键语法. 标识符进入 REST 端点, 浏览页面 URL 或元数据 URL 时使用 `encodeURIComponent` 编码为一个路径段; `/`, `?` 或 `#` 不得改变 URL 结构. `list`, `accept` 和 `complete` 必须限定或重新验证配置项目. `open` 的例外只是不调用 REST 和不读取令牌, 它仍从 Application 配置取得 `baseUrl`.

选择不透明键加路径段编码, 优先兼容不同 JIRA 部署返回的真实键, 同时固定 URL 结构. 代价是一个语法非标准但安全编码的键仍可能由 JIRA 服务器拒绝. 严格客户端语法会在访问服务器前拒绝服务器可能接受的身份, 直接插值又会让保留字符改变端点, 因而都不采用.

### Listing candidate Stories

`list` 构造严格匹配配置 `projectKey`, `issueType` 和 `candidateStatus` 的 JQL, 并使用 `ORDER BY key ASC`. 它只取得一页:

- `startAt=0`.
- `maxResults` 使用 `--limit` 或 `jira.listLimit`.
- 它信任 JIRA 对项目, 类型, 状态和键顺序的返回, 不在客户端重复过滤或排序.

ARW 在输出 issue 行前显示 JIRA 返回的匹配总数, 并说明后续只显示按键排序的前 N 条. N 是本页实际返回的条目数量, 不是请求数量限制. 非空结果使用现有 ARW 对齐表格渲染器, 准确形状例如:

~~~text
Total matching issues: 32
Showing first 5 issues ordered by key.

Key          Title
-----------  ----------------
P20274-1643  First story
~~~

每行只有键与标题. 标题中连续空白字符和控制字符变成一个 ASCII 空格, 然后去掉首尾空白. 标题不截断.

空结果输出:

~~~text
Total matching issues: 0
No matching JIRA issues.
~~~

第一页请求失败时, 标准输出为空, 标准错误输出安全错误, 命令返回非零.

`list` 只是发现. 它不创建预留, 交接, 锁文件, 映射或 Agent 运行. Application Leader 先运行 `list` 判断是否存在候选. 确认存在后, Application Leader 让当前 Agent 运行同一命令. Agent 逐个 `print` 并与用户讨论转换.

### Printing issue details

`jira print` 取得指定 issue 的全部必要分页数据, 只有完整的规范化结果可用时才输出. 输出是 UTF-8, 使用两个空格缩进的易读 JSON, 以一个 LF 结束.

顶层字段使用以下准确顺序:

~~~text
key
url
project
issueType
status
summary
description
priority
reporter
assignee
labels
components
fixVersions
created
updated
comments
attachments
links
customFields
otherFields
~~~

核心标量缺失时为 `null`, 核心集合缺失时为空数组. `project` 是 `{key, name}`. `issueType`, `status` 和存在的 `priority` 都是 JIRA 返回的名称字符串, 缺失的 `priority` 为 `null`. `customFields` 与 `otherFields` 只输出非空字段, 其中 `null`, 空字符串, 空数组和空对象都是空值, `0` 与 `false` 不是空值. 两个集合按字段 ID 排序, 条目形状为 `{id, name, value}`.

JIRA 用户统一表示为 `{key, name, displayName}`. 报告人 `reporter`, 经办人 `assignee`, 评论作者, 附件作者, 以及 `otherFields` 中被 JIRA 结构标记为 `user` 的值都使用该结构. `labels`, `components` 与 `fixVersions` 输出排序后的字符串数组. `created` 和 `updated` 保留 JIRA 返回的准确日期字符串. 说明 `description` 与评论正文 `body` 保留 JIRA 返回的原始文本作为 JSON 字符串, 不把 JIRA 的维基标记转成 Markdown.

评论读取全部分页, 按 `created` 和 JIRA 评论 ID 升序排序, 只输出 `author`, `body` 与 `created`. 附件集合 `attachments` 只输出 `id`, `filename`, `mimeType`, `size`, `created`, `author`, `contentUrl` 和 `thumbnailUrl`, 不下载内容; 缺失缩略图时使用 `null`. 链接集合 `links` 输出 `id`, `type`, `direction`, `relationship`, 以及关联 issue 的键, URL, `summary` 和状态, 并按关联 issue 键, 再按链接 ID 排序. `print` 不请求变更历史 `changelog`.

任何后续分页请求失败都返回非零. 命令不输出不完整 JSON.

### Opening a JIRA page

`jira open` 与 `jo` 使用已规范基础 URL 和编码为单个路径段的 issue 键形成浏览页面 URL, 并请求默认浏览器打开. 它不验证 issue 是否存在, 不调用 REST, 不读取令牌.

浏览器成功启动时标准输出为空. 启动失败时标准错误包含目标 URL, 使用户可以手动打开. 不存在的 issue 由浏览器中的服务器响应处理.

## Converting a JIRA Story into an Application effort

真正转换前, Agent 重新读取 JIRA issue 并验证:

- issue 所属项目键与配置严格相等.
- issue 类型与 `issueType` 严格相等.
- issue 状态与 `candidateStatus` 严格相等.

一个 JIRA Story 对应一个 Application effort. Application effort 必须拥有一个 spec, 并在最终完成前至少拥有一个 issue. 第一次接收 JIRA Story 时允许 effort 只有 spec, 不要求已经创建所有实施 issue.

Agent 根据 JIRA 内容和用户讨论结果决定 effort 名称, spec 和 issue. ARW 命令不自动生成这些语义内容. Agent 先准备完整未暂存差异, 使新文件通过 intent-to-add 出现在比较中, 并等待用户对准确路径和字节的明确批准. 未取得批准时, 不暂存, 提交或写 JIRA.

Application spec 的 H1 后第一条元数据是:

~~~markdown
JIRA issue: [`P20274-123`](http://172.17.80.222:31538/browse/P20274-123)
~~~

元数据保存 JIRA 键与可点击 URL, 不保存 JIRA 数字 ID. ARW 不建立单独映射文件, 也不自动处理 JIRA 键变化.

Application spec 提交已推送后可以执行 JIRA 接收. 接收时 JIRA 只记录 Application 名称与 spec Canonical ID, 不记录 effort issue.

## Application and Module issue association

### Association input

`arw application associate <application-issue-id> <qualified-module-issue-id>` 建立 Application Repository 中一个 issue 与一个 Module 实施 issue 的一对一关联. 第一个参数是 Application Repository 本地 Canonical ID, 例如 `issue:0007:02`. 第二个参数是包含已配置 Module 名称的 Canonical ID, 例如 `issue:billing:0013:07`. 该命令没有短别名. 两侧 issue 都必须由 Agent 预先写好. 命令不生成 effort 名称, spec 或 issue 内容.

Application issue 与 Module issue 可以使用不同 Canonical ID. 同一个 Application effort 在同一个 Module 中的所有关联必须使用第一次关联确定的同一个 Module effort. 试图关联到该 Module 的另一个 effort 时失败.

关联前两个 issue 必须:

- 都是普通实施 issue.
- 使用完全相同的非终态 `Status:`.
- 保持各自现有规范要求, 治理输入和正文.

Module issue 的 `## Spec Requirement` 只使用其最近 Module Repository 内的治理输入. 如果确实没有治理设计, 它可以在用户按普通 issue 规则明确确认后使用准确的 `Not required`. Application Repository 的 spec 不成为 Module issue 的跨仓库治理输入.

允许的状态来自普通跟踪器非终态状态, 包括 `needs-triage`, `needs-info`, `ready-for-agent` 与 `ready-for-human`. `completed` 和 `wontfix` 不能关联. 关联操作不擅自推进或覆盖状态. 状态行只在围栏代码外识别.

### Association output

成功后 Application Source Issue 的关联行紧接 `Status:` 且中间没有空行:

~~~markdown
Status: ready-for-agent
Module implementation issue: `issue:billing:0013:07`
~~~

Module issue 使用相同位置规则:

~~~markdown
Status: ready-for-agent
Application source issue: `issue:payments:0007:02`
~~~

关联值准确使用 `issue:<application-or-module-name>:<effort-number>:<issue-number>`. Application 或 Module 名称保留现有的不含冒号的小写 slug 语法, effort 和 issue 使用固定宽度数字身份, 因而关联值不增加转义规则. 旧关联格式从未发布, 不提供迁移或兼容路径.

恰好一个语法有效的 `Module implementation issue:` 使 Application Repository 中的 issue 成为 Application Source Issue. 关联前它只是普通实施 issue, 不存在 `not-distributed` 或其他占位字段. 关联后 Application Source Issue 是独立 issue 类型, 不再是实施 issue. `Application source issue:` 只记录 Module issue 的来源关联, Module issue 始终保持普通实施 issue, 不增加类型字段. 两种关联字段在同一 issue 中互斥. 任一关联字段位置错误, 重复, 值格式错误或与另一种字段并存都使 issue 解析失败, 不得降级成普通实施 issue.

### Blocker projection

Application issue 保留完整 Application 阻断关系图. Module issue 只保留本地跟踪器能够解释的阻断问题:

- 同一个 Module effort 中的阻断问题变成普通本地 issue 编号.
- 跨仓库阻断问题变成 External dependency.

External dependency 的准确形式是:

~~~markdown
- External dependency: `issue:<application-or-module-name>:<effort-number>:<issue-number>` - non-empty description.
~~~

它出现在 `Blocked by` 章节, 由 issue 解析器识别为信息项, 但不进入本地阻断关系图. 说明必须非空, 说明 Module 实施者仍需等待的外部工作.

如果 Application 阻断问题已经关联到另一个 Module 实施 issue, External dependency 坐标指向实际承担实施的 Module 名称和 Module issue Canonical ID. 如果阻断问题仍是 Application Repository 中未关联的普通实施 issue, 坐标使用 Application 名称和该 Application Repository issue 的 Canonical ID. 同一个 Module effort 内的已关联阻断问题继续使用普通本地 issue 编号.

跨仓库阻断问题选择 External dependency, 而不是在 Module 中复制一个虚假的本地阻断问题或复制 Application Repository 中对应的 issue. 该选择优先保留实际工作归属和单一正文权威, 代价是 External dependency 不进入 Module 本地阻断关系图, Module 实施者需要根据说明等待外部工作. 复制 issue 会产生独立状态和正文漂移, 因而不采用.

后续关联可以检查多个配置 Module 中仍未提交的关联 issue. 如果新关联使两个 issue 现在属于同一个 Module effort, 命令可以把早期 External dependency 改成普通本地阻断问题.

仓库 `HEAD` 中已经包含有效关联字段的 Application Source Issue 或 Module issue 是 `associate` 的已提交输入, 不可改写. 如果后来发现需要表达新的依赖, Application Leader 创建新 issue, 并在新 issue 中用正常阻断问题或文字说明. 不解冻旧 issue.

### Working-tree transaction

`associate` 不提供 `--dry-run`, 不运行 `git add`. 开始前, Application effort 目录和所有相关 Module effort 目录都必须没有未暂存或未跟踪内容. 暂存区可以干净, 也可以保存 Agent 已准备的已暂存基线.

命令以各仓库暂存区字节作为恢复基线, 先完成全范围分析, 再写工作树. 成功后全部变更保持未暂存. Agent 审核完整结果后, 按受影响 effort 分别暂存.

任何失败都恢复工作树到调用前暂存区字节, 暂存区不变. 如果恢复本身不完整, 命令报告每个受影响仓库的最终文件状态, 不宣称原子成功.

## Distribution branch and commits

`associate` 和 Application 同步开始前, 所有配置 Module 当前分支必须严格等于 `submoduleDistributionBranch`. 任一 Module 不匹配时, 在业务写入前失败. Application Repository 自身分支不受此字段约束.

关联结果按以下顺序发布:

1. Agent 审核并暂存所有受影响 Module effort.
2. Agent 分别提交 Module 分发.
3. 在独立用户推送授权下, Agent 把每个 Module 提交推送到 `submoduleRemote/submoduleDistributionBranch`.
4. Agent 确认配置远端已包含这些提交.
5. Agent 按总长期规格中不属于当前仓库实施产物的轻量提交流程, 暂存并提交 Application Source Issue 和需要记录的安全 gitlink. Application/JIRA 工作流不增加另一套 gitlink 分类器或配对要求.

Module 分发提交已推送后, 两侧关联永久冻结. Application Source Issue 的交付目标, 要求, 验收条件和阻断项内容继续冻结. Module 实施 issue 的同类章节和同 effort 已跟踪 spec 改为前述精确授权下的软锁, 其他内容继续按普通实施治理更新. Application Source Issue 只有 `Status:` 和 `### Downstream changes` 可以由 `application sync` 镜像改变. Application spec 和新增 issue 不受冻结限制.

ARW 不持久化分发提交 ID 或文件哈希. 同步从当前 Module Git 状态重新计算事实. Application Repository gitlink 的准确提交值不参与 Module 提交已推送的证明.

## Module correction check

Module 分发提交已推送后, Module Agent 只有在 `## What to build`, `## Spec Requirement`, `## Acceptance criteria`, `## Blocked by` 或同 effort 本地 spec 的真实问题阻止既定实施范围继续时, 才能请求用户对准确修改的授权. `Application source issue:` 关联是硬锁, 不能修改或建议修改. 获得授权后, Agent 直接修改实际 issue 或 spec 文件, 把本次修改作为当前有效条目记录到 issue 的 `## Comments` 下 `### Downstream changes`, 并删除因本次修改被撤销或取代而失效的旧条目. 该工作不要求用户调用 `application-workflow` Skill; 共享 Agent 规则要求 Agent 读取该 Skill 的 Module 纠错文档以取得完整步骤.

公开只读命令是:

~~~text
arw module check-correction <local-module-issue-id>
~~~

参数必须是当前仓库中不带限定名称的本地 issue Canonical ID. 命令不要求 `application` 配置, 但目标必须是 `HEAD` 与当前工作树中都能按同一身份唯一解析的已发布实施 issue, 且当前具有语法有效的 `Application source issue:` 反向关联. 同 effort 本地 spec 只指目标 issue 所在 `.scratch/<effort>/spec.md`; 只有该准确路径已由 `HEAD` 跟踪时才进入检查, 命令不创建缺失 spec.

命令直接比较 `HEAD` blob 与文件系统中的当前文件字节. 它不把暂存区作为比较版本, 不要求暂存区等于 `HEAD`, 也不因目标 issue 或 spec 已有已暂存修改而失败. 工作树文件同时包含已暂存和未暂存修改形成的当前事实. 命令不写文件, 不生成候选, 不运行 File Transaction Module, 不运行 `git add`, 也不承担后续差异审核或暂存.

软锁是 Module issue 的 `## What to build`, `## Spec Requirement`, `## Acceptance criteria`, `## Blocked by` 和适用本地 spec 的完整内容. 计算 `## Acceptance criteria` 变化时, 只在 Markdown 围栏代码外把实际任务列表项开头的 `[x]` 与 `[X]` 规范为 `[ ]`; 单纯复选框完成状态变化不构成软锁变化. 硬锁只有准确的 `Application source issue:` 关联字段. 命令不为其余 issue 内容建立允许列表, 因而普通状态, 验证, 评论和其他实施内容可以在同一工作树中变化.

成功要求同时满足:

- 至少一个规范化后的软锁相对 `HEAD` 发生变化.
- 硬锁与 `HEAD` 完全一致.
- 当前 issue 有唯一且结构安全的 `### Downstream changes`.
- 该子章节相对 `HEAD` 发生变化.
- 当前子章节至少包含一个实际条目.

命令只能机械判断位置, 文档结构和变化范围. 它不判断自然语言是否证明真实阻塞或用户授权, 不判断条目是否在语义上覆盖本次修改, 也不判断自然语言是否建议另一个关联. Agent 治理继续负责这些要求.

合法调用使用 `status: "succeeded" | "blocked" | "failed"` 和始终存在的稳定 `diagnostics`. 纯检查按 issue 身份, 关联, 软锁变更, Downstream changes 位置, Downstream changes 内容的固定顺序聚合所有输入仍可判断的阻断问题; 同一类别按仓库相对路径和代码排序. 每项诊断信息使用稳定非空 `code`, `message` 和仅在适用时存在的 `path`. Git 或文件系统无法读取输入时返回 `failed` 与 `stage: "git-read" | "filesystem-read"`; 结构或变化条件不满足时返回 `blocked`; 两种结果都没有持久影响. 成功 CLI 准确输出 `Module correction check passed: <local-module-issue-id>.` 和一个 LF, 然后返回 `0`; 阻断问题或读取失败逐行向标准错误输出诊断信息 `message` 并返回 `1`; 用法错误返回 `2`.

纠错检查新增的稳定诊断信息代码是:

| Code | 条件 |
| --- | --- |
| `module-correction-issue-invalid` | `HEAD` 或工作树不能把参数唯一解析为同一个已发布实施 issue |
| `module-correction-association-invalid` | `HEAD` 或工作树 issue 没有一个语法有效的 Application 反向关联 |
| `module-correction-association-changed` | 硬锁相对 `HEAD` 变化 |
| `module-correction-soft-lock-unchanged` | 规范化后没有任何软锁变化 |
| `module-correction-downstream-unchanged` | Downstream changes 相对 `HEAD` 没有变化 |
| `module-correction-downstream-empty` | 当前子章节没有实际条目 |
| `module-correction-git-read-failed` | Git 不能读取 `HEAD` 输入 |
| `module-correction-filesystem-read-failed` | Filesystem 不能读取当前输入 |

`arw` 无参数用法说明增加准确的 `arw module check-correction <local-module-issue-id>` 行. 原有标准输出为空, 用法说明与 `A command is required.` 写入标准错误, 退出码 `2` 的合同不变.

### Downstream changes structure

`### Downstream changes` 最多出现一次, 必须属于唯一的 `## Comments`, 并且是该章节的最后一个子章节和最后一段受管理内容. 普通评论保留在它之前, 后续普通评论紧接在该子章节之前追加, 使它持续保持末尾位置. Module issue 缺少 `## Comments` 时, Agent 可以在文件末尾增加 `## Comments` 和该子章节; `check` 命令本身不增加它们.

`- None.` 是唯一空列表哨兵值. 它不能与实际条目混用. 每个实际条目以行首的 `- ` 开始, 并在同一行包含至少一个非空白字符. 条目后续的每个非空行必须以至少两个 ASCII 空格或一个制表符开始. 该规则允许缩进续行, 嵌套列表和围栏代码, 所以缩进围栏代码中的标题文字不划分子章节. 空行可以保留. 任何未缩进正文, ATX 标题, 其他顶层列表标记, 重复子章节或子章节后的额外 Comments 内容都使结构无效.

解析器在内存中把 CRLF 和 CR 规范为 LF 后判断结构, 不因检查而修改来源文件. 对 Application 同步, 缺失子章节, 空白子章节或唯一 `- None.` 都表示当前没有下游条目. 对 Module 纠错检查, 这 3 种状态都不能满足至少一个实际条目的要求.

Downstream Changes Document Interface 新增的稳定诊断信息代码是 `downstream-comments-duplicate`, `downstream-changes-duplicate`, `downstream-changes-position-invalid` 和 `downstream-changes-content-invalid`. 它们分别表示 Comments 不唯一, 子章节不唯一, 子章节不在规定末尾位置, 或哨兵值与列表项语法无效. 纠错检查和 Application Sync 原样使用这些代码与发生问题的仓库相对 `path`, 不为同一结构问题建立第二套代码.

## Submodule branch switching

`arw submodule switch-branch <branch>` 和 `arw ssb <branch>` 同时切换全部配置 Module, 不切换当前 Application Repository. 当前仓库没有 `application` 配置, 或 `application.modules` 是空数组时, 命令都不执行 Git 操作, 成功并说明没有配置 Module.

切换前:

- 每个 Module 工作树和暂存区必须完全干净.
- 命令对所有 Module 完成分支写入前检查.
- 命令不获取远端引用.
- 已存在本地分支时使用它.
- 本地分支不存在时, 只有 `submoduleRemote/<branch>` 存在才创建跟踪远端的本地分支.

任一写入前检查失败时零切换. 实际切换失败时, 命令按相反顺序尝试恢复已经切换的 Module 到原分支和 HEAD. 如果恢复失败, 结果准确列出全部配置 Module 的最终分支与 HEAD, 不隐藏部分状态.

## Application status and downstream synchronization

`arw application sync` 始终处理全部配置 Module 和全部 Application Source Issue. 它不提供 issue 或 Module 子集参数, 也不关心 Application Repository 自身的分支, 远端, 上游, 拉取或推送.

### Module convergence

开始前每个配置 Module 必须:

- 工作树与暂存区完全干净.
- 当前分支等于 `submoduleDistributionBranch`.

同步使用 `submoduleRemote` 与 `submoduleDistributionBranch` 显式取得远端分支末端, 不依赖本地分支的上游配置. 分支关系和操作结果决定后续处理:

| 分支关系或操作结果 | 处理 |
| --- | --- |
| 本地落后 | 只允许快进拉取, 并要求最终本地 HEAD 等于远端分支末端. |
| 本地超前 | 失败. Agent 可以另行获得用户的推送授权, 推送本地提交后重试. |
| 本地与远端分叉 | 失败. |
| 获取, 拉取或最终等值验证失败 | 失败. |

如果早期 Module 已经成功快进, 但后续 Module 失败, 已经完成的拉取保留. 在全部 Module 都收敛前, 同步不修改任何 Application Source Issue.

保留已完成的快进, 是为了让每个 Module 工作树忠实保留已经确认的远端状态, 并让重试继续向前. 代价是一次失败的同步可以先在 Application Repository 留下部分 gitlink 变化. 反向移动已经收敛的独立 Module HEAD 可能覆盖并发观察或制造第二套 Git 回滚政策, 因而不采用. Application Source Issue 文件使用下面单独定义的全量写入与恢复边界.

### Status and downstream mirroring

全部 Module 收敛后, 同步读取每个关联 Module issue 的当前 `Status:` 和完整 Downstream changes, 验证双向规范关联, 再更新 Application Source Issue.

状态原样镜像, 不使用映射. 状态行只在围栏代码外识别. 非终态推进, 非终态回退, `completed` 与 `wontfix` 都可以从 Module 同步到 Application. Application Leader 不通过本地编辑改变 Application Source Issue 状态.

原样镜像优先让 Module 实施 issue 保持唯一状态权威. 代价是 Application Source Issue 可以随 Module 状态回退, 也不能保存 Application Leader 的独立覆盖值. 维护 Application 到 Module 的状态映射或第二套 Application 状态会复制生命周期事实并产生漂移, 因而不采用.

每个 Application Source Issue 在 `## Comments` 下最多有一个 `### Downstream changes`. 已有子章节必须位于 Comments 末尾, 其后不能有普通评论或其他子章节. 目标没有该子章节时, 同步把它插入现有 Comments 末尾; 目标没有 Comments 时, 同步在 issue 末尾增加 `## Comments` 和子章节. 普通 Application 评论保留在子章节之前, 后续普通评论同样紧接在该子章节之前追加.

每次同步以 Module 当前完整条目为唯一来源, 删除 Application 侧旧条目并写入新的完整条目. Module 来源缺失, 空白或只有 `- None.` 时, Application 侧准确写 `- None.`. 非空条目使用解析后的 LF 表示原样复制, 不增加来源说明, Canonical issue ID, 提交范围, Downstream changes 基线, 游标或其他元数据. Application Source Issue 已有关联足以表达来源身份. 这里不建立同步基线, 但不改变后续 Application 文件事务使用暂存区字节作为恢复基线的既有合同.

Downstream changes 只通知 Application 当前仍有效的下游修正. 同步不根据这些条目创作或修改 Application spec, `## What to build`, `## Spec Requirement`, `## Acceptance criteria`, `## Blocked by` 或关联, 也不把它们加入 JIRA 接收或完成资格. Application Leader 读取同步结果后另行决定是否建立上层工作.

Application Sync Module 在内存中解析全部关联 Module 和 Application 来源 issue, 聚合全部诊断信息后才返回替换内容. 任一双向关联不匹配, 重复映射, 重复或位置错误的子章节, 不安全列表或 issue 解析阻断问题都返回 `blocked` 和零替换内容. 诊断信息按 `path ?? ""`, `code`, `message` 的升序稳定排列. 成功替换内容按 Application 路径排序, 同时反映需要变化的状态和 Downstream changes; 两者都未变化的 issue 不产生替换内容.

Submodule Coordination 把每个 Module 工作树收敛到该 Module 的远端末端, 因而 Application Repository 观察到对应 Module HEAD 的 gitlink 变化. 这些已经完成的 Module HEAD 变化不属于 Application 文件事务, 后续 Module 失败时与已经完成的拉取一起保留.

Application 文件写入按以下顺序进行:

1. 全部 Module 收敛后, Application CLI 要求每个 Application Source Issue 的工作树字节等于该路径的暂存区字节. 暂存区字节同时作为每个替换操作的预期状态和恢复基线.
2. 在任何写入前形成全部替换操作, 调用 File Transaction Module 完成全量写入前检查.
3. 一次应用全部操作. 写入前检查或应用时状态重验存在阻断问题时, 保证零 Application 写入.

文件写入开始后失败, 返回准确失败阶段, 按原顺序列出的已完成操作, 以及 File Transaction Module 按反向顺序形成的每个 `{path, status: "restored" | "failed"}` 回滚结果. 命令把诊断信息和回滚结果输出到标准错误并返回非零, 不把回滚失败表示为原子成功. 最终状态如下:

| Application 文件操作结果 | 工作树结果 |
| --- | --- |
| 写入成功 | Application Source Issue 替换和 Module HEAD 形成的 gitlink 变化都保持未暂存. |
| 写入失败, 全部回滚成功 | Application 文件恢复到暂存区字节; 已完成的 Module 拉取和 HEAD 变化保留. |
| 写入失败, 任一回滚失败 | 结果准确暴露仍需人工恢复的路径; 已完成的 Module 拉取和 HEAD 变化保留. |

Application 暂存区始终不变.

同步不创建工作记录或证据. 这些信息保留在 Module issue.

## Application validation and completion

每个包含 Application Source Issue 的 Application effort 必须在 spec 中准确声明一个 Application 验证 issue:

~~~markdown
Application validation issue: 05
~~~

值只包含当前 effort 的 issue 编号. 该 issue 必须是未分发的普通本地实施 issue, 并且是 effort 中唯一 Application 验证 issue.

Application 验证 issue 的 `Blocked by` 必须包含 effort 中全部其他 issue, 无论它们是 Application Source Issue 还是普通本地实施 issue. 它是依赖图中的最后一个 issue, 但不要求使用最大 issue 编号.

验证工作在所有依赖进入终态后进行. Application Leader 优先在本地构建完整产品运行环境, 也可以在服务器环境构建. 验证可以由确定性程序, Agent 或用户操作完成. Issue 按普通实施治理记录工作过程和少量证据.

ARW 不为 effort 持久化独立状态. 每次判断完成资格时, 都从本次读取的当前 Application spec 声明和全部 issue 状态重新计算. Application 验证 issue 的普通工作记录与证据保存实际验证事实, 不增加提交 ID, 文件哈希或另一份 effort 完成状态.

一个关联 JIRA 的 effort 只有在满足以下全部条件时才能完成:

- effort 至少存在一个 issue.
- 除 Application 验证 issue 外, 全部 issue 都进入终态: 实施 issue 为 `completed` 或 `wontfix`, Wayfinder issue 为 `resolved`.
- Application 验证 issue 的状态准确为 `completed`.

Application 验证 issue 为 `wontfix` 时, effort 不能完成. Application Source Issue 本身不执行实施 Spec Readiness, Validation 或 Commit Audit, 不保存 Module 证据. Application 验证 issue 作为普通本地实施 issue 执行适用治理.

## JIRA acceptance and completion

### Git and authorization precondition

`jira accept <spec-id>` 只读取已提交 HEAD 中的 Application spec. `jira complete <spec-id>` 只读取已提交 HEAD 中的 spec 与 effort issue. 两个命令都不隐式运行 `application sync`.

命令忽略工作树与暂存区, 不要求整个 Application Repository 干净. 它们获取当前 Application 分支的真实远端跟踪上游, 并比较本地 HEAD 与实时上游末端中由 spec Canonical ID 解析出的完整 `.scratch/<NNNN>-<effort-slug>` 树. 准确树相等才证明用于 JIRA 写入的 effort 已提交并推送.

无关路径上的提交不影响证明. Application gitlink 不进入 effort 树比较.

Application 提交, Application 推送和对应 JIRA 写入使用一次明确用户授权. Agent 在请求该授权时列出:

- 准确已暂存 Application 候选.
- 当前分支的上游.
- JIRA issue 键.
- 阶段.
- 完整评论正文.
- 目标状态.

Git 提交与推送始终由 Agent 执行, 不由 `jira accept` 或 `jira complete` 执行. 如果后续步骤失败, 已成功的提交, 推送, 评论或状态转换保留. Agent 从第一个未完成步骤向前恢复. 只有候选字节, 上游或 JIRA 目标改变时, 原授权才失效.

### Deterministic comments

接收评论的准确正文是:

~~~text
ARW synchronization
Phase: accepted
Application: payments
Spec: spec:0007

此 JIRA issue 已被上述 application repository 接收.
~~~

完成评论的准确正文是:

~~~text
ARW synchronization
Phase: completed
Application: payments
Spec: spec:0007

该本地 effort 已完成产品级验证.
~~~

Application 与 Spec 值来自已验证的已提交 Application 配置和 spec. 评论不包含 issue 列表, JIRA 数字 ID, 提交 ID 或文件哈希.

评论身份使用完整正文字节内容, 不使用作者. 查找先请求最新 10 条评论. 找不到时继续向旧分页获取, 直到找到或穷尽全部评论.

### State convergence

`accept` 的来源状态是 `candidateStatus`, 目标是 `acceptedStatus`. `complete` 的来源是 `acceptedStatus`, 目标是 `completedStatus`.

写入前, 命令重新读取 issue 并验证项目键与 issue 类型. 当前状态必须是准确来源或目标. 如果两者都不是, 命令失败且不写评论.

命令在写评论前读取可用状态转换:

- 当前状态已是目标时, 不需要状态转换.
- 当前状态是来源时, 必须至少存在一个准确进入目标状态的状态转换.
- 存在多个准确状态转换时, 使用 JIRA API 返回的第一个.
- 没有准确状态转换时, 在评论写入前失败.

收敛时先补充评论, 再转换状态. 根据当前准确评论和状态, 执行以下动作:

| 准确评论 | 当前状态 | 写入动作 |
| --- | --- | --- |
| 已存在 | 目标 | 不重复添加评论, 不转换状态. |
| 缺失 | 目标 | 只添加评论. |
| 已存在 | 来源 | 只执行状态转换. |
| 缺失 | 来源 | 先添加评论, 再执行状态转换. |

写入后命令重新读取最终状态, 并重新按最新 10 条再向较早分页的方式完整查找评论. 只有准确评论存在且状态是目标时成功. 成功时标准输出使用一行准确摘要, 例如:

~~~text
JIRA synchronization: issue=P20274-123 phase=accepted comment=created status=transitioned
~~~

`phase` 是 `accepted | completed`, `comment` 是 `created | existing`, `status` 是 `transitioned | existing`.

这套协议不承诺跨 JIRA HTTP 请求的数据库事务. 它通过可观察的幂等收敛和向前重试处理评论成功但状态转换失败等中断.

## Module Design

### Modules

- 通用仓库配置模块解析并验证仓库 `arw.config.json`, 产生 Application Member 或完整 Application Leader 上下文. 它也导出该配置格式的版本规则.
- JIRA Client Module 负责安全 REST 请求, 超时, 错误规范化, 分页, issue 详情规范化, 评论查找和状态转换发现. 它不读取 Git 或跟踪器.
- JIRA Presentation Module 把 `list` 与 `print` 的规范值转换为准确标准输出字节. 它不发网络请求.
- Application Association Module 解释 Application Repository 中的 issue, Module issue 和阻断项投射, 并生成全部相关替换字节.
- Submodule Coordination Module 负责分支写入前检查, 切换回滚, 远端获取, 快进收敛与作为 Application gitlink 的权威值的每个最终 Module HEAD. 它不解释 issue 状态.
- Module Correction Check Module 接受同一个已关联 Module issue 的 `HEAD` 与工作树快照, 以及同 effort 已跟踪 spec 的可选快照对, 只读判断软锁, 硬锁和 Downstream changes 的机械条件.
- Application Sync Module 验证双向关联, 从收敛后的 Module 快照计算 Application Source Issue 状态与 Downstream changes 替换内容.
- Application Completion Module 从已提交 Application effort 计算接收与完成资格.
- Application JIRA Workflow Module 组合 Git 上游证明, 完成结果, JIRA Client 和评论/状态收敛. 它不执行 Git 提交或推送.

### Interfaces

本节的 Module Interface 对合法调用使用封闭结果. 成功返回 `status: "succeeded"`, 空 `diagnostics` 和该 Interface 的完整成功载荷. 当前状态, 配置或语义前置条件不允许继续时返回 `status: "blocked"` 和完整稳定 `diagnostics`, 不返回可写入的部分替换内容. 外部 Git, HTTP, Browser 或文件系统操作失败时返回 `status: "failed"`, 准确 `stage`, 已经发生或仍不确定的影响, 以及安全 `diagnostics`. 每项诊断信息包含稳定非空 `code`, `message` 和仅在适用时存在的 `path`. 没有外部依赖的纯 Interface 不返回 `failed`. 无效调用形状抛出 `TypeError`, 实现缺陷继续抛出普通异常.

通用仓库配置 Interface 接受仓库根目录与已解析仓库配置 JSON. 成功的 `context` 是 `{role:"member"}` 或包含规范 Application 名称, Module 映射, 子模块政策和 JIRA 政策的 `{role:"leader"}`. 无效配置返回 `blocked` 且不返回上下文.

JIRA Request Interface 接受请求方法, 规范基础 URL, 相对端点, 可选查询参数和可选 JSON 正文. 成功返回解析后的 JSON `value` 和响应元数据. HTTP 状态, 超时, 重定向, 响应解析或传输失败返回 `failed`, `stage: "request" | "response"` 和安全诊断信息, 不返回部分值. 令牌注入只存在于生产 HTTP Adapter.

JIRA List Interface 接受完整 Application JIRA 政策与数量限制, 成功返回 `total` 和一页已规范的 `key`/`title` 条目. JIRA Print Interface 接受已经验证的 issue 键, 取得完整分页后返回规范化后的顶层值. 两者都不直接写标准输出, 任一分页失败不返回部分条目或值.

Association Interface 接受 Application Repository 中的 issue 快照, 目标 Module issue 快照, 以及可能受阻断项规范化影响的全部未提交 issue 快照. 成功返回按仓库和路径分组的完整替换内容. 关联不匹配, 终态, 无效阻断项投射或其他语义阻断问题返回 `blocked`, 完整诊断信息且没有替换内容. 该纯 Interface 不读写文件. `application associate` 只把成功的完整替换内容交给公共 File Transaction Module; 事务失败和逐仓库恢复结果由该事务与命令调用方报告, 不把 I/O 失败伪装成 Association 阻断问题.

Submodule Switch Interface 接受配置 Module 集合与目标分支. 全体写入前检查阻断问题返回 `blocked`, 零切换和当时观察到的完整 `finalStates`. 成功返回全部 `finalStates` 和每个 Module 的 `changed`. 实际切换失败返回 `failed`, `stage: "switch" | "recovery"`, 全部最终分支/HEAD, 以及按反向恢复顺序排列的 `{module, status: "restored" | "failed"}` 恢复结果; 它不把恢复失败声明为原子成功.

Remote Convergence Interface 接受配置 Module 集合, 远端与分支. 清洁状态, 分支, 超前或分叉阻断问题返回 `blocked`, 不改变 Module 工作树, 并返回完整最终状态. 只有全部 Module 最终等于远端末端时, 成功才返回可供 Application Sync 消费的快照, 最终状态和按配置顺序排列的 `{module, action: "unchanged" | "fast-forwarded"}` 影响. 获取, 拉取或最终等值验证失败返回 `failed`, `stage: "fetch" | "fast-forward" | "final-verification"`, 全部最终状态和已经完成的影响; 之前已完成的快进保留且不得从结果中隐藏.

Downstream Changes Document Interface 接受一个完整 issue UTF-8 文本. 读取操作返回缺失, 为空或按来源顺序保存的完整实际条目; 替换内容操作接受规范 LF 条目内容, 在唯一 Comments 末尾替换或插入唯一子章节, 并返回完整 issue 字节. 它使用本文的严格列表语法, 保留受管理子章节外的字节, 对重复 Comments, 重复或位置错误的子章节, 哨兵值混用和不安全条目边界返回 `blocked` 与完整诊断信息, 不返回部分条目或字节. 无效参数形状抛出 `TypeError`; 该纯 Interface 不返回 `failed`.

Module Correction Check Module Interface 接受同一 issue 身份的 `HEAD` 与工作树快照, 以及可选的同 effort 已跟踪 spec 对. `succeeded` 只返回空诊断信息, 不返回替换内容. Association 硬锁变化, 无有效软锁变化, Downstream changes 未变化, 缺失实际条目或文档结构无效时返回 `blocked` 与按本文固定类别排序的完整诊断信息. 该纯 Interface 不读取 Git, 文件系统或暂存区, 不解析自然语言授权, 也不返回 `failed`.

Application Sync Interface 接受 Application 快照和包含最终 Module HEAD 的已收敛 Module 快照. 成功返回按路径排序的完整 Application Source Issue 替换内容, 每个替换内容同时包含需要镜像的状态与 Downstream changes, 不复制或生成 gitlink 值, 也不直接暂存. gitlink 变化已由 Submodule Coordination 对 Module 工作树的收敛形成. 关联不匹配, 解析失败, 不安全的 Downstream changes 或重复映射返回 `blocked`, 按 `path ?? ""`, `code`, `message` 排序的完整诊断信息, 且没有任何替换内容.

Application Completion Interface 接受已提交配置, spec 与 issue. 成功返回接收与完成资格, JIRA 键, Application 名称和 spec Canonical ID. 不完整 effort 是成功的 `eligible: false` 判断, 不是 Interface 失败. 无效已提交输入返回 `blocked`. 该 Interface 不读取状态转换.

JIRA Convergence Interface 接受 issue 键, 项目与类型政策, 阶段, 准确评论, 来源状态与目标状态. 写入前检查项目, 类型, 状态或状态转换阻断问题返回 `blocked` 且保证评论和状态都未写. 成功返回 `commentAction: "created" | "existing"` 和 `statusAction: "transitioned" | "existing"`. HTTP 或写入后验证失败返回 `failed`, `stage: "issue-read" | "comment-read" | "transition-read" | "comment-create" | "transition" | "final-verification"`, `commentAction: "none" | "created" | "existing" | "unknown"`, `statusAction: "none" | "transitioned" | "existing" | "unknown"` 和安全诊断信息. 调用方从这些影响向前重试, 不推断跨请求回滚.

Git Upstream Proof Interface 接受 Application Repository 与 effort 路径. 它获取当前分支上游, 读取本地 HEAD 和实时上游末端中的准确 effort 树. 树相等返回 `succeeded`; 缺失上游或树不匹配返回 `blocked`; 获取或 Git 观察失败返回 `failed`, `stage: "fetch" | "tree-read"` 和诊断信息. 非成功结果不返回部分证明.

### Seams and Adapters

Git 是 Application 关联, Module 纠错检查, 子模块协调, 同步和 JIRA 上游证明的外部 Seam. 生产 Git Adapter 为纠错检查提供 `HEAD` 树字节, 并为其他流程提供分支, 引用, 获取, 快进与提交包含关系. 确定性 Git Adapter 通过同一 Interface 返回可控制的仓库状态, 影响和失败阶段. 业务 Module 不拼接命令解释器命令.

HTTP 是 JIRA Client 的外部 Seam. 生产 HTTP Adapter 使用原生 Node.js HTTP 能力. 确定性 HTTP Adapter 实现相同 JIRA Request Interface, 返回可控制的响应, 超时, 重定向, 传输失败和安全诊断.

Browser 是 JIRA `open` 的外部 Seam. 生产 Adapter 请求操作系统默认浏览器. 测试 Adapter 只记录 URL 或返回启动失败, 不打开 GUI.

Filesystem 与跟踪器解析通过现有 Repository, Filesystem, JSON 和 issue Interface. 纠错检查 CLI 从 Filesystem Adapter 读取实际工作树字节; Application Module 不绕过这些公共边界建立第二套路径或 Markdown 解析器.

用户授权, Agent 提交和 Agent 推送是调用工作流责任, 不是运行时 Adapter. ARW 命令只验证已经形成的 Git 与 JIRA 前置条件.

### Dependencies and Data Flow

~~~mermaid
flowchart LR
  RepositoryConfig[Repository Application config] --> ApplicationContext[通用仓库配置模块]
  GlobalConfig[Global jira.listLimit] --> JiraCli[JIRA CLI]
  ApplicationContext --> JiraCli
  Token[JIRA_ACCESS_TOKEN] --> JiraClient[JIRA Client Module]
  JiraCli --> JiraClient
  JiraClient --> JiraServer[JIRA project]
  ApplicationContext --> Associate[Application Association Module]
  Associate --> ModuleIssue[Module implementation issue]
  ModuleIssue --> Correction[Module Correction Check Module]
  ModuleSpec[Module effort spec] --> Correction
  ModuleIssue --> SubmoduleSync[Submodule Coordination Module]
  SubmoduleSync --> ApplicationSync[Application Sync Module]
  ApplicationSync --> ApplicationSource[Application Source Issue]
  ApplicationSource --> ApplicationValidation[Application validation issue]
  ApplicationValidation --> Completion[Application Completion Module]
  Completion --> JiraWorkflow[Application JIRA Workflow Module]
  JiraWorkflow --> JiraClient
~~~

权威来源和最终写入边界如下:

| 权威来源或状态 | 责任方 | 转换和使用方 | 失败, 恢复和最终写入点 |
| --- | --- | --- | --- |
| 仓库 `arw.config.json` | 用户拥有文件, 通用仓库配置模块唯一解释 Application 字段和 v2 规则 | Repository Workflow 在初始化与更新事务中转换; JIRA, 关联和同步只消费成功的 Application 上下文 | 无效配置在业务操作前阻断; 工作流事务使用自己的暂存区基线; 用户或工作流形成的普通 Git 提交保存最终仓库配置 |
| Engine `config.json` 中的 `jira.listLimit` | Installation 长期规格拥有格式, 升级和安装事务 | JIRA `list` 只读取成功升级后的全局值, 可选 CLI 数量限制只覆盖本次调用 | 无效或不可读配置在 JIRA 请求前阻断; Installation 事务是持久升级完成点 |
| 当前进程 `JIRA_ACCESS_TOKEN` | 启动进程的用户提供, JIRA Client 只在请求时读取 | 生产 HTTP Adapter 注入 Bearer 请求头, 其他 Module 和持久文件不接收令牌 | 缺失时零请求阻断; 重定向, 诊断信息或结果不得传播令牌; 操作结束后没有 ARW 持久写入点 |
| Application 与 Module 跟踪文档 | 各自最近 Git 仓库中的 issue 文件是正文权威, Module 实施 issue 是实施状态, 证据和当前 Downstream changes 权威 | Association 形成双向关联和阻断问题替换内容; Correction Check 比较 Module `HEAD` 与工作树; Application Sync 从已收敛 Module 快照镜像状态和 Downstream changes | Correction Check 零写入; Association 使用每个仓库暂存区基线恢复文件; Application 替换内容单独全有或全无; 用户审核后的对应仓库 Git 提交是文件完成点 |
| 配置 Module 的远端分支末端与本地 HEAD | `submoduleRemote/submoduleDistributionBranch` 取得的分支末端是已发布 Module 权威, Submodule Coordination 拥有本地收敛 | Remote Convergence 快进本地 Module, Application Repository 由 Module HEAD 自然观察 gitlink | 超前或分叉阻断; 已完成快进在后续失败时保留; Module 推送提交已发布实施状态, Application Git 提交保存观察到的 gitlink |
| Application Source Issue 替换内容 | 已收敛 Module issue 的 `Status:` 和当前 Downstream changes 是来源权威, Application Sync 拥有一对一镜像 | Application 文件事务验证完整替换集合后统一写工作树 | 任一关联, 解析或 Downstream changes 阻断问题产生零替换内容; 文件失败按事务结果恢复 Application issue 到暂存区; Application Git 提交保存镜像结果 |
| Application effort 完成 | 已提交 Application 配置, spec 和完整 effort issue | Application Completion 每次重新计算资格, Git Upstream Proof 再比较实时上游 effort 树 | 无效或不完整输入不写 JIRA; Application 验证 issue 的普通 Git 提交保存验证证据, Application 推送形成 JIRA 写入前置条件 |
| JIRA issue, 评论和状态 | 实时 JIRA 服务器是外部权威 | JIRA Client 读取规范状态, Application JIRA Workflow 按评论优先顺序收敛评论/状态组合 | 已成功评论或状态转换不回滚; 失败结果保存可观察影响并向前重试; JIRA 服务器接受对应请求是每项外部写入完成点 |

### Module Design Rationale

通用仓库配置模块独立于普通锁文件, 因为 Application 名称, Module 列表和 JIRA 项目是用户拥有的仓库事实, 而 Managed Content 归属是 Engine 派生状态. 通过一个规范 Application 上下文让 JIRA, 关联与同步共用同一输入, 可以避免每条命令重新解释 JSON.

JIRA Client 与 Application JIRA Workflow 分离, 因为前者解释外部 REST, 分页与状态转换, 后者解释本地已提交 effort, 上游证明和阶段. 这让 `print` 可以访问任意 issue, 而 `accept`/`complete` 仍被 Application 政策限定.

JIRA `list` 刻意只读取一页, 因为它是让 Application Leader 判断是否存在候选并选择后续 `print` 对象的有界发现, 不是完整导出. JIRA 返回的总数让用户知道当前页之外仍有多少匹配项, 而不要求命令缓存或串行读取全部分页.

JIRA `print` 不请求变更历史 `changelog`, 评论也不保留 ID 或 `updated` 元数据, 因为这些数据可能远大于 Agent 判断 Story 所需的内容. 它保留可读正文, 作者和 `created`, 以限制一次讨论输入而不建立第二套摘要语义.

Association Module 接受完整相关快照而不是只接收两个文件, 因为后续关联可能把早期跨仓库阻断问题规范为同一 Module 阻断问题. Module 只修改仍未提交的输入, 已冻结边界由 Git 写入前检查和调用流程共同保证.

Application Association, Module Correction Check, Submodule Coordination 和 Application Sync 保持 4 个边界, 而不合并成一个跨仓库工作流 Module. 该选择让阻断项投射, 本地纠错范围, Git 分支/远端恢复和状态/Downstream changes 镜像各自只有一个政策责任方, 并使纯跟踪器判断与有外部影响的 Git 操作分开测试. 代价是调用方必须传递完整快照, 影响和诊断信息. 合并边界会让只读纠错检查获得文件写入或远端收敛责任, 或让跟踪器投影同时承担 Git 部分失败和文件事务, 因而不采用.

Correction Check 只比较 `HEAD` 与当前文件系统字节, 不寻找关联建立时的原始版本, 因为本次 Agent 已知自己刚完成的获授权修改, 而 `HEAD` 足以机械识别当前软锁与硬锁差异. 允许已暂存与未暂存内容共存可以让命令始终观察真实文件状态, 也避免建立另一套暂存区资格. 要求 Downstream changes 本身发生变化可以发现 Agent 完全忘记更新当前记录的情况, 但命令不尝试证明自然语言项目与每一处修改的语义对应关系.

公开名称使用 `check-correction` 而不是 `correct`, 因为命令只验证 Agent 已经写入文件系统的纠错, 不执行或准备纠错. 该名称避免让调用者误以为命令会修改 issue, spec, Downstream changes 或暂存区, 并保持后续差异审核和暂存属于其他工作流.

验收任务列表复选框表示普通实施进度和完成证据, 不是要求纠错, 因而比较时忽略仅复选框变化. 普通 issue 内容通过排除硬锁和软锁自然得到, 不建立允许列表, 因为普通 issue 生命周期可以继续增加 Validation, Comments 和其他实施记录; 允许列表会让纠错检查与这些正常演进耦合, 并错误阻断同时发生的合法实施更新.

Module 纠错依赖当前 issue 的有效 Application 反向关联, 不依赖本地 Application 配置, 因为该关联已经机械证明 issue 处于 Application/Module 关系中, 而 Module Repository 不负责保存 Application Leader 配置. 只比较同 effort 且由 `HEAD` 跟踪的 spec, 因为它是当前 Module Repository 内可以从 issue 身份机械确定的封闭设计范围; 扩展到其他 effort 或仓库会要求额外的语义推断和数据来源.

`### Downstream changes` 固定在 `## Comments` 末尾, 让解析器无需为普通评论新增另一个 H3 就能机械区分普通记录和需要同步的下游条目. 后续普通评论插入该子章节之前, 可以继续保持这一边界, 同时让 Application 同步只替换受控的末尾子章节.

Workflow Distribution 在同一 Skill 来源中同时保留 Codex 和 Claude Code 的原生调用配置, 因为两个平台分别从 `agents/openai.yaml` 和 `SKILL.md` 前置元数据读取自己的字段. 现有投影已经为 Codex 保留元数据文件并为 Claude Code 排除该文件, 所以不需要增加前置元数据转换规则或新的平台专用发布责任.

Module issue 只引用最近 Module Repository 内的治理输入, 因为每个子模块都是独立 Git 仓库, 拥有自己的 `.scratch` 与普通 issue 门禁. 允许用户明确确认 `Not required` 保持它与其他普通实施 issue 使用同一例外, 不让 Application spec 绕过 Module 自己的治理边界.

Submodule Coordination Module 不读取 issue, 因为分支/远端收敛与跟踪器状态是两类失败和恢复责任. Application Sync 只消费已经等于远端末端的快照, 因而不会把本地超前的未发布状态误当成 Application 事实.

Application 验证保持普通实施 issue, 因为它需要工作记录, 证据和普通治理. Application Source Issue 只镜像外部实施状态, 不复制 Module 证据或执行第二次实施门禁.

Application effort 完成每次从 spec 与 issue 计算, 因为独立持久化 effort 状态会复制同一事实并可能与 issue 状态漂移. Application 验证 issue 已经提供唯一需要保存的产品级验证记录.

Application 提交, 推送和对应 JIRA 写入使用一次授权, 因为本地发布与远程接收或完成同步被有意绑定为一个工作流结果. Git 上游证明只比较 effort 树; Application gitlink 的准确值不影响该树已经推送的事实, 因而不进入证明.

JIRA 评论优先和状态收敛优先保证可向前重试. JIRA API 不提供跨评论与状态转换的单一事务, 因而把最终组合作为成功条件比持久化本地中间状态更小也更可靠.

### ADR Evaluation

[ADR-0027](../../adr/0027-separate-repository-configuration-from-workflow-lock.md) 拥有 `arw.config.json` 与 `arw-lock.json` 的责任分离, Application 配置的用户归属, 以及配置存在时的 Application Leader 身份. 本文细化该 Application 配置的字段和使用行为, 不建立另一份配置权威.

[ADR-0012](../../adr/0012-use-namespaced-arw-operation-surfaces.md) 继续拥有带命名空间的 CLI. `jira`, `application`, `module` 和 `submodule` 是公开命名空间, `jl`, `jo` 和 `ssb` 是明确批准的简化入口, 不是旧命令兼容拼写. 新纠错检查位于 `module` 命名空间且没有短别名.

[ADR-0013](../../adr/0013-use-main-agent-single-writer-orchestration.md) 拥有 Main Agent 协调分工写入和 Git 写入的责任边界. 用户授权的 Module issue 或 spec 修改可以由获分派的 subagent 在明确范围内完成, Git 写入仍由 Main Agent 执行, JIRA 步骤仍按其独立授权执行. 纠错命令保持只读, ARW 不自动启动 Agent.

[ADR-0025](../../adr/0025-use-root-only-repository-platform-discovery.md) 只拥有 Repository Workflow 从最近 Git 仓库根发现平台定义的范围. Application 命令继续按总长期规格从当前最近 Git 仓库取得 Application 上下文, 每个 Module 作为独立 Git 仓库使用自己的 `.scratch`. 本文协调这些已经分离的跟踪器, 不把 Application 的子模块路径解释为两个跟踪器根合并, 也不扩大 ADR-0025 的平台发现结论.

[ADR-0017](../../adr/0017-use-operation-specific-recovery-baselines.md) 要求不同生命周期使用各自真正可恢复的基线, 而不是建立通用回滚协议. Association 的逐仓库暂存区基线, 分支切换的反向恢复, 远端收敛的保留已完成的快进, 以及 Application 替换内容的独立暂存区基线都遵守该方向. 它们没有共享恢复日志或跨操作检查点, 失败影响由各自结果准确返回, 因而不与 ADR-0017 冲突, 也不为这些可独立重试的操作新增 ADR.

[ADR-0018](../../adr/0018-use-bounded-mechanical-trust-for-initial-arw-security.md) 拥有来源取得与信任根的有界机械边界, 不拥有实时 JIRA 凭据. `JIRA_ACCESS_TOKEN` 只来自当前进程, 重定向直接失败, 诊断信息删除秘密信息和原始 HTML, 没有新的持久凭据权威来源, 键也只作为编码后的路径段使用. 这些限制缩小现有 HTTP 请求的传播边界, 不建立签名, 凭据存储或身份信任体系, 因而不改变 ADR-0018, 也不需要独立安全 ADR.

双向关联字段与 Downstream changes 子章节是跟踪文档中的持久格式, 但没有建立新的 issue 存储或独立历史权威来源. Module 实施 issue 保持实施状态, 证据和当前下游改动权威, Application Source Issue 只是可重新计算的投影; 关联硬锁, Module 软锁和唯一同步操作使两侧责任不竞争. 该格式和同步行为由本文完整拥有, 将来可以通过普通解析器与文档迁移演进, 因而不需要单独 ADR.

Module 的封闭结果合同, Association/Coordination/同步边界和 JIRA 评论优先收敛不增加新的持久状态, 外部授权主体或不可逆依赖方向. 它们分别把现有跟踪器, Git 与 JIRA 失败暴露给调用方, 并保留向前重试. 本文记录其替代方案, 成本和恢复影响已足以支持后续实现, 不新增 ADR.

## Requirement ownership

本文是以下要求的唯一长期负责方:

- Application Repository 与 Module Repository 在 issue 分发和 JIRA 同步中的职责.
- Application Leader, Application Member 和 Application Source Issue 在该工作流中的行为.
- `application-workflow` Skill 的显式调用, 内容路由, 设置例外和目标 Agent 规则抽取边界.
- `arw.config.json` 的 Application, Module 和 JIRA 字段语义.
- `jira list | print | open | accept | complete` 公开行为和别名.
- `module check-correction` 的公开只读行为, 软锁, 硬锁和 Git 比较边界.
- JIRA Story 到 Application effort/spec 的授权与关联.
- Application issue 与 Module 实施 issue 的双向关联与阻断项投射.
- 配置 Module 的统一分支与远端政策, 分支切换和同步收敛.
- Downstream changes 的结构, 当前状态语义和 Application 全量替换内容.
- Application Source Issue 状态与 Downstream changes 镜像, 冻结和证据边界.
- Application 验证 issue 与关联 JIRA 的 effort 完成.
- JIRA 接收/完成评论, 状态转换收敛和令牌安全边界.

开发长期规格唯一拥有 JSON 路径与通用版本化配置转换 Interface. Installation 长期规格唯一拥有全局 `config.json` v2 到 v3 的持久升级与事务. 总长期规格拥有普通跟踪器生命周期, 治理和仓库操作. README 拥有面向用户的操作说明, 但不重新定义本文合同.

## Validation strategy

验证分为 3 层. 纯 Module 验证直接观察本节 Interfaces 的完整成功, 阻断问题, 失败阶段和影响结果. 公开 CLI 验证观察命令 Interface 的输出, 退出码和外部影响. 已安装 CLI 集成验证实际安装入口能够发现 Application 配置, 路由命令, 并组合全局配置与仓库 `arw.config.json`, 而不依赖源码仓库内部路径.

验证必须覆盖正常行为, 关闭式失败, 边界状态, 授权变化, 持久写入顺序, 部分外部影响和恢复结果. Downstream Changes Document 测试覆盖缺失, 空白, 哨兵值, 实际条目, 续行, 嵌套, 缩进围栏, CRLF/CR, 重复或错位子章节和精确替换内容. Correction Check 测试覆盖每个软锁, 仅验收复选框变化, 关联硬锁, Downstream changes 必须变化且非空, 已暂存与未暂存共存, 普通 issue 内容同时变化, Git/文件系统失败和零写入. Application Sync 测试覆盖状态与完整当前列表同步, 删除旧条目, 保留普通评论, 缺失 Comments 插入, 多 Module 阻断问题的零替换内容, 稳定诊断, 事务回滚和保留之前已完成的快进. Skill 与 Workflow Distribution 测试覆盖两个平台的显式调用元数据, `agents/openai.yaml` 排除规则, 生命周期文档完整性和目标 Agent 规则不含 Application 操作方法. 常规验证不访问真实 JIRA, 不读取真实令牌, 不启动真实浏览器, 也不修改用户仓库. 当前 Source Checkout 使用的夹具, 用例矩阵和验证命令由 Agent 验证指导拥有.

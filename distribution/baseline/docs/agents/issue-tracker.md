<!-- arw:managed:start -->
# Issue 跟踪器规则

本地跟踪器把每个 ARW Artifact 存储在最近的 Git 工作树根目录下的 `.scratch` 中. 永远不得回退到外层仓库.

## ARW Artifact model

- 一个 effort 使用 `.scratch/<NNNN>-<effort-slug>/`, 其中 `NNNN` 从 `0001` 到 `9999`.
- 实施 issue, Application Source Issue 和 Wayfinder issue 分别使用 `.scratch/<NNNN>-<effort-slug>/issues/<NN>-<issue-slug>.md` 中的一个文件, 其中 `NN` 从 `01` 到 `99`.
- 跟踪器内部的 spec 可以选择位于 `.scratch/<NNNN>-<effort-slug>/spec.md`. 它是行为合同, 不是 effort 要求清单.
- 只有 Wayfinder effort 具有 `.scratch/<NNNN>-<effort-slug>/map.md`.
- 已注册的 ARW Artifact 类型是 `issue`, `map` 和 `spec`. 审计和就绪 JSON 文件是工作流记录, 不是已注册的 ARW Artifact 文件.

Effort 和 issue 编号是稳定身份. Local Canonical ID 是 `issue:<NNNN>:<NN>`, `map:<NNNN>` 和 `spec:<NNNN>`. Application 工作流可以使用 `issue:<application-or-module-name>:<NNNN>:<NN>` 作为限定的 issue 引用.

描述性 slug 只保留在已注册目录和 issue 文件名中, 或指向这些文件的精确路径中. 派生目录, 伴随文件名称, 记录键和持久身份字段只使用编号.

创建新 effort 时, 使用当前已有的最大 effort 编号加 1. 如果 `9999` 已被占用则停止.

在普通工作流中, 不得删除, 重新编号, 更改类型, 或重用已经提交的 issue, map 或 spec 身份. 编号保持固定时可以更改 slug. 只通过适用的终态退役 issue.

受独立治理的旧 effort 清理只能删除现有 effort 中最旧的连续数字前缀. 清理必须保留较新编号的 effort 和当前最大值, 使已删除的编号无法重用. 普通 ARW Artifact 读取不会从已清理的 effort 回退到 Git 历史.

每个 ARW Artifact 的文档语言遵循 `writing.md`. 保留精确的跟踪器字段, 状态值, 命令, 路径, 标识符和已经建立的名称.

渲染后的第一项内容是 H1. 标题后的字段和正文结构按 issue 类型区分:

- 实施 issue: H1 后第一个段落是 `Status:`, 不添加 `Type:` 字段. 正文的必要章节顺序见 [Issue requirements](#issue-requirements); `## Blocked by` 位于 `## Acceptance criteria` 后. 每个实施 issue 都指明预期验证和相关边界情况.
- Application Source Issue: 沿用实施 issue 的结构, 由精确的 `Module implementation issue:` 关联字段标识. 它镜像 Module 状态, 不执行本地实施, Spec Readiness, 验证或 Commit Audit.
- Wayfinder issue: H1 后使用 `Type:`, 可选的 `Status:` 和 `Blocked by:` 元数据, 正文使用 `##### Question`. 这里的 `Type:` 是 Wayfinder 工作流字段, 不是 `implementation | application-source | wayfinder` 分类的声明.

issue 的完成证据和讨论分别按 [Issue record sections](#issue-record-sections)记录. 有效要求及替代决定写入正式交付要求或验收章节, 不留在评论中作为隐含要求.

如果已发布的 Module 实施 issue 的受保护内容包含真实问题, 导致已同意的实施范围无法继续, 则解释该问题并请求用户授权精确修正.

获得授权后, 直接读取当前仓库 Skill 目录中 `application-workflow` 的 `references/module-correction.md`, 并且只遵循其中的 Module 修正规则. 不得更改或建议更改已关联的 Application issue.

不得为仅仅相关的工作重用已完成的实施 effort. 只有当新工作精确修复原 issue 已经要求的行为时, 才重新打开该 issue. 否则使用下一个 effort 编号创建新 effort, 并从 `01` 开始编号 issue.

读取或更新分流状态时, 在选择或解释该值前读取 `triage-labels.md`.

## Effort reading scope

Agent 恰好有一个当前 effort, 并可读取其完整的 `.scratch/<NNNN>-<effort-slug>/` 内容.

读取另一个 effort 的内容前, Main Agent 说明精确的 effort 和目的, 并取得用户明确授权. 该授权针对相应 effort 和目的, 覆盖同一个根会话中的 Main Agent 及其子 Agent. 切换 effort 会清除所有跨 effort 授权, 并为新的当前 effort 授予完整读取权限.

该规则管辖 Agent 读取的内容, 不管辖程序内部读取的文件. Agent 可以运行会读取其 Interface 所需文件的程序, 并在没有跨 effort 读取授权时使用其普通结果. 但是, 调用程序来返回另一个 effort 的内容同样属于 Agent 读取. 为保护仓库工作, 无需授权即可检查路径, Git 状态, 文件模式和哈希. 这些读取规则不授予写入权限或外部操作权限.

## Issue requirements

每个实施 issue 都有一个 `## Spec Requirement`. 只有在不需要治理设计时, 才精确使用 `Not required`. 否则使用 `Governing requirements:`, 后面空一行, 再写要求引用列表.

每行以连字符和空格开头, 后接由反引号包裹的精确路径, 可以附带 `#ascii-heading-anchor`. 路径相对于最近 Git 仓库根目录. Markdown 超链接不是该字段的有效列表项. 使用与 Spec Readiness Input `filePath` 相同的路径基准. 永远不得相对于 issue 目录解析治理引用.

使用以下章节形式, 将示例路径和锚点替换为实际治理要求:

```markdown
## Spec Requirement

Governing requirements:

- `docs/specs/example/spec.md#solution`
```

仅路径列表项写为 ``- `docs/adr/example.md` ``, 只适用于没有 ATX 标题, 或恰好只有一个 H1 且没有其他 ATX 标题的文档. 有多个章节时使用精确的 ASCII 章节锚点.

实施 issue 按顺序使用连续的二级章节 `## What to build`, `## Spec Requirement` 和 `## Acceptance criteria`, 不把它们降为更深的标题. 普通 `arw print` 成功只说明读取成功, 不能证明要求引用格式有效. 编写后检查实际要求解析入口接受章节和列表项, 并分别确认目标文件与锚点存在. Spec Readiness 和 Commit Audit 使用该格式的正式解析; Source Checkout 可通过现有 `readIssueRequirement` 入口定向核对, 不增加替代命令.

发布 issue 前确定该章节的内容. 要求引用表示 issue 要实现这项现有的治理要求. `## What to build` 负责交付结果, `## Acceptance criteria` 负责可验证的完成条件. 相关文档, 有用背景, 仅作为交付结果修改的文档, 交付目标, 解决方案构想或实施指引都不是治理要求, 不得把它们改写为治理要求.

只有当 effort 的存在目的就是实现长期规范时, 该规范才属于 issue 要求. 如果 effort 把修改长期规范作为其他受治理工作的输出, 则把所需的文档变更放入验收标准. 如果不存在治理设计, 在写入 `Not required` 前取得用户明确确认. 不得根据缺失或不确定的引用推断该例外.

该规则首先在创建或修改 issue 时强制执行, 然后在 Spec Readiness 和 Commit Audit 期间独立审查. 不得添加第二份 effort 级要求清单.

## Module Design in governing documents

Spec Readiness 对每个实施 issue 运行, 不对 Application Source 或 Wayfinder issue 运行. 在实施工作流内, Module Design 有条件地适用:

- 工作不修改非测试运行时代码时, 省略 `## Module Design`.
- 非测试运行时代码发生变化, 但 Module 责任, Interface, Seam, 依赖方向, 权威来源和数据流都不变时, 使用一个 `Not required:` Module Design 段落.
- 任何一项此类模块相关设计发生变化时, 使用完整的 Module Design 格式.

根据行为而不是路径或语言判断运行时代码. 测试, 文档和其他不修改正式运行时行为的工作不需要额外的 Module Design 章节.

## Issue lifecycle

Issue 终态和 Commit Audit 相互独立. 实施 issue 可以进入 `completed`, Application Source Issue 可以镜像 `completed | wontfix`, Wayfinder issue 可以进入 `resolved`, 而无需创建审计伴随文件.

在精确的 `## Validation` 标题下按[记录章节规则](#issue-record-sections)记录非空实施完成证据. 其他未注册标题不满足 issue 生命周期要求. Application Source Issue 的状态只来自 Application 同步, 且不添加本地完成证据. 为 Wayfinder issue 记录所需的解决证据, 并且只在 issue 工作实际完成时更新适用状态.

Gate 1 和 Gate 2 只为使用实施 issue 提交工作流的候选内容生成. 提交候选内容分类和非实施提交工作流由 `docs/agents/commits.md` 负责.

在已取得代码审查结果后补记完成状态或验收勾选时, 按 `code-review` Skill Package 的完成记录规则判断结果是否仍有效. 记录章节采用下方独立规则. 提交工作流拥有暂存时点, 最终候选及正式授权检查.

Spec Readiness subject 身份覆盖连续的 `## What to build`, `## Spec Requirement` 和 `## Acceptance criteria` 范围, 并把行尾归一化为 LF. 在 `## Acceptance criteria` 内, 它还会把 Markdown 围栏代码块之外, 位于列表项开头的实际任务列表标记中的 `[x]` 和 `[X]` 规范化为 `[ ]`. 只更改这些完成标记或行尾表示不会使就绪失效. 其他任何审核对象内容变更都会使它失效. Markdown 围栏代码块内的二级标题属于正文, 不划分该范围. 如果变更只涉及 `Status:`, `## Blocked by`, `## Validation`, `## Comments` 或 Commit Audit JSON, 就绪不会失效.

每个实施 issue 都在 issue 旁边的 `.scratch/<NNNN>-<effort-slug>/issues/<NN>.spec-readiness.json` 中拥有自己的 Spec Readiness 记录. 该记录只授权精确的 `issue:<NNNN>:<NN>`, 且永远不通过 effort 根目录中的就绪文件共享.

## Issue record sections

`## Validation` 和 `## Comments` 的整个章节都是记录内容, 变化本身不改变审核的要求或实现身份, 不触发 Spec Readiness, Code Standards, Code Spec 或 Commit Audit 的语义复审. 本规则只适用于这两个 issue 章节, 不排除整份 issue, 正式 subject 或任何完整治理 Input.

Validation 保存当前验收项对应的实际命令, 测试, 文件位置和结果, 是完成证据的索引. Comments 在 issue 底部保存讨论, 审核事件及已取得的结论. 两章不承载实施要求, 验收条件或授权例外, 不成为独立通过的权威. 有效要求和替代决定进入 `## What to build`, `## Spec Requirement` 或 `## Acceptance criteria`, 授权由实际用户决定及适用工作流取得. 正式验收以某审核通过为条件时, 必须先取得该事实, 不能通过换记录位置解除依赖.

记录可以指向准确证据和报告, 但链接不扩大 Reviewer 读取权限, 成功声明不能替代独立判断或实际结果. 新失败, 相反证据, 证据含义变化或必要事实缺失仍须处理, 删除记录不会消除已知失败和未解决问题. 保留各 Role 对当前事实与证据的独立责任.

修改记录后机械核对准确章节范围, 文本和必要证据定位, 确认没有其他实现, 要求, 输入或授权变化. Commit Audit 运行时记录先改工作树, 完整旧轮结束后按[提交工作流](commits.md#exclusive-commit-audit)统一暂存, 运行中的审计继续读固定索引. 记录差异不要求语义复审, 正式结果仍须通过当前完整要求, 定位和字节核对. Status 和验收勾选不属于这两个章节的例外, 按其真实完成责任及代码审查完成记录规则处理.

其他工作流使用记录章节中的结构化信息时, 保留其独立解析, 同步, 关联和机械纠错合同, 不因记录免复审而跳过这些操作或改变 Application 行为.

## Commit Audit records

创建, 替换或解释 issue 和 effort 审计记录前, 读取 [Issue Audit 记录](issue-audit-records.md).

## Wayfinding

Wayfinder map 包含 `Destination`, `Notes`, `Decisions so far`, `Not yet specified` 和 `Out of scope`. 当 `Blocked by:` 中的所有标识符都引用已经解决的 issue 时, 下级 issue 解除阻塞. 工作前领取一个最前沿 issue, 每个 Agent 会话最多解决一个, 附加 `## Answer`, 并更新 map 中的决定指针.
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
None.
<!-- arw:repository-owned:end -->

---
description: 读取, 创建或更新本地跟踪器中的 effort, issue, map, spec 及其工作流字段 (Status, 分流标签, 要求引用, 完成记录) 时使用, 报告 issue 完成前也使用.
name: issue-tracking
---

# Issue 跟踪

本地跟踪器把每个 ARW Artifact 存储在最近的 Git 工作树根目录下的 `.scratch` 中, 永远不回退到外层仓库. Artifact 的文档语言遵循 `docs/agents/writing.md`; 保留精确的跟踪器字段, 状态值, 命令, 路径, 标识符和已建立的名称.

## Artifact model

- effort 使用 `.scratch/<NNNN>-<effort-slug>/`, `NNNN` 从 `0001` 到 `9999`. 新 effort 使用当前最大编号加 1; `9999` 已被占用时停止.
- 实施 issue, Application Source Issue 和 Wayfinder issue 各使用一个 `.scratch/<NNNN>-<effort-slug>/issues/<NN>-<issue-slug>.md`, `NN` 从 `01` 到 `99`.
- 可选的 `.scratch/<NNNN>-<effort-slug>/spec.md` 是行为合同, 不是 effort 要求清单. 只有 Wayfinder effort 具有 `map.md`.
- 已注册的 ARW Artifact 类型是 `issue`, `map` 和 `spec`; 审计和就绪 JSON 是工作流记录. Local Canonical ID 是 `issue:<NNNN>:<NN>`, `map:<NNNN>` 和 `spec:<NNNN>`; Application 工作流可以使用限定引用 `issue:<application-or-module-name>:<NNNN>:<NN>`.
- 编号是稳定身份. 普通工作流中不删除, 重新编号, 更改类型或重用已提交的 issue, map 或 spec 身份; 编号不变时可以更改 slug. 描述性 slug 只出现在已注册目录和 issue 文件名及其精确路径中; 派生目录, 伴随文件, 记录键和持久身份字段只使用编号. issue 只通过适用终态退役.
- 受独立治理的旧 effort 清理只能删除最旧的连续编号前缀, 保留较新 effort 和当前最大值, 使编号无法重用. 读取不从已清理的 effort 回退到 Git 历史.
- 不为仅仅相关的工作重用已完成的 effort. 只有新工作精确修复原 issue 已要求的行为时才重新打开它; 否则使用下一个 effort 编号创建新 effort, issue 从 `01` 开始.

## Issue structure

渲染后的第一项内容是 H1.

- 实施 issue: H1 后第一段是 `Status:`, 不添加 `Type:`. 正文依次是连续的二级章节 `## What to build`, `## Spec Requirement` 和 `## Acceptance criteria`, 不降为更深的标题, 然后是 `## Blocked by`. 每个实施 issue 都指明预期验证和相关边界情况.
- Application Source Issue: 沿用实施 issue 结构, 由精确的 `Module implementation issue:` 关联字段标识. 它镜像 Module 状态, 状态只来自 Application 同步, 不执行本地实施, Spec Readiness, 验证或 Commit Audit, 也不添加本地完成证据.
- Wayfinder issue: H1 后使用 `Type:`, 可选的 `Status:` 和 `Blocked by:` 元数据, 正文使用 `##### Question`. 这里的 `Type:` 是 Wayfinder 字段.

已发布的 Module 实施 issue 的受保护内容存在真实问题, 导致已同意的范围无法继续时, 说明问题并请求用户授权精确修正. 获准后只遵循 `application-workflow` Skill 的 `references/module-correction.md`, 不更改或建议更改已关联的 Application issue.

## Triage labels

读取或更新分流状态时使用以下值:

- `needs-triage`: 需要维护者评估.
- `needs-info`: 需要报告者提供更多信息.
- `ready-for-agent`: 工作对 Agent 已有足够定义.
- `ready-for-human`: 工作需要用户执行或判断.
- `wontfix`: 不会处理该请求.

## Issue requirements

每个实施 issue 都有 `## Spec Requirement`. 不需要治理设计时精确写 `Not required`, 写入前取得用户明确确认, 不根据缺失或不确定的引用推断. 否则写 `Governing requirements:`, 空一行, 再列要求引用:

```markdown
## Spec Requirement

Governing requirements:

- `docs/specs/example/spec.md#solution`
```

- 每行是连字符, 空格和反引号包裹的精确路径, 可以附带 `#ascii-heading-anchor`. 路径相对于最近 Git 仓库根目录, 与 Spec Readiness Input 的 `filePath` 相同, 永远不相对于 issue 目录. Markdown 超链接不是有效列表项. 只有没有 ATX 标题, 或恰好一个 H1 且没有其他 ATX 标题的文档可以只写路径. 不引用本地跟踪器 issue.
- 只列 issue 实际实现的现有治理要求. 只有 effort 的存在目的就是实现长期规范时, 该规范才是要求; effort 把修改长期规范作为输出时, 把所需变更写进验收标准. 相关文档, 背景, 交付目标, 方案构想或实施指引都不是治理要求. `## What to build` 负责交付结果, `## Acceptance criteria` 负责可验证的完成条件.
- 发布 issue 前确定该章节. 普通 `arw print` 成功不证明引用有效: 编写后确认要求解析入口接受章节和列表项, 且目标文件和锚点存在 (Source Checkout 可以定向调用 `readIssueRequirement`). Spec Readiness 和 Commit Audit 独立审查该格式. 不另建 effort 级要求清单.

## Issue lifecycle

- issue 终态与 Commit Audit 相互独立: 实施 issue 可以进入 `completed`, Application Source Issue 可以镜像 `completed | wontfix`, Wayfinder issue 可以进入 `resolved`, 都不需要审计伴随文件.
- 实施完成证据写在精确的 `## Validation` 标题下, 内容非空; 其他标题不满足生命周期要求. Wayfinder issue 记录所需的解决证据, 工作实际完成时才更新状态.
- 已取得代码审查结果后补记 `Status` 或验收勾选时, 按 `code-review` 的完成记录规则判断结果是否仍有效.
- 每个实施 issue 在 `.scratch/<NNNN>-<effort-slug>/issues/<NN>.spec-readiness.json` 拥有自己的就绪记录, 只授权该 issue, 不通过 effort 根目录共享. 就绪 subject 及其失效规则见 `spec-readiness` Skill.

## Issue record sections

`## Validation` 保存当前验收项对应的实际命令, 测试, 文件位置和结果; `## Comments` 在 issue 底部保存讨论, 审核事件和已取得的结论. 这两章整章是记录:

- 它们不承载实施要求, 验收条件或授权例外, 不成为独立通过的权威. 有效要求和替代决定写入 `## What to build`, `## Spec Requirement` 或 `## Acceptance criteria`. 正式验收以某审核通过为条件时, 必须先取得该事实.
- 它们的变化不改变审核对象身份, 不触发 Spec Readiness, Code Standards 或要求符合审核的语义复审. 修改后机械核对准确章节范围, 文本和证据定位, 确认没有其他实现, 要求, 输入或授权变化. 提交审核运行中先改工作树, 暂存时点见 `commit` Skill. `Status` 和验收勾选不属于此例外.
- 链接不扩大 Reviewer 读取权限, 成功声明不替代独立判断. 新失败和反证仍须处理, 删除记录不消除已知失败.
- 其他工作流对记录中结构化信息的解析, 同步, 关联和纠错合同不变.

## Effort reading scope

Agent 恰好有一个当前 effort, 可以读取其完整目录. 读取另一个 effort 前, Main Agent 说明精确的 effort 和目的并取得用户明确授权; 授权覆盖同一根会话中的 Main Agent 及其子 Agent, 切换 effort 时清除. 该规则管辖 Agent 读取的内容, 不管辖程序内部读取; 但调用程序来返回另一个 effort 的内容同样属于 Agent 读取. 检查路径, Git 状态, 文件模式和哈希无需授权. 这些规则不授予写入或外部操作权限.

## Wayfinding

Wayfinder map 包含 `Destination`, `Notes`, `Decisions so far`, `Not yet specified` 和 `Out of scope`. `Blocked by:` 中的全部标识符都引用已解决的 issue 时, 下级 issue 解除阻塞. 工作前领取一个最前沿 issue, 每个 Agent 会话最多解决一个, 附加 `## Answer`, 并更新 map 中的决定指针.

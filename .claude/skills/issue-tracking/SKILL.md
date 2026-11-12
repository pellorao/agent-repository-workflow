---
description: 读取, 创建或更新本地跟踪器中的 effort, issue, map, spec 及其工作流字段 (Status, 分流标签, 完成记录) 时使用, 报告 issue 完成前也使用.
name: issue-tracking
---

# Issue 跟踪

本地跟踪器把每个 ARW Artifact 存储在最近的 Git 工作树根目录下的 `.scratch` 中, 永远不回退到外层仓库. Artifact 的文档语言遵循 `docs/agents/writing.md`; 保留精确的跟踪器字段, 状态值, 命令, 路径, 标识符和已建立的名称.

新建 effort, issue, map, spec, 分配或更改编号, 或处理 Wayfinder map 时, 先读 `./artifact-model.md` (编号模型与 Wayfinding).

## Issue structure

渲染后的第一项内容是 H1.

- 实施 issue: H1 后第一段是 `Status:`, 不添加 `Type:`. 正文依次包含二级章节 `## What to build` 和 `## Acceptance criteria`, 不降为更深的标题, 然后是 `## Blocked by`, 其中只写 bullet, 没有阻断项时写 `- None - can start immediately`. `## What to build` 可以引用 spec 章节, 引用不做机械校验. 每个实施 issue 都指明预期验证和相关边界情况. `## What to build` 和验收标准写到用户请求要求的最终状态, 不只写其中第一步; 写完对照用户原话, 确认每项请求都有对应的验收标准.
- Application Source Issue: 沿用实施 issue 结构, 由精确的 `Module implementation issue:` 关联字段标识. 它镜像 Module 状态, 状态只来自 Application 同步, 不执行本地实施, Spec Readiness, 验证或 Commit Audit, 也不添加本地完成证据.
- Wayfinder issue: H1 后使用 `Type:`, 可选的 `Status:` 和 `Blocked by:` 元数据, 正文使用 `##### Question`. 这里的 `Type:` 是 Wayfinder 字段.

已发布的 Module 实施 issue 的受保护内容存在真实问题, 导致已同意的范围无法继续时, 说明问题并请求用户授权精确修正. 获准后只遵循 `../application-workflow/references/module-correction.md`, 不更改或建议更改已关联的 Application issue.

验收标准不包含以 Commit Audit 通过或提交本身为条件的条目; 这些由 `commit` 工作流保证, 写入预期验证.

## Triage labels

读取或更新分流状态时使用以下值:

- `needs-triage`: 需要维护者评估.
- `needs-info`: 需要报告者提供更多信息.
- `ready-for-agent`: 工作对 Agent 已有足够定义.
- `ready-for-human`: 工作需要用户执行或判断.
- `wontfix`: 不会处理该请求.

## Issue lifecycle

- issue 终态与 Commit Audit 相互独立: 实施 issue 可以进入 `completed`, Application Source Issue 可以镜像 `completed | wontfix`, Wayfinder issue 可以进入 `resolved`, 都不需要审计伴随文件.
- 实施完成证据写在精确的 `## Validation` 标题下, 内容非空; 其他标题不满足生命周期要求. Wayfinder issue 记录所需的解决证据, 工作实际完成时才更新状态.
- 已取得 `code-review` 的审查结果后补记 `Status` 或验收勾选时, 按 `../code-review/result-reuse.md` 的 Completion records 节判断结果是否仍有效; 提交审核的 `prepare` 之后不得再改它们, 见 `commit` Skill.
- 每个实施 issue (行为保持重构例外的 issue 除外) 在 `.scratch/<NNNN>-<effort-slug>/issues/<NN>.spec-readiness.json` 拥有自己的就绪记录, 只授权该 issue, 不通过 effort 根目录共享. 就绪 subject 及其失效规则见 `spec-readiness` Skill.

## Issue record sections

`## Validation` 保存当前验收项对应的实际命令, 测试, 文件位置和结果; `## Comments` 在 issue 底部保存讨论, 审核事件和已取得的结论. 这两章整章是记录:

- 它们不承载实施要求, 验收条件或授权例外, 不成为独立通过的权威. 有效要求和替代决定写入 `## What to build` 或 `## Acceptance criteria`; 已开始实施后只涉及措辞, 重复或一致性的处置不改这两章, 按 `../spec-readiness/SKILL.md` 的 Authorization timing 节记入 `## Comments`. 正式验收以某审核通过为条件时, 必须先取得该事实.
- 它们的变化不改变审核对象身份, 不触发 Spec Readiness, Code Standards 或要求符合审核的语义复审. 修改后机械核对准确章节范围, 文本和证据定位, 确认没有其他实现, 要求, 输入或授权变化. 提交审核运行中先改工作树, 暂存时点见 `commit` Skill. `Status` 和验收勾选不属于此例外.
- 链接不扩大 Reviewer 读取权限, 成功声明不替代独立判断. 新失败和反证仍须处理, 删除记录不消除已知失败.
- 其他工作流对记录中结构化信息的解析, 同步, 关联和纠错合同不变.

## Effort reading scope

Agent 恰好有一个当前 effort, 可以读取其完整目录. 读取另一个 effort 前, Main Agent 说明精确的 effort 和目的并取得用户明确授权; 授权覆盖同一根会话中的 Main Agent 及其子 Agent, 切换 effort 时清除. 该规则管辖 Agent 读取的内容, 不管辖程序内部读取; 但调用程序来返回另一个 effort 的内容同样属于 Agent 读取. 检查路径, Git 状态, 文件模式和哈希无需授权. 这些规则不授予写入或外部操作权限.

---
description: 将计划, 规范或当前对话拆分为一组纵向切片 issue, 每项声明阻断关系并发布到已配置的跟踪器. 本地以每项一个文件记录, 实际跟踪器使用原生阻断链接.
name: to-tickets
disable-model-invocation: true
---

# 任务拆分

将计划, 规范或当前对话拆分为一组纵向切片 issue, 每项声明阻断它的其他 issue. 编写和发布前遵循 [Subagent 分配](../../../docs/agents/subagent-allocation.md) 与 [Agent 文件写入](../../../docs/agents/agent-writes.md).

创建本地实施 issue 时, 按 [Issue requirements](../issue-tracking/SKILL.md#issue-requirements) 使用唯一的要求引用格式.

如果尚未提供 issue 跟踪器和分流标签词汇, 运行只读 `arw workflow verify`. 如果验证报告仓库尚未初始化, 告知用户另行运行 `arw workflow init`.

## Process

### 1. Gather context

使用已在对话中的信息. 用户传入规范路径, issue 编号或 URL 时, 获取并阅读其完整正文和评论.

### 2. Explore the codebase

尚未探索代码库时, 调查当前代码状态. issue 标题和描述使用项目术语表词汇, 并遵循所涉区域的 ADR.

寻找使实现更容易的预先重构机会. 先让改变容易, 再完成容易的改变.

### 3. Draft vertical slices

将工作拆分为纵向切片 issue.

<vertical-slice-rules>

- 每个切片覆盖数据模式, API, UI 和测试等各层的一条狭窄且完整的路径, 而不是只覆盖单层.
- 已完成切片可以独立演示或验证.
- 每个切片适合在一个新的上下文窗口内完成.
- 任何预先重构先完成.

</vertical-slice-rules>

为每个 issue 给出其阻断关系, 即必须先完成的其他 issue. 没有阻断项的 issue 可以立即开始.

对每个实施 issue, 在起草正文前识别它实际实现的既有治理要求. 要求选择与交付结果和实现方式分开.

以下内容不是治理要求:

- 相关文档.
- 仅作为输出修改的文档.
- 交付目标.
- 解决方案构想.
- 实施指引.

没有治理设计时, 在使用 `Not required` 前获得用户明确确认, 不得根据缺失引用推断例外.

大范围重构是纵向切片的例外. 一次机械改动, 如重命名列或改变共享标识符的类型, 可能同时破坏遍布代码库的大量调用点, 使任何单个纵向切片都无法通过测试. 此时不要强行纵向拆分, 而应按以下顺序安排工作:

1. 扩展: 加入新形式并保留旧形式, 保证现有调用不受影响.
2. 迁移: 按影响范围分批迁移调用点, 例如按包或目录分批. 每批建立独立 issue 并依赖扩展步骤, 利用仍保留的旧形式使每批都通过持续集成检查.
3. 收缩: 用一个依赖全部迁移批次的 issue, 在没有调用方使用旧形式后删除它.

如果连迁移批次也无法单独通过检查, 仍保留该顺序并使用共同的集成分支. 所有批次成为最终集成验证 issue 的前置依赖, 只要求在最后完成集成时全部通过检查.

### 4. Confirm with the user

以编号列表展示拟议拆分. 每个 issue 说明:

- **Title**: 简短描述标题.
- **Blocked by**: 必须先完成的 issue.
- **What it delivers**: 从用户视角交付的端到端行为.
- **Governing requirements**: 实际实现的既有治理要求, 或尚待用户确认 `Not required` 是否准确.

询问用户:

- 粒度是否合适.
- 每条阻断关系是否确实阻断该 issue.
- 是否应合并或拆分 issue.

迭代直到用户批准拆分.

### 5. Publish to the configured tracker

按 `issue-tracking` Skill 记录的跟踪器发布已批准 issue. 两种跟踪器中的 issue 相同, 只有阻断关系的表达方式不同:

- **Local files** -> 使用对话已建立的 effort. 需要新 effort 时, 以当前最大编号加一创建 `.scratch/<NNNN>-<effort-slug>/`. 在其 `issues/` 下为每项 issue 写一个 `<NN>-<issue-slug>.md`, 按依赖顺序从 `01` 编号. 数字部分是 issue 身份, slug 只提高路径可读性. 每个文件的 `Blocked by` 列出所依赖的编号和标题. 使用下列章节式 `<issue-template>`, 每个文件只放一项 issue.
- **实际 issue 跟踪器** -> 按依赖顺序为每个已批准任务分别发布一个 issue, 使阻断关系可以引用真实身份. 平台提供原生阻断或子 issue 关系时使用它, 否则在 `Blocked by` 中列出阻断 issue. 除非另有指示, 应用 `ready-for-agent` 分流标签.

只处理所有阻断项均已完成的 issue. 纯线性链按从上到下顺序工作.

不得关闭或修改父 issue.

<issue-template>

## Parent

已有跟踪器 issue 作为来源时, 引用父 issue; 否则省略本节.

## What to build

从用户视角说明此 issue 实现的端到端行为, 不按实现层次罗列.

## Spec Requirement

本节的精确格式由 [Issue requirements](../issue-tracking/SKILL.md#issue-requirements) 定义.

## Acceptance criteria

- [ ] 标准 1
- [ ] 标准 2

## Blocked by

- 每项阻断项的引用, 或 `None - can start immediately`.

</issue-template>

本地 Markdown 使用章节式形式, 以 `# <Ticket title>` 开始并紧接普通 `Status: ready-for-agent`. YAML frontmatter 可以位于 H1 前. 除非需要, 省略 `## Parent`. `## Spec Requirement` 属于目标实施 issue, 不属于本 Skill.

交付散文中避免具体文件路径或代码片段, 它们容易过期. 原型产生的片段如果比散文更精确地表达决定, 可以内嵌并简短注明来自原型.

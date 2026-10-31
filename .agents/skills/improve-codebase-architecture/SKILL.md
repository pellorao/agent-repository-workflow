---
description: 扫描代码库中的加深机会, 以可视化 HTML 报告呈现, 再对你选中的那一项展开追问 (grill).
name: improve-codebase-architecture
disable-model-invocation: true
---

# 改进代码库架构

发现架构上的摩擦, 并提出 **加深机会** (deepening opportunities), 即把浅 Module 变成深 Module 的重构. 目标是可测试性和便于 AI 导航.

这个命令以项目的领域模型为依据, 建立在共享的设计词汇之上:

- 运行 `$codebase-design` Skill, 获取架构词汇 (**module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, **locality**) 及其原则 (删除测试, "Interface 就是测试面", "一个 Adapter = 假想的 Seam, 两个 = 真正的 Seam"). 在每条建议中严格使用这些术语, 不要滑向 "component", "service", "API" 或 "boundary".
- `CONTEXT.md` 中的领域语言为好的 Seam 命名; `docs/adr/` 中的 ADR 记录了该命令不应重新争论的决定.

## Process

### 1. Explore

**先划定范围再扫描, YAGNI.** 加深一个 Module 的回报在于让今后对它的改动更容易, 所以对最近改动过的部分要额外加重权重. 在查看之前先决定 _看哪里_:

- 如果用户指明了方向 (某个 Module, 子系统, 痛点), 就按它走, 跳过下面的推断.
- 否则, 回溯相当一段提交历史 (`git log --oneline`), 找出代码库的热点, 即反复出现的文件和区域, 让这些路径最先吸引你的注意. 如果改动分散, 没有清晰的热点, 就扩大范围.

先阅读适用的上下文文件, 以及你所改动区域的任何 ADR.

由 Main Agent 依据 `docs/agents/subagent-allocation.md` 创建或复用一个协作者来遍历代码库. 如果你是 subagent, 向 Main Agent 请求该协作者并等待分配. Main Agent 检查容量并分配任务范围. 自然地探索, 并记下你感到摩擦的地方:

- 理解一个概念需要在许多小 Module 之间来回跳转的地方在哪里?
- 哪些 Module 是 **浅** 的, 即 Interface 几乎与实现一样复杂?
- 哪里为了可测试性而抽出了纯函数, 但真正的 bug 藏在它们如何被调用中 (没有 **locality**)?
- 哪些紧耦合的 Module 在其 Seam 处发生了泄漏?
- 代码库的哪些部分没有测试, 或很难通过现有 Interface 测试?

对任何你怀疑是浅的东西应用 **删除测试**: 删掉它会让复杂性集中, 还是只是转移? 答案为 "会集中" 就是你想要的信号.

### 2. Present candidates as an HTML report

把一个自包含的 HTML 文件写到会话工作区 (见 [Agent 环境](../../../docs/agents/environment.md)), 使仓库的受跟踪路径里不留任何东西. 写入 `<workspace>/architecture-review-<timestamp>.html`, 使每次运行得到新文件. 替用户打开它 (Linux 用 `xdg-open <path>`, macOS 用 `open <path>`, Windows 用 `start <path>`), 并告诉他绝对路径.

报告用 **Tailwind (CDN)** 做布局和样式, 在用图/流程/时序能可靠表达结构的地方用 **Mermaid (CDN)** 画图. 把 Mermaid 与手工制作的 CSS/SVG 视觉混用: 关系呈图状 (调用图, 依赖, 时序) 时用 Mermaid, 想要更有编辑感的东西 (质量图, 剖面, 折叠动画) 时用手工搭的 div/SVG. 每个候选都有一个 **前后对比可视化**. 要有视觉感.

为每个候选渲染一张卡片, 包含:

- **文件**: 涉及哪些文件/Module
- **问题**: 当前架构为什么造成摩擦
- **方案**: 用平实的语言描述将改变什么
- **收益**: 用 locality 和 leverage 解释, 以及测试将如何改善
- **前后对比图**: 并排的, 手工绘制的, 说明浅的现状及加深后的样子
- **推荐强度**: `Strong`, `Worth exploring`, `Speculative` 之一, 以徽章形式渲染

报告以 **首选推荐** 章节收尾: 你会先处理哪个候选, 以及为什么.

**领域部分使用适用上下文文件中的词汇, 架构部分使用 `$codebase-design` 的词汇.** 如果该文件定义了 "Order", 就说 "Order intake module", 不要说 "FooBarHandler", 也不要说 "Order service".

**ADR 冲突**: 如果某个候选与现有 ADR 矛盾, 只有当摩擦真实到值得重新审视该 ADR 时才提出. 在卡片中明确标出 (例如警告提示框: _"与 ADR-0007 矛盾, 但值得重新讨论, 因为..."_). 不要列出 ADR 所禁止的每一种理论上的重构.

完整的 HTML 骨架, 图示模式和样式指引见 [HTML-REPORT.md](HTML-REPORT.md).

现在 **不要** 提出 Interface. 文件写好后, 询问用户: "你想探索其中哪几项?"

### 3. Grilling loop

用户选定一个候选后, 运行 `$grilling` Skill 与他一起走完决策树: 约束, 依赖, 加深后 Module 的形状, Seam 背后放什么, 哪些测试会保留.

随着决定逐渐成形, 副作用就地发生, 运行 `$domain-modeling` Skill 让领域模型随之保持最新:

- **用适用上下文文件中没有的概念为加深后的 Module 命名?** 把该术语加到那里. 如果所选的领域布局缺失, 报告 Repository 设置缺口, 不要自行选择布局或创建上下文文件.
- **对话中澄清了一个模糊术语?** 当场更新适用的上下文文件.
- **用户以有分量的理由否决了候选?** 提议记录 ADR, 措辞类似: _"要我把它记录为 ADR, 以免今后的架构评审再次建议它吗?"_ 只有当未来的探索者确实需要该理由来避免重复建议同一件事时才提议, 跳过临时性的理由 ("现在不值得") 和不言自明的理由.
- **想为加深后的 Module 探索备选 Interface?** 运行 `$codebase-design` Skill, 使用其 design-it-twice 并行 sub-agent 模式.

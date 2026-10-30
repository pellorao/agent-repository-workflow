# 两次设计

用户想为选定的加深候选探索备选 Interface 时, 使用这个并行 sub-agent 模式. 它基于 "Design It Twice" (Ousterhout): 你的第一个想法不太可能是最好的.

使用 [SKILL.md](SKILL.md) 中的词汇: **module**, **interface**, **seam**, **adapter**, **leverage**.

## Process

### 1. Frame the problem space

在请求协作者之前, 先为所选候选写一份面向用户的问题空间说明:

- 任何新 Interface 都需要满足的约束
- 它将依赖的依赖项, 以及这些依赖项属于哪一类 (见 [DEEPENING.md](DEEPENING.md))
- 一段大致的示意代码草图, 使约束具体化 (不是提案, 只是让约束落到实处)

把它展示给用户, 然后进入第 2 步. 协作者并行工作的同时, 用户阅读并思考.

### 2. Allocate collaborators

Main Agent 依据 `docs/agents/subagent-allocation.md`, 在其容量与任务分配规则的约束下, 创建或复用至少三个协作者. 如果你是 subagent, 向 Main Agent 请求协作者, 并等待其分配的身份与范围. 每个协作者都必须为加深后的 Module 产出一个 **截然不同** 的 Interface.

为每个 sub-agent 提供一份单独的技术简报 (文件路径, 耦合细节, 来自 [DEEPENING.md](DEEPENING.md) 的依赖类别, Seam 背后放什么). 这份简报独立于第 1 步面向用户的问题空间说明. 给每个 agent 不同的设计约束:

- Agent 1: "最小化 Interface, 最多 1 到 3 个入口. 让每个入口的 Leverage 最大."
- Agent 2: "最大化灵活性, 支持多种用例和扩展."
- Agent 3: "为最常见的调用方优化, 让默认场景变得轻而易举."
- Agent 4 (如适用): "围绕端口与适配器 (ports & adapters) 设计跨 Seam 的依赖."

简报中同时包含 [SKILL.md](SKILL.md) 的词汇和 CONTEXT.md 的词汇, 使每个 sub-agent 的命名都与架构语言和项目的领域语言一致.

每个 sub-agent 输出:

1. Interface (类型, 方法, 参数, 以及不变量, 顺序, 错误模式)
2. 展示调用方如何使用它的使用示例
3. 实现在 Seam 背后隐藏了什么
4. 依赖策略与 Adapter (见 [DEEPENING.md](DEEPENING.md))
5. 取舍: Leverage 高在哪里, 薄弱在哪里

### 3. Present and compare

依次呈现各个设计, 让用户逐个消化, 然后用文字比较它们. 按 **Depth** (Interface 处的 Leverage), **Locality** (变更集中在哪里) 和 **Seam 位置** 对比.

比较之后给出你自己的推荐: 你认为哪个设计最强, 理由是什么. 如果不同设计的元素可以很好地结合, 提出一个混合方案. 要有明确立场: 用户想要的是强有力的判断, 不是一份菜单.

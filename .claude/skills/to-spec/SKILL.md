---
description: 将当前对话整理为规范并发布到项目 issue 跟踪器. 不重新访谈, 只综合已经讨论的内容.
name: to-spec
disable-model-invocation: true
---

本 Skill 把当前对话和已获得的代码库理解整理为规范, 不重新访谈用户. 编写和发布前遵循 [Subagent 分配](../../../docs/agents/subagent-allocation.md), [Agent 文件写入](../../../docs/agents/agent-writes.md) 与 [规范设计呈现](../../../docs/agents/writing.md#specification-design-presentation).

创建本地实施 issue 时, 按 [Issue requirements](../issue-tracking/SKILL.md#issue-requirements) 使用唯一的要求引用格式.

如果尚未提供 issue 跟踪器和分流标签词汇, 运行只读 `arw workflow verify`. 如果验证报告仓库尚未初始化, 告知用户另行运行 `arw workflow init`.

## Process

1. 在尚未探索时, 调查代码库当前状态. 在规范中使用项目术语表词汇, 并遵循所涉区域的 ADR.
2. 草拟将用于测试功能的边界. 优先采用已有边界, 并选择最高层的边界. 需要新边界时, 提出能够承担责任的最高层边界. 测试边界越少越好, 理想情况下只需一个.
3. 与用户核对这些边界是否符合预期.
4. 按规范设计呈现规则使用下列模板编写规范, 完成下方自检后再发布到项目 issue 跟踪器. 应用 `ready-for-agent` 分流标签, 不需要额外分流.

<spec-template>

## Problem Statement

从用户视角说明触发问题的情境, 风险以及为什么需要解决.

## Solution

从用户视角说明解决方案怎样改变该情境及产生什么结果. 在理解选择需要时说明理由.

## User Stories

用详尽的编号列表列出用户故事, 充分覆盖功能的各个方面. 每项使用以下形式:

1. 作为 <actor>, 我希望有 <feature>, 以便 <benefit>

<user-story-example>
1. 作为移动银行客户, 我希望查看账户余额, 以便更明智地决定消费.
</user-story-example>

## Implementation Decisions

列出已作出的实现决定, 可以包括:

- 将要构建或修改的模块.
- 将要修改的模块 Interface.
- 开发者给出的技术澄清.
- 架构决定.
- 数据模式变更.
- API 合同.
- 具体交互.

按规范设计呈现规则组织适用的关系, 阶段, 分支和失败恢复, 使读者不依赖原始对话也能理解决定.

不得包含具体文件路径或代码片段, 它们很快会过期.

例外: 原型产生的片段如果比散文更精确地表达决定, 例如状态机, 状态更新函数, 数据模式或类型结构, 可以内嵌在相应决定中并简短注明来自原型. 只保留表达决定的部分, 不保留可运行演示.

## Testing Decisions

按已确认的测试边界和风险分组说明验证方式, 包括:

- 通过哪些边界观察哪些外部结果, 以及这些观察防止什么实际风险.
- 为什么整体验证构成最少充分覆盖.
- 代码库中可参考的同类测试.

以测试边界, 可观察结果和风险分组组织内容, 不按预计测试案例, 参数组合或实现分支逐项列举.

## Out of Scope

说明本规范不包含的内容.

## Further Notes

记录其他必要说明.

</spec-template>

## Completion check

综合完成后, 按规范设计呈现规则中的交付前自检要求阅读全文, 补足仍依赖原始对话的信息后再发布. 自检以实际正文能否独立解释设计为依据, 模板标题齐全本身不代表完成.

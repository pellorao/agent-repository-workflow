---
description: 将当前对话整理为 effort 的 spec 并写入本地跟踪器. 不重新访谈, 只综合已经讨论的内容.
name: to-spec
disable-model-invocation: true
---

本 Skill 把当前对话和已获得的代码库理解整理为规范, 不重新访谈用户. 编写前遵循 `docs/agents/subagent-allocation.md`, `docs/agents/agent-writes.md` 与 `docs/agents/writing.md` 的 Specification design presentation 节.

## Process

1. 在尚未探索时, 调查代码库当前状态. 在规范中使用项目术语表词汇, 并遵循所涉区域的 ADR.
2. 草拟将用于测试功能的边界. 优先采用已有边界, 并选择最高层的边界; 覆盖范围按 `validation` Skill 的最少充分覆盖原则确定.
3. 与用户核对这些边界是否符合预期.
4. 用下列模板编写规范. 规范写入对话已建立的 effort 的 `spec.md`; 尚无 effort 时按 `issue-tracking` Skill 创建. spec 不带分流 `Status:`, 是否可实施由其下的 issue 表达. 按规范设计呈现规则自检全文后再交付.

规范修改非测试运行时代码时, 按 `../spec-readiness/SKILL.md` 的 Governing design 节增加 `## Module Design` 章节, 其形式 (`Not required:` 段落或完整格式) 由该 Skill 决定, 本 Skill 不重复; 其他情况省略该章节.

规范和 issue 正文不写具体文件路径或代码片段, 它们很快会过期. 例外: 原型产生的片段如果比散文更精确地表达决定, 例如状态机, 状态更新函数, 数据模式或类型结构, 可以内嵌在相应决定中并简短注明来自原型; 只保留表达决定的部分, 不保留可运行演示.

## Template

H1 使用中文描述性标题, 下列 H2 保持英文原文.

```markdown
# <规范标题>

## Problem Statement

从用户视角说明触发问题的情境, 风险以及为什么需要解决.

## Solution

从用户视角说明解决方案怎样改变该情境及产生什么结果. 在理解选择需要时说明理由.

## User Stories

用详尽的编号列表列出用户故事, 充分覆盖功能的各个方面. 每项使用以下形式:

1. 作为 <角色>, 我希望有 <功能>, 以便 <收益>

示例: 作为移动银行客户, 我希望查看账户余额, 以便更明智地决定消费.

## Implementation Decisions

列出已作出的实现决定, 可以包括: 将要构建或修改的模块, 模块 Interface 的修改, 开发者给出的技术澄清, 架构决定, 数据模式变更, API 合同, 具体交互. 按规范设计呈现规则组织适用的关系, 阶段, 分支和失败恢复, 使读者不依赖原始对话也能理解决定.

## Testing Decisions

按已确认的测试边界和风险分组说明验证方式: 通过哪些边界观察哪些外部结果, 这些观察防止什么实际风险, 为什么整体验证构成最少充分覆盖, 以及代码库中可参考的同类测试. 不按预计测试案例, 参数组合或实现分支逐项列举.

## Out of Scope

说明本规范不包含的内容.

## Further Notes

记录其他必要说明.
```

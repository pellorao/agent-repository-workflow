---
description: "根据一个 implementation issue 及其适用规范构建, 修复, 修改或完成仓库交付内容. 当用户要求实际改变代码, 测试或文档时使用; 任何已跟踪文件修改 (包括 Wayfinder issue 处理和初始规划记录) 前也用其 Entry 确认授权. 只读诊断, 审查, 研究和 grilling 不触发."
name: implement
---

# 实施

先对照根 `AGENTS.md` 的效率与精简最高原则: 用最少的时间, token 和代码只交付当前验收标准要求的内容, 先删后加, 不为推测性的稳健性扩大范围.

按 Entry, Preparation, Implementation, Validation, Completion 顺序推进. 某个阶段的条件失效时, 回到拥有该条件的阶段.

## Entry

1. 找到授权本次工作的 issue. 先使用对话中已识别的路径或 ID, 解析为 `.scratch/<NNNN>-<effort-slug>/issues/<NN>-<issue-slug>.md`, 并核对它仍与所请求的工作匹配; 否则搜索当前仓库的全部 issue. 没有匹配或存在多个合理匹配时请用户指定, 不代替用户选择或创建实施范围.
2. 按 `issue-tracking` Skill 确认文件结构与记录类型, 再按类型判断授权:
   - 实施 issue 只有直接覆盖所请求范围, 使用 `Status: ready-for-agent`, 且每个阻断项都已达到适用终态时, 才授权更改已跟踪文件. `Status: ready-for-human` 不授权 Agent 实施.
   - Application Source Issue 永远不授权本地实施; 关联和同步内容只由 Application 和 JIRA 工作流修改.
   - Wayfinder issue 以 `Status: claimed` 领取, 且每个阻断项都是 `Status: resolved` 后, 才授权处理其中记录的问题. `claimed` 和 `resolved` 不是实施 issue 状态.
   - 初始规划记录授权只允许创建或更新其治理 Skill 授权的规划产物, 不授权生产代码, 测试或无关文档.
3. 完成 issue 所必需, 且不增加行为, 规则, 公开合同或架构决定的机械性配套修改可以留在本 issue 内. 其他新要求先通过 issue 工作流记录并取得授权, 不默默扩大 issue.
4. 完整读取 issue 及其 effort spec (如存在). 新 Agent 接手, 中断后恢复, 或 spec 任何字节变化时, 重新完整读取.
5. 只改 Agent 规则和文档 (范围见 `commit` Skill 的非实施工作流) 不安排就绪审核. 其余实施 issue 按 `spec-readiness` Skill 安排就绪审核; 修改实现文件前运行 `arw spec-readiness verify --issue issue:<NNNN>:<NN>` 并取得 `0`, 否则不开始实施.

## Preparation

1. 按 `docs/agents/subagent-allocation.md` 决定分工, 按 `docs/agents/agent-writes.md` 准备恢复基线和准确的写入范围.
2. 应用根 `AGENTS.md` 中所有匹配的 Workflow Trigger. 存在未解决的重要决定时, 按 `Important Decisions` 处理后才继续.

## Implementation

完成 issue 授权的交付内容, 适用时使用 `$tdd`. 授权或上下文失效时回到 Entry, 分工或写入范围变化时回到 Preparation.

## Validation

按 `validation` Skill 验证已完成的结果. 修复需要新授权时回到 Entry, 需要重新准备时回到 Preparation, 只需修改交付内容时回到 Implementation.

## Completion

1. 按 `spec-readiness` Skill 核对最终内容的有效就绪结果, 再按 `issue-tracking` Skill 检查验收条件, 记录完成证据并更新状态.
2. 验收条件满足, 必要验证成功, 记录和状态已更新后, 实施流程结束. Git 提交只在用户请求后按 `commit` Skill 进行.

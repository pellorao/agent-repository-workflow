---
description: "根据一个 implementation issue 及其适用规范构建, 修复, 修改或完成仓库交付内容. 当用户要求实际改变代码, 测试或文档时使用. 只读诊断, 审查, 研究, grilling 和规划不触发."
name: implement
---

# 实施

这是仓库实施工作的统一入口. 各专用治理文档保留所属阶段的详细契约. 完整流程按以下顺序推进, 当前阶段满足进入下一阶段的条件后才继续:

1. 按 [Entry](#entry) 确认实施授权, 读取完整上下文, 并确定工作何时可以开始.
2. 按 [Preparation](#preparation) 建立恢复基线, 分配写入范围, 并选择适用规则.
3. 按 [Implementation](#implementation) 完成已授权的交付内容.
4. 按 [Validation](#validation) 验证已经完成的实施结果.
5. 按 [Completion](#completion) 检查验收条件, 记录证据, 并处理后续状态.

## Entry

1. 按 [Issue Gate](../../../docs/agents/issue-gate.md) 找到并检查授权本次实施的一个 issue.
2. 完整读取该 issue, 以及它所属 effort 下的 spec (如果存在).
3. 新 Agent 接手, 中断后恢复实施, 或 effort spec 的任何字节发生变化时, 重新完整读取第 2 步要求的文档.
4. 按 [设计就绪工作流](../../../docs/agents/spec-readiness.md)安排独立审核, 并识别需要有效结果的最终授权时点.
5. 任务授权, 已确认设计, 实际前置工作和必要的用户决定都满足后, 进入 [Preparation](#preparation). 就绪审核尚未通过时, 按其工作流开展不依赖该结果的已授权实施. 运行中的审核不代表已经通过, 源设计变化也不使旧结论取得新版本的效力.

## Preparation

1. 按 [Subagent 分配](../../../docs/agents/subagent-allocation.md) 决定实施分工和交接.
2. 按 [Agent 文件写入](../../../docs/agents/agent-writes.md) 准备恢复基线和准确的写入范围.
3. 根据实际行动使用 `AGENTS.md` 中所有匹配的 Workflow Trigger, 并遵循它们指向的详细契约.
4. 存在未解决的重要决定时, 按 `AGENTS.md` 的 Important Decisions 处理, 不进入下一阶段.
5. 实施分工, 写入范围, 恢复基线, 适用规则和重要决定都已经处理后, 进入 [Implementation](#implementation).

## Implementation

1. 完成 issue 授权的交付内容. 适用时使用 `$tdd`.
2. 任务授权或实施上下文失效时返回 [Entry](#entry). 分工, 写入范围或其他准备条件变化时返回 [Preparation](#preparation). 就绪结果因内容变化失效时, 按设计就绪工作流刷新最终版本的审核, 不把它当作无关实施自动失去授权.
3. 交付内容完成且没有阻止验证的问题时, 进入 [Validation](#validation).

## Validation

1. 按 [Validation](../../../docs/agents/validation.md) 验证已经完成的实施结果.
2. 验证要求的修复需要重新授权时, 返回 [Entry](#entry). 需要重新准备时, 返回 [Preparation](#preparation). 授权和准备仍然有效, 但需要修改交付内容时, 返回 [Implementation](#implementation).
3. 其他验证尚未成功或证据不足时, 留在 Validation, 并重新执行受影响的验证. 全部必要验证成功后, 进入 [Completion](#completion).

## Completion

1. 先按设计就绪工作流核对最终当前内容的有效结果, 再按 [任务跟踪规则](../../../docs/agents/issue-tracker.md)检查验收条件, 记录完成证据并更新任务状态. 就绪结果缺失或无效时, 保留尚未完成的状态, 不把代码实现或测试成功作为设计审核通过的替代依据.
2. 交付内容不满足验收条件时, 返回 [Implementation](#implementation). 必要验证或验证证据不完整时, 返回 [Validation](#validation). 授权失效时, 返回 [Entry](#entry). 准备条件失效时, 返回 [Preparation](#preparation).
3. 验收条件已经满足, 必要验证已经成功, 且第 1 步的记录和状态更新已经完成后, 实施流程结束.

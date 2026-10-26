---
description: 修改 Agent 指令 (`AGENTS.md`, `docs/agents/**`, Skill), 长期规范, ADR, 上下文文档或保存持久设计的规范与 PRD 前使用: 先取得用户对改动内容的确认 (Reviewer 提出的 spec 修改改由 Main Agent 与独立 subagent 共同决定), 并按文档责任编写.
name: rule-and-design-changes
---

# 规则和设计修改

## Protected documents

按文档责任判断是否受保护, 不使用封闭的路径列表. Agent 指令, Skill Package, 长期规范, ADR, 上下文文档, 以及保存持久设计的跟踪器 spec 或 PRD 受保护. 普通 issue 完成证据和其他工作记录不因文件类型而受保护.

## User confirmation

修改受保护文档前, 向用户说明目标路径和具体改动内容 (改动要点或拟议文字), 取得用户对改动内容的明确确认后再编辑. 用户已经给出具体改动内容的请求本身就是确认; 只给出目标或问题时, Agent 拟定的内容须经确认. 确认只在当前对话有效, 不通过交接, issue 评论或 Agent 摘要继承. 实际改动偏离已确认内容时重新确认. 写入仍遵循 `docs/agents/agent-writes.md`; 确认不授权暂存或提交.

## Reviewer-proposed changes

独立 Reviewer (Spec Readiness 或提交审核) 的问题要求修改 spec 或 PRD 时, 不逐次向用户确认, 由 Main Agent 和一个独立 subagent 共同决定是否修改及怎样修改. subagent 使用与 Main Agent 相同的模型和推理强度; 这是 `docs/agents/subagent-allocation.md` 所说的预定义角色配置, 不按其映射选择, 也不需要先完成其首次配置.

- 同一审核轮全部报告 (提交审核有两份) 中的此类问题合并为一次决定, 每轮只启动一个 subagent, 不逐条启动.
- subagent 收到报告, 相关 spec 或 PRD 和 issue, 不先看 Main Agent 的结论, 对每个问题给出是否修改及拟议内容; Main Agent 对比双方意见.
- 双方一致的问题按一致内容直接修改; 双方一致认为不应修改的问题按 `docs/agents/subagent-findings.md` 的质疑规则交回原 Reviewer, 共同决定的理由作为质疑证据, 此后按该规则处理. 有分歧的问题按 [User confirmation](#user-confirmation) 交用户决定, 期间推进不依赖它的工作.
- 改动只限于解决这些问题; 超出部分仍按 [User confirmation](#user-confirmation) 确认.

## Writing durable documents

- 长期规范写成当前的持久设计: 陈述最终行为, 责任, 公开或架构边界, 以及维持这些选择所需的理由. 实施步骤, 单个 issue 的迁移工作和已被取代的实施历史放入 issue, 验证证据或其他工作记录. 替换原有行为时陈述最终合同及其长期理由, 不叙述旧机制.
- ADR 写成当前有效的决定, 维持该选择所需的理由, 以及仍有意义的被否决方案. 只有紧邻的前一次决定有助于解释当前取舍时才简要标明; 不累积多轮旧决定, 日期日志或实施细节. 完全被取代的 ADR 保留原编号和路径, 只说明取代关系并链接现行决定.

# 结论复用与复审

没有未解决问题且同时满足以下条件时, 复用一个轴完整的通过结果, 不调用 Reviewer:

- 该轴实际依赖的比较内容, 关联代码上下文, 授权, 适用 Agent 指令和已完成验证事实与其受审版本相同; [完成记录](#completion-records) 和 [issue 记录章节](../issue-tracking/SKILL.md#issue-record-sections) 的机械核对差异除外. 只改变治理要求而不涉及 Standards 的候选, 规则或上下文时, 保留 Standards 结果. 不按文档路径或名称猜测依赖.
- 没有新的失败或相反证据削弱已有结论.

需要新判断时只对受影响的轴复审: 准备新的空报告, 按[复审规则](../../../docs/agents/reviewer.md#re-review)交付变化及影响范围和该 Reviewer 的前轮报告, 用同一身份经 `reviewer-launch` 的 `followup_task` 复用原线程. 先前问题和修复位置只提示需要核对之处, 不替代当前证据. 重复提交请求或再次记录未变候选不使结果失效; 缺失或不完整结果不能证明覆盖.

审查期间 Main Agent 可以读取绑定报告的中途结果, 对需要处理的问题独立核对后再请求必要的用户决定 (按 `docs/agents/subagent-findings.md`). 每条结论只适用于其受审版本.

## Completion records

审查开始前, Main Agent 可以仅根据已经完成的工作设置 `Status: completed` 并勾选已满足的验收项, 不改变其文字. 记录章节按 [issue 记录章节规则](../issue-tracking/SKILL.md#issue-record-sections) 更新, 其中的成功声明不是独立审核通过. 新要求, 范围变化, 用户例外或验收文字变化不属于完成标记例外.

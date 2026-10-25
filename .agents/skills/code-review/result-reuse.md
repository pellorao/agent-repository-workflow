# 审查结论复用

没有未解决问题且同时满足以下条件时, 复用每个适用轴完整的通过结果:

- 比较基线, 纳入路径, 文件内容, 模式和关联代码上下文与该轴固定受审版本相同, 下方完成记录及 [issue 记录章节](../issue-tracking/SKILL.md#issue-record-sections)的机械核对差异除外.
- 该轴实际依赖的授权, 适用 Agent 指令和已完成验证事实与其绑定版本相同. Spec 轴还要求完整治理输入相同; 只改变 Spec 治理内容且它不属于 Standards 的候选, 规则或关联上下文时, 保留 Standards 完整通过结果. 不按文档路径或名称猜测依赖.
- 没有新的失败或相反证据削弱已有结论.

复用前, 将拟议最终候选及该轴完整实际输入与受审版本比较. 需要新判断的变化按[公共复审规则](../../../docs/agents/reviewer.md#review-changes-and-prior-coverage)处理, 默认集中相邻版本差异及关联影响, 取得完整当前结果; 不自动失效另一轴的未受影响通过结果. 重复提交请求, 进入提交准备或再次记录未变候选身份不使结果失效. 缺失或不完整结果不能证明已完成覆盖, 新失败或反证必须先处理.

复用有效结果时不调用 Reviewer; 需要另一轮审查时复用线程.

## Completion records before Commit Audit

审查完成后且 Commit Audit 开始前, Main Agent 可以保留审查结果, 并仅根据已经完成的工作更新以下 issue 完成记录:

- 设置 `Status: completed`.
- 勾选已经满足的验收项, 不改变其文字.
- 更新记录章节时使用 [issue 记录章节规则](../issue-tracking/SKILL.md#issue-record-sections), 不把其中的成功声明当作独立审核通过.

对 Status 和验收勾选检查相对于受审候选的精确差异. 新要求, 范围变化, 用户例外或验收文字变化不属于完成标记例外, 不豁免整个 issue. 记录章节整章的身份与实际反证处理由其所属规则拥有, 不以记录删除抹去已知问题, 不声称尚未完成的工作成功.

将真实完成状态及验收勾选纳入审计候选前验证其差异, 这两项标记例外限于 Commit Audit 开始前. 记录章节的变化不受这个时点限制, 暂存时点仍按[固定审计范围](../commit/SKILL.md#exclusive-commit-audit)执行. Spec Readiness 的规范化不扩大本完成标记例外.

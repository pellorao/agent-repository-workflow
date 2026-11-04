# 处理 Reviewer 问题

## Respond to findings

Main Agent 在修改 issue 前独立验证每个问题. 问题有效时修正设计或 issue: 要求修改 spec 或 PRD 的问题按 `../rule-and-design-changes/SKILL.md` 的 Reviewer-proposed changes 节由 Main Agent 与独立 subagent 共同决定, 只有分歧交用户. 然后对新内容执行完整工作流 (已开始实施后的措辞, 重复或一致性问题按 `./SKILL.md` 的 Authorization timing 节只记录不改 subject). 每轮修正后, 重新 `prepare` 前, 对本轮改动的每一处执行 `./SKILL.md` 的 Prepare and review 节第 2 步自检, 并补齐修正带来的义务 (第 2 轮起的发现多数是上一轮修正引入的): 按类全文 grep, 同步 subject, spec, 长期规范和 ADR 中的同一事实 (含计数, 清单和例外); 新增或改变的行为, 错误和分支补测试观察与验收项; 新的设计选择 (新来源, 新例外, 新公开字段或输出) 补理由和 `ADR Evaluation` 条目, 并复核 Module Design; 新的调用方可见输出写明输出流, 文字, 缺省情形和退出码. 修正会转变设计方向 (如失败改为成功, 新的配置位置, 长期规则的例外, 新的公开输出) 时, 优先选择不改变方向的收窄修正; 必须转向时先把整段设计按上述各项写齐再 `prepare`. 按 `docs/agents/subagent-findings.md` 的 Triage by origin 节属于既有缺口的问题记入后续 issue, 并按下段质疑, 理由是本次交付不引入, 不改变也不依赖该缺口; Reviewer 指出交付对缺失事实的具体依赖而保留它时, 它不是既有缺口, 按本次影响的问题修正; 提交审核只修改代码时就绪记录仍有效, 不重跑.

结果符合 `docs/agents/subagent-findings.md` 的质疑条件时, 用未变的 subject 和 Input 重新 `prepare`, 通过 `followup_task` 把新请求, 每个受质疑问题的具体证据和推理错误交给原 Reviewer. 质疑消息只是提示, 不是 Input, 证据或授权. 有争议的结果在替代结果完成 `generate -> promote` 前继续阻断提交. subject 或 Input 已改变时改用普通的新请求.

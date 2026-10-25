# Source Checkout 工作流例外

本文件只适用于 ARW Source Checkout, 记录对共享 Skill 的源码仓库例外.

## Targeted Reviewer optimization exception

一个实施 issue 完成一次当前普通 Spec Readiness 授权后, 用户可以批准一轮定向 Reviewer 优化迭代. 该迭代可以修改 Source Checkout Role, 能力验证程序, 测试夹具, 测试和治理文档, 再直接运行该轮所需的确定性, 语法, 文本和实时能力验证. 这批有意的修改使先前的就绪记录过期后, 修改与该轮验证之间无需重复普通 Spec Readiness.

定向优化循环结束后, 关闭当前 issue 前, 必须以最终治理输入和当前 issue 审核对象重新完成普通 `prepare -> review -> generate -> promote -> verify` 工作流并取得有效授权. 该检查位于 issue 收尾阶段, 不插入每轮优化修改与验证之间. 能力验证通过不能替代最终设计的独立语义审查; 收尾审查发现的问题按普通治理设计修复和复审流程处理.

该例外只覆盖用户批准的当前修改批次和该轮定向验证. 它不授权未经批准的下一轮迭代, 该工作流以外的普通实施, 发布验证, 暂存或提交. 定向迭代的验证顺序, 用户审查停点和审查线程隔离遵循 [Reviewer Capability 会话检查和收敛](reviewer-capability-session-inspection.md).

## Reviewer Capability fixture exception

`tests/fixtures/reviewer-capability/**` 中供合成场景使用的 Agent 指令, 规范和其他文档按测试数据处理, 不触发 `rule-and-design-changes` Skill 的用户确认. 这些文件描述被测场景, 不治理真实仓库工作; 测试数据身份优先于其文档形式或文件名. 它们继续遵循 [Reviewer Capability 场景规则](reviewer-capability-scenarios.md#fixture-authority) 的迭代方案授权和独立质量审核. 本例外不包括治理验证工作流本身的真实规则或长期规范.

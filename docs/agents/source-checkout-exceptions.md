# Source Checkout 工作流例外

本文件只适用于 ARW Source Checkout, 记录对共享 Skill 的源码仓库例外.

## Reviewer Capability fixture exception

`tests/fixtures/reviewer-capability/**` 中供合成场景使用的 Agent 指令, 规范和其他文档按测试数据处理, 不触发 `rule-and-design-changes` Skill 的用户确认. 这些文件描述被测场景, 不治理真实仓库工作; 测试数据身份优先于其文档形式或文件名. 本例外不包括治理验证工作流本身的真实规则或长期规范.

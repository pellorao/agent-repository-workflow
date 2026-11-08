# 确定 ARW 1.0 首版覆盖的工作流与跨平台组合

Type: grilling
Status: resolved
Blocked by: issue:0099:04

##### Question

两平台对等已定, ARW 1.0 规范覆盖哪些仓库类型和工作流 (规划, 实施, 验证, Reviewer, 批准, 提交, Application/JIRA, 源码仓库维护如发布, 能力测试, 上游同步): 规范是否覆盖全部现有工作流, 首版实施先做哪一部分, 未覆盖的部分在过渡期间怎样与 Engine 驱动的流程共存? 与用户对话的 Main Agent 所在平台, 与 Engine 启动的 worker, Reviewer 和本地或第三方模型所在平台是否必须相同, 还是由 Engine 按角色组合?

## Answer

用户 11-08 对两部分分别答复.

工作流覆盖 (用户原话): "规范覆盖全部现有工作流, 一次做完, 不需要共存. 1.0 不急着上线, 也不会影响现有的发布, 我建议你新开分支来实现, 然后定期拉取 main 分支的新内容, 等完全实现后, 再合并到 main 分支." 因此:

- ARW 1.0 规范覆盖问题中列出的全部现有工作流, 不分首版与后续版本, 也不设计 Engine 驱动流程与现有规则驱动流程的过渡期共存.
- 规范定稿并审查通过后进入实施. 实施在单独的分支上进行, 定期合入 main 的新内容, 全部实现后一次合并回 main; 在此之前现有发布不受影响. Main Agent 的执行方式: 分支放在单独的克隆目录 (如 `~/projects/ARW-v1`, 分支 `arw-1.0`), 不在 ARW 主工作区切换分支, 因为主工作区每天都有 main 上的提交, 本机的 Codex 驱动也要求主仓库 HEAD 不变. 实施不属于本 effort, 见地图 Destination.

平台组合 (用户原话): "你说的平台是 harness 吗? 也就是 codex 和 claude code. 如果是的话, 那么应该是 engine 负责和我对接, engine 把我的话发给哪个 harness, 那是它的工作. 比如用户选择 gpt 模型作为 main agent, 那么接到我的话的, 就应该是 codex. 然后 engine 可以控制多个 harness, 每个 harness 启动自己可用的模型." Main Agent 已向用户确认这里的平台即 harness (Codex 与 Claude Code). 因此:

- 与用户对话的入口由 Engine 提供. 这补上了 [确定 ARW 1.0 的产品边界与 Agent 平台范围](04-decide-product-and-platform-scope.md) 中未定的一点.
- Engine 按用户选择的 Main Agent 模型决定由哪个 harness 接收用户的话 (选 GPT 类模型即 Codex, 选 Claude 即 Claude Code). 各角色 (Main Agent, worker, Reviewer) 所在的 harness 不要求相同, 由 Engine 按角色选择的模型组合; Engine 可以同时控制多个 harness, 每个 harness 只启动它自己能用的模型, 含经兼容端点接入的本地或第三方模型.
- 用户对话入口与 harness 路由的具体形态归入 [定义 Engine 驱动流程的运行合同](07-define-engine-runtime-contract.md); 不设过渡期共存这一点约束 [确定现有 ARW 合同在 1.0 中的继承范围](13-decide-legacy-contracts.md).

# Source Checkout 工作流例外

本文件只适用于 ARW Source Checkout, 记录对共享 Skill 的源码仓库例外.

## Targeted Reviewer optimization exception

一个实施 issue 完成一次当前普通 Spec Readiness 授权后, 用户可以批准一轮定向 Reviewer 优化迭代. 该迭代可以修改 Source Checkout Role, 能力验证程序, 测试夹具, 测试和治理文档, 再直接运行该轮所需的确定性, 语法, 文本和实时能力验证. 这批有意的修改使先前的就绪记录过期后, 修改与该轮验证之间无需重复普通 Spec Readiness.

定向优化循环结束后, 关闭当前 issue 前, 必须以最终治理输入和当前 issue 审核对象重新完成普通 `prepare -> review -> generate -> promote -> verify` 工作流并取得有效授权. 该检查位于 issue 收尾阶段, 不插入每轮优化修改与验证之间. 能力验证通过不能替代最终设计的独立语义审查; 收尾审查发现的问题按普通治理设计修复和复审流程处理.

该例外只覆盖用户批准的当前修改批次和该轮定向验证. 它不授权未经批准的下一轮迭代, 该工作流以外的普通实施, 发布验证, 暂存或提交. 定向迭代的验证顺序, 用户审查停点和审查线程隔离遵循 [Reviewer Capability 会话检查和收敛](reviewer-capability-session-inspection.md).

## Release validation repair exception

Source Checkout 发布准备 issue 在进入默认发布验证前必须已经完成一次当前普通 Spec Readiness. 发布验证发现问题后, Main Agent 先按[发布验证规则](source-checkout-release-validation.md#repair-iteration)完成全部可执行路径和补偿调查, 再把问题及修复方法记录到同一个 issue, 直接修改并验证新的本地候选. 修复循环中不为每轮治理 Input 或审核对象变化重复 Spec Readiness.

只有同一个连续流程中的本地 VM, `pre-tag` 和本地 `post-tag` 全部通过后, 才以最终治理 Input 和当前 issue subject 完成一次普通 `prepare -> review -> generate -> promote -> verify`. 该最终结果位于 Gate 3 和 issue 完成记录之前. Reviewer 要求修改候选时, Main Agent 按[发布验证规则](source-checkout-release-validation.md#candidate-promotion)在 Candidate promotion 内集中修复并重复适用审核; 治理 Input 或 issue subject 变化时, 在 Gate 3 前刷新 Spec Readiness. 全部审核收敛后只重新运行一次完整本地发布验证. 重新验证期间审核对象, 输入和适用规则未变时, 复用已有的 Spec Readiness 通过结果.

该例外不改变 Engine, Reviewer Role, 记录格式, 提升或验证规则. 它不适用于发布验证外的普通实施, 不省略最终 Spec Readiness, Gate 3, issue 终态 Commit Audit 或提交检查, 也不授权远程分支, tag 或 GitLab 写入.

## Reviewer Capability fixture exception

`tests/fixtures/reviewer-capability/**` 中供合成场景使用的 Agent 指令, 规范和其他文档按测试数据处理, 不触发 `rule-and-design-changes` Skill 的用户确认. 这些文件描述被测场景, 不治理真实仓库工作; 测试数据身份优先于其文档形式或文件名. 它们继续遵循 [Reviewer Capability 场景规则](reviewer-capability-scenarios.md#fixture-authority) 的迭代方案授权和独立质量审核. 本例外不包括治理验证工作流本身的真实规则或长期规范.

## Release validation Post-init Handoff exception

Source Checkout 发布验证流程 ([Source Checkout 发布验证](source-checkout-release-validation.md)) 规定其操作是否使用完整的 Agent Post-init Handoff. 对其他所有操作, `arw-commands` Skill 的普通 Post-init Handoff 保持不变.

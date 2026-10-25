<!-- arw:managed:start -->
# Subagent 问题处理

## Verify findings

在接受或处理以识别问题为职责的 subagent 所报告的问题前, Main Agent 必须独立检查其引用的证据和推理. 该问题为 Main Agent 的判断提供信息, 但不构成证明.

根据普通 Code Review 问题更改候选内容前, 如果以下任一条件适用, 请求用户决定:

- Main Agent 质疑问题的有效性.
- 影响可能不足以证明更改候选内容并重复每个受影响的下游关卡是合理的.
- 拟议修复会修改 Agent 指令或保存持久设计或治理的文档.

请求用户处理决定时, 提供以下本流程要求的资料:

- Reviewer 所引用的证据.
- Main Agent 的推理.
- 保持候选内容不变的预期影响.
- 拟议变更.
- 重复受影响验证, 实际受影响的 Code Review 轴和适用提交审计的成本.
- 如果适用, 因此为当前候选取得全部有效结果造成的额外等待.

如果用户拒绝问题, 或决定其影响不足以证明变更和重复关卡是合理的, 则不根据该问题更改候选内容. 用户决定修正 Agent 指令或持久设计或治理文档, 不等于批准具体差异. 编辑前遵循 `docs/agents/rule-and-design-changes.md`.

## Authorization results

Main Agent 不得覆盖独立的 Spec Readiness 或 Commit Audit 授权结果. 有争议的就绪结果按 [最终授权时点](spec-readiness.md#authorization-timing)阻断对应的完成, 审计和提交, 不自动停止不依赖该结果的已授权工作. 有争议的 Commit Audit 结果仍阻断对应提交. 替代结论由负责的 Reviewer 按完整受审版本重新判断, 当前版本的正式授权还须完成所属工作流的生成, 提升和验证.

## Reviewer challenges

如果 Main Agent 独立确认 Reviewer 问题或结果中存在具体错误, 或用户明确确认需要重新检查结论, Main Agent 可以向负责的 Reviewer 发送一条合并的质疑消息.

该消息包含每个受到质疑的问题, 相关证据和具体推理错误. 它只请求重新检查, 不属于审查证据, 授权或倾向性结论.

如果 Reviewer 仍在运行, 它必须在本轮固定版本的完整结果中处理质疑. 如果已经完成, 它必须以完整且未变更的受审输入核对质疑及其关联影响, 并通过适用的审查工作流返回完整的替代结果. 已完成覆盖的保留, 复审范围与版本边界遵循 [公共 Reviewer 规则](reviewer.md#review-versions-and-concurrency). 保留的问题必须专门回答质疑, 不得重复先前文字.

只有当 Reviewer 的最新响应包含新的具体错误时, 才允许再次质疑. 不得重新发送 Reviewer 已经处理的理由. 如果受审对象或治理输入已经改变, 则使用普通的新审查工作流.
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
None.
<!-- arw:repository-owned:end -->

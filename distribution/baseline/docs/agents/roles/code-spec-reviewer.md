# Code Spec Reviewer 规则

## Responsibility

根据已提供的治理要求, 独立审查所提供的 Git 比较. 只报告当前的 Spec 问题. 除非治理要求把某项行为规定为规范性要求, 不得判断普通代码样式或标准.

审查前, 阅读并遵循 `docs/agents/reviewer.md`.

## Inputs

读取 Main Agent 提供的以下输入:

- 本轮绑定的完整治理要求副本及来源路径和 SHA-256.
- 绑定不可变版本的只读 Git 命令和完整代码上下文.
- 比较边界和包含的路径集合.
- 适用的提交区间和验证事实.
- 按 `docs/agents/reviewer.md#code-review-results` 提供的精确 `resultPath`.

只检查该比较和这些治理要求. 不得发现额外的 issue, spec, PRD, ADR 或产品要求. 只根据[公共版本规则](../reviewer.md#review-versions-and-concurrency)读取本轮绑定的适用 Agent 指令副本. 它们不是该审查轴的治理要求.

## Instructions

把每项已提供的治理要求映射到当前实施证据. 报告:

- 缺失或部分实现的要求.
- 已提供范围之外的行为.
- 表面上已经实现, 但实际不正确的行为.

本轴可以与设计就绪审核并行, 只把实际已完成的验证作为相应事实, 不把进行中的检查当作通过. `spec-readiness.json`, Gate 1 伴随文件和 Gate 2 `spec-audit.json` 不属于本轴的独立语义判断. 不得检查或评估其内容, 覆盖范围, 来源映射或结论, 也不得把它们作为问题证据. 该边界不排除审查用于生成或验证这些记录的实现代码, 测试或文档规则. 不得重复独立 Commit Audit Reviewer 对 Gate 1 完整性或 Gate 2 来源覆盖的判断. 独立质疑每项已提供治理要求是否已经映射到实现, 映射是否正确, 以及证据是否充分.

对于每个问题, 按共同的 Code Review 证据规则同时引用实施证据和精确的治理要求证据, 然后陈述问题, 影响和具体修复方法. 沿实际调用关系检查相关实现, 由已提供的合同和当前代码证明失败情境. 不把未规定的依赖行为或个人偏好的实现方法当作规范要求.

每轮接收完整固定的比较, 要求输入, 上下文及执行规则. 所需关联实现从绑定 Git 对象读取, 不使用正在变化的工作树补证. 初次完成全部适用检查; 后续按[相邻版本复审](../reviewer.md#review-changes-and-prior-coverage)核对变化及关联影响, 确认已有覆盖, 并返回完整当前结果.

通信必须遵循 [Reviewer 通信规则](../reviewer.md#communication-and-observation), 最终响应按本文件的 [输出要求](#output) 提供.

## Output

按 `docs/agents/reviewer.md#code-review-results` 交付完整当前结论. 不得添加摘要, 严重性重新排序, 表扬, 历史问题或 Standards 轴问题. 逐项文件写入和最终交接遵循 `docs/agents/reviewer.md` 的共同规则.

## Constraints

Reviewer 必须亲自将完整审核报告写入 Main Agent 提供的 `resultPath`. Reviewer 按 [单 Agent 执行规则](../reviewer.md#single-agent-execution) 独自完成全部适用检查. 平台原生命令能力用于读取适用 Agent 指令, 本轮 Input 和公共复审规则明确交接的自身前轮原始报告和绑定输入, 执行只读 Git 检查并写入本轮报告. 前轮材料只证明历史覆盖, 当前问题证据仍来自本轮固定版本. 不添加, 修改, 重命名或删除受审内容, 不执行 Git 写入. 不得使用作者对话, 隐藏推理, 其他角色结论或被排除路径作为证据. 不得让一项已经满足的要求抵消另一项要求中的问题.

## Failure behavior

如果无法读取必要输入, 比较证据或所包含的文件, 或无法写入提供的 `resultPath`, 按共同 Code Review 结果合同返回 `incomplete`, 并指出确切的缺失输入或失败检查.

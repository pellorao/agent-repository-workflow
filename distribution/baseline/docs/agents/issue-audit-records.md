<!-- arw:managed:start -->
# Issue Audit 记录

## Commit Audit records

提交准备阶段只使用 ARW Engine 写入的 JSON:

- Gate 1 是 `.scratch/<NNNN>-<effort-slug>/issues/<NN>.audit.json`.
- Gate 2 是 `.scratch/<NNNN>-<effort-slug>/spec-audit.json`.
- 当前没有成功工作流使用 Markdown 审计章节, Markdown 表格或 `Full Issue Audit`.

实施提交的完整编排, Reviewer 线程身份, Request, JSONL, Engine 生成和提升规则由 [Commit Audit 工作流](commit-audit-workflow.md)拥有. 本文件只负责正式记录的路径, 字段含义和解释.

同一次提交的 `authorizingIssueIds` 全部属于一个 effort. Gate 1 记录的 `issueId` 使用本地 `issue:<NNNN>:<NN>` Canonical ID. Gate 2 记录的 `effort` 使用 4 位 effort 编号. 正式记录不使用 `schemaVersion`.

Gate 1 使用精确的正数 issue 来源行, 简短要求文本, 定向证据, 以及 `satisfied`, `gap` 或 `uncertain` 结果, 覆盖完整的 issue 要求表面. Gate 2 是 effort 级的. 它的 `documents` 和要求集合只根据该批次中已经接受的授权 issue 的有效 `## Spec Requirement` 并集导出. 它不包含 issue 身份, 也不表达 issue 关系.

如果适用的 Gate 2 effort 具有空要求并集, 需要用户明确确认. 例外包含具体的 `reason`, UTC 秒级 `confirmedAt`, 空文档和要求, 以及 `not-applicable`. 它不存储确认身份, 也不豁免任何其他关卡.

Main Agent 只有在每个适用结果都满足时, 才按 Engine 返回的来源与目标映射提升并暂存精确字节. 任何 `gap` 或 `uncertain` 都会阻止整个批次. 正式记录只对当时冻结并通过验证的候选有效; 之后只作为历史文件保留.
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
None.
<!-- arw:repository-owned:end -->

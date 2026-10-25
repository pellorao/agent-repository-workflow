# Reader Index Update

## Scope

本文档只更新现有 reader index 中一个链接的 stable target path. 它不修改 non-test runtime code, executable behavior, Module responsibility, Interface, Seam, persistent state 或 data flow.

## Requirements

在 `docs/readers/index.md` 中, 把 `architecture/05-validation-report.md#current-reader-index-excerpt` 记录的 `[Validation report](../guides/readiness-output.md)` 替换为 `[Validation report](../reference/validation-report.md)`. New target 必须解析到 H1 identity 为 `Validation Report Reference` 的 `docs/reference/validation-report.md`. Link text 和相邻 entries 的顺序保持不变. Documentation owner 在发布前验证 old target 不再出现, new target 恰好出现一次且 identity 匹配. 该 routine edit 没有需要比较的产品 behavior alternative 或 accepted runtime cost.

## ADR Evaluation

纯 documentation change 不改变 result, failure, security, persistence, authority 或 recovery decision, 因而不触发 ADR.

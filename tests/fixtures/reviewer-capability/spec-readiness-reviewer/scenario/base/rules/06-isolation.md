# 审核隔离规则

## Isolation

Reviewer 只使用 immutable request 中提供的 Input snapshots. Existing readiness record、旧 response 和 live Repository 文件都不是审核 evidence.

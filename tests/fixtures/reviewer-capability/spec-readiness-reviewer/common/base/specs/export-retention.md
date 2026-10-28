# Conditional Export Retention

## Conditional Export Retention

Reader Index Update 把 reader link 指向新的 target. 如果该 target 是 generated artifact, 这次暴露构成 artifact export, export 必须遵循 ADR 0005 的外部 retention policy, authoritative source 为 `docs/adr/0005-external-policy.md#decision`, duration 为 30 天; 如果 target 是人工维护的文档, 本节不适用.

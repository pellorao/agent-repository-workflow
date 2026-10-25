# Conditional Export Retention

## Conditional Export Retention

Reader Index Update 可以把 generated artifact 暴露给 reader. 当该暴露构成 artifact export 时, export 必须遵循 ADR 0005 的外部 retention policy, authoritative source 为 `docs/adr/0005-external-policy.md#decision`, duration 为 30 天. 是否构成 export 仍由本次 reader 交付的适用范围决定.

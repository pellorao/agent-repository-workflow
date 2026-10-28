# Review Implementation Readiness

Status: ready-for-agent

## What to build

实现本 issue 所选的 Validation Report, Result Summary, invalid-input diagnostic wording, indexed cache lookup, single-scan parser strategy, protected access review, promotion, recovery 和 runtime migration 行为, 以及 Reader Index Update. 本 issue 的交付只包括本段明确列出的行为. 下面每个 governing requirement 必须定义其中一项交付所必需的输入; 被列入清单本身不会增加交付内容. Reviewer Request 中的其他 Inputs 仅作为 supporting evidence, 不会因为被提供而成为交付要求.

## Spec Requirement

Governing requirements:

- `specs/diagnostic-wording.md#requirements`
- `specs/validation-report.md#requirements`
- `specs/reader-index.md#requirements`
- `specs/cache-indexing.md#requirements`
- `specs/parser-scan.md#requirements`
- `specs/access-review.md#requirements`
- `specs/result-summary.md#requirements`
- `specs/promotion-runtime.md#requirements`
- `specs/promotion-recovery.md#requirements`
- `specs/runtime-migration.md#requirements`
- `specs/export-retention.md#conditional-export-retention`
- `specs/image-cache.md#preview-cleanup`
- `specs/request-consistency.md#requirements`

## Acceptance criteria

- [ ] 调用方可见行为通过各自 public lifecycle 验证, 并保持指定 authority 和 failure contract; 纯内部 cache 和 parser 算法策略, 以及 promotion 的 request binding 和 retentionDays 应用通过源码审查核对.

## Blocked by

- None

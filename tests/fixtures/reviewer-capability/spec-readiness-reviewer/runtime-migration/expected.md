# Expected findings

Hidden from the Reviewer. Each problem is one seeded defect; a finding matches when it names the same defect, whichever equivalent location it cites.

## Problems

1. The subject selects specs/request-consistency.md, but no matching governing Input was supplied. (`.scratch/0001-reviewer-capability/issues/01-review-readiness.md:21`)
2. Runtime Migration successful result omits the summary required by Result Summary. (`specs/runtime-migration.md:23`, `specs/result-summary.md:11`, `specs/promotion-runtime.md:37`)
3. Runtime Migration expected filesystem failure omits the operation field required by Promotion Runtime. (`specs/runtime-migration.md:23`, `specs/promotion-runtime.md:41`, `specs/promotion-runtime.md:11`)
4. The subject adds image-preview cleanup that is not needed to implement this issue. (`specs/image-cache.md:5`, `.scratch/0001-reviewer-capability/issues/01-review-readiness.md:3`, `specs/reader-index.md:5`, `.scratch/0001-reviewer-capability/issues/01-review-readiness.md:20`)
5. The supplied design cannot establish whether the conditional export-retention section belongs to this issue. (`specs/export-retention.md:5`, `specs/reader-index.md:9`, `.scratch/0001-reviewer-capability/issues/01-review-readiness.md:3`, `specs/reader-index.md:5`)

## Clean

Reporting one of these as a problem is a false positive.

- The subject accurately selects the supplied validation-report requirement and should not be reported as absent. (`.scratch/0001-reviewer-capability/issues/01-review-readiness.md:10`)
- The clean Artifact reader design is supported by explicit architecture evidence. (`architecture/05-validation-report.md:65`)
- The immutable request isolation boundary is complete and usable as supplied. (`rules/06-isolation.md:5`)
- The clean exemption preserves the structured diagnostic code and payload contract. (`specs/diagnostic-wording.md:9`)
- The clean report requirements define a complete and verifiable structured result. (`specs/validation-report.md:11`)
- The clean omitted spec is a complete stable-path documentation change. (`specs/reader-index.md:9`)
- The stable boundary correctly separates Engine, Reviewer, and Input-author responsibilities. (`architecture/05-validation-report.md:5`)
- The clean complete Requirements do not need to prescribe internal parser, helper, or storage implementation details. (`specs/validation-report.md:11`)

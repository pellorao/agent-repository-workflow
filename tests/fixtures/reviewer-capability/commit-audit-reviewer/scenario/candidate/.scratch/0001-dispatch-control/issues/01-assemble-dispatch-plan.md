# Assemble Dispatch Plan

Status: completed

## What to build

Connect dispatch planning and execution through the public dispatch entry.

## Spec Requirement

Governing requirements:

- `.scratch/0001-dispatch-control/spec.md#requirements`

## Acceptance criteria

### Planning

- [x] `orderStops` orders a copied list by descending priority and then ascending sequence.
- [x] The capacity boundary test exercises a total exactly equal to the configured limit.
- [x] `executeAuthorizedPlan` checks authorization before invoking dispatch.
- [x] `planFailure` returns a structured non-throwing failure result.
- [x] `totalPackageWeight` sums every package weight without changing the package list.
- [x] `chooseDeparture` evaluates the inclusive dispatch window in UTC.
- [x] `redactNestedDriverToken` removes a nested driver token from telemetry.

### Boundaries

- [x] `emitPlanCreated` emits `plan.created` only after storage succeeds.
- [x] `hasDuplicateRouteKeys` rejects duplicates after route-key normalization.
- [x] `parseRetryCount` accepts only integer counts from 0 through 3 and otherwise returns an error result.
- [x] `remainingVehicleCapacity` never returns a negative value.
- [x] `createDispatchPlan` returns an ordered plan without mutating the supplied stop list.
- [x] `previewPlan` returns a dry-run result without invoking storage.
- [x] `redactAccessLog` removes token and secret fields while preserving other fields.

### Execution

- [x] `loadAllowedRegions` obtains the allowed-region list from the configured policy provider.
- [x] `preserveDriverLabel` trims surrounding whitespace without changing letter case.
- [x] The invalid-storage test asserts that validation failure performs zero writes.
- [x] `savePlan` validates a plan before the first persistent write.
- [x] `computeBackoff` doubles from 250 milliseconds and caps the result at 2000 milliseconds.
- [x] `retryTransient` permits retries only for errors explicitly marked transient.
- [x] `restorePlan` confirms that a partial-write restore completed successfully.

### Verification

- [x] `retainScheduleOffset` preserves the supplied offset exactly.
- [x] `runEligibleStops` skips cancelled stops while retaining the other stop order.
- [x] `withinVehicleCapacity` accepts a total equal to the configured limit.
- [x] `canPlanRoute` requires both the `routes:plan` scope and matching depot ownership.
- [x] `serializePlan` sorts keys lexically, uses two-space JSON, and ends with one LF.
- [x] `selectActiveClaims` excludes claims before their start and at or after expiry.
- [x] `checksumPlan` hashes the bytes returned by the plan serializer.

## Blocked by

None.

## Validation

- The staged dispatch implementation and focused tests were reviewed against every acceptance criterion.

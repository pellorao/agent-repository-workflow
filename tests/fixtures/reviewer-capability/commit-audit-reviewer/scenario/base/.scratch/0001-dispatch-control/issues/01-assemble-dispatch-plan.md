# Assemble Dispatch Plan

Status: ready-for-agent

## What to build

Connect dispatch planning and execution through the public dispatch entry.

## Spec Requirement

Governing requirements:

- `.scratch/0001-dispatch-control/spec.md#requirements`

## Acceptance criteria

### Planning

- [ ] `orderStops` orders a copied list by descending priority and then ascending sequence.
- [ ] The capacity boundary test exercises a total exactly equal to the configured limit.
- [ ] `executeAuthorizedPlan` checks authorization before invoking dispatch.
- [ ] `planFailure` returns a structured non-throwing failure result.
- [ ] `totalPackageWeight` sums every package weight without changing the package list.
- [ ] `chooseDeparture` evaluates the inclusive dispatch window in UTC.
- [ ] `redactNestedDriverToken` removes a nested driver token from telemetry.

### Boundaries

- [ ] `emitPlanCreated` emits `plan.created` only after storage succeeds.
- [ ] `hasDuplicateRouteKeys` rejects duplicates after route-key normalization.
- [ ] `parseRetryCount` accepts only integer counts from 0 through 3 and otherwise returns an error result.
- [ ] `remainingVehicleCapacity` never returns a negative value.
- [ ] `createDispatchPlan` returns an ordered plan without mutating the supplied stop list.
- [ ] `previewPlan` returns a dry-run result without invoking storage.
- [ ] `redactAccessLog` removes token and secret fields while preserving other fields.

### Execution

- [ ] `loadAllowedRegions` obtains the allowed-region list from the configured policy provider.
- [ ] `preserveDriverLabel` trims surrounding whitespace without changing letter case.
- [ ] The invalid-storage test asserts that validation failure performs zero writes.
- [ ] `savePlan` validates a plan before the first persistent write.
- [ ] `computeBackoff` doubles from 250 milliseconds and caps the result at 2000 milliseconds.
- [ ] `retryTransient` permits retries only for errors explicitly marked transient.
- [ ] `restorePlan` confirms that a partial-write restore completed successfully.

### Verification

- [ ] `retainScheduleOffset` preserves the supplied offset exactly.
- [ ] `runEligibleStops` skips cancelled stops while retaining the other stop order.
- [ ] `withinVehicleCapacity` accepts a total equal to the configured limit.
- [ ] `canPlanRoute` requires both the `routes:plan` scope and matching depot ownership.
- [ ] `serializePlan` sorts keys lexically, uses two-space JSON, and ends with one LF.
- [ ] `selectActiveClaims` excludes claims before their start and at or after expiry.
- [ ] `checksumPlan` hashes the bytes returned by the plan serializer.

## Blocked by

None.

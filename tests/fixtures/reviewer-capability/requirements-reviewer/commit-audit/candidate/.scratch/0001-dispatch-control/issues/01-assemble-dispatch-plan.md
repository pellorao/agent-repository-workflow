# Assemble Dispatch Plan

Status: completed

## What to build

Connect dispatch planning and execution through the public dispatch entry.

## Spec Requirement

Governing requirements:

- `.scratch/0001-dispatch-control/spec.md#requirements`

## Acceptance criteria

### Planning

- [x] Under `docs/dispatch/dispatch-policy.md`, `nextRetryDelay` applies the Retry timing rules to every server-provided `retryAfter`.
- [x] `executeAuthorizedPlan` rejects an unauthorized caller before invoking dispatch.
- [x] Under `docs/dispatch/dispatch-policy.md`, `stopsForDriver` returns exactly the stops whose assigned driver is the given driver.
- [x] Under `docs/dispatch/storage-contract.md`, `writePlanAtomically` renames the temporary bytes only after they are durable.
- [x] Under `docs/dispatch/dispatch-policy.md`, `chooseDeparture` applies every Departure timing rule.
- [x] `redactNestedDriverToken` removes a nested driver token from telemetry.

### Boundaries

- [x] `emitPlanCreated` emits `plan.created` only after storage succeeds.
- [x] Under `docs/dispatch/dispatch-policy.md`, `hasDuplicateRouteKeys` reports duplicates exactly when two stops are duplicates.
- [x] Under `docs/dispatch/dispatch-policy.md`, `parseRetryCount` accepts exactly the valid retry counts and otherwise returns a result whose `ok` is `false`.
- [x] `remainingVehicleCapacity` never returns a negative value.
- [x] Under `docs/dispatch/dispatch-policy.md`, `pendingStops` returns every stop except the delivered stops.
- [x] `previewPlan` returns a dry-run result without invoking storage.
- [x] `redactAccessLog` removes token and secret fields while preserving other fields.

### Execution

- [x] `orderedDestinationGroups` returns the destination groups of the records in ascending lexical order.
- [x] Under `docs/dispatch/adapter-contracts.md`, `routeDistance` rejects when no road connects two consecutive points.
- [x] `savePlan` validates a plan before the first persistent write.
- [x] `computeBackoff` doubles from 250 milliseconds and caps the result at 2000 milliseconds.
- [x] `retryTransient` permits retries only for errors explicitly marked transient.
- [x] Under `docs/dispatch/adapter-contracts.md`, `locateStops` leaves out every stop whose address the geocoder does not know.

### Verification

- [x] `retainScheduleOffset` preserves the supplied offset exactly.
- [x] `runEligibleStops` skips cancelled stops while retaining the other stop order.
- [x] Under `docs/dispatch/dispatch-policy.md`, `withinVehicleCapacity` accepts a total equal to the configured limit.
- [x] Under `docs/dispatch/dispatch-policy.md`, `canPlanRoute` treats an actor holding `routes:admin` as owning every depot.
- [x] Under `docs/dispatch/dispatch-policy.md`, `canPlanRoute` refuses every suspended actor.
- [x] `selectActiveClaims` excludes claims before their start and at or after expiry.
- [x] `checksumPlan` hashes the bytes returned by the plan serializer.

## Blocked by

None.

## Validation

- The staged dispatch implementation and focused tests were reviewed against every acceptance criterion.

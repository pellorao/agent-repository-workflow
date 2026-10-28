# Assemble Dispatch Plan

Status: ready-for-agent

## What to build

Connect dispatch planning and execution through the public dispatch entry.

## Spec Requirement

Governing requirements:

- `.scratch/0001-dispatch-control/spec.md#requirements`

## Acceptance criteria

### Planning

- [ ] Under `docs/dispatch/dispatch-policy.md`, `nextRetryDelay` applies the Retry timing rules to every server-provided `retryAfter`.
- [ ] `executeAuthorizedPlan` rejects an unauthorized caller before invoking dispatch.
- [ ] Under `docs/dispatch/dispatch-policy.md`, `stopsForDriver` returns exactly the stops whose assigned driver is the given driver.
- [ ] Under `docs/dispatch/storage-contract.md`, `writePlanAtomically` renames the temporary bytes only after they are durable.
- [ ] Under `docs/dispatch/dispatch-policy.md`, `chooseDeparture` applies every Departure timing rule.
- [ ] `redactNestedDriverToken` removes a nested driver token from telemetry.

### Boundaries

- [ ] `emitPlanCreated` emits `plan.created` only after storage succeeds.
- [ ] Under `docs/dispatch/dispatch-policy.md`, `hasDuplicateRouteKeys` reports duplicates exactly when two stops are duplicates.
- [ ] Under `docs/dispatch/dispatch-policy.md`, `parseRetryCount` accepts exactly the valid retry counts and otherwise returns a result whose `ok` is `false`.
- [ ] `remainingVehicleCapacity` never returns a negative value.
- [ ] Under `docs/dispatch/dispatch-policy.md`, `pendingStops` returns every stop except the delivered stops.
- [ ] `previewPlan` returns a dry-run result without invoking storage.
- [ ] `redactAccessLog` removes token and secret fields while preserving other fields.

### Execution

- [ ] `orderedDestinationGroups` returns the destination groups of the records in ascending lexical order.
- [ ] Under `docs/dispatch/adapter-contracts.md`, `routeDistance` rejects when no road connects two consecutive points.
- [ ] `savePlan` validates a plan before the first persistent write.
- [ ] `computeBackoff` doubles from 250 milliseconds and caps the result at 2000 milliseconds.
- [ ] `retryTransient` permits retries only for errors explicitly marked transient.
- [ ] Under `docs/dispatch/adapter-contracts.md`, `locateStops` leaves out every stop whose address the geocoder does not know.

### Verification

- [ ] `retainScheduleOffset` preserves the supplied offset exactly.
- [ ] `runEligibleStops` skips cancelled stops while retaining the other stop order.
- [ ] Under `docs/dispatch/dispatch-policy.md`, `withinVehicleCapacity` accepts a total equal to the configured limit.
- [ ] Under `docs/dispatch/dispatch-policy.md`, `canPlanRoute` treats an actor holding `routes:admin` as owning every depot.
- [ ] Under `docs/dispatch/dispatch-policy.md`, `canPlanRoute` refuses every suspended actor.
- [ ] `selectActiveClaims` excludes claims before their start and at or after expiry.
- [ ] `checksumPlan` hashes the bytes returned by the plan serializer.

## Blocked by

None.

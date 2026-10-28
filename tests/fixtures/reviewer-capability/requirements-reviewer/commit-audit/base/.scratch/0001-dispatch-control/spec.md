# Dispatch Control Rules

## Requirements

### Identity and ordering

- Stop ordering uses descending priority followed by ascending sequence.
- Publication audit records include action, actor, and timestamp.
- Window membership includes both the declared start and end hour.
- Schedule offsets pass through without coercion.
- Under `docs/dispatch/dispatch-policy.md`, a route duration adds the travel minutes and the service time of every stop.
- Under `docs/dispatch/dispatch-policy.md`, manifest-event redaction removes every credential nested inside authentication data.
- Empty manifests use an empty entries array and a generated marker.
- Publication failure telemetry includes the manifest ID, error, and timestamp.
- Driver labels are trimmed without changing their letter case.
- `savePlan` completes validation before its first write.
- Under `docs/dispatch/storage-contract.md`, announcement failure rolls back the manifest written earlier in the same operation.

### Capacity and access

- Package IDs are trimmed, deduplicated, and sorted lexically.
- Package coalescing removes duplicate IDs across destination groups.
- Under `docs/dispatch/storage-contract.md`, atomic plan writes remove temporary bytes when the rename operation fails.
- Under `docs/dispatch/storage-contract.md`, `publishManifest` returns, in a success result, the manifest object that `store.put` durably stored.
- Eligible-stop execution excludes cancelled stops.
- Under `docs/dispatch/dispatch-policy.md`, assigning all packages accepts a total equal to the vehicle limit.
- The public dispatch entry exports the execution operations used by callers.
- Publication success telemetry includes the manifest ID and timestamp.
- Plan previews return without touching persistent storage.
- Appending a stable stop returns a new list.
- Dispatch backoff is capped at 2000 milliseconds.

### Time and retry

- Two plans that differ only in the order of the fields inside their nested objects have the same plan hash.
- Transient retry classification requires an explicit true marker.
- Depot ownership requires equal actor and route depot identifiers.
- Under `docs/dispatch/dispatch-policy.md`, urgent-stop partitioning places every stop in exactly one partition according to its urgency.
- Destination keys are normalized with NFKC, trimmed, and uppercased.
- Under `docs/dispatch/dispatch-policy.md`, the next dispatch time is the later supplied bound adjusted by Departure timing rules 10, 12, and 13.
- Plan-created telemetry is emitted only after plan storage succeeds.
- Access-log redaction removes both token and secret fields.
- Under `docs/dispatch/storage-contract.md`, atomic plan writes rename the temporary bytes only after they are durable.
- `toStableJson` uses two-space indentation and one terminal LF.
- `orderManifestGroups` orders destination groups in ascending lexical order.
- Manifest NDJSON ends every record, including the final record, with LF.

### Storage and execution

- Under `docs/dispatch/dispatch-policy.md`, the ordinary stop-ordering operation follows the Stop priority rules.
- Destination grouping uses normalized keys and copied records.
- Batch authorization rejects the batch when any route fails depot ownership.
- Under `docs/dispatch/dispatch-policy.md`, package weighing records each package weight in the unit that the Vehicle capacity rules give.
- Blackout intervals include the start and exclude the end.
- Authorized execution rejects a caller before invoking dispatch.
- Successful publication results and failed publication results use distinct structured variants.
- Blank package IDs make a manifest entry invalid.
- Under `docs/dispatch/dispatch-policy.md`, a driver's workload counts exactly the stops whose assigned driver is that driver.
- Under `docs/dispatch/dispatch-policy.md`, retry-count parsing accepts exactly the valid retry counts and rejects every other value.
- Serialized plan parsing returns structured success or failure.
- Under `docs/dispatch/dispatch-policy.md`, the delivered-stop count counts exactly the delivered stops.

### Publication

- The ordinary stop-ordering operation sorts a copy of its input.
- Stops at the vehicle weight limit remain in the accepted partition.
- Given a positive integer maximum, manifest chunks never exceed that configured size.
- `normalizeRouteKey` applies NFKC before trimming and uppercasing.
- Normalized plan storage keys trim and uppercase route keys.
- Under `docs/dispatch/dispatch-policy.md`, measured vehicle limits use the unit that the Vehicle capacity rules give.
- Under `docs/dispatch/dispatch-policy.md`, publication retries stop immediately for failures that the Failure classification rules do not make transient.
- UTF-8 encoding uses the explicit `utf8` encoding name.
- Under `docs/dispatch/dispatch-policy.md`, a suspended actor cannot plan any route.
- Under `docs/dispatch/dispatch-policy.md`, delivery notices go to the contact phone of every manifest entry.
- Under `docs/dispatch/dispatch-policy.md`, the next retry delay follows the Retry timing rules whenever the server provides `retryAfter`.

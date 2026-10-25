# Dispatch Control Rules

## Requirements

### Identity and ordering

- Stop ordering uses descending priority followed by ascending sequence.
- Publication audit records include action, actor, and timestamp.
- Window membership includes both the declared start and end hour.
- Schedule offsets pass through without coercion.
- Stable JSON sorts keys recursively at every object depth.
- Manifest-event redaction removes credentials nested inside authentication data.
- Inactive authorization claims are excluded before route planning.
- Empty manifests use an empty entries array and a generated marker.
- Publication failure telemetry includes the manifest ID, error, and timestamp.
- Driver labels are trimmed without changing their letter case.
- `savePlan` completes validation before its first write.
- Announcement failure rolls back the manifest written earlier in the same operation.

### Capacity and access

- Package IDs are trimmed, deduplicated, and sorted lexically.
- Package coalescing removes duplicate IDs across destination groups.
- Atomic plan writes remove temporary bytes when the rename operation fails.
- Under `docs/dispatch/storage-contract.md`, `publishManifest` returns the exact manifest object durably stored by `store.put` in a success result.
- Eligible-stop execution excludes cancelled stops.
- Assigning all packages accepts a total equal to the vehicle limit.
- The public dispatch entry exports the execution operations used by callers.
- Publication success telemetry includes the manifest ID and timestamp.
- Plan previews return without touching persistent storage.
- Appending a stable stop returns a new list.
- Dispatch backoff is capped at 2000 milliseconds.
- Announcement payloads omit top-level credential fields.

### Time and retry

- Frozen dispatch plans also freeze a copied stop list.
- Transient retry classification requires an explicit true marker.
- Depot ownership requires equal actor and route depot identifiers.
- Urgent-stop partitioning leaves the supplied stop list unchanged.
- Destination keys are normalized with NFKC, trimmed, and uppercased.
- The next dispatch time is not earlier than either supplied bound.
- Plan-created telemetry is emitted only after plan storage succeeds.
- Access-log redaction removes both token and secret fields.
- Package weight totals include every supplied package.
- `toStableJson` uses two-space indentation and one terminal LF.
- Manifest destination groups are ordered in ascending lexical order.
- Manifest NDJSON ends every record, including the final record, with LF.

### Storage and execution

- The publication integration test invokes `publishManifest` through the binding imported from the public dispatch entry.
- Destination grouping uses normalized keys and copied records.
- Batch authorization checks depot ownership for every route in the batch.
- Plan restoration reports whether the storage adapter restored the requested snapshot.
- Blackout intervals include the start and exclude the end.
- Authorized execution rejects a caller before invoking dispatch.
- Successful publication results and failed publication results use distinct structured variants.
- Blank package IDs make a manifest entry invalid.
- An explicit vehicle capacity of zero is preserved instead of replaced by a default.
- Retry-count parsing accepts integers from 0 through 3 and rejects fractions and integers outside that range.
- Serialized plan parsing returns structured success or failure.
- Depot aliases are trimmed and lowercased.

### Publication

- The ordinary stop-ordering operation sorts a copy of its input.
- Stops at the vehicle weight limit remain in the accepted partition.
- Given a positive integer maximum, manifest chunks never exceed that configured size.
- `normalizeRouteKey` applies NFKC before trimming and uppercasing.
- Normalized plan storage keys trim and uppercase route keys.
- The declared departure window records UTC as its time zone.
- Publication retries stop immediately for errors not marked transient.
- UTF-8 encoding uses the explicit `utf8` encoding name.
- Planning scope matching accepts only the exact `routes:plan` scope.
- Route tokens combine the normalized destination and route key.
- Server-provided retry delays are capped at 2000 milliseconds.

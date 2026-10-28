# Publish Dispatch Manifest

Status: completed

## What to build

Connect dispatch manifest publication through the public dispatch entry.

## Spec Requirement

Governing requirements:

- `.scratch/0001-dispatch-control/spec.md#requirements`

## Acceptance criteria

### Planning

- [x] `safeAnnouncement` omits a top-level credential from the announcement payload.
- [x] `encodeUtf8` encodes publication bytes as UTF-8.
- [x] `manifestEntryIsValid` rejects blank package IDs.
- [x] Under `docs/dispatch/storage-contract.md`, `publishWithAnnouncement` removes the stored manifest when announcement delivery fails.
- [x] Under `docs/dispatch/dispatch-policy.md`, `redactManifestEvent` removes every credential nested below an `auth` field.

### Boundaries

- [x] Given a positive integer maximum, `chunkManifest` limits every non-empty chunk to that configured maximum.
- [x] Under `docs/dispatch/storage-contract.md`, `publishWithAnnouncement` waits for the exact manifest to be durably stored before sending its announcement.
- [x] `serializeManifestRecords` emits NDJSON with one LF after every record, including the last.
- [x] `orderManifestGroups` orders destination groups in ascending lexical order.
- [x] Under `docs/dispatch/dispatch-policy.md`, `manifestRecipients` lists the contact phone of every manifest entry that has a `phone`.

### Execution

- [x] `publicationResult` returns structured success and failure variants.
- [x] `normalizedPlanKey` trims and uppercases the route-key storage segment.
- [x] `buildManifest` copies record objects instead of mutating supplied records.
- [x] Under `docs/dispatch/dispatch-policy.md`, `publishWithRetry` stops after the allowed number of publication attempts.
- [x] `publishManifest` stores the manifest only when every entry is valid.

### Verification

- [x] `successTelemetry` records the success event, manifest ID, and timestamp.
- [x] `groupByDestination` groups records using normalized destination keys.
- [x] Under `docs/dispatch/dispatch-policy.md`, `departureMinute` is a stop's `arrivalMinute` plus its service time.
- [x] Under `docs/dispatch/dispatch-policy.md`, `publishWithRetry` retries only failures that the Failure classification rules make transient.
- [x] `preserveManifestDriver` trims driver labels without changing letter case.
- [x] `coalescePackages` removes duplicate package IDs across the complete manifest.

## Blocked by

None.

## Validation

- The staged publication implementation and focused tests were reviewed against every acceptance criterion.

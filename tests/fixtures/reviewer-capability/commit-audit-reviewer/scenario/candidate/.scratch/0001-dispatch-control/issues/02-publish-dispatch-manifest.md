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
- [x] `publishWithAnnouncement` removes the stored manifest when announcement delivery fails.
- [x] `emptyManifest` produces an eligible manifest with an empty entries list.
- [x] `redactManifestEvent` removes credentials nested below an `auth` field.
- [x] `emptyManifest` marks an empty manifest as generated.

### Boundaries

- [x] Given a positive integer maximum, `chunkManifest` limits every non-empty chunk to that configured maximum.
- [x] `preserveManifestDriver` preserves driver-label letter case.
- [x] Under `docs/dispatch/storage-contract.md`, `publishWithAnnouncement` waits for the exact manifest to be durably stored before sending its announcement.
- [x] The public dispatch entry exports `publishManifest`.
- [x] `serializeManifestRecords` emits NDJSON with one LF after every record, including the last.
- [x] `orderManifestGroups` orders destination groups in ascending lexical order.
- [x] `auditFieldsPresent` requires action, actor, and timestamp fields.

### Execution

- [x] `publicationResult` returns structured success and failure variants.
- [x] `normalizedPlanKey` trims and uppercases the route-key storage segment.
- [x] `buildManifest` copies record objects instead of mutating supplied records.
- [x] `publicationRetryBudget` is two attempts.
- [x] `normalizePackageIds` removes duplicates within a supplied package-ID list.
- [x] `publishManifest` validates every entry before storing the manifest.
- [x] The publication integration test imports through the public dispatch entry.

### Verification

- [x] `successTelemetry` records the success event, manifest ID, and timestamp.
- [x] `groupByDestination` groups records using normalized destination keys.
- [x] `failureTelemetry` records the failure event, error, manifest ID, and timestamp.
- [x] `publishWithRetry` retries only failures explicitly marked transient.
- [x] `normalizePackageIds` produces a stable lexical package-ID order.
- [x] `preserveManifestDriver` trims driver labels without changing letter case.
- [x] `checksumPlan` supplies serialized plan bytes to the configured hasher.
- [x] `coalescePackages` removes duplicate package IDs across the complete manifest.

## Blocked by

None.

## Validation

- The staged publication implementation and focused tests were reviewed against every acceptance criterion.

# Publish Dispatch Manifest

Status: ready-for-agent

## What to build

Connect dispatch manifest publication through the public dispatch entry.

## Spec Requirement

Governing requirements:

- `.scratch/0001-dispatch-control/spec.md#requirements`

## Acceptance criteria

### Planning

- [ ] `safeAnnouncement` omits a top-level credential from the announcement payload.
- [ ] `encodeUtf8` encodes publication bytes as UTF-8.
- [ ] `manifestEntryIsValid` rejects blank package IDs.
- [ ] `publishWithAnnouncement` removes the stored manifest when announcement delivery fails.
- [ ] `emptyManifest` produces an eligible manifest with an empty entries list.
- [ ] `redactManifestEvent` removes credentials nested below an `auth` field.
- [ ] `emptyManifest` marks an empty manifest as generated.

### Boundaries

- [ ] `chunkManifest` limits every non-empty chunk to the configured maximum.
- [ ] `preserveManifestDriver` preserves driver-label letter case.
- [ ] Under `docs/dispatch/storage-contract.md`, `publishWithAnnouncement` waits for the exact manifest to be durably stored before sending its announcement.
- [ ] The public dispatch entry exports `publishManifest`.
- [ ] `serializeManifestRecords` emits NDJSON with one LF after every record, including the last.
- [ ] `orderManifestGroups` orders destination groups in ascending lexical order.
- [ ] `auditFieldsPresent` requires action, actor, and timestamp fields.

### Execution

- [ ] `publicationResult` returns structured success and failure variants.
- [ ] `normalizedPlanKey` trims and uppercases the route-key storage segment.
- [ ] `buildManifest` copies record objects instead of mutating supplied records.
- [ ] `publicationRetryBudget` is two attempts.
- [ ] `normalizePackageIds` removes duplicates within a supplied package-ID list.
- [ ] `publishManifest` validates every entry before storing the manifest.
- [ ] The publication integration test imports through the public dispatch entry.

### Verification

- [ ] `successTelemetry` records the success event, manifest ID, and timestamp.
- [ ] `groupByDestination` groups records using normalized destination keys.
- [ ] `failureTelemetry` records the failure event, error, manifest ID, and timestamp.
- [ ] `publishWithRetry` retries only failures explicitly marked transient.
- [ ] `normalizePackageIds` produces a stable lexical package-ID order.
- [ ] `preserveManifestDriver` trims driver labels without changing letter case.
- [ ] `checksumPlan` supplies serialized plan bytes to the configured hasher.
- [ ] `coalescePackages` removes duplicate package IDs across the complete manifest.

## Blocked by

None.

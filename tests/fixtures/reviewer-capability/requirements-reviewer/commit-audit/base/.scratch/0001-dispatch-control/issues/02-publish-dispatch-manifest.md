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
- [ ] Under `docs/dispatch/storage-contract.md`, `publishWithAnnouncement` removes the stored manifest when announcement delivery fails.
- [ ] Under `docs/dispatch/dispatch-policy.md`, `redactManifestEvent` removes every credential nested below an `auth` field.

### Boundaries

- [ ] `chunkManifest` limits every non-empty chunk to the configured maximum.
- [ ] Under `docs/dispatch/storage-contract.md`, `publishWithAnnouncement` waits for the exact manifest to be durably stored before sending its announcement.
- [ ] `serializeManifestRecords` emits NDJSON with one LF after every record, including the last.
- [ ] `orderManifestGroups` orders destination groups in ascending lexical order.
- [ ] Under `docs/dispatch/dispatch-policy.md`, `manifestRecipients` lists the contact phone of every manifest entry that has a `phone`.

### Execution

- [ ] `publicationResult` returns structured success and failure variants.
- [ ] `normalizedPlanKey` trims and uppercases the route-key storage segment.
- [ ] `buildManifest` copies record objects instead of mutating supplied records.
- [ ] Under `docs/dispatch/dispatch-policy.md`, `publishWithRetry` stops after the allowed number of publication attempts.
- [ ] `publishManifest` stores the manifest only when every entry is valid.

### Verification

- [ ] `successTelemetry` records the success event, manifest ID, and timestamp.
- [ ] `groupByDestination` groups records using normalized destination keys.
- [ ] Under `docs/dispatch/dispatch-policy.md`, `departureMinute` is a stop's `arrivalMinute` plus its service time.
- [ ] Under `docs/dispatch/dispatch-policy.md`, `publishWithRetry` retries only failures that the Failure classification rules make transient.
- [ ] `preserveManifestDriver` trims driver labels without changing letter case.
- [ ] `coalescePackages` removes duplicate package IDs across the complete manifest.

## Blocked by

None.

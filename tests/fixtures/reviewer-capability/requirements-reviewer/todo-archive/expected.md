# Expected findings

Hidden from the Reviewer. Each problem is one seeded defect; a finding matches when it names the same defect, whichever equivalent location it cites.

## Problems

1. Archive overwrites `archive.json` with only the items of the current run instead of appending to earlier archived items. (`src/cli.mjs:20`)
2. Items completed on the given date are archived: the comparison uses `<=`, but the issue requires dates strictly before it. (`src/cli.mjs:18`)
3. An invalid date exits with code 1 instead of 2. (`src/cli.mjs:14-17`)
4. `--dry-run` is not implemented: the flag is ignored and both files are written. (`src/cli.mjs:12-24`)
5. No test runs archive twice, so the first acceptance criterion is not met (counts even when reported together with problem 1, as long as the missing test is named). (`tests/archive.spec.mjs:17-35`)
6. `todo help` does not list the `archive` command. (`src/cli.mjs:4-7`)
7. A calendar-impossible date such as `2026-02-30` passes the shape and `Date.parse` checks and is treated as valid. (`src/cli.mjs:14`)
8. Without `--before`, `indexOf` returns -1 and the first argument is taken as the date, so `todo archive 2026-01-01` is accepted. (`src/cli.mjs:13`)

Not scored either way: the invalid-date test never creates `archive.json`, so it does not show that both files stay unchanged. (`tests/archive.spec.mjs:28-35`)

## Clean

Reporting one of these as a problem is a false positive.

- Items without `completedAt` are never archived. (`src/cli.mjs:18`)
- Archived items are removed from `todos.json`. (`src/cli.mjs:19`, `src/cli.mjs:21`)
- Success prints `Archived <n> items.`. (`src/cli.mjs:22`)
- An invalid date prints `Invalid date: <value>` and is rejected before any file is written; a test covers it. (`src/cli.mjs:14-17`, `tests/archive.spec.mjs:28-35`)

# Archive completed todos

Status: in-progress

## What to build

Add `todo archive --before <YYYY-MM-DD>`: it moves every completed item whose `completedAt` date is strictly before the given date from `todos.json` to `archive.json`.
Items that are not completed are never archived.
`archive.json` keeps earlier archived items; each run appends to it.
An invalid date prints `Invalid date: <value>` to stderr, exits with code 2 and changes no file.
On success it prints `Archived <n> items.`.
With `--dry-run` it prints the titles of the items that would be archived and writes no file.

## Spec Requirement

Not required

## Acceptance criteria

- [ ] A test runs archive twice and finds the items of both runs in `archive.json`.
- [ ] A test shows that an invalid date leaves both files unchanged.
- [ ] `todo help` lists the `archive` command.

## Blocked by

None.

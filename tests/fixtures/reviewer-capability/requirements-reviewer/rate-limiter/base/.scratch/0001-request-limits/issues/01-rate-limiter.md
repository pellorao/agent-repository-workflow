# Per-client rate limiter

Status: in-progress

## What to build

Add `src/rate-limiter.mjs` exporting `createRateLimiter({limit, windowMs, now})`; its `check(clientId)` allows at most `limit` requests per client in any sliding window of `windowMs` milliseconds and returns `{allowed, retryAfterMs}`.
For an allowed request `retryAfterMs` is 0; for a rejected request it is the time until the oldest counted request of that client leaves the window.
Rejected requests are not counted toward the limit.
Each client is limited independently: requests from one client never affect another client.
`createRateLimiter` throws a `RangeError` when `limit` is not a positive integer or `windowMs` is not a positive number.
In `src/server.mjs`, a rejected request gets HTTP status 429 and a `Retry-After` header holding `retryAfterMs` in whole seconds, rounded up.

## Spec Requirement

Not required

## Acceptance criteria

- [ ] Tests cover the window boundary, rejected requests not being counted, per-client independence and invalid options.
- [ ] A rejected request to the server receives 429 with `Retry-After`.
- [ ] `README.md` documents the `limit` and `windowMs` options.

## Blocked by

None.

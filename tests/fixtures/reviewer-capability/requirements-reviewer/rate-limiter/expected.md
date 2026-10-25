# Expected findings

Hidden from the Reviewer. Each problem is one seeded defect; a finding matches when it names the same defect, whichever equivalent location it cites.

## Problems

1. Rejected requests are counted: `check` stores the timestamp before comparing with `limit`, so a rejected request occupies a slot and a client that keeps retrying is never allowed again. (`src/rate-limiter.mjs:9-11`)
2. `retryAfterMs` is computed from the newest request instead of the oldest counted request of the client. (`src/rate-limiter.mjs:12-13`)
3. `limit` is checked only for being a positive number; a non-integer such as 1.5 is accepted instead of throwing `RangeError`. (`src/rate-limiter.mjs:2`)
4. `Retry-After` rounds down with `Math.floor` instead of rounding up to whole seconds. (`src/server.mjs:6`)
5. Tests do not cover rejected requests not being counted or per-client independence (nor a non-integer `limit`), so the first acceptance criterion is not met. (`tests/rate-limiter.spec.mjs:13-26`)
6. `README.md` does not document `windowMs`. (`README.md:7`)

## Clean

Reporting one of these as a problem is a false positive.

- The sliding window keeps only requests newer than `now - windowMs`. (`src/rate-limiter.mjs:8`)
- Clients are tracked in a map keyed by `clientId`, so they are limited independently. (`src/rate-limiter.mjs:4`, `src/rate-limiter.mjs:8-10`)
- An allowed request returns `retryAfterMs: 0`. (`src/rate-limiter.mjs:11`)
- `windowMs` validation throws `RangeError` for non-positive values. (`src/rate-limiter.mjs:3`)
- The server answers a rejected request with status 429, and a test covers it. (`src/server.mjs:5-8`, `tests/rate-limiter.spec.mjs:28-35`)

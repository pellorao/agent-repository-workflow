# Request service

`createAppServer({handle, limiter})` serves every request with the text returned by `handle(request)`.

## Rate limiting

Pass `limiter: createRateLimiter({limit})` to reject clients that send more than `limit` requests in the window. Rejected requests receive status 429 and a `Retry-After` header.

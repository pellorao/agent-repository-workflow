# Dispatch Policy

This document is reference policy, not a list of requirements. Its rules apply only to requirements that cite this document. Within one section, a later rule overrides an earlier rule wherever both apply.

## Route planning

1. Planning a route requires the exact `routes:plan` scope among the actor's held scopes and ownership of the route depot.
2. An actor owns a depot when the actor and route depot identifiers are equal.
3. An actor whose held scopes include `routes:admin` meets the ownership requirement for every depot.
4. An actor's held scopes are its own scopes plus the scope of every active claim; a claim is active when its `startsAt` is not after the current time and its `expiresAt` is after it.
5. A suspended actor has no held scopes.

## Retry timing

6. Retry delays are in milliseconds; a server-provided `retryAfter` value is in seconds.
7. When the server provides a finite numeric `retryAfter`, the delay it gives replaces the computed backoff.
8. No retry delay exceeds 2000 milliseconds.
9. A publication makes at most two attempts, counting the first attempt.

## Departure timing

10. All departure hours are UTC hours.
11. The departure window includes its start hour and its end hour.
12. A blackout includes its start hour and excludes its end hour.
13. A departure inside a blackout moves to the blackout end hour on the same day.
14. A departure chosen inside the departure window and then moved outside it is refused.

## Stop priority

15. A stop's priority is its finite numeric `priority`, otherwise 5.
16. A stop is urgent when its priority is greater than 5.
17. Stops are ordered by descending priority, then by ascending `sequence`.
18. A stop without a finite numeric `sequence` follows every stop of equal priority that has one.

## Route identity

19. A route's identity is its `depotId` together with `normalizeRouteKey(routeKey)`.
20. Two stops are duplicates when their route identities are equal; cancelled stops are ignored.

## Retry counts

21. A retry count is a whole number from 0 through 3.
22. A retry count supplied as text is valid only when it is one or more base-10 digits.

## Credentials

23. Fields named `token`, `secret`, or `password` are credentials.
24. Redaction removes credentials at every depth of the value being redacted, which is the value the citing requirement names.

## Failure classification

25. A failure is transient when it is marked `transient: true`.
26. A failure that carries a finite numeric `retryAfter` is also transient.
27. A failure marked `transient: false` is never transient.

## Vehicle capacity

28. Package weights that dispatch records or compares are in grams.
29. Vehicle limits that dispatch records or compares are in kilograms.

## Terms

30. A stop's assigned driver means the `driver` of the stop's `reassignment` when the stop has a `reassignment`, and otherwise the stop's own `driver`.
31. A delivered stop means a stop whose `state` is `delivered` or `handedOver`.
32. A stop's service time means its `serviceMinutes` plus 5 minutes of parking.
33. An entry's contact phone means its `phone` with every space (` `) and hyphen (`-`) character removed.

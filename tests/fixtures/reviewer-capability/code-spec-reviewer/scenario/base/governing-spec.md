# Workspace Reservation Contract

## Reservation requests

- A reservation request must reject a blank `roomId` after trimming surrounding whitespace.
- A `memberId` that contains only whitespace is invalid after normalization.
- `partySize` must be a positive integer.
- A party larger than the selected room capacity must be rejected.
- Only active rooms may accept reservations.
- The request note must be preserved without normalization.
- New reservation identifiers must come from the injected `nextId` function.
- Idempotency keys must be trimmed and converted to lowercase before lookup and storage.
- If the normalized idempotency key already exists, creation must return that reservation without allocating an identifier or saving another record.

## Room selection and availability

- A room must contain every requested amenity; matching only some requested amenities is insufficient.
- A reservation that overlaps a confirmed reservation for the same room must be rejected.
- Time ranges use half-open intervals, so one reservation may start exactly when another ends.
- Canceled reservations do not occupy a room.
- A held reservation occupies a room only while `now()` is earlier than its `expiresAt` value.
- A confirmed reservation occupies its room regardless of any earlier hold expiration.
- A room with no reservations is available for a valid request.
- Availability checks performed while rescheduling must exclude the reservation being moved.
- Eligible rooms are ordered by ascending capacity and then by room identifier.

## Holds and confirmation

- A new reservation starts in the `held` state.
- Its `startAt` and `endAt` values must equal the requested window.
- A new hold expires exactly ten minutes after the injected `now()` value used to create it.
- A hold is expired when `now()` is equal to or later than `expiresAt`.
- Only a nonexpired reservation in the `held` state may be confirmed.
- Confirming a valid hold changes its state to `confirmed`.
- The confirmation time must come from the injected `now()` function.
- If saving a confirmation fails, the caller's original reservation object must remain unchanged.
- A confirmation notification may be sent only after the confirmed reservation has been saved successfully.
- The confirmation notification must identify the saved reservation.

## Cancellation and access

- Only reservations in the `held` or `confirmed` state may be canceled.
- Canceling an already canceled reservation returns it unchanged and performs no persistence or notification work.
- A successful cancellation records `canceledAt` from the injected `now()` function.
- The canceled record must be saved before its cancellation notification is sent.
- Building access begins fifteen minutes before the reserved start time.
- Building access ends fifteen minutes after the reserved end time.
- Only a confirmed reservation can authorize building access.
- The requested building must match the reservation's building.

## Rescheduling

- A rescheduled window must have an `endAt` value later than its `startAt` value.
- Rescheduling preserves the reservation identifier.
- Rescheduling preserves the selected room and building.
- A successful reschedule returns the reservation to `held` and gives it a fresh ten-minute expiration based on the injected `now()` value.

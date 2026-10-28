# Workspace Reservation Contract

## Conventions

- All timestamps, including values returned by `now()`, are milliseconds since the Unix epoch.
- Every time-dependent decision uses the injected `now()` function.
- Durations and limits in this contract are stated in minutes.
- Operations never modify a reservation object they receive; they return new records.

## Cancellation

- Only `held` or `confirmed` reservations may be canceled. Canceling an already canceled reservation returns that same object and performs no persistence or notification work.
- A successful cancellation records `canceledAt` from `now()` and appends `{state: 'canceled', at}` to `history`, where `at` equals `canceledAt`.
- Canceling a confirmed reservation less than 120 minutes before its `startAt`, or after it, charges a `fee` of half its `price`, rounded down to a whole unit. Every other successful cancellation has a `fee` of 0.
- The canceled record, including its `fee`, is saved before the cancellation notification is sent. The notification carries the saved `canceledAt` and `fee`.

## Slots

- Every reservation window is snapped outward to 15-minute slot boundaries: `startAt` down to a boundary and `endAt` up to a boundary. A value already on a boundary is unchanged.
- Duration limits, pricing, availability, and storage all use the snapped window.
- A snapped window lasts at most 240 minutes.

## Badge events

- A badge event's `buildingId`, `memberId` and `readerId` must be strings. They are trimmed and stored trimmed; a blank value is rejected. Building queries trim and require `buildingId` the same way.
- A badge event's `direction` is trimmed and lowercased and must then be `in` or `out`.
- A badge event's `readerId` must match the trimmed `id` of a supplied reader whose `active` value is `true` and whose trimmed `buildingId` equals the event's `buildingId`. A supplied reader's `id` and `buildingId` are strings.
- A badge event is a repeated swipe when a recorded event has the same `buildingId`, `memberId` and `direction` and the `at` values differ by less than 3 minutes. A repeated swipe is not stored; recording returns the first such recorded event in badge order.
- Badge order is ascending `at`, then ascending `id`. Event listings use it.
- Walking a building's events in badge order, an `out` event is flagged `exit-without-entry` when the same member's previous event there is missing or not `in`, and an `in` event is flagged `repeated-entry` when that previous event is `in`. Flags are `{eventId, memberId, kind}` in badge order.
- A building's daily counts take a building's events with `from` <= `at` < `until`, where `until` must be later than `from`. Each 1440-minute day, starting at a multiple of 1440 minutes since the epoch, that holds such an event gets `entries` and `exits`: the numbers of distinct members with an `in` and with an `out` event. Days are in ascending order.
- A building's occupants are the members whose latest event there in badge order with `at` not later than `now()` is `in`, by ascending `memberId`.
- A building's reader counts give, per `readerId`, its numbers of `in` and `out` events, by ascending `readerId`.

## Idempotency

- Idempotency keys are trimmed and lowercased before lookup and storage.
- The lookup happens after the request field rules and before any room is selected. If the key already belongs to a reservation, creation returns that reservation and does no further work.
- New reservation identifiers come from the injected `nextId` function.

## Waitlist

- A waitlist entry's `memberId` and `roomId` are trimmed and a non-string or blank value is rejected; its `partySize` must be a positive integer. Waitlist listings trim the ids the same way.
- A waitlist entry's window must have `endAt` later than `startAt` and a `startAt` not earlier than `now()`; it is stored as supplied.
- A member may have at most 3 active entries, counting `waiting` ones and `offered` ones whose offer has not expired; joining is rejected when the member has 3.
- An opening needs a trimmed non-blank `roomId`, a window with `endAt` later than `startAt`, and a `capacity` that is a positive integer.
- An opening yields no offer while a nonexpired offer for the room overlaps its window.
- An offer goes to the first `waiting` entry for the room whose window overlaps the opening and whose `partySize` is at most `capacity`, by ascending `requestedAt`, then `id`. With none, no offer is made.
- An offer sets `offered`, `offeredAt` from `now()` and `expiresAt` 15 minutes later and is saved before the offer notification (`entryId`, `memberId`, `roomId`, `startAt`, `endAt`, `expiresAt`).
- Only a nonexpired `offered` entry may be accepted; acceptance sets `accepted` and `acceptedAt` and books nothing.
- Only a `waiting` or `offered` entry may be withdrawn, setting `withdrawn` and `withdrawnAt`; withdrawing a `withdrawn` entry returns it with no persistence.
- A `waiting` entry's position is 1 plus the number of `waiting` entries for its room with overlapping windows ahead of it by ascending `requestedAt`, then `id`; other entries have none. Room queues list `waiting` entries and member listings list active entries, both in that order.

## Utilization reports

- A report room entry's `id` and `buildingId` are trimmed and must not be blank, its `capacity` must be a positive integer, and a trimmed `id` may appear only once.
- A counted reservation contributes the part of its `startAt`–`endAt` window inside the report window; both windows are half-open, and a reservation that does not overlap the report window contributes nothing.
- A room row gives `roomId`, `buildingId`, `capacity`, `reservations` (number of contributions) and `bookedMinutes`, the total contribution length in minutes rounded down.
- A room's `seatUtilization` is the sum of `partySize` × contribution length over `capacity` × report window length, as a percentage rounded half up to one decimal and not capped at 100.
- A building row's `rooms` and `capacity` are the count and capacity total of its selected rooms; `bookedMinutes` sums their rows; `seatUtilization` uses its contributions and total capacity; `busiestRoomId` has the most `bookedMinutes`, ties to the lowest `roomId`, or is null when all are 0.
- A building's `peakConcurrency` is the largest number of its contributions sharing one instant, and `peakAt` the earliest such instant, or null when it has none.
- Each selected room and each building with a selected room gets one row. Room rows are ordered by `buildingId` then `roomId`, building rows by `buildingId`.
- A report has `id` from `nextId()`, the normalized `reportKey`, `generatedAt` from `now()`, `from`, `until` and the requested amenities. It is saved before the notice `{reportId, generatedAt, from, until, buildings}` is published; `buildings` lists building ids in row order.
- Report generation never modifies reservation records or room entries.

## Request fields

- `roomId` and `memberId` are trimmed; a value that is blank after trimming is rejected. The trimmed values are the ones used and stored.
- `partySize` must be supplied as a number, and that number must be a positive integer.
- A request window must have an `endAt` value later than its `startAt` value, and its `startAt` must not be earlier than `now()`.
- The request note is stored exactly as supplied.

## Rooms

- Only rooms whose `active` value is `true` may be booked or listed.
- A room can host a party whose size is at most its capacity.
- Amenity names are compared case-insensitively, and a room must contain every requested amenity.
- Eligible rooms are listed by ascending capacity and then by ascending room identifier.

## Visitors

- A guest registration's `memberId` is trimmed, a non-string or blank one is rejected, and it must equal the reservation's `memberId`; the reservation must be `confirmed`.
- A guest's `name` is trimmed with each inner whitespace run made one space, and its `email` is trimmed and lowercased; a non-string or blank value is rejected.
- A guest's `expectedAt` must be equal to or later than the reservation's `startAt` and earlier than its `endAt`. Registering a guest or changing its arrival is rejected once `now()` is equal to or later than that `endAt`.
- A reservation's guest list holds at most its `partySize` minus 1 guests; every guest that is not `canceled` counts.
- Two guests of a reservation that are not `canceled` may not have names that are equal case-insensitively.
- Only a `registered` guest inside its lobby check-in window may check in. Check-in sets `checkedIn` and `checkedInAt`; the guest is saved before the arrival notification (`guestId`, `reservationId`, `name`, `checkedInAt`) is sent.
- Only a `registered` guest of the given reservation may have its arrival changed. Only `expectedAt` changes, and the guest is saved before a new invitation is sent.
- Only a `registered` guest may be canceled, setting `canceled` and `canceledAt`; canceling a `canceled` guest returns it with no persistence.
- A guest list shows a reservation's guests that are not `canceled`, by ascending `expectedAt`, then name case-insensitively. Lobby arrivals list, in that order, the `registered` guests of a trimmed non-blank `buildingId` with `from <= expectedAt < until`; `until` must be later than `from`.

## Audit trail

- An audit entry's `actor` and `subjectId` are trimmed, and its `action` and `subjectType` are trimmed and lowercased; a non-string or blank value is rejected.
- An entry's `details` are `{}` when undefined or null, and must otherwise be a plain object, whose prototype is `Object.prototype` or null; any other value, an array included, is rejected.
- In the stored `details`, at any depth of nested plain objects and arrays, every key named `note`, `email` or `phone`, compared case-insensitively, has its value replaced by `'[redacted]'`. Other keys and values are kept, and the supplied details are not modified.
- An audit query has integer `from` and `until`, `until` later than `from` by at most 10080 minutes, and a `limit` that is an integer from 1 to 500, or 500 when absent (undefined or null).
- A subject history lists every entry of one normalized subject that is not earlier than the retention cutoff, by ascending `at`, then `id`.
- A reservation change entry has action `reservation.` plus the state of the last `history` entry (an empty history is rejected), subject `reservation` with the reservation `id`, `entryKey` `<id>:<history length>` normalized as an audit `entryKey`, and as details the present `id`, `roomId`, `buildingId`, `memberId`, `partySize`, `state`, `startAt`, `endAt`, `expiresAt`, `price`, `fee` and `note` fields.

## Pricing

- A reservation's `price` is the room's `hourlyRate` multiplied by the number of started hours in the snapped window; a partial hour counts as a whole hour.

## Stored records

- A new waitlist entry's `id` comes from `nextId()`; it is `waiting`, with `requestedAt` from `now()`. Each later state change sets its stamp (such as `offeredAt`) from `now()`.
- A new ticket's `id` comes from `nextId()`; it is `open`, with `openedAt` from `now()` and a `lastEscalation` of null. Each later state change sets its stamp from `now()`.
- A recorded audit entry has `id` from `nextId()`, `at` from `now()`, and the normalized fields; a supplied `id` or `at` is not used.
- The audit store is append-only: it never changes a stored entry, rejects an `id` it already holds, and removes entries only by retention pruning.
- A new invoice's `id` comes from `nextId()`, and its `number` is `INV-` plus the id left-padded with zeros to at least six characters. It is `issued`, with `issuedAt` from `now()`.
- A new guest's `id` comes from `nextId()`; it copies `reservationId`, `roomId`, `buildingId` and `memberId` from the reservation and is `registered` with `registeredAt` from `now()`. Each later state change sets its stamp from `now()`.
- A recorded badge event is the normalized event plus `id` from the injected `nextId` and `recordedAt` from `now()`. The badge store is append-only and rejects an `id` it already holds.
- A new payment intent's `id` comes from `nextId()`; it is `authorized` with `authorizedAt` from `now()`, a hold `expiresAt` 10080 minutes later, `captured` and `refunded` of 0, and a `lastRefund` of null.
- A new message's `id` comes from `nextId()`.

## Holds

- A new reservation starts in the `held` state with the snapped window, the selected room's `roomId` and `buildingId`, and `requestKey` equal to the normalized key.
- A new hold expires 10 minutes after the instant it was created, or 30 minutes after it when its `partySize` is greater than 8.
- Expiry never changes a reservation's `state`; an expired hold is still `held`.
- A new reservation's `history` contains exactly one entry, `{state: 'held', at}`, where `at` is its creation time.
- The held notification is sent only after the new hold has been saved.

## Confirmation

- A hold is expired when `now()` is equal to or later than `expiresAt`. Only a nonexpired `held` reservation may be confirmed.
- Confirmation sets `state` to `confirmed`, records `confirmedAt` from `now()`, and appends `{state: 'confirmed', at}` to `history`, where `at` equals `confirmedAt`.
- The confirmed reservation is saved before the confirmation notification is sent.
- The confirmation notification carries the reservation identifier and the access window boundaries `accessFrom` and `accessUntil` defined under Building access.

## Invoices

- An invoice request's `memberId` is trimmed; a non-string or blank value is rejected. Its period runs from `periodStart` (included) to `periodEnd` (excluded); both must be integers, and `periodEnd` must be later than `periodStart`.
- An invoice request's `taxRateBasisPoints` must be an integer from 0 to 10000. Its `credits` must be a list; each credit's `amount` must be a non-negative integer and its `reason` must not be blank after trimming; the reason is stored exactly as supplied.
- A billed `confirmed` reservation yields a `booking` line item for its `price`; a billed `canceled` one whose `fee` is greater than 0 yields a `cancellation` line item for its `fee`. No other reservation yields a line item.
- Line items carry `reservationId`, `roomId`, `buildingId`, `startAt` and `endAt`, ordered by ascending `startAt`, then `reservationId`. The room summary totals amounts per `roomId`, by ascending `roomId`.
- An invoice's `subtotal` is the sum of line item amounts; its `credit` is the sum of credit amounts, at most the subtotal; `creditRemaining` is the unapplied rest.
- An invoice's `tax` is `(subtotal - credit) * taxRateBasisPoints / 10000` rounded half up to a whole unit; its `total` is `subtotal - credit + tax`.
- Issuing an invoice with no line items is rejected.
- Only an `issued` invoice may be voided or paid; voiding a `void` invoice or paying a `paid` one returns it with no persistence or notification. Voiding sets `state` `void` and `voidedAt`, paying sets `paid` and `paidAt`, both from `now()`.
- Invoice listings for a member trim `memberId`, order by ascending `periodStart`, then `periodEnd`, and when a state is given (not undefined) include only that state.

## Selection and counting

- An actor summary takes a query that is valid under the audit query rules, `limit` included, and counts every entry it matches, ignoring `limit`, as `{actor, entries}` by descending count, then ascending `actor`.
- A reservation is billed when its `memberId` equals the invoice request's and its `startAt` is within the period.
- A reservation counts toward a utilization report when its `roomId` is a selected room and it is `confirmed`, or `held` with `expiresAt` later than `now()`. Canceled reservations never count.
- A utilization report's requested amenities are lowercased and deduplicated, room amenities are lowercased, and only rooms whose `active` value is `true` and that contain every requested amenity are selected.
- A message digest flush takes queued messages whose `releaseAt` is not later than `now()`: per member, the first 20 by ascending `queuedAt`, then `id`. The rest stay queued. Members go by ascending `memberId`.
- An audit query matches entries not earlier than the retention cutoff with `from` <= `at` < `until`, filtered by each of `actor`, `action` and subject that is supplied (not undefined), compared in normalized form; a supplied filter value must be valid under the audit entry rules, and a subject filter needs both `subjectType` and `subjectId`. The first `limit` matches by ascending `at`, then `id`, are returned.
- A reservation is exported when `from` <= `startAt` < `until`, its `state` is listed, and, when a `buildingId` is supplied, its `buildingId` equals it. Rows are ordered by `startAt`, then `id`; more than 10000 selected reservations reject the export.
- A room export writes only rooms whose `active` value is `true`: text `id` and `buildingId`, integer `capacity` and `hourlyRate`, and list `amenities`, with rooms by ascending `id`.
- A member's used minutes are the total length in minutes of the member's `confirmed` reservations whose `startAt` is within the month; `held` and `canceled` ones are not counted.

## Message templates

- A template placeholder is `{{name}}`, `name` being a letter followed by letters, digits or underscores. Rendering replaces each with its value as a string and keeps other text; an undefined or null value rejects the message.
- A rendered value has `&`, `<`, `>`, `"` and `'` replaced by `&amp;`, `&lt;`, `&gt;`, `&quot;` and `&#39;`, and is not scanned for placeholders.
- Catalog locale keys are trimmed and lowercased; a blank catalog key stays blank. A member's `locale` is trimmed and lowercased, a missing or blank member locale being `en`. A template comes from that locale, else its part before the first `-`, else `en`; the message records the locale used and is rejected when none has it.

## Request keys

- A waitlist request key is trimmed and lowercased and must not be blank. The lookup follows the waitlist entry rules for ids, `partySize` and window; a key that belongs to an entry returns that entry with no further work.
- A payment key lookup follows the payment request rules for the key and the invoice and precedes all other work; a key that belongs to an intent returns that intent with no further work.
- An audit entry's `entryKey` is trimmed and lowercased; a non-string or blank key counts as absent. After the audit entry rules for `actor`, `subjectId`, `action`, `subjectType` and `details`, if a stored audit entry has the key, recording returns it and does no further work.
- A badge event's `eventKey` is trimmed and lowercased; a non-string or blank key counts as absent. After the badge event rules for its fields, `direction`, `at` and reader, if an event recorded in any building has the key, recording returns it and does no further work.
- An invoice already stored for the same member, `periodStart` and `periodEnd` is returned whatever its state. The lookup follows the invoice request rules for `memberId`, period, `taxRateBasisPoints` and credits and precedes all other work.
- A utilization report request's `reportKey` is trimmed and lowercased; a non-string or blank key counts as absent. Before any other utilization report rule, if an archived report has the key, generation returns it and does no further work.
- A reservation export's `requestKey` is trimmed and lowercased; a non-string or blank key counts as absent. After the reservation export window, building and state rules, a stored export with the key is returned and no further work is done.
- A payment request's idempotency key is trimmed and lowercased; a non-string or blank key is rejected.

## Time limits and expiry

- The audit retention cutoff is `now()` minus 43200 minutes. Audit pruning removes entries whose `at` is earlier than the cutoff and returns `{cutoff, removed}`, `removed` being the number of entries removed.
- A ticket is overdue while it is `open` and `now()` is not earlier than its `respondBy`. A building's overdue tickets are listed by ascending `respondBy`, then `id`.
- A utilization report window has integer `from` and `until`; `until` must be later than `from`, and the window lasts at most 44640 minutes.
- A badge event's `at` must be a non-negative integer. An event whose `at` is later than `now()` is rejected, and so is a late event whose `at` is more than 1440 minutes earlier than `now()`.
- A payment request's invoice is due 20160 minutes after its `issuedAt` and is late when `now()` is equal to or later than that instant. A payment status reports `dueAt`, `late` and `paid`, the sum of `captured` minus `refunded` over its `captured` and `refunded` intents.
- A usage month is a half-open UTC calendar month named by an integer `year` from 1970 to 9999 and an integer `month` from 1 to 12; other values are rejected.
- Recording guest no-shows moves each `registered` guest whose `checkInUntil` is not later than `now()`, among a reservation's guests, to `noShow` with `missedAt`.
- A waitlist offer is expired when `now()` is equal to or later than its `expiresAt`. A waitlist opening first moves each expired `offered` entry for the room to `lapsed` with `lapsedAt`, saved before its lapse notification (`entryId`, `memberId`, `lapsedAt`).
- Withdrawing an `offered` waitlist entry is rejected when its `startAt` is less than 60 minutes after `now()`. A `waiting` entry has no such limit.
- A desk closure has integer `startAt` and `endAt`, `endAt` later than `startAt` by at most 20160 minutes, and a trimmed, non-blank `reason`. A closure whose `endAt` is not later than `now()` is rejected.
- Front-desk times are UTC: an instant falls on its UTC weekday, at its milliseconds since UTC midnight.
- A payment authorization is expired when `now()` is equal to or later than its `expiresAt`; expiry never changes `state`. Only a nonexpired `authorized` intent may be captured.
- A ticket's `respondBy` is its `openedAt` plus 60 minutes (`urgent`), 240 minutes (`high`), 1440 minutes (`normal`) or 4320 minutes (`low`).
- A guest's lobby check-in window starts 30 minutes before `expectedAt` (`checkInFrom`, inside it) and ends 60 minutes after it (`checkInUntil`, outside it).
- Upcoming desk closures are the building's active closures whose `endAt` is later than `now()`, by ascending `startAt`, then `id`.
- A member's suspension is in effect while `now()` is earlier than its `expiresAt`. Expiry never changes the stored `status`; status queries and the directory report a member whose suspension is not in effect as `active`.

## Rescheduling

- Only `held` or `confirmed` reservations may be rescheduled; any other state is rejected.
- A `confirmed` reservation may be rescheduled only while its `startAt` is at least 60 minutes after `now()`; a later attempt is rejected. A `held` reservation has no such limit.
- Rescheduling applies no request validation other than the rules in this section.
- The new window must have an `endAt` value later than its `startAt` value. It is then snapped, and the snapped window must satisfy the duration limit and be available.
- A successful reschedule keeps the reservation identifier, room, and building; stores the snapped new window and a price recomputed for it; returns the reservation to `held` with a hold that expires 10 minutes after the reschedule time, whatever the party size, instead of the hold given under Holds; removes `confirmedAt`; and appends `{state: 'held', at}` to `history`, where `at` is the reschedule time.
- Every other stored field is unchanged by a reschedule.

## Message delivery

- A message's member `id` and `templateName` are trimmed and must not be blank. Its `messageKey` is trimmed and lowercased; a non-string or blank key counts as absent. After these rules, if a stored message has the key, creation returns it and does no further work.
- A member's quiet hours have integer `startMinute` and `endMinute` from 0 to 1439; its `utcOffsetMinutes` is an integer from -720 to 840, or 0 when absent (undefined or null). An instant's local minute is its whole minutes since the epoch plus the offset, mod 1440.
- A member is in quiet hours when `startMinute` < `endMinute` and the local minute is in [`startMinute`, `endMinute`), or when `startMinute` > `endMinute` and it is not in [`endMinute`, `startMinute`). Otherwise, including when the member has no quiet hours, it is not.
- A message created in quiet hours is saved as `queued` with `queuedAt` from `now()`, `releaseAt` at the first minute boundary after `now()` whose local minute is `endMinute`; it is not sent. It is rejected if the member already has 50 queued messages.
- A message created outside quiet hours is saved as `sent` with `sentAt` from `now()` before `send` receives `{messageId, memberId, body}`.
- Each digested message is saved as `sent` with `sentAt` from `now()` before the member's digest `{memberId, messageIds, bodies}` is sent.
- Only a queued message may be withdrawn: it becomes `canceled` with `canceledAt` from `now()`. Withdrawing a canceled message returns it unsaved.

## Building access

- Only a confirmed reservation authorizes building access, and the requested building must match the reservation's building.
- Access begins 15 minutes before `startAt` (`accessFrom`) and ends 15 minutes after `endAt` (`accessUntil`); the `accessFrom` instant is inside the access window and the `accessUntil` instant is outside it.
- For a reservation whose `partySize` is greater than 8, `accessFrom` is 30 minutes before `startAt` instead of 15. `accessUntil` does not depend on the party size.

## Reservation exports

- A reservation export has columns `id`, `roomId`, `buildingId`, `memberId`, `partySize`, `state`, `startAt`, `endAt`, `expiresAt`, `confirmedAt`, `canceledAt`, `price`, `fee`, `note`, in order; `partySize`, `price` and `fee` are integers, the `...At` columns timestamps, the rest text.
- A reservation export has integer `from` and `until`, `until` later than `from` by at most 44640 minutes. A `buildingId` is either absent or a string that is trimmed and must not be blank; any other value, null included, is rejected. Supplied `states` are a non-empty list, each trimmed, lowercased and one of `held`, `confirmed`, `canceled`; absent means all three.
- An export job records `id` from `nextId()`, `requestKey`, `createdAt` from `now()`, `from`, `until`, `states` in the order above, `buildingId` or null, the column names, `rowCount` and `csv`. It is saved before `deliver` receives `{exportId, rowCount, csv}`.
- A history export selects reservations the same way as a reservation export and writes text `reservationId` and `state` and timestamp `at`, one row per `history` entry in reservation, then history, order.

## Member directory

- A profile's `memberId` and `name` are trimmed and its `email` is trimmed and lowercased; a value that is not a string or is blank after trimming is rejected. Member lookups trim the `memberId`.
- A profile's `tier` must be exactly `basic`, `plus` or `team`; any other value is rejected. A tier change accepts the same values and changes no other field.
- Registration is rejected when the normalized `memberId` or `email` already belongs to a stored member. A contact update normalizes `name` and `email` the same way and is rejected when the `email` belongs to another member.
- A new member has `status` `active` and `joinedAt` from `now()`. It is saved before the welcome notification (`memberId`, `email`, `tier`) is sent.
- The monthly booking allowance is 600 minutes for `basic`, 1800 minutes for `plus` and 6000 minutes for `team`.
- The remaining allowance is the allowance minus used minutes, never below 0; the overage is the used minutes beyond the allowance, or 0. Counted reservation ids are listed by ascending `startAt`, then id.
- A suspension lasts a whole number of minutes from 1 to 43200 and needs a reason that is not blank after trimming. It sets `status` to `suspended`, stores `suspension` with the trimmed `reason`, `startedAt` from `now()` and `expiresAt` that many minutes later.
- Suspending a member whose suspension is in effect is rejected. Only such a member may be reinstated, which sets `status` to `active` and removes `suspension`.
- The directory lists members by ascending `memberId`; when a status is given, only members reported with that status are listed.
- An allowance summary's `suspended` is `true` when the member has a stored `suspension` whose half-open period from `startedAt` to `expiresAt` overlaps the month, and `false` otherwise.

## CSV exports

- A CSV export's column names are trimmed, non-blank and unique; each column's kind is `text`, `integer`, `timestamp`, `boolean` or `list`.
- A CSV export writes a header line of the column names, then one line per row with its value for each name. Every line, the last included, ends with `\r\n`.
- A field containing a comma, double quote, carriage return or line feed is wrapped in double quotes, with inner double quotes doubled; other fields are written unchanged.
- An undefined or null value writes an empty field. A `text` value must be a string and is written as stored, but with `'` prefixed when it starts with `=`, `+`, `-` or `@`.
- An `integer` must be a safe integer, written in decimal. A `timestamp` must be a safe integer of at most 8.64e15 in absolute value, written in UTC ISO form with milliseconds. A `boolean` is written `true` or `false`; a `list` of strings is joined with `;`, its items written as stored. Other values reject the export.

## Occupancy and availability

- Confirmed reservations occupy their room; canceled reservations do not.
- A held reservation occupies its room only while `now()` is earlier than its `expiresAt` value.
- A room is unavailable when an occupying reservation for the same room overlaps the window. Windows are half-open, so one reservation may start exactly when another ends.
- While rescheduling, the reservation being moved never conflicts with itself.

## Front desk hours

- A front-desk request's `buildingId` is trimmed and must not be blank.
- A weekly opening interval has an integer `day` from 0 (Sunday) to 6 and integer `openMinute` and `closeMinute` with 0 <= `openMinute` < `closeMinute` <= 1440.
- Opening intervals on the same day must not overlap, though one may open at the minute another closes. They are stored by ascending `day`, then `openMinute`.
- Saving opening hours replaces the building's earlier schedule and stores the `intervals`, `weeklyOpenMinutes` (the sum of `closeMinute` minus `openMinute`) and `updatedAt` from `now()`.
- A new desk closure gets `id` from `nextId()`, `state` `active` and `createdAt` from `now()`, and is saved before the `closure` notice `{closureId, buildingId, startAt, endAt, reason}` is sent.
- Only an active desk closure may be canceled; it gets `state` `canceled` and `canceledAt` from `now()`. Canceling a canceled closure returns it without saving.
- An open-desk query names the instant `t` it asks about; the front desk is open at `t` when an interval of `t`'s day has `openMinute` minutes <= time of day < `closeMinute` minutes and no active closure of the building has `startAt` <= `t` < `endAt`. A building without a schedule is never open.
- The next opening is the earliest instant from `now()` to 20160 minutes after it at which the desk is open, so `now()` itself when it is open, or null when there is none.
- The next closing is null unless the desk is open at `now()`; then it is the earliest instant after `now()`, at most 20160 minutes after it, at which the desk is closed, or null when there is none.

## Payments

- A payment request's invoice needs a trimmed non-blank `id` and `memberId`, an integer `issuedAt`, and a `total` that is a positive integer; the trimmed values are stored.
- An intent created while its invoice is late has a `fee` of 5 percent of `total`, rounded down to a whole unit; otherwise its `fee` is 0. Its `amount` is `total` plus `fee`.
- Creating an intent is rejected when the invoice has an intent that is `captured` or `refunded`, or `authorized` and not expired.
- Capture sets `state` to `captured`, `capturedAt` from `now()` and `captured` to `amount`.
- A refund applies only to a `captured` intent, needs a positive integer `amount` and a trimmed non-blank `reason`, and must not raise `refunded` above `captured`. It records `{amount, reason, at}` as `lastRefund` and adds its amount to `refunded`.
- When `refunded` reaches `captured`, `state` becomes `refunded`; a partial refund leaves `state` unchanged.
- Only an `authorized` intent, expired or not, may be voided, which sets `voided` and `voidedAt`; voiding a `voided` intent returns it with no persistence or notification.
- Payment listings trim the invoice id and order intents by ascending `authorizedAt`, then `id`.
- Creating a payment intent does not depend on the invoice's `state`; an intent may be created for an invoice in any state.

## Member limit

- A reservation is open while it occupies its room and its `endAt` is later than `now()`.
- A member may have at most two open reservations across all rooms; creation is rejected when the member already has two.

## Maintenance tickets

- A ticket's `roomId`, `buildingId` and `summary` are trimmed; non-string or blank values are rejected. Ticket listings trim and require `roomId` or `buildingId` alike.
- A ticket's `priority` is trimmed and lowercased and must then be `urgent`, `high`, `normal` or `low`. Its `amenities` must be a list, possibly empty, of non-blank names, each trimmed and lowercased; repeats are dropped.
- Only an `open` or `assigned` ticket may be assigned, to a trimmed non-blank assignee. Assignment, also reassignment, sets `assigned`, `assignedAt` and `assignee`.
- Only an `assigned` ticket may start, setting `inProgress` and `startedAt`. Only an `inProgress` ticket may be resolved, setting `resolved`, `resolvedAt` and a trimmed non-blank `resolution`.
- Escalation raises `low` to `normal`, `normal` to `high` and `high` to `urgent`; escalating an `urgent` or `resolved` ticket is rejected. It recomputes `respondBy` from `openedAt`, records `{from, to, at}` as `lastEscalation`, and keeps `state`.
- A ticket's planned work window may be set or cleared only while it is `open` or `assigned`. A new window needs `endAt` later than `startAt`, `startAt` not earlier than `now()`, and at most 480 minutes. Setting or clearing a window sets `plannedAt` from `now()` and keeps `state`; clearing an `open` or `assigned` ticket without a window returns it unchanged.
- Two tickets' planned windows conflict when they share a `roomId` and overlap; windows are half-open. A window conflicting with that of another ticket that is not `resolved` is rejected. Planning a ticket that already has a planned window is rejected.
- A room's planned work lists its tickets that are not `resolved` and have a planned window, by window `startAt`, then `id`, ascending.
- A room's unavailable amenities are the distinct `amenities` of all its tickets that are not `resolved`, sorted ascending.

## Saving before notifying

- A newly recorded badge event that is flagged is saved before the `anomaly` notice, the flag plus `buildingId`, is sent.
- A suspended member is saved before the suspension notification (`memberId`, `expiresAt`) is sent.
- A new invoice is saved before the issued notification (`invoiceId`, `number`, `memberId`, `total`) is sent.
- A ticket is saved before its opened, assignment, escalation or resolution notification is sent.
- Each created, captured, refunded or voided payment intent is saved before its notification is sent.
- A guest is saved before its invitation (`guestId`, `name`, `email`, `expectedAt`, `checkInFrom`, `checkInUntil`) is sent.
- A recorded audit entry is appended to the audit store before it is passed to `publish`.
- A voided or paid invoice is saved before its notification (`invoiceId`, `number`, `voidedAt` or `paidAt`) is sent.

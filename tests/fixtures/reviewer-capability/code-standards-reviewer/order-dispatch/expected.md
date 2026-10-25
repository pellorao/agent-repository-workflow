# Expected findings

Hidden from the Reviewer. Each problem is one seeded defect; a finding matches when it names the same defect, whichever equivalent location it cites.

## Problems

1. The Repository export-prefix rule is violated by formatCarrierReference. (`src/delivery/dispatch-service.mjs:8`)
2. The Repository named-export rule is violated by the default service-level export used by dispatch creation. (`src/delivery/service-levels.mjs:1`, `src/delivery/dispatch-service.mjs:2`)
3. The Repository built-in import rule is violated because fs/promises omits the node: prefix. (`src/config/policy-loader.mjs:1`)
4. The Repository immutable-export rule is violated by the mutable reviewerCapabilityDeliveryStages array. (`src/orders/order-state.mjs:3`)
5. The Repository boolean-naming rule is violated by reviewerCapabilityOrderReady. (`src/orders/order-state.mjs:5`)
6. The Repository error-cause rule is violated when loading a carrier policy replaces the caught error without preserving cause. (`src/config/policy-loader.mjs:6`, `src/config/policy-loader.mjs:7`)
7. Courier assignment mutates the caller-supplied dispatch; prepared dispatches are frozen, so the fulfillment dispatch entry throws TypeError instead of returning the dispatched order. (`src/delivery/dispatch-service.mjs:28`, `src/orders/order-service.mjs:34`, `src/delivery/dispatch-service.mjs:11`, `src/orders/order-service.mjs:46`, `src/orders/order-service.mjs:90`)
8. The Repository clock-injection rule is violated when dispatch marking reads Date.now directly. (`src/orders/order-service.mjs:47`)
9. Stock quantity adjustment inside reservation preparation uses opaque r and v parameter names, obscuring how the requested quantity changes the reservation record. (`src/inventory/reservations.mjs:4`, `src/inventory/reservations.mjs:5`)
10. Customer and recipient normalization duplicate the same pipeline across order preparation and notification delivery. (`src/orders/order-service.mjs:23`, `src/notifications/delivery-notifications.mjs:3`)
11. Order preparation keeps the incoming carrierId for stock reservation and later release while dispatch independently selects a carrier by service level, so one fulfillment can reserve and release inventory for a different carrier than it dispatches. (`src/delivery/carrier-policy.mjs:1`, `src/delivery/carrier-policy.mjs:5`, `src/delivery/carrier-policy.mjs:6`, `src/delivery/dispatch-service.mjs:29`, `src/orders/order-service.mjs:28`, `src/inventory/reservations.mjs:9`, `src/orders/order-service.mjs:34`, `src/orders/order-service.mjs:35`, `src/orders/order-service.mjs:50`, `src/orders/order-service.mjs:53`, `src/orders/order-service.mjs:98`)
12. Warehouse, order, and carrier identifiers travel together through both stock reservation and release operations. (`src/inventory/reservations.mjs:3`, `src/inventory/reservations.mjs:16`)
13. Dispatch approval and carrier trust are encoded together in one colon-delimited decisionCode primitive. (`src/delivery/carrier-policy.mjs:3`, `src/orders/order-service.mjs:67`, `src/orders/order-service.mjs:92`)
14. Order state labels and cancellation policy repeat switches over the same state variants. (`src/orders/order-state.mjs:7`, `src/orders/order-state.mjs:8`, `src/orders/order-state.mjs:9`, `src/orders/order-state.mjs:10`, `src/orders/order-state.mjs:11`, `src/orders/order-state.mjs:16`, `src/orders/order-state.mjs:17`, `src/orders/order-state.mjs:18`, `src/orders/order-state.mjs:19`, `src/orders/order-state.mjs:20`, `src/orders/transition-policy.mjs:4`, `src/orders/transition-policy.mjs:5`, `src/orders/transition-policy.mjs:6`, `src/orders/transition-policy.mjs:7`, `src/orders/transition-policy.mjs:8`, `src/orders/transition-policy.mjs:9`, `src/orders/transition-policy.mjs:11`)
15. Adding a delivery service level requires coordinated edits to delivery-day, fee, and notification-label switches in three Modules. (`src/delivery/service-levels.mjs:1`, `src/delivery/service-levels.mjs:2`, `src/delivery/dispatch-service.mjs:20`, `src/delivery/dispatch-service.mjs:22`, `src/notifications/delivery-notifications.mjs:5`, `src/notifications/delivery-notifications.mjs:7`)
16. reviewerCapabilityDescribeDeliveryHandling combines invoice formatting, retry timing, and locale direction policies that evolve for unrelated reasons. (`src/reporting/fulfillment-report.mjs:18`, `src/reporting/fulfillment-report.mjs:19`, `src/reporting/fulfillment-report.mjs:20`, `src/reporting/fulfillment-report.mjs:21`)
17. Stock reservation preparation accepts an optional reservationMapper although the current order flow has no reservation mapping need. (`src/inventory/reservations.mjs:3`, `src/inventory/reservations.mjs:13`, `src/orders/order-service.mjs:27`, `src/orders/order-service.mjs:28`, `src/orders/order-service.mjs:29`, `src/orders/order-service.mjs:30`, `src/orders/order-service.mjs:31`, `src/orders/order-service.mjs:32`, `src/orders/order-service.mjs:33`)
18. Dispatch request construction reaches through checkout, order, customer, profile, and address to obtain a region. (`src/delivery/dispatch-service.mjs:17`)
19. The order-store wrapper only forwards load, save, and remove while order preparation depends on that indirection. (`src/persistence/order-store.mjs:37`, `src/persistence/order-store.mjs:39`, `src/persistence/order-store.mjs:41`, `src/persistence/order-store.mjs:43`, `src/orders/order-service.mjs:36`)
20. ReadOnlyOrderStore inherits save and remove but rejects both inherited operations when the order service constructs its read-only view. (`src/persistence/order-store.mjs:24`, `src/persistence/order-store.mjs:26`, `src/persistence/order-store.mjs:31`, `src/persistence/order-store.mjs:35`, `src/orders/order-service.mjs:78`, `src/orders/order-service.mjs:106`, `src/orders/order-service.mjs:109`)
21. Dispatch authorization is independently implemented in reviewerCapabilityCanDispatch and reviewerCapabilityCreateDispatchDecision().canDispatch, so approval or trust policy changes can drift between the two implementations. (`src/delivery/carrier-policy.mjs:3`, `src/delivery/dispatch-service.mjs:37`, `src/delivery/dispatch-service.mjs:40`, `src/orders/order-service.mjs:67`)
22. Dispatch creation and resolved dispatch separately construct and freeze the same orderId and region request, requiring coordinated changes to the request shape or construction policy. (`src/delivery/dispatch-service.mjs:15`, `src/delivery/dispatch-service.mjs:16`, `src/delivery/dispatch-service.mjs:17`, `src/delivery/dispatch-service.mjs:18`, `src/delivery/dispatch-service.mjs:32`, `src/delivery/dispatch-request.mjs:1`, `src/orders/order-service.mjs:82`)

## Clean

Reporting one of these as a problem is a false positive.

- reviewerCapabilityDescribeDeliveryWindow follows the required export prefix. (`src/notifications/delivery-notifications.mjs:19`)
- reviewerCapabilitySelectCarrier is a named export. (`src/delivery/carrier-policy.mjs:5`)
- The shared path helper directly re-exports reviewerCapabilityBasename from node:path. (`src/shared/path.mjs:1`)
- reviewerCapabilityTerminalStates is frozen before export. (`src/orders/order-closure.mjs:1`)
- reviewerCapabilityHasReservedInventory follows the boolean-return naming rule. (`src/inventory/reservations.mjs:29`)
- reviewerCapabilityParseRoutePolicy preserves the caught error as cause. (`src/config/route-policy.mjs:5`)
- reviewerCapabilityRescheduleDelivery returns a copy instead of mutating its dispatch Input. (`src/delivery/delivery-schedule.mjs:2`)
- reviewerCapabilityElapsedTime receives current time through the injected now function. (`src/shared/elapsed-time.mjs:3`)
- reviewerCapabilityDescribeDeliveryWindow clearly names the window it describes. (`src/notifications/delivery-notifications.mjs:19`)
- reviewerCapabilityBuildReservationKey performs one distinct reservation-key operation. (`src/inventory/reservations.mjs:23`)
- The fulfillment report summary uses the report title captured by its report object. (`src/reporting/fulfillment-report.mjs:6`, `src/reporting/fulfillment-report.mjs:8`, `src/orders/order-service.mjs:57`, `src/orders/order-service.mjs:61`)
- reviewerCapabilityArchiveFulfillment receives the related run identity in one runContext value. (`src/reporting/fulfillment-report.mjs:12`, `src/orders/order-service.mjs:100`)
- reviewerCapabilityCreateDispatchDecision keeps dispatch status and trust as separate properties with their behavior. (`src/delivery/dispatch-service.mjs:37`)
- reviewerCapabilityTransitionPolicy centralizes the current state-specific label and cancellation behavior. (`src/orders/transition-policy.mjs:4`, `src/orders/transition-policy.mjs:5`, `src/orders/transition-policy.mjs:6`, `src/orders/transition-policy.mjs:7`, `src/orders/transition-policy.mjs:9`, `src/orders/transition-policy.mjs:11`)
- reviewerCapabilityRiskPolicies centralizes every current risk-level attribute in one table. (`src/delivery/service-levels.mjs:5`, `src/delivery/service-levels.mjs:6`, `src/delivery/service-levels.mjs:7`)
- The inventory reservations Module contains cohesive stock-reservation behavior used by order preparation. (`src/inventory/reservations.mjs:3`, `src/orders/order-service.mjs:27`)
- reviewerCapabilitySelectObjectFields uses both parameters for its current field-selection operation. (`src/shared/object-fields.mjs:1`, `src/shared/object-fields.mjs:2`)
- reviewerCapabilityCreateResolvedDispatchRequest receives the resolved order and region values directly. (`src/delivery/dispatch-request.mjs:1`)
- reviewerCapabilityCreateCachedReader adds caching policy around reader access. (`src/shared/cached-reader.mjs:11`, `src/shared/cached-reader.mjs:13`, `src/shared/cached-reader.mjs:16`, `src/shared/cached-reader.mjs:17`, `src/shared/cached-reader.mjs:18`)
- reviewerCapabilityCreateOrderReader uses composition and adds order-identifier validation. (`src/persistence/order-readers.mjs:4`, `src/persistence/order-readers.mjs:7`)

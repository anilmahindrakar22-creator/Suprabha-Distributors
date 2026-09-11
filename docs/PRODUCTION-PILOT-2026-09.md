# StockFlow production acceptance and pilot

## Acceptance run — 11 September 2026

Production order `SF-260911-00031` was created as `ZZ TEST - PRODUCTION ACCEPTANCE 11 SEP 2026` and completed through confirmation, fulfilment, pick and pack, Tally billing handoff, billed status, dispatch and delivery. The test references are deliberately labelled `TEST-ACCEPTANCE-00031`, `TEST-DOCKET-00031` and `TEST-POD-00031`. The invoice reference is not a Tally voucher and correctly remains “Invoice not found”. The order is retained as immutable operational evidence.

The run found one defect: saving fulfilment with a blank optional promised-delivery date sent an empty string and was rejected. The local fix now omits the field when blank; it requires the normal release process before production is corrected.

## Performance baseline before changes

- Orders screen became usable 562 ms after selecting Orders on the measured warm session.
- Recent production order-list requests took 465–1,004 ms at the worker.
- Production order mutations during the acceptance run took 376–1,289 ms at the worker, excluding one 400 response from the blank-date defect.
- Current snapshot: approximately 545 KB total, containing 371 KB of catalogue data and 78 KB of cached invoice data.
- Current customer directory: approximately 92 KB for 457 active customers.
- Current active-order page data: approximately 7 KB for five active orders.
- Built client assets include approximately 209 KB CSS, 190 KB framework JavaScript and 112 KB StockFlow screen JavaScript before transfer compression.

These are single-run baselines, not percentile service-level claims. The catalogue and customer payloads are the first optimization candidates; order data itself is currently small.

## Local performance batch after baseline

- Tally catalogue and customer masters no longer download merely because Orders was visited; together this avoids approximately 463 KB of raw response data in an Orders-only session.
- A normally acknowledged new order is inserted into the first open-order page without a second list request. Filtered views and uncertain recovery responses retain the authoritative refresh fallback.
- Exact customer history is now filtered and paginated in the database rather than assembled from the complete order archive.
- Deferred Service and administrator-only Users sections now load on demand. The measured StockFlow client chunk fell from 113,978 bytes to 102,518 bytes, a 10.1% raw reduction; separate chunks are 9,111 bytes and 3,607 bytes respectively.
- Collapsed order details no longer mount every fulfilment, delivery, exception, installation, note and activity control during the initial inbox render. Once opened, a row retains its mounted details for that session.
- Successful order mutations now emit the same response-size and server-timing headers as list requests, allowing the post-release pilot to separate network/server delay from browser rendering.
- The stock dashboard now reads operational counters through a dedicated RBAC-protected summary gateway instead of repeatedly loading the complete order bootstrap. Focus, visibility and page-show events are coalesced within 15 seconds, while manual refresh and reconnect remain immediate.
- Stock data renders before the independent order counters complete, so a slower operations summary cannot block the reorder screen.
- The open-order inbox preload now waits for browser idle time instead of competing with the first Stock request. Hover, keyboard focus and touch-down on Orders still begin the preload immediately, using the existing account-isolated request deduplication.
- Operational counters now use one materialized, role-scoped active-order set instead of repeating a separate order scan for each counter. The scope still comes from the server-side role policy table, including creator-only access.
- Partial database indexes cover active status queues, creator-scoped queues, promised-delivery reminders and same-day dispatch events. Archived transactions remain immutable and queryable, but no longer enlarge the daily-work indexes.
- Delivery-date, back-order, open-exception and priority queues are now filtered and paginated inside the secured database gateway. Opening one of these queues returns its requested page instead of downloading every active order for browser-side filtering; full export remains explicit.
- Order-list responses reuse the consolidated operations summary without recalculating delayed deliveries a second time.
- Order-history date ranges are validated and paginated in India business time by the database gateway. The interactive screen no longer gathers every page on the application server before returning the requested page; explicit CSV export continues to stream all matching pages.

These figures are production-build raw asset sizes before transfer compression. Live latency must be re-measured after the application and exact-customer database migration are released together.

## Five-working-day device checklist

Run this once on each staff device and each approved account. Record device, account, date and result without entering passwords or customer-sensitive data in this file.

1. Sign in, open Orders and confirm the `+ Order` control appears.
2. Enable trusted-device draft saving and enter a clearly labelled test customer and one product, but do not submit.
3. Disconnect the device, close and reopen StockFlow, and confirm the same account recovers the draft.
4. Reconnect and submit once; confirm only one order is created.
5. Create another unsent draft, sign out and sign in with the second approved account. Confirm the first account’s draft content is not displayed.
6. Sign back into the first account, confirm its draft is still recoverable, then discard it.
7. Record any loading delay, duplicate order, stale data, lost draft, cross-account data display or unclear message as a pilot incident.

Do not use real patient data. Do not change Tally, connector, permissions or Service settings during the pilot.

## Pilot exit gate

Proceed only if five working days complete without duplicate submissions, lost committed orders, cross-account draft exposure, unexplained Tally slowdowns or unresolved critical workflow failures. Service expansion remains deferred.

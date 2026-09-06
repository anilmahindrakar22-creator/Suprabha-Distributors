# Lightweight recovery phase

Tally remains the inventory and accounting authority. Pause new service, CRM and inventory features until the following gates pass. Keep one application and the existing database; add no infrastructure or dependencies for this phase.

## Slice 1: correct verification and reduce repeated work

Invoice verification requires customer ledger name plus voucher number. A bare number requires the current financial year in the SD voucher number. References alone cannot verify an invoice. Quantity comparison remains unimplemented.

Connector refreshes share an in-memory snapshot for 15 minutes by default, retaining its original timestamp. This reduces scheduled full reads from 12 to 4 per hour; it does not prove a reduction in Tally response latency. Manual refresh serves the same cache during the cooldown. Restarting the connector resets its cache.

## Slice 2: incremental connector, with recovery

Implemented locally: durable snapshot recovery, independent upload retries, per-user exclusive connector lock, and persisted recent sales history. Regular sales exports request the last 30 days and replace that complete window. A tiny per-item last-supply baseline preserves older dashboard facts without retaining or rereading years of vouchers. Stable MasterID matching replaces vouchers moved into the window; cancelled vouchers remain in the recent source cache and are excluded from derived invoice/last-supply output. There is no automatic full-history reconciliation. The explicit `-RebuildSalesHistory` repair remains administrator-only and must be commissioned outside billing hours.

Fixture checks cover history retention, window deletions, moved IDs, cancellation replacement, empty windows and missing identity. Live date-window behavior is validated; representative office performance, source-company verification and separately scheduled master refresh remain outstanding. Backdated edits outside the window can leave the compact summary stale until an administrator performs a controlled repair; this is bounded-window synchronisation, not a proven Tally change-feed implementation.

Measure Tally request duration, response bytes and query counts on the office machine. Separate stock refresh from customer/catalog refresh and historical sales. Persist the last successful snapshot atomically; retry cloud upload independently of Tally reads. Replace repeated five-year sales scans with an initial off-hours baseline and bounded recent-voucher updates, preserving old last-supply data. Reconcile cancellations and edited vouchers by stable identity. Prevent concurrent connector instances. Verify company identity before merging snapshots.

Gate: repeated browser refresh causes no extra Tally queries; failed upload causes no additional extraction; restart and network interruption retain the last successful snapshot. Compare office billing responsiveness before and after under the same workload.

## Slice 3: smaller OMS and offline drafts

Implemented locally: one account-scoped order draft is stored in the existing browser with visible saved, waiting and error states. A user action is required before it becomes pending; reconnect retries only that pending command and preserves its original server idempotency key. Successful server acknowledgement removes the local copy. Drafts never appear as confirmed or billed, cannot be read by another signed-in account through the application, and expire after seven days. The host owns sign-out, so explicit sign-out cleanup cannot yet be observed directly; account isolation and short retention are the current boundary.

Implemented locally in the next increments: the browser renders at most 20 matching order cards at once, and background action refreshes preserve the internal scroll position instead of collapsing the list and jumping to the top. Routine bootstrap no longer includes every audit event. Opening an order's Activity log calls a dedicated read-only gateway that validates the gateway secret, active membership and order row scope before returning immutable events.

Implemented locally: routine order bootstrap now carries only the Tally catalogue version. Opening New Order retrieves the full catalogue through a separate read-only gateway and reuses an account-scoped, version-matched browser-session copy. A newer Tally snapshot invalidates that copy automatically. This adds no dependency, background polling or new service.

Successful OMS reads now expose their uncompressed JSON size and server duration through response headers. This records no customer payloads or credentials and adds no database write. Browser/network inspection can therefore compare bootstrap, catalogue and activity costs using representative approved accounts before setting a hard production threshold.

Routine status, fulfilment, order-edit, dispatch and delivery commands now apply the successful server acknowledgement to the affected order and counters instead of downloading the entire workspace again. If an older or incomplete server response cannot safely identify the row and version, the client falls back to the existing full refresh.

Still outstanding in this slice: record representative deployed measurements; move pagination to the server when measured order volume requires it; add authenticated browser coverage for restart/reconnect, scroll retention and lazy data once the Sites test harness can provide an approved session.

Gate: documented initial payload and transfer budget, no full history on each save, successful offline draft recovery and exactly one order after reconnect. Offline OMS is not complete until these gates pass.

## Later expansion

Resume service and commercial features only after the recovery gates. Keep optional details collapsed and load modules on demand. Free-tier usage must be measured; no guarantee of unlimited free hosting.

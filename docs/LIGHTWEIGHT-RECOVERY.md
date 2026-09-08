# Lightweight recovery phase

Tally remains the inventory and accounting authority. Pause new service, CRM and inventory features until the following gates pass. Keep one application and the existing database; add no infrastructure or dependencies for this phase.

## Slice 1: correct verification and reduce repeated work

Invoice verification requires customer ledger name plus voucher number. A bare number requires the current financial year in the SD voucher number. References alone cannot verify an invoice. Quantity comparison remains unimplemented.

The OMS now withdraws the matched badge when the supporting Tally snapshot is invalid, more than 20 minutes old or over five minutes ahead of the browser clock. The order remains billed, but the screen asks for a fresh sync before presenting the invoice identity as matched.

Invoice reconciliation also reports distinct not-found, customer-ledger-mismatch and duplicate-match outcomes. Ambiguous voucher identities fail closed instead of selecting one record arbitrarily.

Connector refreshes share an in-memory snapshot for 15 minutes by default, retaining its original timestamp. This reduces scheduled full reads from 12 to 4 per hour; it does not prove a reduction in Tally response latency. Manual refresh serves the same cache during the cooldown. Restarting the connector resets its cache.

## Slice 2: incremental connector, with recovery

Implemented locally: durable snapshot recovery, independent upload retries, per-user exclusive connector lock, and persisted recent sales history. Normal 15-minute Sales exports request seven days and replace that complete window. Once per 24 hours the window expands to 30 days to reconcile backdated edits, deletions and cancellations; request metrics distinguish recent, reconciliation and full-history work. Older verified records remain in the compact cache. Stable MasterID matching replaces vouchers moved into the active window; cancelled vouchers remain in the source cache and are excluded from derived invoice/last-supply output. There is no automatic full-history reconciliation. The explicit `-RebuildSalesHistory` repair remains administrator-only and must be commissioned outside billing hours.

Office validation on 7 September 2026 confirmed that the installed TallyPrime honored the seven-day boundary: 57 vouchers, zero dates outside the requested window, 358,146 response bytes and 227 ms duration. The preceding five 30-day samples averaged 1,764,357 bytes with 1,537 ms median duration. This single controlled sample is an approximately 80% response-size and 85% duration reduction, not yet a production p95 claim.

Fixture checks cover history retention, window deletions, moved IDs, cancellation replacement, empty windows and missing identity. Live date-window behavior is validated; representative office performance, source-company verification and separately scheduled master refresh remain outstanding. Backdated edits outside the window can leave the compact summary stale until an administrator performs a controlled repair; this is bounded-window synchronisation, not a proven Tally change-feed implementation.

Implemented locally: the stock export includes a filtered Tally company identity record. The connector requires exactly one case-insensitive match for `SUPRABHA DISTRIBUTORS` before it reads dependent reports, merges sales, replaces its saved snapshot or uploads data. Missing or wrong identity therefore leaves the last good snapshot and source timestamp intact. Fixture coverage includes matching, missing and wrong-company responses. This still requires confirmation against the office TallyPrime version before release.

Implemented locally: customer ledgers now use a separate atomic, company-scoped cache and a four-hour refresh interval. Normal 15-minute operational cycles reuse the saved directory, and an empty, malformed or failed customer export cannot erase the last good directory. Restart can recover the valid backup when the primary customer cache is damaged; a failed refresh retries on the normal operational interval instead of waiting four hours. The existing cloud snapshot format is unchanged.

Implemented locally: the complete item/catalog export now also uses a separate atomic, company-scoped four-hour cache. Each 15-minute cycle performs a small company-identity check, the existing reorder report and the bounded Sales-voucher read, but it no longer exports every stock item and group. Invalid, empty or failed catalog refreshes retain the last valid catalog and retry after 15 minutes. Closing quantities shown for non-reorder catalog items can therefore be up to four hours old and remain advisory; monitored reorder quantities still come from the 15-minute report. The cloud payload contract is unchanged.

Implemented locally: persisted last-supply history now carries an explicit `sales_vouchers_v1` provenance marker. Older unscoped history—whose origin could include purchase vouchers—is rejected and rebuilt from the bounded Tally Sales collection before it can populate “Last supplied”. The connector also records voucher type for diagnostics. This deliberately prefers a temporarily blank older supply fact over displaying an unverified purchase transaction; an off-hours sales-history rebuild restores verified facts outside the recent window.

Measure Tally request duration, response bytes and query counts on the office machine. Separate stock refresh from customer/catalog refresh and historical sales. Persist the last successful snapshot atomically; retry cloud upload independently of Tally reads. Replace repeated five-year sales scans with an initial off-hours baseline and bounded recent-voucher updates, preserving old last-supply data. Reconcile cancellations and edited vouchers by stable identity. Prevent concurrent connector instances.

Gate: repeated browser refresh causes no extra Tally queries; failed upload causes no additional extraction; restart and network interruption retain the last successful snapshot. Compare office billing responsiveness before and after under the same workload.

## Slice 3: smaller OMS and offline drafts

Implemented locally: one account-scoped order draft can be stored in the existing browser after the user explicitly enables saving on that trusted device. Storage permission is account-scoped, can be withdrawn for non-pending drafts, and quota failures remain visible instead of being mistaken for a saved draft. The Orders header shows whether the current account has one draft, one pending submission or a draft needing attention; the button changes to Continue order. Switching accounts recalculates the indicator from that account's isolated key. A user action is required before a draft becomes pending; reconnect retries only that pending command and preserves its original server idempotency key. Successful server acknowledgement removes the local copy. Drafts never appear as confirmed or billed, cannot be read by another signed-in account through the application, and expire after seven days. The host owns sign-out, so explicit sign-out cleanup cannot yet be observed directly; account isolation and short retention are the current boundary.

Expired authentication, revoked membership and invalid order/catalogue data now stop automatic retry, retain the draft in a needs-attention state and show distinct corrective guidance. Only network, rate-limit and temporary server failures remain eligible for reconnect retry.

The service worker now caches only four explicit public static assets. Authenticated application navigation, APIs, non-GET requests, cross-origin resources, query variants, redirects and error responses are never handled or cached. Upgrades remove only obsolete StockFlow static caches and immediately control existing tabs; unrelated origin caches are preserved.

Runtime-boundary tests execute the service worker and dispatch browser-style fetch and activation events. They verify protected requests pass through untouched, allowlisted assets resolve from static cache, and an upgrade cleans legacy StockFlow caches without deleting unrelated storage. An authenticated production-browser upgrade remains a deployment check rather than a local claim.

Implemented locally in the next increments: the browser renders at most 20 matching order cards at once, and background action refreshes preserve the internal scroll position instead of collapsing the list and jumping to the top. Routine bootstrap no longer includes every audit event. Opening an order's Activity log calls a dedicated read-only gateway that validates the gateway secret, active membership and order row scope before returning immutable events.

Implemented locally: routine order bootstrap now carries only the Tally catalogue version. Opening New Order retrieves the full catalogue through a separate read-only gateway and reuses an account-scoped, version-matched browser-session copy. A newer Tally snapshot invalidates that copy automatically. This adds no dependency, background polling or new service.

Successful OMS reads now expose their uncompressed JSON size and server duration through response headers. This records no customer payloads or credentials and adds no database write. Browser/network inspection can therefore compare bootstrap, catalogue and activity costs using representative approved accounts before setting a hard production threshold.

Implemented locally: the authenticated shell begins one account-scoped OMS bootstrap request while the Stock screen is visible. Opening Orders reuses the same in-flight or completed request instead of starting a second round trip. The Order action responds immediately and joins that request if tapped before preload finishes; failures are not cached, and explicit Refresh replaces the cached result. This changes no API or database contract and adds no dependency.

Routine status, fulfilment, order-edit, dispatch, delivery-exception and equipment-installation commands now apply the successful server acknowledgement to the affected order and counters instead of downloading the entire workspace again. Server-issued exception and installation IDs remain authoritative. If an older or incomplete server response cannot safely identify the row and version, the client falls back to the existing full refresh.

Transition requests now reject unknown workflow states, invalid versions and oversized identifiers, cancellation reasons or invoice numbers at the API boundary before invoking database logic. Database transition policy remains the authoritative permission and state-machine check.

The same bounded-input policy now covers order capture, fulfilment, edits, dispatch, delivery, exceptions and installations. It limits line counts, whole-unit quantities, identifiers and free-text fields without adding a validation dependency; database constraints and policies remain authoritative.

The order HTTP boundary requires JSON and enforces its 64 KiB limit against both declared and actually streamed bytes. Chunked requests can no longer bypass the size check before JSON parsing.

Still outstanding in this slice: record representative deployed measurements; move pagination to the server when measured order volume requires it; add authenticated browser coverage for restart/reconnect, scroll retention and lazy data once the Sites test harness can provide an approved session.

Gate: documented initial payload and transfer budget, no full history on each save, successful offline draft recovery and exactly one order after reconnect. Offline OMS is not complete until these gates pass.

## Later expansion

Resume service and commercial features only after the recovery gates. Keep optional details collapsed and load modules on demand. Free-tier usage must be measured; no guarantee of unlimited free hosting.

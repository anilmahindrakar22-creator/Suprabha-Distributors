# Phone frame and Tally recent products — 16 October 2026

Owner: Codex integration chat. Claude retains order next-stage/dispatch work.

## Outcome and acceptance

The phone shell must keep its header and bottom navigation inside the viewport while the embedded Stock document scrolls, changes views and resizes. Pin the existing flex shell with `fixed inset-0`; preserve safe areas and the independently scrolling workspace. No standalone Stock redesign.

New-order recent products must come from the selected customer's imported Tally sales bills. Previous StockFlow orders remain available for duplicate warnings and account previews, but never supply these suggestions.

## Implementation

- `components/stockflow-frame.tsx`: viewport-pinned outer shell.
- `components/order-workspace.tsx`: only new-order recent-product state/effect/cards. Eight active, not-already-selected suggestions, last billed quantity (fractional billing defaults to one because orders accept whole quantities), dates and Tally source label. Customer changes abort stale reads. A 20-entry, 30-second in-memory cache uses actor/customer/ledger/catalog/snapshot context. Failure shows Retry; new customers without a ledger can still search and order.
- `app/api/orders/route.ts`, `lib/order-gateway.ts`, `lib/tally-recent-products.ts`: UUID-validated private read `GET /api/orders?recentProductsFor=<customer UUID>` → `get_tally_recent_products`.
- `supabase/functions/stockflow-orders/index.ts`: adds that action to the read allowlist and routes it to its dedicated RPC.
- CLI-created `20261016130829_tally_recent_products.sql`: service-only gateway, existing gateway-secret/current-member checks, one consistent existing snapshot read. Match the selected customer's canonical `tally_key` to invoice party with exact case/whitespace normalization. Never guess from display name. Deduplicate bill identities, omit conflicting duplicates, invalid/future dates and nonpositive quantities. Use last 20 imported bills, sum repeated item lines within a bill, rank by bill frequency then latest date, return at most 100 catalog keys/counts/dates/quantities. Ambiguous catalog names and inactive products are excluded. No financial values or other customers' identities returned.
- SQL, API, real Edge handler and browser regressions; register SQL replay and append pending-migration evidence without replacing earlier bookkeeping.

No new table, connector extraction, commercial price, economic formula, role assignment, order submission or stage transition. Existing imported billing window is the history boundary; this feature does not certify complete historical Tally coverage.

## Verification and limitations

- Initial 24 desktop/phone checks passed. Final expanded suite: 36 passed, including embedded Stock views, first/last content, resizing, customer switching, quantity entry, Retry, a delayed previous-customer response and pricing-review regressions.
- Old shell reproducibly loses its header after a simulated 96px ancestor document scroll; viewport-pinned shell passes. Unforced headless Chromium did not reproduce the photographed Android behavior. Real-device confirmation remains useful; no claim of a hardware test.
- Full unit suite: 1,466 tests / 140 files passed. Typecheck passed after correcting an untyped JSON assertion in the new test.
- First SQL run reached the new regression after all prior checks, then failed because its fixture omitted required snapshot company/fetched_at fields. Corrected fixture and expanded last-20 boundary test passed the fresh deployment-order replay: 45 checks.
- Standard lint passed; an extra ad hoc invocation incorrectly included the Deno Edge entrypoint in Node typechecking and reported missing Deno/jsr declarations. Use the repository's normal static checks plus the executed real-handler routing test; no suppression added.

Private evidence and isolated sources: `work/phone-scroll-20261016/`.
Production-specific build passed. Screenshot capture adds two focused phone reruns; final screenshot review is recorded in the shared log. Source map retains the prior verified 134 deployed migrations and adds this one pending read-only migration.

## Integration/release

Local implementation complete; final integration/release results belong in the shared handover and rollout logs. Release in order: reviewed migration → Orders Edge → production Worker; preserve the previous Worker and Edge version for rollback. This is an additive read, so the prior UI/Edge remains compatible with the added function. The new UI exposes a retryable unavailable state if the read has not reached an environment yet.

Accounts/pricing approval values remain untouched. No deployment by other agents. Preserve existing dirty documentation, migration evidence, tests and screenshots; stage exact owned files only.

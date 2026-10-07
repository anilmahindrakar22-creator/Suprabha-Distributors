# StockFlow production acceptance and pilot

## Offline candidate checkpoint — 7 October 2026

- PR #41 remains a draft; no merge or production deployment in this checkpoint.
- Owner reports installed Android email/password sign-in immediately reloads an empty login form without an error. Chrome stays signed in. This is an unresolved actual-device blocker, not proven expiry; no cookie security or session lifetime was weakened.
- Updated the transitive MCP SDK from 1.30.0 to patched 1.31.0 for GHSA-6qxp-vccf-f47h. The security gate passes with the existing exact, tested braces mitigation (review expiry 17 October); the audit is not advisory-free.
- Fresh isolated candidate checks: lint and typecheck passed; 45 affected auth/audit tests passed; all 16 desktop/mobile-emulated offline browser checks passed; staff production build passed. Emulation does not certify actual installed Android behavior.
- Earlier clean 4192ad4 consolidation passed 746 unit tests, 36 general and 148 pricing/workflow browser checks, plus deployment-order database replay. Its audit failed on the newly discovered SDK advisory, fixed above. These earlier results are not a fresh full-suite run of the dependency update.
- Remaining gates: demonstrate and repair installed Android sign-in, actual-device offline/reconnect acceptance, final combined CI, hosted critical office workflow and backup/restore requirements before real business use. Tally remains untouched.

## Current status — 3 October 2026

**Published; operational pilot remains HOLD.** PR #36 merged to main at `aebdcbefeba523b4a1ec7a7e0d3e6f2f6146f5ce`. Public version 55 deployed successfully as `appgdep_6ac0bfb979008191b87fbc13605b6a11`, runtime revision 4, on 3 October. All six pending production migrations were previously applied and reconciled. The earlier version-52 signed-in Orders/Pricing checks remain historical evidence, not version-55 acceptance. These results supersede historical publication blockers below, not the remaining acceptance gates. The dependency mitigation review expires on 17 October. Full evidence is in `PRICE-BOOK-IMPLEMENTATION-STATUS.md`.

Read-only follow-up at 3 October 14:16 IST: source extraction 14:01:37 IST, cloud upload 14:01:38 IST, snapshot JSON text 596,354 bytes. Source age was about 15 minutes, within the 20-minute threshold; no live browser banner transition was observed. In the fixed 13:16–14:16 IST log window, three function POSTs returned HTTP 200, maximum execution 5,720 ms; eight PostgreSQL events were LOG-level. Four PostgREST events were counted but their timeout/error contents were not verified after the message aggregation query failed. These sparse results do not establish p95, CPU/memory health, full order-workflow acceptance or a completed working-day pilot.

Remaining: hosted uncertain-save recovery, actual staff-device offline/account separation, representative performance/resource measurements, five real working days of pilot evidence and a restore-tested backup. Normal save/reload success and local fault fixtures do not prove hosted uncertain-response recovery. A failed request while already offline proves pre-send handling only; do not count it as a response lost after a server commit.

For the first staff-device check, use a trusted staff device and an approved account: enter an explicitly synthetic **unsent** order draft, disconnect, reload and verify recovery; reconnect, sign out and check that a second account cannot see the draft; return to the first account and discard it. Record device/browser, account role, date and each result. This first check needs no submitted order or Tally transaction. The submitted-order checklist below is a separate authorized pilot step.

Hosted uncertain-save testing needs controlled client-network interruption on the private acceptance site, with one synthetic command and authoritative receipt/audit reconciliation. The current browser automation interface has no network-fault toggle. Do not interrupt production services, rotate credentials or weaken authorization to manufacture a failure. Operator-assisted network timing is required; if the command never reached the server, record that limitation rather than certifying post-commit recovery.

## Seven-gate release attempt — 30 September 2026

Status: **HOLD; not released or pilot-ready.** The owner requested completion of sync, pricing acceptance, deployment, performance measurement, staff-device acceptance, the five-working-day pilot and recovery rehearsal. Existing local consolidation results do not substitute for these live gates.

- Sync configuration: the authenticated production Supabase Edge Secrets page reports no custom secrets. The replacement requires `STOCKFLOW_READ_KEY` and `STOCKFLOW_UPLOAD_KEY` matching existing clients; neither has been configured here. The local Windows user upload credential exists, but its value was not printed. Sites redacts its read credential. Secure owner entry is required before replacement deployment; do not rotate or invent mismatched values. The dashboard also displays a provider technical-issue notice, which alone does not establish a StockFlow failure cause.
- Live freshness at `2026-09-30 09:20:53 UTC`: source extraction `09:11:58.7246899Z`, cloud upload `09:11:59.823Z`, full snapshot JSON text 579,832 bytes. Existing sync is currently arriving; this does not verify the new handler.
- Database sample: one active session, five idle sessions and one session without a reported state. For the requested log window `2026-09-29T10:00:00Z` through `2026-09-30T10:00:00Z` (available events at check time), there were zero `40001` or `42501` string matches and 27 timeout-related PostgREST error messages. None matched the specific database-statement or pool-acquisition timeout phrases queried. Root cause and affected requests remain unverified; do not claim clean latency, CPU recovery or a completed working-day observation.
- Pricing acceptance: the existing private candidate opens but its ChatGPT sign-in remains at security verification. No authenticated mutation acceptance was performed in this attempt; bypassing authentication or security checks is not acceptable.
- Deployment: held pending secure sync configuration and authenticated candidate acceptance. Production remains on sync version 4; no production migration, function replacement, Site publication, grant change or Tally operation was performed in this attempt.
- Performance: above figures are a baseline only. Staff-login screen/save latency, p95, current CPU and office Tally impact still need measurement under a bounded real workload, not a stress test.
- Devices/pilot: use the existing device checklist below on actual staff devices and accounts. A five-working-day pilot must record five real working days after release acceptance; prior incident-containment observations and fixture browser tests do not count as completed pilot days. Service remains deferred.
- Recovery: the existing `production-2026-09-27.dump` is zero bytes and invalid. PostgreSQL backup tooling is installed, but no database password is available to the process. Keep credentials out of chat. The existing local hidden-input backup helper, archive validation and an isolated restore must succeed before genuine business use. No paid service or reset credit is needed or authorized.

Next dependency: secure owner configuration of the existing read/upload secrets, followed by verified candidate sync and pricing acceptance. User participation is also required for staff devices and the hidden database-password prompt; these are missing access/evidence, not routine approval requests.

### Sync cutover follow-up, 30 September (15:17 IST)

The owner configured both custom secrets; digest comparisons match the existing clients without revealing values. All 32 focused sync tests passed. A candidate deployed in the existing project returned expected 401/400 rejection responses without changing the snapshot. The exact same bundle is now live as `stockflow-sync` version 7, retaining custom-key authentication and existing database permissions. Live rejection probes passed and the snapshot remained unchanged at the final check. The last observed upload preceded cutover; successful post-cutover office upload and authenticated dashboard-read acceptance are still pending. The temporary candidate remains idle and needs later cleanup. No Tally operation or other public application release occurred. Pilot remains HOLD, not a completed first pilot day.

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
- Ordinary order pages now include only open delivery exceptions and scheduled installations needed for daily decisions. Resolved exceptions and completed-installation history load through a separately authorized endpoint only after an order's details are opened.
- Billing Attention now reads one paginated invoiced-order candidate stream rather than scanning five status queues and loading the broad order bootstrap. Tally invoice records already scoped to each candidate page are deduplicated and reused for the existing customer, invoice and quantity reconciliation rules.
- Paginated order counts and rows now evaluate the already-loaded creator field against the authoritative role-scope table. Creator-only access remains server-enforced, without a second order-table lookup for every candidate row.
- Each visible order card now obtains its line count, ordered quantity, compatibility quantity and line details from one database aggregate after pagination, replacing four scans of the same order lines.
- The large Orders workspace is now a separate browser bundle. Stock opens without parsing it; idle time and the first hover, touch or keyboard focus preload both the Orders code and its data before the user opens the section.
- Order pages now receive only Tally invoices referenced by their visible orders, after customer-ledger matching. Numeric entries still expand solely to the current `SD/YY-YY/0XXX` financial year, preserving ambiguity and line-quantity verification while excluding unrelated customer history.

These figures are production-build raw asset sizes before transfer compression. Live latency must be re-measured after the application and exact-customer database migration are released together.

The pending order-performance database changes are deliberately ordered: consolidate billing candidates, optimize row-scope evaluation, consolidate page-line projection, then bound Tally invoice payloads. Apply them in timestamp order; every patch aborts if the expected secured gateway shape is absent and restores the service-only execution grant.

Billing-candidate status is added to the authoritative base order filter. The exact-customer and searchable-note optimized wrappers both delegate status decisions to that filter; a contract test protects this dependency.

Manual order refresh now shows progress, blocks duplicate taps and uses last-request-wins protection so an older response cannot overwrite a newer filter or refresh result on a slow connection.

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

## 27 September 2026 — Supabase CPU incident (pilot hold)

The project reported high CPU. Read-only logs showed approximately 6,000 PostgreSQL `40001` order/pricing conflicts per minute, sustained across multiple PostgREST sessions. The caller and retry source are not yet identified. Query performance and missing indexes are not established as the primary cause.

The owner approved a temporary order-entry interruption while keeping the Supabase project running. The owner deleted the modern `default` secret API key (masked prefix `sb_secret_K54k1`) in the dashboard; this **did not** stop the conflicts. Do not assume that deletion was the fix or that Edge Function database credentials were unaffected.

As a reversible emergency containment, `EXECUTE` was revoked from `service_role` on `public.stockflow_order_gateway(text,text,text,jsonb)` and `public.stockflow_pricing_gateway(text,text,text,jsonb)`. The original ACL for each was `{postgres=X/postgres,service_role=X/postgres}`. The `40001` rate fell from 6,000/minute to 1,124 in the cutover minute and then zero in the next observed minute; sampled PostgREST sessions were idle. Order transitions and pricing actions are intentionally unavailable while these grants are absent. Business rows, Tally, and project status were not changed by the grant revocation.

Do not restore these grants until the repeated caller is identified, retry behavior is bounded, the Edge Function credential path is verified, and a controlled smoke test is ready. The exact privilege restoration is:

```sql
BEGIN;
GRANT EXECUTE ON FUNCTION public.stockflow_order_gateway(text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.stockflow_pricing_gateway(text,text,text,jsonb) TO service_role;
COMMIT;
```

After restoration, verify the ACLs, the order workflow, Tally snapshot freshness, and the per-minute `40001` rate before resuming the pilot. No paid compute upgrade or project pause was made.

At the time of containment, the latest `stockflow_snapshots.updated_at` was 21 September 2026 10:22 UTC, so cloud stock freshness was already overdue before this intervention. Connector/cloud-sync repair remains separate from the CPU containment.

### Containment follow-up, 27 September

The failed commands were repeatedly carrying stale order versions or pricing evidence. Those `40001` results are deliberate conflict rejections, not a reason to retry the same request. The exact originating client remains unproven: available Site Worker and Edge Function logs did not account for the database request rate. Do not describe this as a confirmed credential compromise or a confirmed browser retry loop.

Root cause clarification, 28 September: retained PostgreSQL logs show 4,150,654
`40001` entries on 27 September and 8,589,264 on 26 September, while the retained
HTTP logs contain only a small number of matching gateway calls. The database was
running PostgREST 14.5. Supabase documents that PostgREST 14 internally retries an
RPC transaction when application code deliberately raises SQLSTATE `40001`; one
stale request can therefore create a large internal retry loop. StockFlow used that
database serialization code for ordinary optimistic-concurrency and pricing-evidence
rejections. This is the established amplification mechanism. The original request
that first triggered a stale rejection remains unidentified and is not required to
explain the sustained load.

The corrective migration changes only explicit StockFlow business-conflict raises
from `40001` to PostgREST's non-retryable HTTP-conflict code `PT409`. Genuine database
serialization failures remain `40001`. Client and Edge mappings accept both codes
during rollout. A deployment-order replay proves no StockFlow function retains an
explicit retryable business-conflict raise and verifies the stale-write behavior,
ACID rollback, concurrency controls and existing order preservation.

The release process missed a **negative-path load** scenario. Transaction tests covered rollback, concurrency and idempotency, but not a client sending an already-rejected mutation thousands of times; there was no per-actor request budget or conflict-rate pilot gate. This is an operational gap, not a reason to relax version checks.

The owner created a replacement named Supabase backend secret (`stockflowedge`). The order Edge Function now uses that modern secret in the `apikey` header only. A new random 256-bit order gateway credential replaced the old Site and database values; only its SHA-256 verifier is in source. Edge rejects an outdated gateway key before calling PostgREST. Accepted mutating requests have a per-actor, per-isolate budget of 60/minute, a single in-flight copy of a command, and a 60-second cooldown when that exact command conflicts; a new idempotency key alone does not bypass the cooldown. This is a safety brake, not a globally distributed quota, and direct PostgREST calls do not pass through it.

Order Edge Function version 23 and Site environment revision 4 were deployed. The two `service_role` grants were restored at 12:07 UTC after the new credential path was deployed. The live administrator Orders and Pricing read paths loaded, and one intentionally invalid `create_order` probe returned `22023` before any business write. PostgreSQL logs had **zero new `40001` conflicts** in the observed minutes through 12:13 UTC; the sampled database had one active and eight other ordinary service sessions. The seven-day infrastructure peak still displays 100% and must not be mistaken for the current CPU rate; the live CPU report was temporarily unavailable after restoration. The 60-minute memory report showed 406.51 MB used with a broadly flat chart, and active sessions were not accumulating. This alone is not evidence of a leak; monitor swap, free memory and the multi-day trend before changing memory configuration.

For future releases, do not treat the incident as resolved solely because one smoke test passes. Check per-minute `40001` and `42501` counts, active database sessions and current CPU over the next working day. If conflicts exceed **10/minute for 5 consecutive minutes**, immediately pause the two gateway grants above, inspect the request path and credential use, and do not purchase additional compute to mask the problem. Review any new mutation/retry path with a repeated-conflict test and ensure rejected commands do not spin. The Tally snapshot remains stale and is a separate connector-health issue; this incident response did not change Tally.

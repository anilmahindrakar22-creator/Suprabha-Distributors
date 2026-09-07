# Suprabha StockFlow: requirements and delivery plan

Planning baseline: 5 September 2026. This plan combines the OMS and future Suprabha OS within the existing application. It supersedes conflicting future inventory and workflow proposals. It is a delivery specification, not a claim that all requirements are implemented.

## 1. Product contract

Help a small diagnostics distributor capture an order quickly, prepare the correct goods, identify the correct Tally bill, and follow delivery. Daily work should remain understandable on a phone and usable during intermittent internet connectivity.

The business distributes diagnostic equipment and reagents; there is no manufacturing. Tally Prime owns accounting and all inventory transactions. StockFlow owns operational orders and their audit trail. The application must never slow normal Tally billing materially or require duplicate stock entry.

Keep one application, one authoritative OMS database and modular code. Existing Service and Users functions remain available; further expansion waits for the reliability gates. Do not add mandatory fields or approval steps merely to accommodate future modules.

### Non-negotiable boundaries

- No manufacturing, internal stock reservation, stock ledger, receipt or adjustment entry in StockFlow.
- All Tally inventory items are searchable in order capture. The reorder page uses a separately configured subset.
- Tally remains the source for invoices, customer ledgers, stock and future batch/expiry visibility.
- No automated Tally posting in this phase. Staff continue billing in Tally.
- Returns remain excluded.
- Business records and audit history are preserved. Administrative reset uses an explicit recoverable archive.
- Existing order numbers are never reused after archiving.
- Offline capture creates a draft; confirmation and other shared business transitions require server acceptance.
- Free-tier compatibility is a cost objective, not a promise of unlimited free operation.

## 2. Evidence-based current position

| Area | Evidence in repository | Assessment |
|---|---|---|
| OMS | Capture, search/date filter, edits, fulfilment, dispatch, delivery, cancellation and events | Available; full release acceptance still required |
| Authorization and integrity | Server gateway, role/scope functions, version checks, idempotency and deletion protection migrations | Foundations present; revalidate against a real database |
| Tally verification | Number matching originally ignored ledger; local fix now checks ledger and removes reference-only matches | Local tests passed previously; deployment and live acceptance pending |
| Connector | Full historical voucher export; local 15-minute shared-cache change | Repetition reduced in code; historical extraction and office impact unresolved |
| OMS data transfer | Bootstrap returns combined orders, catalog, customers and invoice data; save triggers reload | Pagination and independent caches needed |
| Offline | Service worker skips API requests and broadly caches other requests | Does not establish complete or account-safe offline OMS support |
| Service | Installation/commissioning-derived register exists | Preserve; postpone extension |
| Testing | CI scripts, unit tests, access E2E, security workflows | Existence does not prove current CI status or real concurrency/recovery behavior |

We are in Phase 3 stabilisation, followed by lightweight recovery. Do not call Phase 3 operationally complete until the gates below pass. No percentage-complete claim is justified without production acceptance.

## 3. Operational requirements

### Order capture

REQ-01: One capture screen: customer ledger, products and whole-number quantities. Contact details, delivery date/address and notes remain optional unless a later action needs them. Preserve a draft when changing tabs, closing accidentally or restarting the browser after explicit device-storage consent.

REQ-02: Customer suggestions use canonical Tally ledger identity; store both identity and display name. Preserve spelling, meaningful punctuation and customer distinctions. Legacy free-text names require a visible mapping step when ambiguous. Do not silently create or merge ledgers in Tally.

REQ-03: Product lookup searches the complete synced catalog, including products excluded from reorder monitoring. Display unit/pack description and last-sync stock as advisory information. Reagent pack names such as “2+2x5” must not be interpreted as entered quantities.

REQ-04: Save gives a clear result: saved on server, draft on this device, submission pending, or needs attention. Use one stable request key through retries. Never show success on timeout without checking the original request outcome.

### Simple order flow

| Visible stage | Normal action and evidence | Proposed responsible roles |
|---|---|---|
| To confirm | Check customer/products/quantities; approve once | Administrator or operations |
| Preparing | Pick and pack together; record actual prepared quantity and shortages | Operations; warehouse permission to be validated |
| Tally billing | Copy billing handoff; accounts bills in Tally and enters invoice reference | Accounts or administrator |
| Dispatch | Record courier/local delivery and dispatch date; reference where applicable | Operations or administrator |
| Delivered | Receiver and delivery time; optional proof reference | Operations or administrator |

These role assignments are a proposed acceptance matrix, not a statement of current permissions. Keep a shared workspace with role-appropriate actions; do not build separate applications or duplicate screens for every role. Administrators may perform operational actions with the same audit requirements.

REQ-05: Internal legacy statuses may remain during migration, but must not require extra user actions. Do not reintroduce reservation, separate picking and packed confirmations, or a mandatory hold step. Exceptions use notes/attention flags unless a distinct state is demonstrated necessary.

REQ-06: Before billing, permitted edits retain before/after values, actor, timestamp and reason when required. After billing, do not silently rewrite a verified order; a correction must invalidate/recheck reconciliation and preserve history. Administrator cancellation requires a reason. Cancelling in StockFlow does not cancel the Tally invoice.

REQ-07: History search supports date range, customer, order number, invoice and stage across all pages. Default to active orders; closed orders are available through history. Export reflects all matching records, not only the loaded page. Archived reset records stay outside normal history but remain recoverable by an authorised administrative process.

### Invoice reconciliation

REQ-08: Verification requires company + financial year + voucher identity + customer ledger. A bare “346” resolves only within the configured company/current financial year. Historical orders use a full invoice reference or explicitly selected year; never guess across years.

REQ-09: Prefer stable Tally ledger/voucher identifiers where available. Until these are exported, conservative ledger-name matching may ignore case and repeated whitespace, but must not use fuzzy matching for automatic verification. Missing ledger evidence, multiple candidates, conflicting customer, optional or cancelled vouchers cannot receive a verified badge.

REQ-10: Retain matched full voucher number, source identifier, voucher date and verification timestamp. Show specific outcomes: awaiting sync, no match, customer mismatch, ambiguous match, invoice matched, or verification stale. Store/read provenance so a new sync, changed invoice, customer edit or cancellation can invalidate a previous result.

REQ-11: Invoice identity matching and quantity reconciliation are separate. A future quantity check compares canonical item IDs, billed quantities and compatible units; sums repeated lines and handles split invoices explicitly. Until implemented, never imply that invoice matching verifies products, quantities or stock. Request only needed voucher detail to control Tally load.

## 4. Lightweight connector contract

REQ-12: Single active extractor per company/installation. Serial Tally requests, bounded timeouts, no overlapping schedules, and backoff after failure. A browser refresh reads the latest available snapshot; it must not trigger a historical export.

REQ-13: Separate three workloads: current stock, customer/catalog masters, and invoice history. Proposed starting cadence is stock/recent invoices every 15 minutes, masters every 4 hours, and historical baseline/reconciliation outside billing hours. Tune against measurement; longer cadences must be reflected in freshness messages.

REQ-14: Preserve the successful baseline across restart using atomic file replacement and schema versioning. Retry upload from disk independently of extraction. Never advance source freshness when retrying an upload or serving cached data. Preserve last good values on partial failure with per-domain error/freshness state; an empty failed response must not erase masters or invoices.

REQ-15: Incremental sync needs stable identity, upsert rules, deletion/cancellation handling and recovery from missed edits. A rolling date window alone is insufficient for backdated changes. Select supported Tally change metadata after verifying it against the installed version; otherwise use a bounded window plus scheduled full reconciliation and explicit limitations.

REQ-16: Measure duration, response bytes, counts, last success and consecutive failures without logging credentials or full customer payloads. Provide an administrator pause/schedule control. Keep office-only health details out of the everyday order screen.

## 5. Offline and privacy contract

REQ-17: Distinguish offline stock viewing, offline draft capture and server-side order processing. First-time sign-in requires connectivity. Offline drafts are available only on an explicitly trusted device after successful sign-in and catalog download.

REQ-18: Use an account/company-scoped local store with versioned schema, storage quota handling and migration/recovery. Cache only the data needed for capture. Clear protected caches on sign-out/account switch; explain that unsent drafts must be submitted or explicitly discarded before cleanup. Browser eviction can remove device-only data, so show pending draft counts clearly.

REQ-19: Reconnect requires current authentication and permission checks. Pending drafts reuse their request keys. Revoked access, invalid catalog items, changed data and validation failures produce an actionable error without dropping the draft. No offline confirmation, billing, cancellation or dispatch transition in the initial release.

REQ-20: Review service-worker cache scope before enabling offline OMS. Cache public static assets by explicit rules; do not broadly cache authenticated HTML, redirects, errors or another account’s content. Test service-worker upgrades with an old tab still open. Do not promise remote revocation can erase data on a disconnected device.

## 6. Architecture and performance acceptance

Use the existing modular application and PostgreSQL. ACID covers each database command, associated audit event and outbox record in one transaction. It cannot make a browser-to-cloud-to-Tally operation one atomic transaction. External work uses acknowledgements, stable request keys and retries.

Separate API reads into versioned masters, paginated order summaries, order detail/history, and operations counts. Compute counts/search server-side across the full authorised dataset. Commands return the changed order/version or invalidate a small affected query; avoid full bootstrap reloads. Add indexes only after examining query plans. Load optional Service/Users modules on demand where bundle evidence justifies it.

Proposed budgets, to be confirmed using representative data and hardware:

| Measure | Initial acceptance target |
|---|---|
| Normal order capture | Customer + 3 products saved in 60 seconds in a staff trial |
| Order save | p95 under 2 seconds on agreed office network; immediate pending indicator |
| Warm orders view | Useful list within 2 seconds |
| List response | At most 50 summaries per page; under 100 KB compressed without masters/history |
| Search | Local catalog response under 200 ms; server search p95 under 1 second |
| Repeat stock refresh | Zero extra Tally queries during connector cooldown |
| Billing impact | No material regression; investigate over 10% p95 increase in a repeatable before/after trial |
| Integrity | No duplicate accepted order on retry; no lost edit under two-user conflict |
| Offline | Draft survives browser restart and submits once after reconnect |

Record dataset size, hardware, connection, sample count, p50/p95 and failures. These are release targets, not measured achievements. Do not remove dependencies simply because installed package size looks large; measure shipped JavaScript and request payloads.

## 7. Dependency-ordered delivery roadmap

Effort below is provisional focused engineering time, including testing but excluding access delays, office observations and unexpected migration work. It is not a calendar commitment.

| Slice | Deliverable | Dependencies and exit gate | Indicative effort |
|---|---|---|---|
| R0: baseline and release audit | Verify deployed/local versions, running connector path, current schedules, payload sizes and office billing baseline; finish ledger mismatch regression | Record what is live; reproduce wrong-ledger rejection and correct match | 1–2 days |
| R1: connector recovery | Single instance, durable snapshot, independent upload retry, cooldown/backoff and domain freshness | Restart/offline/failure tests; repeated refresh adds no extraction | 2–4 days |
| R2: incremental Tally reads | Separate masters/stock/invoices; baseline outside billing hours; change/cancellation reconciliation; source-company guard implemented locally | Confirm company guard on office Tally; no regular five-year scan; compare office latency; prove missed-change recovery | 3–5 days |
| R3: lean OMS API | Pagination, detail on demand, versioned catalog, targeted post-save updates | Full-dataset search/counts/export correct; meet payload budgets | 2–4 days |
| R4: offline drafts | Account-scoped local drafts, explicit device consent, reconnect handling and safe cache rules | Restart, quota, expired login, switch-account and duplicate-retry tests pass | 3–5 days |
| R5: pilot and release | Staff walkthrough, real DB security/concurrency tests, backup restoration and measured pilot | Five working days of representative usage; no unresolved critical defects | 1–2 engineering days plus pilot |

Total recovery planning allowance: 12–22 focused engineering days plus pilot observation. Re-estimate after R0. Implement R1 next; continue R2 before expanding business features. Parallel feature development is not a requirement.

After recovery: consolidate existing service register and only then add tickets/maintenance (separately estimated); follow with customer/receivables visibility and commercial controls; finally evaluate customer self-service and analytics. Each expansion requires its own user acceptance cases and measured budget. Do not assign an arbitrary “complete OS” date to unscoped future modules.

## 8. Verification, release and rollback

- Unit tests: invoice/ledger/year ambiguity, unit matching when implemented, freshness calculations and draft state transitions.
- Integration tests against an isolated real database: permissions for each action, row scope, transaction rollback, version conflict, idempotent retry and archived-order restrictions. SQL-text assertions alone do not prove these properties.
- Connector fixtures: timeout, malformed XML, cancelled/edited/backdated vouchers, wrong company, duplicate process, corrupt cache and upload failure. Never run destructive fixture writes against office Tally.
- Black-box browser tests: order entry through delivery, correct mismatch messaging, history/export, offline reload/reconnect and two-account isolation. White-box tests target domain rules and fault paths rather than matching implementation strings.
- Security checks: unauthenticated/forbidden API calls, object-level access, request bounds, XSS in ledger/item fields, CSV injection, secret exposure, dependency scanning and cache privacy. Authorised dynamic testing belongs in staging.
- CI: focused branch per slice; lint/typecheck/unit/build plus affected integration/E2E and security gates; review before release. Preserve schema compatibility across one prior app version. Verify actual CI runs rather than assuming workflow files mean passing checks.
- Rollback: retain previous app/connector package and snapshot. Prefer additive migrations. Pause publishing and resume the last working connector if office billing regresses. Retry already-submitted commands with the original key.
- Backups: verify provider coverage and retention, record a restore procedure, and perform an isolated restore exercise. Set recovery-time/data-loss commitments only after the exercise and plan capabilities are known.

## 9. Decisions to validate during R0

Observe approximate daily orders, line counts, concurrent users, office PC specifications, Tally version/company layout and acceptable sync delay. Confirm shared-device use, whether all products truly require whole units, handling of split bills/partial deliveries, and the working-day boundary. These refine budgets and later scope; they do not block safe connector recovery work.

Completion means staff can capture and fulfil orders reliably, ledger verification is trustworthy, Tally remains responsive, and offline drafts recover safely. Adding more screens does not satisfy those requirements.

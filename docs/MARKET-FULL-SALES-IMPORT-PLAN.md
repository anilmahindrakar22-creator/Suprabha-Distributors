# Market V1: complete company sales coverage

12 October 2026. Connector scope review for Claude's Market handover. This is a plan, not an activated import, migration or accounting approval. Market remains on its separate branch; no part is added to the speed release.

## Current source behavior

The Economic exporter is already company-wide inside its configured date window. Get-TallyEconomicCollection filters Voucher by date, not installed instrument, customer or item. Read-TallyEconomicEvidence requests canonical company, ledger, product and group masters and all vouchers for that window. Its default starts at the first of the current month minus three months and ends tomorrow; this is three complete months plus the current partial month, not all history. The converter classifies supported economic vouchers, preserves revisions/cancellations and reports unsupported evidence.

Additional older cost history is restricted to items consumed in the current window, including all customers' relevant earlier consumption; it is not a complete older sales book. Combined evidence is capped at 2,000 vouchers, and the server import has the same limit. Neither a selected window nor a successful sample proves complete company sales coverage.

Evidence: desktop-connector/economics.ps1, functions Get-TallyEconomicCollection, Read-TallyEconomicEvidence and Convert-TallyEconomicEvidence; desktop-connector/dashboard.ps1 configured EconomicHistoryMonths/EconomicPurchaseHistoryMonths and explicit economics sync; supabase/migrations/20261007181000_instrument_economic_import_and_rebuild.sql input bound. Instrument sale-date attribution is a downstream placement rule in 20261011000000_instrument_reagent_sale_date.sql, not a restriction in the reviewed exporter.

The legacy DashboardSalesVouchers cache is a separate Sales collection and its pricing read selects a small history per customer/item. It is not the Market financial authority: do not sum limited pricing samples, stock-group display totals, dashboard cache balances or placement attribution as complete company revenue.

## Smallest reliable build

1. Reuse the canonical economic source vouchers/lines and existing net-value policy. Add an explicit company/period import coverage record alongside that authority; avoid a second sales database or parser. Instrument attribution continues to apply its own sale-start/mapping rules. A Market read must not widen instrument attribution.
2. Market reads the last three complete calendar months in Asia/Kolkata: inclusive first day of month minus three months through the last day of the prior month. Import every supported sales voucher and signed return/credit revision in that period, for every customer and item. Current partial month and historical cost movements are outside this revenue window.
3. Make source requests and uploads bounded. Retain whole vouchers and canonical GUID + AlterID + inventory line identity. Split exports by reviewed calendar intervals and upload batches no larger than the existing 2,000-voucher bound. A source interval still too large must split safely or fail explicitly; never silently truncate, raise the limit blindly or count partial coverage as full. Agree the bounded cursor/reconciliation contract before implementing it.
4. Mark coverage complete only after every requested interval/batch is accepted, canonical company checks pass, revisions/cancellations are reconciled and unresolved financial exceptions are visible. An interrupted run retains the last complete generation and labels the new run incomplete. Identical retries are idempotent; changed content at the same source revision is an exception. Publish a generation atomically after its bounded ingestion completes.
5. Revenue uses actual net Tally amounts excluding GST, signed returns/credit notes and the existing approved discount/rounding/freight/document policy. FOC contributes zero revenue. Accounting-only credits need verified linkage or a visible unresolved amount; do not guess their product/division. Exclude cancelled, optional and explicitly non-economic documents. Tally remains the amount authority.
6. Divide accepted lines through the existing canonical item-group catalog and explicit division rules. Unassigned remains a named bucket. Person-confirmed canonical customer identities govern Market joins; no fuzzy customer match. Wallet estimates remain append-only estimates, separate from actual revenue. This release adds no GP or collectible-debt claim.
7. Market API/read models are company-scoped, administrator/management only, paginated and bound to complete source generation. Show exact covered period, latest complete import time and unresolved/unassigned counts. A missing period is unavailable/partial, not zero sales or zero share.

## Acceptance before activation

- A fixed independent three-month fixture reconciles exact paise by customer/division and in total; GST/FOC/returns/rounding are tested separately.
- Two identical instrument placements do not double Market sales. An item unassigned to any instrument still counts in Market revenue, in its division or Unassigned.
- Custom approved sales/credit types are covered; excluded documents never enter revenue.
- Cancellation, increased revision and idempotent batch retry count each voucher once. Same revision with changed contents is rejected visibly.
- Failed/missing/oversized intervals cannot publish complete coverage or overwrite last-good financial reads. A completed run can be replayed from retained evidence.
- Company/role/access revocation tests prevent cross-company reads; phone list/map use the same scoped generation and records.
- Run the disposable deployment-order SQL replay and gateway authorization/idempotency/concurrency checks on the final integrated Market branch. Map its new migrations before release preflight, and recheck gateway-source blocker 7.
- Production Economics cutover, source reconciliation/exception treatment and Accounts review remain separate gates. Existing Accounts sign-in is deferred. No automatic activation against current production.

## Ownership and sequence

Claude owns Market design/backends on claude/market-w1, including the active market-w3 wallet migration/gateway work. Codex owns connector planning, financial/source review and final integration/deployment. First reconcile the completed Market handoff and this source contract; implement coverage/bounded export under a new exact connector/backend file claim; verify synthetic fixtures and disposable replay; capture an approved read-only company period; reconcile native revenue controls; then consider a guarded acceptance integration. Reuse the existing connector and canonical source authority; do not run an extra production connector.

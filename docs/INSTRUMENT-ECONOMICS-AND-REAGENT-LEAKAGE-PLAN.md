# Suprabha OS — Instrument Economics and Reagent Leakage

Status: finalized architecture and implementation baseline; business configuration and source capability checks remain implementation gates.
Date: 7 October 2026 (Asia/Calcutta).
Provenance: Map Feature Design conversation, including corrected attribution architecture and joint planning request. This document supersedes preliminary examples that used assumed margins for actual GP.

Local implementation and verification: [build status and rollout guide](INSTRUMENT-ECONOMICS-BUILD-STATUS.md). The architecture below remains the full target; the guide identifies the implemented V1 boundary and remaining pilot/scale-up work.

## 1. Purpose and architectural decisions

Instrument Economics establishes what each placement actually earns and how that contributes to recovering capital. Reagent Leakage compares expected business/consumption with evidenced supply and turns qualified gaps into commercial actions. They share one verified attribution engine, one source of Tally actuals, and one economic ledger, delivered as two milestones.

Use the existing modular monolith and Postgres. Reuse existing Customer, Product, Instrument, Tally sync, approval, task and audit modules wherever present. The names below describe logical entities; extend existing tables rather than create competing masters. No separate accounting system, duplicated sales entry, independent leakage mapping, or mutable recovery counter.

Authority boundaries:

- Tally is authoritative for accounting customer/product identity, voucher sales, purchase-cost evidence, credits, returns and accounting corrections.
- Suprabha OS is authoritative for assets/placements, verified compatibility and allocation rules, expectations, approvals, commercial actions and their audit history.
- Derived actuals reference immutable source revisions and approved rule versions. They are projections, not a second editable source of truth.
- No silent failures: source gaps, stale sync, unresolved identity, missing cost and ambiguous attribution remain visible with owners and remediation paths.
- Apply ACID to domain changes. Use bounded retries, explicit exceptions and demonstrable acceptance tests; avoid infinite hardening.

## 2. Identity, placements and temporal scope

Canonical accounting keys are `(tenant_id, tally_company_id, source_customer_id)` and `(tenant_id, tally_company_id, source_product_id)`. Names are labels only. Preserve rename history and explicit alias/merge evidence; never fuzzy-match names into financial attribution. If the connector cannot provide stable IDs, resolve that capability before automatic posting. Keep separate companies separate even when names match.

A physical Instrument has a persistent asset ID and serial identity. An InstrumentPlacement is its commercial deployment at a canonical customer and site, with installation/removal dates, commercial model, agreement and capital exposure. Relocation creates a new placement; it does not rewrite the old customer. Prevent overlapping active placements for one asset. Support full/partial placement, reagent rental, rental, customer-owned, demo and loaner labels, but apply only approved V1 economic rules.

All placement windows, mappings, group membership, allocations, consumption conversions, expectations and policies use business-valid half-open intervals `[effective_from, effective_to)`. A null end is open-ended. Store recorded time, actor, verification, reason and superseded version separately. Use transaction business date for economics and recorded/source revision time for audit. Same-day moves require an authoritative cutoff; if date-only evidence cannot distinguish them, mark ambiguous.

Model mapping defines verified compatibility, product category (reagent/calibrator/control/cleaner/consumable/other), economic inclusion and shared-use status. Placement overrides can include, exclude or allocate a product, with evidence, approver, expiry/review date and a reason. Compatibility alone does not prove consumption. Unverified, expired or conflicting rules cannot drive actual attribution.

An Economic Placement Group pools identical or shared instruments where serial-level consumption cannot be evidenced. It belongs to one customer/site scope, with dated members, approved product scope and a recovery policy. Report group actuals once. A physical serial can show membership and investment, but no invented serial GP. Optional economic allocations must be labelled policy allocations, not measured consumption, and must never be summed again with group totals. Cross-site grouping requires explicit evidence that source supply is shared; unresolved site identity remains an exception.

## 3. Shared deterministic attribution engine

Input: tenant/company, immutable source line revision, canonical customer/product, site evidence, business date, signed quantity, unit and net economic amount. Output: economic target shares or explicit excluded/unattributed result, with rule IDs, candidate set, reason, evidence and engine version.

Process:

1. Validate source identity, document type, commercial values, units and revision. Quarantine invalid records; do not erase them.
2. For a linked return/credit, inherit original attribution and cost treatment wherever possible, including after removal. New current placements must not receive an old placement's reversal.
3. Resolve the dated customer/site placement set and verified model rules with valid overrides. Explicit exclusions are recorded as exclusions with reasons.
4. Apply a verified direct placement/product designation only if unique and compatible with the dated placement scope.
5. If exactly one eligible compatible placement exists, attribute 100%.
6. If all candidates are represented by one eligible approved economic group for this product, attribute once to that group.
7. Otherwise apply one verified dated allocation rule across the eligible candidates. Shares must total exactly 100%; allocate quantity, revenue and cost consistently. Distribute currency rounding residual deterministically.
8. Otherwise record UNATTRIBUTED with reason: no placement, ambiguous candidates, unresolved site, missing mapping, expired/conflicting rule, or identity problem. Never choose the newest placement or guess percentages.

Rules at the same precedence that conflict yield an exception, not arbitrary ordering. Model overrides change eligibility before target selection. Group and allocation rules cannot route sales to inactive/incompatible targets. Partial attribution is not in V1: either a complete verified allocation or the full line remains unattributed.

Each source amount reconciles across attributed, unattributed, excluded and quarantined buckets, without double counting. Both modules consume the same attribution result/version; Leakage may not reinterpret a line independently.

## 4. Actual economics and cost-at-sale

Actual net economic sales are signed Tally commercial line values excluding GST, after relevant line discounts and apportioned invoice discounts/adjustments. Preserve source tax/discount components and the allocation method. Allocate document-level commercial discounts proportionately using an approved deterministic basis and rounding residual rule. Non-product charges remain excluded unless a verified policy explicitly assigns them. Do not subtract a discount already included in Tally net value again.

Credit notes and returns are signed adjustments with source links. A value-only credit reduces revenue without inventing returned stock or reversing cost. A verified physical stock return reverses the attributable historical cost according to source evidence. An unlinked credit/return requiring original context enters review; no current-price substitution. Cancellation/edit of a synced voucher creates a new source revision and reversing/replacement economic events.

FOC is zero revenue with actual attributable cost, hence negative GP. Require reason classification: placement commitment, promotion/scheme, replacement/complaint, demo/training, approved goodwill, other with explanation, or UNKNOWN requiring review. FOC quantity remains visible in supply and consumption comparisons. No duplicate cost posting when FOC is already represented by the economic line.

Hard actual rule:

`actual reagent GP = actual net Tally sale value − attributable Tally purchase cost`

`GP % = actual GP / actual net sales × 100` only when net sales are positive; zero/negative denominators display not applicable. Expected margin never fills missing actual cost.

Cost policy is approved, versioned and explicit per company:

1. Prefer reliable sale/batch-to-purchase linkage and historical Tally purchase-cost evidence.
2. If direct linkage is unavailable, permit a documented historical FIFO or weighted-average cost policy only when opening stock, receipts, returns, units and relevant inventory movements are complete and reproducible. Select one supported fallback for V1 after the source capability check; do not build several valuation engines.
3. Without adequate evidence, use COST_UNAVAILABLE or COST_UNVERIFIED, with reason and owner. Never apply today's rate retrospectively or default cost to zero.

Retain purchase voucher/line revision IDs, batch/lot where available, opening-stock evidence, valuation date/window, method/version, normalized quantity and cost components. Define purchase discounts and nonrecoverable taxes/freight consistently with the approved source-cost policy; recoverable GST is excluded. Negative inventory, missing opening cost, future-only purchases and broken pack conversions invalidate verification. A later verified historical correction triggers a restatement with audit history.

For incomplete cost coverage, show total sales, verified-cost sales share, known GP subtotal, missing-cost amount/quantity and incomplete status. Do not label the subtotal total GP or issue a healthy/payback conclusion from it. A truly verified zero purchase cost is allowed only with evidence.

## 5. Expectations, investment and recovery

Expected Economics versions record approval baseline, tests by assay, planned operating days, reagent consumption/yield, wastage/QC assumptions, expected net price/cost or margin assumptions, monthly business and payback target. Expected values are estimates. Preserve original approval baseline alongside current effective expectations. Changing a target must not erase historical underperformance; backdated corrections require explicit approval and a new version.

Investment events record approved capital exposure, installation investment and corrections with source/evidence links. Keep asset acquisition cost separate from placement capital allocation. On relocation, use an approved transfer policy that reconciles remaining exposure between placements, instead of charging full acquisition cost twice. Record customer contributions once: either reduce initial net exposure or add an eligible recovery event, never both. Refunds reverse the treatment. Customer-owned/no-exposure placements show payback not applicable.

Economic event ledger is append-only: GP contribution, capital deployment/adjustment/transfer, eligible customer contribution/refund, reversal and replacement. Every event has unique business/source identity, target, effective date, recorded time, currency, signed amount, source/rule versions, actor/job and reversal reference. Reagent GP is recorded once; FOC and returns are components of that GP, not additional deductions.

Derived formulas:

- Cumulative reagent GP = sum of effective GP events, including negative events.
- Economic recovery = cumulative verified GP + approved eligible non-GP contributions.
- Capital remaining = deployed exposure − economic recovery. Show signed position and, separately, outstanding `max(0, position)` and surplus. Negative GP can increase outstanding exposure; never silently floor GP at zero.
- Recovery % = economic recovery / approved exposure when exposure is positive; show over-100% and negative positions honestly.
- Forecast months remaining = positive outstanding / trailing average monthly verified GP over a configured window, only with sufficient complete periods and positive GP. Otherwise INSUFFICIENT_DATA or NO_POSITIVE_RUN_RATE. Label an estimate, not guaranteed cash recovery.

GP-based recovery is a commercial economic measure, not collected cash, accounting asset book value, or audited profitability. Receivables and service costs are not silently included. Show a provisional known recovery position when cost is incomplete, with no definitive recovered/unrecovered declaration.

Placement proposal approval captures expectation and policy versions, decision, reviewer and exception rationale. Configurable indicative bands: ≤24 months attractive; >24–36 management review; >36–48 director exception; >48 normally blocked. These are seed configuration subject to business approval, not immutable rules. Define override authority, minimum data requirements and contract-duration checks. Missing capital/expected GP blocks a numeric payback recommendation.

Health uses versioned thresholds for business shortfall, negative GP, slow payback, stale supply and unresolved exceptions. Separate commercial health from data quality; UNKNOWN/INCOMPLETE cannot be green. Removal/closure does not suppress later credits or unresolved issues.

## 6. Reagent Leakage design and calculation rules

Terminology: actual mapped Tally purchases means the customer's purchases from Suprabha, evidenced by Suprabha Tally sales. Suprabha supplier purchases provide cost evidence. These are distinct flows. Tally sales show supply, not actual laboratory consumption or competitor purchases.

Use two evidence tiers:

- Consumption-based: verified observed tests by assay, dated reagent recipe/yield and QC/wastage assumptions; optionally evidenced opening/closing customer stock and transfers.
- Commercial expectation-based: approved planned tests or monthly reagent business where observations are unavailable. Label the gap a potential commercial shortfall, not confirmed leakage.

Normalize all packs to one verified base unit with effective yield/conversion versions. Include calibrators/controls/cleaners through their own usage rules; do not multiply every product by every test. Account for shared assay packs and avoid double-counting shared consumption. Prorate by active days and the approved operating calendar. Use a configurable rolling window and lag/grace period to reduce bulk-order timing artifacts.

For each target/product/window:

`expected units = assay tests × approved units per test + approved QC/calibration/wastage units`

`net supplied units = mapped delivered/sold units + FOC units − physical returns`

`observed consumption = opening customer stock + net supplied units + verified inbound transfers − closing stock − verified outbound transfers`

Without stock/transfer evidence, compare expected units to net supplied units and flag SUPPLY_PROXY. Invoice quantities are not assumed delivered when evidence shows otherwise. Open undelivered orders are context, not actual supply. Returns and adjustments carry source evidence. Compare full group demand to group supply; no serial-level leakage without evidence.

`unit shortfall = max(0, expected units − comparable actual units)`

`potential revenue leakage = unit shortfall × versioned expected net selling price`

`potential GP leakage = unit shortfall × (expected net selling price − supported expected unit cost)`

Leakage valuations are opportunities/estimates, never actual ledger GP. If expected price/cost is missing, show quantity gap and VALUE_UNAVAILABLE; if expected unit GP is negative, retain its sign and flag economically unfavorable recovery. For monthly amount-only targets, show `expected net revenue − actual net revenue` as signed business variance, with positive shortfall separately; do not fabricate units or GP from that alone.

Separate volume/supply gap from price/discount/mix variance. FOC may meet unit demand while depressing actual GP; flag FOC burden without also valuing those units as absent supply. Revenue and GP leakage are alternative views of the same opportunity and are not added together. Deduplicate overlapping windows/cases; portfolio totals use one canonical nonoverlapping reporting window.

Classify reason with evidence and confidence: competitor sourcing (confirmed only with evidence), lower test volume, stock buildup/order timing, instrument downtime, service issue, supply shortage, pricing/discount pressure, contract noncompliance, excess FOC, mapping/data issue, product substitution, or unknown. Permit several reasons with a primary reason and comments; do not imply a causal allocation without evidence.

Workflow: detected → data review → qualified/dismissed → action assigned → in progress → outcome pending → recovered/partially recovered/no recovery/closed. Record reason, owner, due date, supporting visit/service/order evidence, and approved baseline/window. Reopened cases retain history. Data problems create remediation tasks rather than sales accusations.

Commercial actions include visit, stock/test verification, service escalation, supply follow-up, pricing/contract review and reagent proposal. Reuse task/CRM entities. An action never writes a Tally invoice. Resulting source sales enter through normal sync.

Recovery/outcomes: link later attributed Tally lines to a case/action through recovery claims. Report evidenced follow-up sales/GP separately from estimated incremental uplift against the frozen approved baseline and comparison window. A later order is not proof the action caused it. Cap claimed portions per source line across cases at 100%; a claim is a reference, never another economic GP posting. Reverse/restate claim value after credits, cancellations or attribution corrections. Missing cost means recovery GP unavailable, even when recovered revenue is known.

## 7. Logical entities and table ownership

All entities carry tenant scope, stable IDs and audit timestamps. Money uses decimal or minor currency units, never floating point; units/shares use fixed precision. V1 uses INR; other currencies are exceptions pending policy.

| Entity/table | Essential data and constraints |
|---|---|
| Existing customer/product + source_identity | Canonical company/source IDs, site links, historical names, verified aliases; unique source keys |
| Existing instrument/model | Asset/serial, ownership, acquisition evidence; serial uniqueness in agreed manufacturer scope |
| instrument_placement | Asset/customer/site/agreement/model, dated lifecycle and commercial model; no overlapping asset placements |
| economic_group / group_membership | Customer/site, dated members and scope; prevent duplicate simultaneous economic membership |
| model_product_mapping_version | Canonical product/model, category, inclusion, validity, verification and supersession |
| placement_override / allocation_rule_version / allocation_share | Product/target scope, dates, evidence, approval, shares, expiry; conflict and share-sum constraints |
| expectation_version / consumption_recipe_version | Original/current baseline, assays, units/yield, price/cost assumptions, period, evidence and approval |
| approval_policy_version / placement_approval | Thresholds, role authority, effective policy and expectation references, decision/reason |
| tally_source_revision / source_line | Source voucher/line identity, revision/hash, signed values/units, links and cancellation; reuse sync storage |
| cost_evidence / valuation_policy_version | Source purchase references, historic basis, status, normalized costs and provenance |
| attribution_run / attribution_result / attribution_share | Input revision, deterministic fingerprint, candidates, target shares, rule versions and exception |
| economic_event | Append-only capital/GP/contribution/reversal facts; unique posting key and reversal linkage |
| economics_projection | Rebuildable monthly/portfolio balances, coverage, health and active generation watermark |
| leakage_evaluation / leakage_case | Window/baseline/attribution versions, quantity/value gaps, evidence tier, confidence, reason and workflow |
| existing commercial_task + case_action_link | Owner, due date, action and outcome evidence; reuse task lifecycle |
| recovery_claim / claim_revision | Case/action/source line share, frozen comparison baseline, outcome status and reversals |
| domain_audit / outbox / processing_exception | Actor/reason/change, transactional events, retry/quarantine state and remediation owner |

Snapshots and linked immutable evidence are intentional audit records, not independently editable duplicate masters. Reuse existing tables whenever they already own these facts.

## 8. Processing flows, audit and concurrency

Ingestion → source validation/reconciliation → dated attribution → historical cost verification → economic posting → projection publication → leakage evaluation → case/action → outcome reconciliation.

Master/expectation edits create a new approved version and an impact preview listing affected dates/targets. Backdated changes enqueue bounded rebuilds. Post compensating events and replacements; never edit historical ledger amounts in place. Store both current-restated views and ability to reproduce prior published/as-known results from versions and run IDs.

Use one ACID transaction for a domain command, its audit record and outbox message. Use unique idempotency keys for imports, commands, posting and recovery claims. Source identity must include company/voucher/line/revision; connector line-key instability must be resolved by full voucher revision replacement, not fragile row-position matching. Repeated sync/retries must have no net effect.

Post a source correction's reversals and replacement postings atomically for its affected scope. For large rebuilds stage an identified generation, reconcile it, then atomically switch the read-model watermark. Readers never mix generations. Old generations stay reproducible. Invalid runs do not replace the last valid view; display its age and failure status.

Postgres exclusion constraints or equivalent locked validation prevent overlapping valid ranges. Lock the relevant allocation scope while checking share totals and conflicting rules; use optimistic version checks on user edits with a clear conflict response. Concurrent workers use leases/row locks and unique posting constraints. Lock source-line claim budgets when reserving recovery shares to prevent concurrent overclaiming. Retry serialization/deadlock errors within a bounded policy, then surface a failure.

Outbox consumers tolerate at-least-once delivery. Jobs have pending/running/succeeded/failed/quarantined states, cursor, heartbeat and bounded retry count. Expose reconciliation failures and stale workers. Never claim distributed exactly-once delivery.

RBAC: authorized staff propose mappings/expectations; designated reviewers verify and approve; management approves exceptions; sales owns actions; administrators cannot silently rewrite accounting source facts. Record actor, reason, before/after or superseded version, correlation ID and source evidence. Enforce tenant/company isolation in every query and job. Use existing backups/migrations/restore practices rather than introduce a new infrastructure program.

Reconciliation invariants: source net value/quantity equals all classification buckets; allocation shares sum to one; each active source revision contributes once; cost allocations conserve source cost; group and individual rollups cannot duplicate; recovery claims do not exceed available source shares; projection equals ledger replay. Track source coverage and last successful sync separately from economic business performance.

## 9. APIs and read models

Illustrative routes, adapted to existing API conventions:

| API | Purpose |
|---|---|
| POST /placements; POST /placements/{id}/close | Dated deployment lifecycle with overlap validation |
| POST /mapping-versions; POST /mapping-versions/{id}/verify | Propose/verify model and placement scope |
| POST /economic-groups; POST /allocation-rule-versions | Dated pooling and approved allocations |
| POST /placements/{id}/expectation-versions | Preserve original baseline and current expectation |
| POST /placements/{id}/approval-decisions | Decide against specific policy/expectation versions |
| GET /economics/portfolio | Filtered totals, completeness, unattributed sales, health, watermark |
| GET /economics/targets/{id} | Capital, actual/expected, recovery, group membership and history |
| GET /economics/source-lines/{id}/explanation | Attribution, cost, source revisions, ledger links |
| GET /economics/exceptions | Owned queue for identity/mapping/cost/sync failures |
| POST /economics/rebuilds; GET /economics/rebuilds/{id} | Authorized scoped asynchronous rebuild and reconciliation |
| GET /leakage/opportunities | Canonical window gaps, confidence, valuations and completeness |
| POST /leakage/cases; POST /leakage/cases/{id}/actions | Qualified case and existing commercial task linkage |
| POST /leakage/cases/{id}/outcomes | Evidence, recovery claim references and closure reason |

Mutation APIs accept an idempotency key and expected entity version where relevant. Return explicit validation/conflict responses, not silent coercion. Read responses include as-of date, sync freshness, source/engine/rule generation, baseline version, data-quality status and denominators. Paginate detail/drilldowns. Aggregate from the same published generation. No client-side independent financial formulas.

## 10. Workspaces and operational views

- Placement proposal: capital, expected tests/business/GP, original payback, contract length, policy rating, required approvals and evidence gaps.
- Instrument Portfolio: customer/site/model or group, deployed exposure, monthly net sales, verified GP/coverage, recovery/outstanding, forecast and health. Filters by owner, region, model, status and exception. Group totals appear once.
- Placement/group detail: original/current expectation comparison, actual trend, capital/event history, products/FOC, mapping timeline, cost provenance and linked commercial actions. All totals drill to source lines.
- Verification workspace: mapping/allocation review, effective-date impact preview, stale rules, site conflicts and group membership.
- Data exceptions: unattributed value, excluded reasons, quarantined sources, unavailable cost and sync failures with owner, age and remediation; never hide these behind portfolio totals.
- Leakage workspace: prioritized potential revenue/GP/quantity gaps, confidence and likely reasons; qualify/dismiss, assign a visit or service action, track due dates and follow-up outcomes. Show estimated opportunity separately from evidenced recovered sales and GP.

## 11. V1 boundaries and acceptance criteria

V1 includes verified canonical identity, dated placements/mappings/overrides/groups, complete deterministic allocation, Tally net actuals, FOC/returns/credits, one auditable supported cost-at-sale policy, append-only economic/recovery facts, versioned expectations and configurable approvals, portfolio/detail/exception views, and the leakage evaluation/case/action/outcome flow. Manual observed tests and stock evidence are sufficient with validation and audit; no LIS integration required.

Explicit non-goals: depreciation, asset accounting replacement, cash collection accounting, IRR/NPV, tax filing, comprehensive landed/service cost allocation, multi-currency valuation, multiple new inventory valuation engines, serial-level inferred consumption, automatic competitor accusations, AI prediction/mapping approval, automated purchasing or messaging, route planning, Suprabha80, microservices, and unlimited performance/security optimization beyond existing standards and demonstrated risks.

Acceptance scenarios:

1. Customer/product renames preserve attribution through canonical IDs; identical names in different Tally companies cannot collide.
2. Install/removal/move boundary tests select the correct placement; ambiguous same-day/source-site cases remain unattributed. A late linked return reverses the original target.
3. Verified single compatible placement gets 100%; identical machines pool once; approved shared allocations conserve units/revenue/cost exactly; conflicting/expired rules yield visible exceptions.
4. ₹50,000 net sale with verified ₹32,000 purchase cost yields ₹18,000 GP (36%). GST and already-netted discounts are not counted twice. Value credits and physical returns reverse the appropriate components.
5. FOC with verified ₹2,000 cost contributes ₹0 revenue and −₹2,000 GP once, carries its reason, and counts as supplied units.
6. Missing/unverified historical cost yields no invented actual GP or definitive payback. Complete-cost coverage and partial known GP are distinguishable.
7. Historical policy/mapping/source correction produces an auditable restatement; old publication is reproducible; ledger replay equals the new projection.
8. Original expectation and approval survive later target changes. Payback bands are configurable; missing data and zero/negative run rate have explicit states.
9. Duplicate imports, retries and concurrent edits cannot duplicate postings, overlap asset placements, exceed allocation totals or overclaim recovery. Tenant/company isolation is verified.
10. Leakage uses the exact same attribution generation. Verified 1,000 expected units versus 700 comparable supplied units yields a 300-unit proxy gap; at expected price ₹100 and supported expected cost ₹60 it yields estimated ₹30,000 revenue and ₹12,000 GP opportunity, clearly labelled estimates.
11. Adding 300 FOC units closes that supply gap but preserves the negative GP burden. Bulk stock, downtime, low test volume and missing stock evidence can qualify/dismiss/reclassify cases without changing actual sales.
12. Follow-up claims across overlapping cases stay within the source line budget; credits restate outcomes. Recovered sales are reported separately from estimated causal uplift and never post GP twice.
13. Failed/stale sync or rebuild remains visible; previous valid data is marked stale. Every headline reconciles to evidence/buckets, and a group/member portfolio cannot double-count.

Release gate: representative Tally fixture reconciliation, temporal/allocation/cost tests, transaction/retry/concurrency tests and a business walkthrough of portfolio, exception, leakage and recovery flows. Stop after these gates pass and demonstrated P0/P1 defects are resolved; defer speculative refinements.

## 12. Phased implementation and effort

Estimates are focused engineering person-days, assuming reusable masters, working Tally sync, auth, tasks and audit infrastructure. They include targeted tests and review; business evidence collection and waiting time are additional. This document is a plan, not a claim that these foundations have been inspected or implemented.

| Phase | Deliverable / exit gate | Rough effort |
|---|---|---:|
| 0. Capability and policy check | Inspect existing schema/connector, stable IDs, credits/FOC, historical cost/stock and site evidence; agree one cost policy, capital treatment and owners | 1–2 days |
| 1. Temporal foundations | Placements, groups, verified mapping/overrides, unit conversions, expectations/approval versions and constraints | 2–3 days |
| 2. Actual economics core | Deterministic attribution, cost verification, net adjustments, immutable events, idempotent rebuild/reconciliation | 3–4 days |
| 3. Instrument Economics milestone | Portfolio/detail/proposals/exceptions, health/payback and business fixture acceptance | 2–3 days |
| 4. Leakage milestone | Consumption/expectation gaps, confidence, case/action flow and recovery claims/read models | 3–4 days |
| 5. Pilot and release | Representative customers/groups, retry/concurrency and end-to-end checks, operating guide and bounded fixes | 1–2 days |

Total: approximately 12–18 focused person-days; Instrument Economics through phase 3 approximately 8–12 days. Earlier conversation estimates of 5–8 days were a narrow assumption, not a commitment for this expanded acceptance scope. A thin end-to-end slice can be demonstrated earlier. If cost history is inadequate, release explicit unavailable-cost states, not fabricated GP; connector/source remediation is separately estimated after phase 0.

Sequence: accept existing V1 pilot and fix demonstrated critical defects → shared foundations → Instrument Economics accepted → Reagent Leakage accepted → later map/route planning and Suprabha80. Do not expand this milestone to absorb those later modules.

Before coding, record configuration decisions for cost method, group recovery policy, capital relocation treatment, approval roles/bands, health windows, leakage lag/baselines, unit conversions and evidence owners. These configure the finalized architecture; they do not require reopening it or delaying documentation.

### Acquisition capital source (8 October implementation decision)

Prefer an explicitly management-verified Tally purchase stock line for an individually billed instrument. Derive capital server-side from its net purchase amount excluding GST; never use a customer sales invoice as our acquisition cost. Store an immutable acquisition link and capital event atomically, preserve voucher revision and serial verification reference, prevent cross-company/duplicate/reagent-cost reuse, and expose later source revision/cancellation as unresolved acquisition evidence. Keep an evidenced manual historical/bulk allocation fallback and audited installation-cost adjustments. Management re-verification of compatible source revisions is implemented as an append-only acquisition review plus a compensating capital event, guarded by target/source versions, cancellation confirmation and approved placement/group payback limits. Changed evidence blocks approval/forecast until reviewed. Missing/incompatible source identities, automatic book/resale valuation and bulk-line splitting remain outside this slice. See build status for verified behavior and rollout limits.
Acquisition review contract: `review_acquisition(targetId, expectedVersion, expectedSourceRevision, reason, confirmCancellation?, directorException?, idempotencyKey)` uses the trusted session actor and server-derived amounts. The immutable `stockflow_economic_acquisition_reviews` entity stores target/review sequence, voucher/purchase-line references, previous/new amount, capital-event reference, actor/reason/time. Workspace read models expose `acquisitionReviewItems` and `acquisitionReviews`; Setup provides the review preview and Evidence/history preserves each reviewed valuation. Review and financial publication are one ACID command; zero-difference revisions do not repost capital, and acknowledged source revisions are compared with the latest imported revision before clearing the exception.
### Below-cost instrument billing and placement investment (8 October clarification)

Instrument purchase cost and instrument selling price are different authoritative Tally facts. A placement can deliberately bill the customer less than its acquisition cost in exchange for future reagent business. Gross acquisition/capital stays visible; net instrument billing is upfront economic recovery; the difference is commercial placement investment. Example: ₹5.5 lakh purchase cost − ₹2 lakh net customer billing = ₹3.5 lakh investment. This is an analytical commercial investment, not a change to Tally book classifications or proof of cash collection.

`net placement investment = max(0, gross capital − verified net instrument billing)`.

`outstanding investment = max(0, gross capital − instrument billed recovery − actual reagent GP recovery − separately recorded contributions)`.

Approval payback uses net placement investment / expected monthly reagent GP; actual forecast uses outstanding investment / verified trailing actual reagent GP. Instrument sales never enter reagent revenue, consumption, cost, GP or leakage recovery claims. Purchase cost is not charged twice. Above-cost billing cannot create negative placement investment; invoiced recovery remains fully visible.

Management links one individually billed instrument sales line to its verified acquisition placement with canonical company/customer/product/unit, serial verification evidence and target version. The immutable instrument billing link reserves company/voucher/line across revisions. Rebuild resolves current source revisions, credits and returns, adds/reverses source-backed contribution events atomically, conserves net billing and prevents excessive combined refunds/returned quantity. Missing/incompatible original sales remain exceptions; cancellations remove billed recovery. The monthly sales reconciliation has a separate instrument-billing bucket. Pooled instrument billing belongs once to the approved capital-owning group (including opening billing and later corrections); historical group capital persists until explicit transfer/retirement adjustment. Current-month group capital is cumulative even when revenue reporting covers the prior month.

Entities/API: `stockflow_economic_instrument_billings`, `link_instrument_billing(targetId, expectedVersion, sourceLineId, reason, idempotencyKey)`, target `instrumentBillingPaise`, `netInvestmentPaise`, `instrumentBillingCurrent`, source/status `instrument_billing`, and reconciliation `instrumentBillingSalesPaise`. Billing is a source-backed contribution, not a second profit posting. Statutory instrument P&L and customer receipt reconciliation remain Tally authority. Bulk invoice splitting, multiple instrument/deposit invoices per placement, and automated serial matching remain outside this bounded link workflow; evidenced manual contributions remain available for historical cases.
### Opening recovery corrections after grouping

Each attributed reagent result preserves the original sale date as `recovery_origin_date`. A return or credit retains that original date for capital-recovery ownership, while its voucher business date continues to govern monthly reporting. A group holding member opening recovery includes later corrections to those opening sales. Generation reversals resolve the immutable prior result's origin, so a rebuild cannot lose or duplicate the correction. Group monthly revenue/GP, cost exceptions and trailing GP include post-group corrections to inherited opening sales. Manual contributions retain their own evidenced effective date. This does not allocate pooled GP back to individual serial numbers or introduce automatic residual-capital transfers.

### Reload recovery for uncertain financial commands

Persist only action, opaque idempotency key and original account in tab session storage before dispatch; never persist financial payloads. Reload blocks mutations until explicit receipt checking or atomic closure. The status-only `recover_economic_command` API accepts commandAction/commandKey/closeUnresolved under authenticated original-account binding. Accounts may read their own status; Management may close. Absence is unresolved. Closing takes the same global then command lock as writers, returns accepted for an existing commit, or records a close tombstone and audit atomically to fence delayed original delivery. No automatic reconstructed replay or guessed failure is permitted. Existing in-memory exact-payload retry remains available before reload.

### Leakage classification, immutable evaluation and financial comparison

Controlled reason codes cover unknown, competitor sourcing, lower test volume, stock/order timing, downtime, service, supply shortage, pricing pressure, contract noncompliance, excess FOC, mapping/data issues, substitution and other. Store a primary code, several contributing codes, confidence and supporting evidence. Confirmed classifications require evidence; unknown cannot be silently promoted. Case audit snapshots preserve classification, actor, action and outcomes without estimating causal shares.

Freeze each case's evaluated window/units/potential values and expectation/observation/source-generation references. Protect original valuation and scope against rewriting. Expected-generation checks reject stale opportunity commands and missing evaluations remain explicit failures. Audit UI exposes recent case events and the frozen estimate; older events stay in the immutable ledger with visible read-model bounds.

Leakage valuation must reject incomplete attribution, not merely incomplete sync coverage. Unattributed company/customer/product sales in a window make money estimates unavailable until mapping remediation. Physical quantities may still be displayed as known partial evidence.

In parallel with quantity-gap opportunity estimates, calculate signed actual-minus-expected net revenue and GP variances for the same product/unit/window: expected supply units × versioned expected unit economics, compared with actual mapped Tally net revenue and verified purchase-cost GP. FOC stays physical supply with zero revenue and actual cost. Missing actual cost cannot invent actual GP or its variance; independently known expected economics stay separate. Invalid stock reconciliation, missing coverage or unit/attribution uncertainty blocks monetary comparison. Financial variance and supply-gap estimates overlap and must never be summed; neither proves competitor procurement or causal loss.

### Connector source normalization acceptance

Tally XML metadata counts must not be mistaken for masters, and ALL/plain aliases must not be summed twice. Cancelled vouchers retain GUID/AlterID/date even if party and inventory are cleared. Zero-valued native inventory amounts may be exported as blank strings: accept zero only with explicit numeric evidence evaluated by Tally, bound to the identical canonical voucher revision and ordered inventory fields/count. Preserve that proof on the immutable source line; missing/mismatching proof remains unverified. Invoice rounding is an explicit canonical-ledger role, allocated in exact paise by original nonzero inventory values, with deterministic residual ownership and zero allocation to FOC lines. Freight treatment requires the approved commercial/cost policy. Never activate ledger roles from a name guess or treat proforma/delivery documents as economic sales from their parent type.

Explicitly approved non-economic voucher roles retain immutable document identity/revision/date/type/classification with zero economic lines. They remain visible for audit and coverage reconciliation; they never become reagent revenue, GP or invoiced supply. Standard financial types cannot be excluded through custom-role configuration. Existing economic vouchers cannot be silently erased by reclassification. A newer native Tally invoice revision may promote an earlier excluded quotation while preserving the original evidence; config-only or missing-type promotion is rejected. The Accounts read model exposes bounded excluded-document history and its retained total.

### Recovery display and portfolio reconciliation refinement

Recorded recovery completion and future payback estimates are separate concepts. Show recorded surplus above capital in exact paise, and label recovery as an economic measure rather than cash collection. Evidence-review flags override a completed/not-applicable forecast label. Pooled members do not repeat group recovery.

Portfolio financial totals use the active economic result generation, not a sum of placement and group cards. Report verified cost, known GP and missing-cost result-line count together. Missing-cost sales of zero cannot certify cost completeness because FOC lines have zero revenue and may still have unavailable purchase cost. Allocated result shares count separately; this metric is not an invoice count.

### Subsequent capital approvals and actual posting dates

Positive manual capital increases on approved placements/groups follow the acquisition-revision payback policy: verify current instrument evidence, use gross capital less source-backed instrument billing, validate positive expected GP for remaining exposure, enforce review/absolute limits and retain the exact baseline/policy/exception audit. Contributions remain separately evidenced recovery events. Each command returns its immutable event identity. Actual capital/contribution events cannot be future-dated; scheduled future postings are outside V1.

## Refinement — 9 October 2026: business dates and frozen case estimates

- All economics reporting and date validation use Asia/Kolkata (Asia/Calcutta), independently of the database session timezone. Audit timestamps remain UTC instants. The workspace displays the server business date and timezone. Multi-timezone businesses are outside V1.
- Monthly expected reagent quantities use the actual calendar-month length when a baseline or placement changes mid-month. Opening a case from that segment preserves the displayed expected units and revenue/GP opportunity; it cannot recalculate a partial window as a full month.
- A valued V1 case must reference one exact reporting segment within one calendar month, with an exclusive end date. Requests spanning several baseline segments or months fail explicitly. Unvalued investigation cases remain supported.
- Regression coverage includes Indian midnight/month-end under different database session timezones, segmented estimate freezing, and rejection of merged or multi-month valued windows.

## Refinement — 9 October 2026: investment risk after billing restatement

A verified instrument credit/refund/cancellation can increase the investment after approval. Tally revisions still restate net billing and recovery automatically; source truth is never blocked merely because a historical approval threshold is now exceeded.

The server now publishes an investment review using current gross capital minus current net instrument billing, the immutable expected-GP baseline referenced by the original approval audit, and the current versioned policy. It returns the baseline/policy IDs, current investment, expected payback, original approved investment/payback and original director-exception flag. A subsequent planning baseline cannot silently replace that approval basis. This expected investment review is separate from the forecast derived from trailing actual GP.

- Above the review limit: amber investment review and Watch portfolio health when evidence is otherwise complete.
- Above the maximum, or new exposure without positive approved expected GP: red investment warning and Critical health when evidence is complete.
- Changed acquisition/billing evidence: explicit evidence review; no invented expected payback. A missing planning baseline is shown as planning not set and does not block verified actual tracking.
- Pooled members show their group's investment review rather than duplicate warnings/amounts. Closed/proposed portfolio status retains its lifecycle precedence. No approval, source event or director exception is overwritten or automatically revoked.
- Threshold comparisons use the unrounded database value. If displayed months round back to the breached threshold, the UI says “Over N months.” Setup labels distinguish the director-review threshold from the absolute permitted maximum.

Local regression examples: ₹5.5 lakh gross cost less ₹2 lakh instrument billing is ₹3.5 lakh/35 months at ₹10,000 expected monthly GP. A ₹50,000 credit produces ₹4 lakh/40 months (review), and a full refund produces ₹5.5 lakh/55 months (maximum exceeded). Original approval remains 35 months. SQL coverage also checks a one-paise threshold breach, unchanged original approval basis after a new planning version, and current-policy changes. This is a management review signal, not a new approval workflow or a cash-receipt calculation.

## Refinement — 9 October 2026: slow actual recovery affects health

Portfolio health now also evaluates the unrounded actual recovery forecast against the current versioned review/maximum payback bands. This closes a reproduced case where near-target net sales and positive but low reagent GP left a 43-month recovery forecast Healthy. Above 36 months is Watch; above 48 is Critical with the seed policy, subject to the same evidence and lifecycle precedence as other commercial health signals.

The forecast is still outstanding investment divided by verified trailing actual reagent GP; it requires the existing minimum active history, complete source coverage, current instrument evidence and verified costs. No forecast is manufactured when those conditions fail. Pooled members have no independent forecast/review; their approved group owns that assessment. The read model retains the policy ID and exact comparison status, while the displayed month figure is rounded. A separate amber/red “Actual GP forecast review” explains why a placement can have acceptable approved expected economics and poor realized recovery. The original approval remains immutable.

Disposable database examples hold net sale at ₹50,000 and gross capital at ₹5.5 lakh. Verified actual cost ₹37,500 gives ₹12,500 GP, ₹5,37,500 outstanding and a 43-month one-month-window forecast (Watch). Verified actual cost ₹45,000 gives ₹5,000 GP, ₹5,45,000 outstanding and a 109-month forecast (Critical). The expected approval payback remains about 30.56 months in both. Changed purchase-cost revisions first remove the forecast until cost reverification succeeds. The one-month window is test configuration; the default trailing window remains three months.

Verified zero/negative trailing actual GP with outstanding exposure now has an explicit `non_positive_gp` review status and Critical commercial health. It produces no numeric forecast. This is distinct from missing cost/history/coverage, which retains Data incomplete or unavailable assessment. A third disposable fixture uses verified purchase cost equal to the ₹50,000 net sale: zero actual GP, full ₹5.5 lakh outstanding, Critical status and null forecast. Forecast eligibility is calculated once and shared by the status and numerical projection; pooled member forecasts stay absent.

## Proposal approval preview and financial freshness — 9 October 2026

The proposed-target review presents instrument capital, net customer instrument billing, remaining investment, expected monthly reagent GP and expected payback before a decision. Economic groups use the member capital included at group start. The server selects the immutable expectation effective at placement start, independently of the reporting-month expectation. One private calculation serves both the read model and the locked approval command; the browser only formats the returned amounts.

`investment = max(0, instrument capital − net instrument billing)`.

`expected approval payback = investment / expected monthly reagent GP` when a planning baseline exists and investment is positive; zero investment gives zero expected investment payback. Without a baseline, the proposal can be approved for actual tracking and expected payback remains not set. A baseline with nonpositive expected GP and positive investment, a closed lifecycle, or unresolved instrument evidence cannot produce an approvable proposal. Policy comparisons use exact values before display rounding; a one-paise threshold breach remains visible.

The approval preview exposes its status, gross capital/billing/investment, expectation ID/date/GP, policy ID/limits and exact expected payback. Green means within the review limit, blue means ready for actual tracking without a planning target, amber indicates a director exception or missing evidence, and red indicates excessive payback or nonpositive expected GP. Management chooses a decision explicitly and records a reason; no decision defaults to approval or rejection. The UI requires the director checkbox when the returned status requires an exception. Accounts can read the preview without mutation controls.

Approvals require both target `expectedVersion` and the workspace `expectedGeneration`. Inside the existing financial advisory lock, the gateway rejects an absent/stale generation with PT409 before posting the decision. Expectation, policy, capital, group-member and source mutations publish a new generation in the same transaction. This deliberately also invalidates a preview after an unrelated economic rebuild; V1 favors a refreshed review over a separate cache or duplicate dependency tracker. Rejection remains possible with a current target version and reason, without satisfying positive-GP/payback conditions. Exact accepted-command retries return the original receipt before freshness checks, without duplicating approval/audit/ledger effects.

An accepted decision retains the server-derived preview, exact expectation/policy references, net investment and payback in its immutable audit record. Client-supplied approval evidence fields are replaced by that calculation; rejected decisions do not retain fabricated approval financial fields. The same commit includes the target decision/version, rebuild, audit and idempotency receipt. Two-session tests confirm a queued approval sees a committed policy change, fails without partial writes, succeeds after refresh, and then replays identically.

A rejected newer or conflicting Tally purchase/billing revision is unresolved evidence even while the last admitted source record remains in the ledger. Canonical company/source identity and source revision/time determine whether a retained import exception is still unresolved. Acquisition/billing currentness and the proposal preview expose the warning; an old admitted source cannot be newly linked or used to acknowledge acquisition changes while its newer evidence is quarantined. A later verified billing revision can resolve the warning without deleting the exception; a later verified purchase still requires explicit acquisition review. This does not replace historical Tally events, invent a cost, or treat instrument billing as reagent GP or cash collection.

The economic setup disclosure defaults closed while proposals await review, so the financial preview is not buried below the full create/setup form on smaller screens. It remains available through a keyboard-operable disclosure, and defaults open when there are no proposed targets. The proposal decision remains a separate form.


## Investment increases retain the approved GP baseline — 9 October 2026

Positive capital increases and acquisition-cost increases on approved placements or economic groups use the exact expectation ID retained by the original approved placement decision. The current versioned policy still determines review and maximum bands. A new current or backdated planning assumption is not a new investment approval and cannot weaken these checks. Missing original approval evidence fails explicitly; the gateway never substitutes the latest planning GP. Proposed placements continue to use their placement-start proposal baseline until an explicit approval captures it.

The original-baseline selector is shared by the current investment review, manual capital command and acquisition review. Each affected approved group is checked against its own original approval baseline when a member purchase correction increases pooled capital. Audits preserve the same original expectation reference, current policy reference, exact recalculated expected payback and explicit director exception. This does not change actual Tally purchase/sales evidence or actual reagent GP. A future renegotiation/reapproval workflow is outside V1; editing a planning expectation alone does not authorize replacing the original investment approval.

A regression reproduced the loophole before the fix: changing expected monthly GP from ₹18,000 to ₹50,000 at the original effective date allowed a ₹98,000.01 capital increase to bypass director review. It now requires the exception on the original ₹18,000 basis. A ₹4 lakh increase remains above the original maximum even with a director exception. Further tests cover a pooled group with an exactly 49-month proposed exposure and a revised ₹7 lakh acquisition that requires director review against its original ₹18,000 expected monthly GP. Rejected commands retain no successful receipt or partial capital/review event; accepted commands retain their original baseline reference.


### Covered purchase-cost corrections

The acquisition increase check uses net investment after verified instrument billing, consistently with proposal/manual-capital checks. When billing still covers revised gross capital completely, an original zero-GP baseline is valid and expected investment payback is zero; the command must not divide by zero or demand reagent recovery for absent exposure. The original approval evidence is still required and preserved. If the purchase revision creates positive uncovered investment, positive original approved GP is required and normal current-policy limits apply. Regression examples use ₹6 lakh instrument billing, a purchase revised from ₹5.5 lakh to ₹5.7 lakh (covered, accepted with zero expected investment payback), and a later ₹6.5 lakh cost (uncovered, blocked on a zero-GP baseline). Instrument billing remains invoiced recovery and never becomes reagent GP or cash collection.


## Simple product-mapping entry — 9 October 2026

Keep the existing setup form. Company and model inputs offer suggestions from the existing targets, mappings and admitted source lines. Product suggestions are scoped to the exact company and show source names alongside canonical IDs; duplicate names remain distinct IDs, while repeat source lines for the same ID produce one suggestion. The selected source name remains visible for review. Names are display hints and never perform attribution or identity matching. Verified IDs outside the bounded imported history can still be entered explicitly.

The optional placement override selector lists only placements matching the entered company and model. Its default applies the mapping to all placements of that model. Changing company clears model, product and override; changing model clears the override. Publishing a new generation resets this mapping entry to avoid carrying a prior setup selection into a refreshed workspace. Dates, include/exclude effect, verification reason, Management permissions and canonical server validation stay in the existing command flow. This adds no master table, setup wizard, approval step or new financial policy.


## Item groups plus individual items — 10 October 2026

An instrument placement may include whole Tally item groups and additional individual products. Groups include descendants. A product included through both paths contributes once. Only included products' actual GST-free net sales and verified attributable historical purchase costs enter that placement's reagent revenue/GP. Other sales remain outside its financial totals and stay reconciled in the existing unattributed/excluded/other-target buckets. The lifetime completeness gate for forecasting remains conservative about unresolved customer sales; this change does not relax evidence requirements. Linked instrument selling invoices retain their investment-recovery treatment and never become reagent GP.

The existing Setup workspace provides Map item group to instrument and Set product mapping. Group selection uses friendly names and current item counts; company/model/catalog identifiers come from the selected instrument and verified source. An individual include adds an extra item, while a direct individual exclusion at the same scope overrides a group include. Attribution resolves placement product rule, placement group rules, model product rule, then model group rules. Within one scope, overlapping group exclusions win over includes. The existing shared-instrument/group/allocation hierarchy still applies; a group mapping never forces an ambiguous sale to one instrument.

Two immutable private evidence tables extend the pending V1 migrations: stockflow_economic_item_catalogs holds canonical Tally StockGroup/StockItem snapshots (GUIDs, parent GUIDs, membership, names and units), and stockflow_economic_item_group_mappings holds reviewed dated rules referencing the initial catalog. These are imported evidence and mapping history, not another editable item master. Read-only connector exports reuse the same Tally company authority and exact master lookups. CMPINFO stock-item/group counts are distinguished from real master nodes; missing/duplicate GUIDs, unknown parents, cycles, missing base units and oversized catalogs fail visibly. Bounds are 2,000 groups, 10,000 items and 64 hierarchy levels. Repeated unchanged catalogs do not append another full copy.

The initial reviewed snapshot anchors an explicitly chosen historical mapping start when earlier master evidence is unavailable; Accounts/Management must verify that backdated membership. Later observed membership changes apply from their Asia/Kolkata business date. New products/subgroups follow automatically after a verified sync. Moving/removing items stops future group attribution, while earlier dated membership remains available for rebuilds. Renaming a group preserves its GUID-based rules. Invalid newer evidence is retained as an import exception and suppresses group-based attribution until verified catalog evidence recovers; independently reviewed individual rules remain usable. Exact intraday master change reconstruction before observation is outside V1.

The Management-only set_item_group_mapping command checks expectedCatalogId under the shared economic advisory lock, derives company/model from the selected placement, validates the canonical group, and stores the rule, rebuilt generation, audit and receipt in one transaction. The audit retains the reviewed member IDs and source version, ignoring caller-supplied member lists. A queued command after a committed catalog change returns an explicit refresh conflict without partial posting. Exact accepted retries return the original receipt. GET read models expose current group catalogs/counts and immutable rule history to authorized financial readers; public stock snapshots retain neither the private catalog envelope nor financial evidence.


## Monthly item count and GP breakdown — 10 October 2026

Selected target details show Unique billed items, Invoice lines, Net sales and Known GP, followed by the item list with canonical product ID/name, net quantity and unit, actual net sales, known historical purchase cost, known GP and cost status. A repeated product counts once even across invoices, group-plus-individual mapping or distinct unit rows. Different canonical products sharing a name remain separate. This count covers attributed billed reagent items in the reporting month; it is not the full mapped catalog, and items with no billing are not added as zero-sale rows.

The server derives each target's itemBreakdown directly from the current published results, using the same monthly window and stockflow_economic_result_owned rule as the target totals. Pool-owned later credits against pre-pool sales are therefore included consistently. Instrument selling invoices are excluded. Returns/credits retain their signed amounts and original attributable cost; FOC retains zero revenue and actual cost. Product/unit grouping preserves six-decimal quantities without combining different units. PostgreSQL numeric sums and string paise retain exact financial amounts; no new master or stored financial subtotal is introduced.

Known purchase cost and GP remain partial when any constituent line lacks verified cost. A product with no verified cost has null cost/GP, displayed as Unavailable rather than zero. Amber explicitly marks partial/missing evidence; negative GP is red, nonnegative known GP is green, with amount signs/text preserving meaning. Empty reporting months are distinguished from an unavailable older read model. The existing line-level source evidence remains below the monthly summary and covers all current-generation dates.

## Existing instrument registration — 10 October 2026

Equipment installed before OMS orders were used belongs in the existing equipment register. The Management-only register_historical_instrument action selects a current verified Tally selling line, canonical customer, exact serial/batch and confirmed installation date with evidence. Installation date is independent of invoice date and may equal it when confirmed. Reject future/pre-invoice dates, changed or unresolved sources, mismatched serials, duplicate invoice registration and duplicate customer/serial assets. Reuse the existing command receipt, economic lock, transactional rebuild and immutable audit; exact retries return the accepted receipt.

Historical records have customer_id, historical_sale_line_id and installed_on with nullable order_id. Normal OMS-origin records retain their order reference. Database origin constraints distinguish both valid shapes. Audit completed_at records registration time; installed_on records the confirmed historical business date. Service reads reuse the canonical customer and Tally invoice reference. Historical service tickets carry no fictitious order, and a trigger enforces that every ticket's order matches its installation, including null historical origins. No new equipment or customer master is introduced.

Registration itself posts no financial amount. Create target separately links the individually billed Tally purchase and capital evidence; link instrument selling invoice separately records net billed recovery and investment. Missing expected monthly sales/GP remains unset, with Proposed status and unavailable payback. Management may approve the placement for actual tracking without inventing an expectation; expected payback limits apply when a planning baseline exists. Proposed targets do not participate in reagent attribution. Physical equipment remains visible for service independently of economic approval.

## Simple investment view and mapping setup — 10 October 2026

The owner requested fewer fields and a view of investment/recovered capital without an expected sales or GP target. The main instrument card now leads with Investment, Capital recovered and Balance to recover, followed by monthly reagent sales/GP and the existing labelled health color. Purchase cost and net instrument billing explain investment in one line; invoice totals, expected economics and forecast are expandable. The selected detail's duplicate financial grid is also collapsed. Expected sales/GP are not required to render this view.

Investment uses the published net placement investment (purchase/capital less instrument billing). Recovered investment uses the published lifetime recovery minus its instrument-billing component, so instrument billing is not counted twice against the net investment. Signed GP/contributions and surplus are retained; this is economic recovery, not cash collection. Missing purchase costs remain partial, and Proposed records still show Pending approval for uncalculated reagent recovery. This presentation change does not approve a placement or change the attribution/approval engine.

Group mapping now needs only instrument and group selections in its main flow. Individual mapping similarly selects instrument and reagent by name; canonical company/model/product IDs remain the submitted identity. Current catalog items are included even if not yet billed. Model-wide rules and verified IDs outside imported history remain an explicit advanced option. Dates, exclusions and audit notes are editable optional controls; default inclusion begins on the server's Indian business date, visibly shown before saving. A generic mapping-intent note is not represented as purchase-cost verification. Historical mapping requires deliberately changing the date; no backdating is guessed.

### Actual recovery without a planning target

Expected monthly sales, expected monthly GP and expected payback are optional planning fields. A placement with current instrument acquisition and billing evidence can be approved in **actual tracking** mode without entering those values. Approval then activates the same verified Tally attribution engine: mapped net reagent sales and verified purchase cost produce actual GP, and that GP reduces the instrument's balance to recover. The approval preview says **Ready for actual tracking** and keeps both planning fields as **Not set**.

This does not weaken evidence controls. Missing or changed acquisition/billing evidence still blocks approval; missing reagent purchase cost remains unavailable rather than becoming estimated GP; approval remains an auditable Management decision with generation/version checks and idempotency. Expected targets can be added later for leakage and payback planning without rewriting actual economic history.

After approval, the absence of optional planning values is not a data-quality failure. Data incomplete is reserved for missing or stale source evidence, unavailable purchase cost and unresolved attribution. When those inputs are complete, the portfolio health color follows verified actual GP and recovery/payback evidence; if there is not yet enough actual history for a forecast, the forecast remains unavailable without falsely marking the instrument incomplete.

The cost-review workspace stays task-focused: show only current mapped reagent sales with unavailable cost, then offer compatible historical Tally purchases. Hide already verified, instrument-billing and unrelated sales. The reviewer still selects the purchase evidence and records its reference; the server rechecks revision freshness, remaining purchase quantity, product/unit/batch compatibility and exact sale-quantity coverage before publishing GP.

## Owner refinements — later 10 October 2026

For billed instruments, reagent sales and GP start inclusively on the current compatible Tally instrument invoice date; physical installation remains a separate date. Invalid/cancelled linked billing leaves the start unavailable. Dated mappings still apply. Revisions restate financial events through the existing immutable ledger.

Historical cost evidence must include earlier consumption of the same items across customers. Limit older retained history to items needed by current sales/returns, preserving whole vouchers and explicit source failures/cancellations. A partially covered sale reserves its available purchase stock without claiming full cost or GP. Combined bounds fail visibly. This does not claim a reconciled opening inventory or silently restock unsupported returns.

Simple item suggestions follow verified Tally related-group membership, not customer purchases alone or brand-name guesses. Following the owner's later clarification, explicit item search covers all current same-company Tally items across groups; related items sort first. Search alone never changes mappings or instrument GP. Adding an item is an explicit dated canonical-ID mapping, and group/individual overlap counts once.

Existing-instrument billing uses a searchable selector with item, human invoice number, date and serial/batch. Editing search clears the previous source selection/revision and serial. Installation stays separately confirmed. Import exceptions retain a visible count and Accounts review explanation; technical records are collapsed by default, separate from the mapped sales missing purchase cost. No extra data entry, financial policy or database layer is added for these UI refinements.

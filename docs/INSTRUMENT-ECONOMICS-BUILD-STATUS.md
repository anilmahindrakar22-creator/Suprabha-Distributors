# Instrument Economics and Reagent Leakage — build status

Updated: 10 October 2026, Asia/Calcutta. **Acceptance candidate deployed; production promotion and live financial certification pending.**

Architecture: [finalized plan](INSTRUMENT-ECONOMICS-AND-REAGENT-LEAKAGE-PLAN.md). This guide distinguishes the implemented V1 from the full target.

Current deployment evidence and remaining gates are recorded in the [rollout record](INSTRUMENT-ECONOMICS-ROLLOUT-RECORD.md). Accounts approved the extraction rules; seven migrations and the application/gateway are deployed to the isolated candidate. The owner's real Administrator session successfully registered an existing instrument, created its purchase-backed economics target, linked below-cost billing and mapped the requested reagent group. Older checkpoints below describe their state at the time. Production remains unchanged; financial certification and separate staff-role acceptance remain pending.

## Historical reagent reconciliation and pending totals — 10 October 2026

The source review now reaches back to July. A read-only extraction found 575 documents, including three unresolved documents; a targeted 68-document subset was admitted through the existing candidate import trigger. Candidate totals are now 280 source vouchers and three visible import exceptions. The public stock payload hash stayed unchanged. This partial history does not establish complete lifetime coverage. Actual customer amounts, invoice identities and purchase-cost proposals remain in restricted local work files outside Git.

The selected group matches historical reagent sales after installation. Compatible purchase evidence was prepared for review, with explicit missing/ambiguous candidates and supplier zero-value purchase entries. No purchase-cost verification was posted. The target remains Proposed and expected sales/GP remain unset. Decisions on actual-only tracking for an existing installation and a separate packing-charge ledger remain pending; no approval or cost-policy change was inferred.

Proposed cards and item breakdowns now display **Pending approval**, with an explanation that attribution has not started. They no longer present zero revenue/GP or an empty billed-item table as evidence of no customer purchases. Approval rules and financial calculations are unchanged. The regression failed before this correction; 29 focused unit tests, eight focused desktop/mobile browser checks, lint, TypeScript and the staff build passed. Synthetic previews: [desktop](UI-PREVIEWS/instrument-proposed-pending-pricing-desktop.png), [mobile](UI-PREVIEWS/instrument-proposed-pending-pricing-mobile.png). Guarded acceptance Worker version: `c97bac83-46a9-4a3e-bc25-420d744aae0e`.

## Hosted historical instrument setup — 10 October 2026

Register existing instrument now reuses the equipment register for assets installed before Orders was used. It requires a current Tally selling line, canonical customer, matching serial, confirmed installation date and evidence. The invoice date and installation date remain separate fields, even when equal. No fictitious order is created. These assets appear in the service portfolio and support service tickets without an OMS order. Registration, target creation, capital linking and instrument billing retain their separate auditable responsibilities.

The real candidate pilot completed these commands through the signed-in Administrator UI. The owner corrected the installation date to match billing; the new confirmation supersedes the earlier date. The selected subgroup has 30 current Tally items, and subsequent verified membership follows automatically. Instrument billing remains separate from reagent sales/GP. The owner reported expected monthly sales and GP as **not set**; no baseline or target approval was invented. The proposal can now be approved for actual tracking without a target, but it does not participate in reagent attribution until Management records that decision. Payback and leakage valuation remain unavailable pending supported expectations and evidence. Restricted customer/source reconciliation is retained outside Git.

Fresh verification for the historical-registration slice: **123 unit files / 881 tests passed**, lint and TypeScript passed, staff build passed, full disposable deployment-order database replay passed, hosted historical-registration SQL passed inside rollback, and **96 economics desktop/mobile browser tests passed**. The replay checks source revisions, serial/date/customer validation, duplicate prevention, role denial, idempotent retry, atomic audit, historical service assets/tickets and subsequent economics setup. The hosted Worker is `86291b75-2e98-4b55-9203-0596a3fa177b`; gateway version 11 and candidate migration `20261010073042` are recorded in the rollout document.

## Latest verification — 10 October 2026

The selected instrument now has a **monthly billed-item count and consolidated per-item GP table**. Server-derived rows use the same published results, reporting dates and pooled-credit ownership as target totals. Repeated items count once; exact quantities retain units, same-name GUIDs stay separate, returns reduce their original cost/revenue, and unknown costs remain null/partial. Instrument billing and unrelated sales stay outside reagent totals. This is a billed-item count, not a list of every unbilled mapped catalog item.

Fresh verification for this slice passed **10 focused/preflight unit files / 90 tests**, all **94 economics desktop/mobile browser checks**, lint, TypeScript, production build, disposable deployment-order migration replay, item-group/financial-integrity checks and two-session concurrency. SQL assertions reconcile per-item sums with placement/group totals, prove unmapped items are absent, show null cost/GP before purchase verification and net a linked return to 0.8 units / ₹40,000 sales / ₹25,600 cost / ₹14,400 GP. The initial browser check failed because the breakdown was absent; it passed after implementation. The final mobile scroll hint and singular/plural correction were followed by both focused desktop/mobile checks, including keyboard focus/scrolling. Synthetic desktop/mobile previews are in UI-PREVIEWS/instrument-item-gp-*.png. The four pending migration hashes match; offline releaseReady=false and liveHistoryRechecked=false remain explicit.


Whole Tally item-group mapping is implemented locally alongside individual item mappings. Groups include descendants and new verified group items automatically; direct product exceptions are supported, and a product included through both routes contributes once. Only included products enter the instrument's actual reagent sales/GP. Dated master observations retain earlier membership; linked returns inherit their original revenue/cost after later exclusions. The same attribution, historical-cost and immutable-ledger engine serves Economics and Reagent Leakage.

Fresh verification passed lint, TypeScript, **9 focused unit files / 78 tests**, **10 release-preflight unit checks**, all **92 economics desktop/mobile browser checks**, production build, disposable deployment-order migration replay, group financial-integrity acceptance and expanded two-session concurrency. Database proof covers nested items, unrelated large-value sales excluded from target totals, automatically added/moved products, unavailable costs, group + separate individual items, duplicate inclusion contributing once, direct exclusions, linked return cost, canonical renames, rejected catalog/recovery, one ledger balance, stale queued group save, accepted replay and Accounts denial. Pending hashes for all four migrations were refreshed; whitespace checks passed. The latest change is still local and pending release.

The read-only Tally pilot on **10 October, 11:28 IST** completed under the proposed in-memory policy: **237 documents, 232 active economic vouchers, 3 cancellations, 2 explicit exclusions, zero unverified vouchers**. A master probe found **29 canonical groups / 1,939 canonical items** with no missing GUIDs; the completed extractor validates membership/parents/units and includes its private master catalog. A reproduced CMPINFO count-versus-master parser issue was corrected and fixture-tested. No customer names, voucher IDs or amounts were saved in diagnostics. **financialReleaseCertified remains false**; Accounts policy acceptance, representative historical cost/return/FOC reconciliation, isolated authenticated candidate acceptance and authorized deployment remain release gates. The proposed policy was not activated, no cloud financial evidence was imported, and no Tally writes, Git commit/push or deployment occurred.

## Earlier verification — 9 October 2026

Latest bounded refinement: original approved GP now governs later capital/acquisition increases for placements and groups. Fresh lint, TypeScript, **7 economics unit files / 72 tests**, **2 desktop/mobile capital-review checks**, production build, disposable deployment-order SQL replay, financial integrity and two-session concurrency all passed. The expanded SQL regressions demonstrate that optimistic backdated expectations cannot bypass director/maximum limits and that accepted increases retain the original approval expectation reference. No production or connector extraction changes were made.

Earlier integrated verification on 9 October passed the complete unit suite with one worker: **123 files / 877 tests** and coverage gates. All **80 economics desktop/mobile browser checks** passed, including the proposal financial preview, explicit director exceptions/rejection, investment warnings and filtering, slow/zero actual-GP recovery, and explicit IST freshness display from an America/Los_Angeles browser timezone. Final disposable deployment-order replay, financial integrity and two-session concurrency passed after the proposal/source-currentness changes. Coverage includes stale financial generations after baseline/policy/capital/billing changes, queued approval after a committed policy writer, exact accepted approval replay, unresolved newer Tally source exceptions and recovery through verified later evidence, exact unrounded policy thresholds, retained original approval baseline/history, absent forecasts before purchase-cost reverification, zero actual GP without invented numeric payback, Indian date boundaries and segmented case estimates. Final lint, TypeScript and production build passed. Connector fixtures passed earlier on 9 October; this refinement does not change extraction. The earlier parallel unit run hit the existing encrypted-storage timeout; the complete one-worker suite passed, and an uninterrupted test:ci pass is not claimed.

The four economic migrations remain local and pending deployment. Accounts policy approval, representative live reconciliation and hosted candidate acceptance remain release gates. Offline preflight is not live certification.

UI previews use synthetic automated-test data, not live customer evidence: [desktop investment review](UI-PREVIEWS/instrument-investment-review-desktop.png), [mobile investment review](UI-PREVIEWS/instrument-investment-review-mobile.png), [desktop actual recovery warning](UI-PREVIEWS/instrument-actual-payback-desktop.png), [mobile actual recovery warning](UI-PREVIEWS/instrument-actual-payback-mobile.png).

## Current status — 8 October 2026, 18:53 IST

The latest local implementation passed `pnpm test:ci` with **122 unit-test files / 845 tests**, plus **58 economics browser checks**. Final disposable deployment-order SQL replay, integrity checks and two-session command/recovery concurrency checks passed. A separate read-only live-history check matched all 103 deployed migration versions and hashes; the four economics migrations and related production objects are still absent.

The read-only Tally pilot with the proposed policy draft produced zero extraction exceptions, but the draft was used in memory only. This verifies local behavior and pilot extraction; it is **not production deployment, Accounts policy approval, or live-Tally financial certification**. Those release gates remain pending.

## Implemented locally

- `/instruments` reuses completed installations and service tickets. Red urgent, amber attention and green no-open-issues have text/icons; tickets do not prove physical downtime.
- `/instrument-economics` and main-workspace navigation provide Portfolio, Setup, Exceptions and Reagent Leakage. Economic health is green healthy, amber watch, red critical, grey incomplete/inactive and blue proposed. Pooled members identify their group and omit independent capital/payback. Portfolio search covers instrument/customer/site/model and intersects status/type filters; selected evidence follows the visible targets.
- Financial access: active Management/Administrator manage setup, approvals, verification and cases; Accounts reads only. Sales/Operations use the service portfolio without receiving financial data.
- Existing customers/installations remain authoritative. Reviewed company/customer GUID bindings connect Tally identities. Installation/customer mismatch and overlapping commercial placements fail explicitly. Products use company/product GUIDs, never fuzzy names.
- Dated model mappings, placement overrides, groups and complete allocations share one deterministic attribution engine. Ambiguity stays unattributed; explicit exclusions have a separate reconciliation bucket. Expired placement overrides resume the dated model default; expired model rules do not revive old versions. Shared allocation forms support 2–20 placements with explicit percentages to two decimal places (basis points); totals must equal 100%.
- Connector import preserves voucher GUID/AlterID revisions, signed base-unit quantities, net inventory values and document tax/discount evidence. Cancellations are explicit. Private economics is stripped from public stock snapshots. Reused revisions with changed economics are quarantined; display renames preserve canonical identity.
- Actual reagent GP = actual net Tally sales minus verified attributable Tally purchase cost. Money is integer paise. Allocations conserve signed money and six-decimal quantities. Missing purchase evidence produces null GP. FOC retains actual cost/negative GP and requires reason classification.
- One supported historical cost policy: complete sale-quantity linkage to compatible Tally purchase lines, same company/product/unit, purchase date no later than sale, matching batch where supplied. The review form supports up to 20 compatible historical purchase sources per sale and checks complete six-decimal quantity coverage before submission. No purchase over-allocation or fallback to today's price. Reverification appends evidence; superseded/cancelled purchase evidence no longer verifies cost.
- Linked returns inherit original attribution after removal. Cumulative returned quantity cannot exceed the sale, and cumulative rounding conserves original cost. Value credits reverse revenue with zero stock cost. Review forms link imported adjustments to verified original sales and classify FOC.
- Immutable expected-economics headers support multiple reagent items. Approvals audit the exact expectation and policy versions. Nonzero initial capital needs purchase/approval evidence. Zero-capital placements display payback as not applicable. Expected reagent quantities accept six decimal places. Default configurable approval bands are 24/36/48 months; capital-backed proposals need positive GP and explicit long-payback exceptions.
- Append-only capital/contribution, GP and reversal events rebuild actual economics. Domain writes, restatement, audit and idempotency receipts commit together. One generation publishes atomically. Recovery claims annotate sources and never post extra GP.
- Leakage compares the same attributed supply with dated expectations. Manual tests, reagent yield, QC usage, paired stock counts, transfers and external supply strengthen evidence. Baseline changes split windows; pooled member opportunities are suppressed. Missing coverage/units suppress financial valuation.
- Cases have reason, owner, due date, action, versioned status/outcome. Overlapping opportunities are blocked. Positive post-window sales evidence recovery; claims cannot exceed 100% across cases/revisions. Edits, returns and cancellations restate outcomes; closed recovered cases losing evidence require review.
- APIs expose source lines, attribution/cost explanations, history, observations, groups and monthly reconciliation. Unknown-save retries reuse the exact payload/key and block competing submissions. The API binds each save to the trusted account that loaded the workspace. Access loss clears visible financial data, including non-JSON rejections; uncertain saves stay in memory and only the original account can retry after access is restored.

## Calculation rules

Reporting uses the last completed calendar month, `[reportingFrom, reportingTo)`. Capital/recovery are cumulative; revenue, GP and unattributed sales are monthly. Known GP remains explicitly partial when cost is missing. Forecast requires an approved, currently active placement, complete lifetime coverage/costs, sufficient history and positive trailing GP. Closed placements retain historical GP and recovery but have no future payback forecast. A database regression verifies both the supported active forecast and suppression after closure.

`net sales = attributed reagent sales + instrument billing sales + unattributed sales + explicitly excluded sales`.

`expected consumption = tests / tests per reagent unit + QC units`.

`expected supply = max(0, expected consumption + closing stock − opening stock − net transfers)`.

`observed consumption = opening stock + mapped Tally supply + external supply + net transfers − closing stock`.

External procurement is qualification evidence, not automatically proven lost business. Supply-only gaps are estimates; stockpiling, lag, downtime, workload changes, wastage, FOC, other suppliers and data problems need review. Actual GP is independent of expected prices/costs.

## Groups and relocation

Set members before approval. Group approval includes member capital. The group owns its own ledger, member opening capital and pre-group recovery; later capital/contribution adjustments belong to the group. Member recovery is not counted a second time.

A bounded membership end, or closing an open membership, closes that member's logical economic placement on the same date, preserving physical installation evidence. Reuse/move/regroup needs a new dated placement and reviewed residual capital. Transfer/retirement uses evidenced signed capital adjustments; no serial-level share of pooled GP is guessed. Automated residual-capital splitting is outside this V1.

## Bounded V1 and remaining work

- Last-completed-month reporting; arbitrary trends/ranges remain later work. Rebuild is synchronous and capped at 10,000 stored source lines. Connector caps: 2,000 vouchers/window and 500 lines/voucher. Oversized windows fail visibly. Recent event read model is capped at 500; older immutable facts remain in Postgres. Scale-up needs measured pagination/background processing.
- Exact base units only. Unverified alternative units, ambiguous batches, unsupported stock voucher types, nonreconciling adjustments and accounting-only credits without verified product/original-sale evidence are quarantined. Broader accounting-credit normalization and returned-stock reuse in purchase allocation need representative fixtures and a reviewed cost-policy extension.
- Manual workload/stock evidence is supported; LIS/telemetry is not integrated. Recovery means evidenced follow-up sales/GP, not proven causal uplift. No automatic competitor accusations.
- Uncertain-command payload retry remains in memory and bound to the original account. Reload recovery persists only an opaque action/key/account reference in session storage. Check saved command returns status only; Close unresolved request atomically checks the receipt and fences late delivery if absent. Financial payloads are never stored in the browser. Damaged/unavailable references fail visibly and require Management reconciliation.
- Commercial actions live in the case, managed by Management in V1. A Sales delegation flow hiding financial amounts remains an existing-task-module integration, not a duplicate task system.
- Representative live Tally reconciliation, business policy sign-off and authenticated hosted-candidate acceptance remain release gates. An earlier local check on 8 October found Tally unavailable; a later read-only pilot found it running and exposed the connector corrections and unresolved evidence described below. Isolated browser fixtures never bypass production authentication.

## Verification

Real Postgres 17 replay in deployed-history order plus public gateway integrity and two-session concurrency tests cover ₹50,000 sale/₹32,000 cost/₹18,000 GP, missing cost, replay, stale approvals, cost reverification, returns, late credits, groups/member capital, fractional rounding, FOC −₹2,000 GP, manual workload/stock gaps, overlaps, cancellations, reconciliation and failed-sync suppression.

The full unit suite passed **116 files / 812 tests** with coverage gates. Production build passed with offline assets and both new pages/APIs. Connector fixtures passed GUIDs, GST-free net amounts, discounts, renames, units, cancellations, FOC and custom voucher classification. Final verification also passed lint, TypeScript checks, the production build, 168 broader desktop/mobile browser regressions and 28 focused economics browser checks (including signed currency input, multiple purchase lots, fractional/shared allocations, access revocation and account-bound uncertain-save replay). The full Postgres replay and two-session economics concurrency checks passed, including exact multi-purchase GP, incomplete-evidence rollback and replay. One existing encryption test hit its five-second timeout during parallel validation; all six tests in that file then passed alone, and the final complete unit suite passed with one worker.

## Release estimate and remaining gates — 10 October 2026

The local V1 is ready for candidate review, not production certification. Allow approximately **2–3 working days to a controlled pilot**, assuming Accounts is available, representative purchase evidence can be linked, an isolated hosted candidate is available and the acceptance checks reveal no material discrepancies. This is an effort estimate, not a promised release date. Corrections or missing historical costs extend it. Broader staff rollout follows a successful pilot sync/rebuild and Management/Accounts review, rather than a calendar deadline.

| Work remaining | Owner | Rough effort | Exit evidence |
| --- | --- | --- | --- |
| Accept ledger/voucher policy and reconcile representative sale, purchase, discount/GST, FOC, return and below-cost instrument billing | Accounts + Management | 0.5–1 day | Recorded policy decision and actual GP/investment reconciliation; unavailable costs explicitly retained |
| Refresh hosted history/hashes and install the four migrations, function, app and connector in an isolated candidate | Engineering, after deployment authorization | 0.5 day | Candidate version record, clean replay and healthy verified sync; production untouched |
| Staff-login, financial role, mobile, stale evidence/retry, group/individual mapping and item GP acceptance | Management + Accounts + Engineering | 0.5–1 day | Completed candidate acceptance record with no unresolved financial discrepancy |
| Pilot release and first sync/rebuild review | Engineering + business owners, after release approval | 2–4 hours plus observation | Approved release record, reconciliation and usable exception/disable path |

The latest live-history evidence is cached from 8 October and must be refreshed before release. The successful read-only Tally extraction on 10 October validates extraction, not Accounts approval or historical cost-at-sale certification. No production date is confirmed while these gates remain open. Do not expand V1 for trends, telemetry, automated serial allocation or unrelated hardening before this pilot.

## Rollout

1. Refresh hosted migration history and hashes. The four `2026100718…` migrations are **not deployed**; historical entries are preserved. Read-only preflight does not certify hosted readiness.
2. Apply the four migrations in order to an isolated candidate, then deploy the updated `stockflow-orders` function and application there. Application-only deployment cannot activate economics.
3. Restart the updated read-only desktop connector against that candidate. `EconomicHistoryMonths` defaults to 3 (1–60 supported); choose sufficient history within V1 limits. `DisableInstrumentEconomics` leaves stock sync available.
4. Optional state-directory configuration: `economic-ledger-roles.json` maps canonical ledger GUIDs to `gst`, `discount`, `rounding`, `charge`, `trade`; `economic-voucher-roles.json` maps exact custom voucher-type names to `sale`, `purchase`, `return`. Unclassified stock documents remain exceptions. Store no credentials in these files. Proposed classifications require Accounts review before activating live configuration.
5. Reconcile representative sale/purchase, GST/discount, FOC, returns/credits, revisions/cancellations, shared groups and stock/test counts with Tally. Resolve identities and unavailable costs rather than assume rates.
6. Walk Management setup/approval, Accounts read-only, service-role financial denial, stale sync, uncertain-save retry, drilldown and outcomes. Agree cost, group-transfer, thresholds and evidence owners before production.

No live-data edits, production migrations, commits, pushes or deployments were performed. Preserve immutable business history if disabling the feature; do not drop tables as a rollback shortcut.

## Instrument acquisition value — 8 October extension

Create target now offers a verified Tally purchase source alongside the evidenced manual historical fallback. Management matches the installation/serial number and selects an imported, current purchase line for one individually billed instrument. Postgres derives capital from its net purchase value (excluding GST); clients submit only the source ID and verification reference, with manual amount zero. Customer selling invoices never determine acquisition capital. Additional approved installation expenditure uses the existing audited capital adjustment action.

Immutable acquisition links record target, purchase-line UUID, canonical company/voucher/line identity, verifier, reference and timestamp. The capital ledger records source voucher/revision/product. A purchase line cannot fund a second placement or reagent cost, including through a later source revision. Creation, capital event, acquisition link, audit and retry receipt commit together under the economic command lock. Foreign companies, future purchases, superseded/cancelled sources, bulk quantities and simultaneous manual values are rejected.

A later purchase revision/cancellation retains original capital and marks acquisition evidence for review, suppressing forecasts and blocking new approval (including groups holding that capital). There is no automatic restatement. Management can now review a compatible revision through Review acquisition revision; the original entry remains immutable and only the net capital difference is posted. A cancellation requires explicit approval to reduce acquisition cost to zero. Missing/incompatible line, product, unit, quantity or date evidence remains unresolved for investigation. Bulk invoices, non-stock accounting asset bills, missing historical documents and serial-to-product matching remain a documented management evidence/manual allocation workflow. The connector can only offer purchase stock lines already imported in the evidence window.

Verification for this extension: disposable deployment-order migration replay, acquisition integrity scenarios and two-session economic concurrency passed. Focused API/UI/form/release-preflight unit checks passed (35 tests). All 32 economics browser checks passed across desktop and Pixel 7, including purchase selection, exact paise preview, source-only submission, retained form evidence after rejection and changed-acquisition warning. Final lint, type checking and production build passed; git diff whitespace check passed. Pending migration hashes were refreshed. Read-only release preflight still reports releaseReady=false: live history, hosted staff acceptance and live Tally reconciliation remain outstanding.
## Acquisition revision review — 8 October extension

`review_acquisition` is available to Management/Administrators through Setup. The read model supplies changed acquisitions, target version, latest canonical purchase revision, last verified acquisition cost, proposed acquisition cost and the exact capital difference. No editable monetary amount is submitted. Review requires evidence, the expected target version and expected source revision; the server resolves the original canonical company/voucher/line identity and computes the adjustment. Current/already-reviewed sources, stale targets/sources and incompatible non-cancelled purchases are rejected. Cancellation additionally requires explicit zero-cost confirmation.

`stockflow_economic_acquisition_reviews` is append-only, protected by private-schema privileges/RLS and immutable/no-delete triggers. Each review links the latest source voucher (and purchase line where present), previous/new verified cost, capital event, verifier, reason and timestamp. The original acquisition link remains reserved against duplicate instrument/reagent use. Review, compensating capital entry, target version, rebuilt generation, audit and replay receipt commit atomically under the shared economic lock. Repeated requests replay the same receipt. Metadata-only revisions record a zero-difference event rather than reposting the instrument value.

Increased capital on an approved placement or an affected approved group rechecks its baseline and current configured payback limits, requires the director exception above the review band, and cannot bypass the maximum band. Policy/baseline identities and resulting payback are recorded in audit. Pooled capital stays on its original member event and flows into the existing group read model once. Negative capital after earlier manual adjustments is rejected for reconciliation. Review changes capital only; it does not duplicate reagent GP or alter instrument lifecycle.

The UI previews previous/proposed cost and signed adjustment, preserves evidence after rejection, requires cancellation confirmation, blocks incompatible evidence and lists review history with actor/reason/old/new values. A successfully verified revision clears the acquisition review flag; other source-coverage/cost requirements still govern forecast availability. The local database scenarios cover cancellation, retry, stale target/source, price reinstatement, director and maximum bands, Accounts denial, incompatible products, rejected-command rollback and unchanged-cost revisions. All 38 desktop/mobile economics browser checks passed, followed by the two history-display checks after extending their assertions. Final `pnpm test:ci` passed: lint, type checking, all connector fixtures, 116 unit-test files / 813 tests, coverage and production build. Disposable deployment-order migration replay and the economic integrity/concurrency checks passed. Pending migration normalized hashes were refreshed; read-only release preflight remains releaseReady=false until the external release gates pass. Live Tally reconciliation and hosted candidate acceptance remain release gates.
## Below-cost instrument billing — 8 October extension

Instrument purchase cost stays as gross capital. Verified net customer instrument billing is upfront economic recovery, so a ₹5.5 lakh cost / ₹2 lakh billing leaves ₹3.5 lakh commercial placement investment. Billing is invoiced recovery, not evidence of cash collection. Expected approval payback uses net investment; actual forecast uses outstanding investment and verified actual reagent GP. Instrument invoices are excluded from reagent revenue, cost, GP, consumption and leakage recovery claims.

Management can link one current, individually billed sales stock line to a placement with a verified Tally acquisition. The server verifies canonical company/customer/product/unit, quantity, dates and target version. Source-only submission, immutable links, shared command locking and retry receipts prevent duplicate postings. Rebuild restates source-backed contribution events for invoice revisions, credits, returns and cancellations. Excessive refunds/returns and incompatible evidence remain explicit exceptions. Invoice recovery follows the approved group holding instrument capital, including later corrections to opening invoices. Current-month group capital remains cumulative despite prior-month revenue reporting.

Setup previews gross cost, net billing and remaining investment. Placement details expose the three amounts separately, and evidence history shows the verified invoice link. Monthly reconciliation includes a separate instrument billing bucket. Existing manually recorded invoice contributions must be reviewed before linking the same invoice; the application does not guess which historical manual entry represents billing. Bulk invoice splitting, multiple deposit/instrument invoices and automated serial matching remain outside V1.

Database acceptance covers below-cost approval, replay, role denial, reagent exclusion, group ownership, revision, credit, full return and cancellation. The migrations remain pending deployment; live Tally reconciliation and authenticated hosted acceptance remain required.
Final verification for below-cost billing: pnpm test:ci passed (lint, type checking, connector fixtures, 116 files / 813 unit tests, coverage and production build). Fresh disposable deployment-order Postgres replay and two-session concurrency passed. The below-cost billing browser workflow passed on desktop and Pixel 7; the broader 40 economics browser checks passed before the final history display extension. Pending migration hashes were refreshed; no deployment or live Tally verification was performed.

## Opening recovery after grouping — 8 October correction

Attributed reagent results now preserve the original sale date independently of the adjustment's business date. Groups holding opening member recovery include later returns/credits against those sales; source-result-linked reversals retain the same immutable ownership. Monthly group revenue/GP, missing-cost checks and trailing GP include post-group adjustments against inherited opening sales. Monthly dates remain the actual voucher dates. Manual contributions retain their effective date, and pooled GP is not allocated back to serial numbers.

Acceptance includes a public-command scenario with a pre-group sale, a credit after grouping, the resulting 100-paise recovery reduction and an unchanged balance after rebuild. A separate ledger fixture verifies 100-paise opening GP minus a 40-paise later credit equals 60 paise, and reversals restore the prior balance. Existing late-credit assertions verify original-sale date preservation. Fresh deployment-order replay passed these checks; the migrations are still not deployed.

## Reload-safe uncertain-command recovery — 8 October extension

Before sending a financial command, the page saves only its action, opaque request key and original actor in tab session storage. Reload restores a visible blocked state without reconstructing or automatically resending a financial payload. Another account cannot inspect/close/retry the reference. Accounts can check their own status; Management/Administrators can close their own unresolved reference. Check returns accepted, not_saved or unresolved, with no stored commercial command data. Missing receipt alone remains unresolved.

`recover_economic_command(commandAction, commandKey, closeUnresolved, expectedActorEmail)` uses the trusted authenticated actor. Closing acquires the shared economic lock followed by the existing actor/action/key lock. A previously committed command reports accepted. Otherwise an immutable receipt tombstone and economic audit entry commit together; the non-payload hash rejects any delayed original save. Repeated close does not duplicate audit, rebuild or financial events. The UI explains this behavior before the explicit close button and refreshes authoritative data after resolution. Read/close authorization failures clear financial figures and retain the original reference.

Verification includes opaque-storage and API role/account tests, desktop/mobile reload workflows, absent/closed receipts, blocked late capital delivery and a two-session race proving that closing waits behind an original command and preserves its committed result. Financial storage-disabled/corrupt-reference cases remain visible and blocked; no alternate command key is silently substituted.

## Leakage qualification and audit — 8 October extension

Cases now store a controlled primary reason, contributing reason codes, confidence and a supporting evidence reference. Unknown remains unknown by default. Confirmed reasons require evidence; an estimated shortfall never automatically confirms competitor sourcing. Classification changes commit with the case version, audit and receipt, and failed/stale changes preserve the prior case. Reason comments remain available without assigning a causal financial split to contributing reasons.

An opportunity-backed case freezes the evaluated units, potential values, baseline ID, observation ID, source generation, evidence tier/status and capture time. The database protects this evaluation and original window/product/target against update. Later baseline revisions/rebuilds do not rewrite the earlier estimate. The UI submits its expected generation and stale opportunities are rejected; a missing target/product/window evaluation cannot create an apparent quantified case. Manual cases remain explicitly unvalued. Case review exposes original estimate evidence and a safe recent audit trail. The read model returns the latest 200 case events; each case panel shows up to 20 and labels retained older history.

Unattributed sales for the same canonical company/customer/product/window now mark leakage as data_review_required and suppress monetary estimates and financial variances. This prevents ambiguous allocation from being presented as missing purchases. Known physical counts remain visible for remediation; missing mappings are resolved through the shared attribution engine.

A separate actual-economics comparison shows expected net revenue/GP, actual mapped Tally net revenue/verified GP and signed actual-minus-expected variances. It preserves FOC quantity, zero revenue and actual negative GP, so an adequate physical supply can still expose poor economics. Missing actual cost leaves actual GP/GP variance unavailable while retaining independently known expected GP. Missing coverage, uncertain attribution, inconsistent stock or incompatible units suppress monetary comparisons. These variances overlap supply-gap opportunity estimates and are never added to them. The comparison does not establish a cause or causal recovery.

## Integrated verification and read-only live pilot — 8 October, 17:53 IST

Before the live connector corrections, the integrated implementation passed `pnpm test:ci`: 120 test files / 838 tests, connector fixtures, lint, type checking, coverage and production build. Fresh disposable deployment-order Postgres replay, economic integrity and two-session concurrency passed. All 50 economics browser checks passed across desktop and Pixel 7. Four economics migrations remain not deployed.

The later local Tally pilot used only HTTP Export requests, without connector startup, cloud uploads or Tally writes. The window was 1 September through 8 October inclusive. Real customer/invoice amounts were not saved into repository fixtures. This exposed and corrected four extraction issues:

- CMPINFO's COMPANY count is metadata, not a second company master.
- Undeclared UDF prefixes and numeric character references are parsed without stripping values; DTDs and external entities remain prohibited, and parse failures do not expose raw exports.
- Tally may export ALL and plain collection aliases together. ALL takes precedence so inventory, GST and party balances are counted once. Empty inventory placeholders on banking documents do not create false stock exceptions.
- Cancelled vouchers may have cleared party/inventory fields; verified GUID, AlterID and date still permit reversal of prior economics.

Default-policy pilot: 227 relevant vouchers; 91 active vouchers and 3 cancellations verified, 133 unverified. Exceptions: 123 unclassified adjustment vouchers, 8 vouchers with blank inventory amounts and 2 unclassified stock-document types. The adjustment ledgers were R/o and Frieght. No automatic role was assigned from these names.

A proposed-policy diagnostic used their canonical ledger IDs in memory: rounding adjusts net economic value; freight is an excluded charge. It reconciled 214 active vouchers plus 3 cancellations, leaving the same 8 blank-amount vouchers and 2 unknown types. This is a diagnostic, not Accounts approval or live policy activation. Blank amounts are not silently converted to zero or declared FOC. Delivery/proforma documents are not guessed to be economic sales from their parent type.

Configured rounding now allocates exact paise across original nonzero inventory values, separately from discounts, and leaves zero-value FOC lines at zero. Invalid role values fail visibly. Regression fixtures are synthetic and cover the live XML structures, duplicate aliases, cleared cancellations, rounding and aggregate-report privacy.

Repeat the default-policy, aggregate-only pilot with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File desktop-connector/economic-preflight.ps1 -Company 'SUPRABHA DISTRIBUTORS' -HistoryMonths 1
```

The script contacts localhost only, permits Export requests only, does not load or change live role configuration, and emits counts/reasons without customer names, invoice IDs or financial values. `extractionEvidenceComplete` is false while exceptions remain; `financialReleaseCertified` stays false because extraction alone cannot certify cost-at-sale, attribution, policy approval or hosted acceptance.

### Native zero-amount evidence — later pilot at 17:58 IST

A bounded read-only TDL collection now walks native inventory entries and asks Tally to evaluate `$$Number:$Amount`. This exports explicit numeric zero for the native zero-valued amounts that appear as blank AMOUNT strings. The connector does not default a blank string to zero: it requires the second export's canonical voucher GUID, identical AlterID, identical ordered inventory count, stock item, actual/billed quantities and native amount to match. A changed revision, mismatching line or nonzero result leaves the voucher unverified. The original line must contain an AMOUNT element. The accepted zero proof is retained in immutable line evidence as `tally_numeric_zero_v1`, including source revision and inventory ordinal. Explicit nonblank amounts still use exact decimal currency parsing, and full party/GST/adjustment reconciliation remains mandatory.

This follows Tally's documented [native collection Walk/Compute model](https://help.tallysolutions.com/objects-and-collections/) and [data conversion functions](https://help.tallysolutions.com/what-are-data-types-operators-and-expressions-in-tdl/); the behavior was then verified against the local export. It does not infer the commercial FOC reason or prove purchase-cost allocation.

With the same proposed in-memory rounding/freight roles, the later pilot verified 222 active vouchers plus 3 cancellations out of 227. The 43 blank native inventory amounts across the previously rejected 8 vouchers had matching explicit Tally zero evidence. Two stock-document type exceptions remain. Accounts policy approval, source completeness, production migration history and authenticated hosted acceptance remain outstanding; no live role configuration or cloud data was changed.

## Audited source-document exclusions and policy draft — 8 October, 18:08 IST

Custom voucher roles now support `non_economic` explicitly. These documents retain canonical source GUID, AlterID, business date, voucher type and immutable classification evidence with zero economic lines. The importer rejects non-economic documents containing revenue lines or missing classification evidence. Standard Sales/GST SALE/Purchase/Credit Note types cannot be excluded by the role configuration, and an existing economic voucher cannot silently become non-economic. A previously excluded quotation can become an actual native Tally sale/purchase/credit only with a newer source revision and matching native type evidence; configuration-only changes remain blocked. Original excluded revisions remain immutable. Replays preserve the same source records.

Accounts can inspect the latest 100 current excluded documents and total retained count in a collapsed keyboard-accessible audit panel. Exclusions do not count as reagent revenue, GP or invoiced supply. Full source coverage can include explicitly accounted-for non-economic documents without inventing sales.

The concrete proposal is `docs/INSTRUMENT-ECONOMICS-TALLY-POLICY-DRAFT.json`. It contains canonical R/o/Frieght ledger IDs and exact Delivery Challan/Sales-Quotation type roles, plus decisions for Accounts. The actual remaining stock types were Delivery Challan and Sales-Quotation; Proforma Invoice in this export was optional and did not need an economic role. Names alone did not activate any rule.

Run the proposed policy without changing live configuration:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File desktop-connector/economic-preflight.ps1 -Company 'SUPRABHA DISTRIBUTORS' -PolicyDraftPath docs/INSTRUMENT-ECONOMICS-TALLY-POLICY-DRAFT.json
```

At 18:08 IST the live window contained 228 relevant documents: 223 active economic vouchers, 3 cancellations and 2 explicit exclusions. The proposed-policy extraction had zero exceptions. Live activity added one purchase during the pilot, so counts are time-specific. `financialReleaseCertified` remained false. The proposal was used only in memory; connector configuration, cloud data and Tally records were unchanged.

Fresh deployment-order database replay, exclusion integrity scenarios and two-session concurrency passed. Desktop/Pixel 7 acceptance passed for the Accounts exclusion disclosure, retained history count, keyboard opening and mobile width. The six health states now have distinct text/color/icon presentation; muted text and inactive badges were darkened to improve small-text contrast, and disclosure controls have explicit visible keyboard focus. Preview screenshots use synthetic fixture data, not live financial data.

## Final local verification and release boundary — 8 October, 18:19 IST

The local V1 implementation passed `pnpm test:ci` (lint, type checking, all connector fixtures, 121 unit-test files / 841 tests, coverage and production build). All 52 economics browser checks passed across desktop and Pixel 7. The final disposable deployment-order migration replay, economic integrity checks and two-session command/recovery concurrency passed after the source-exclusion, native-invoice-promotion and combined-role corrections. Accounts with additional Sales/Operations roles remain read-only; the read model no longer offers case actions that the API rejects. Pending migration hashes were refreshed, and whitespace verification passed.

Read-only Supabase inspection at 12:49 UTC verified all 103 deployed migration versions and normalized SHA-256 values against the saved map, including the two bootstrap entries. There were no extra or missing remote versions and no content mismatches. The latest deployed version remains 20261005061401. All four economics migrations and their gateway/target objects are absent from production. The map's evidence timestamp and Git HEAD were updated; deployed SQL and remote migration history were not changed. Production reports PostgreSQL 17.6. The reviewed Supabase minor-release notice affects ltree, legacy PGP ciphers, floating-point GiST indexes and custom estimators; this feature's new GiST keys use UUID/text/date ranges and its pgcrypto use is hashing, not PGP encryption.

The offline preflight deliberately continues to return `releaseReady=false` and `liveHistoryRechecked=false`: it validates saved evidence without making a live connection on each run. The separately recorded live check is timestamped evidence, not deployment authority or proof of a future database state.

Local acceptance is complete for canonical identity, versioned attribution/groups/overrides, exact signed net economics, FOC/cost provenance, below-cost instrument investment, immutable restatements, configurable approvals, leakage qualification/actions/recovery, audit history, role controls and status-colored desktop/mobile workspaces. The live pilot proves bounded source extraction under a proposed policy; it does not certify historical cost allocation or all business policies.

Remaining release work: Accounts accepts the concrete Tally policy draft; an authorized release applies the four pending migrations and deploys the gateway/app/connector in order; staff-login and representative purchase-cost/return/FOC acceptance run against an isolated candidate before production promotion. No deployment, live configuration activation, cloud financial import, Git commit/push, paid service or reset credit was performed in this work.

## Refinement — recovery presentation and zero-value cost completeness, 8 October 2026

The portfolio now distinguishes recorded recovery completion from an unavailable forward forecast. Changed acquisition or instrument-billing evidence takes precedence and displays an evidence-review requirement, including zero-capital cases. Missing cost or incomplete active-target data cannot display completed recovery. Approved targets can show a recorded surplus above capital; the surplus uses exact integer paise and is a display of the existing capital/recovery projection, not another ledger posting. Recovery and surplus are labelled economic measures, not cash receipts. Pooled members continue to omit independent capital/recovery metrics.

Monthly reconciliation now exposes verified reagent cost, known reagent GP and the number of attributed result lines missing cost. A zero-value FOC line can have missing cost while missing-cost sales equal zero; the count prevents that amount from being mistaken for cost completeness. These totals come from the active Postgres result generation rather than summing target cards, which avoids group/member duplication. The count is of attributed result lines (including allocation shares), not unique invoices.

Portfolio filters now offer a conditional reset for search/status/type, with keyboard focus and mobile sizing. Browser acceptance verifies keyboard reset restores all targets and preserves viewport width. The top of this document now gives the latest implementation/release status while preserving historical verification entries.

Verification for this refinement: focused unit tests (27), desktop/mobile reset and zero-value-FOC reconciliation checks, fresh disposable deployment-order SQL replay with a zero-value-FOC missing-cost assertion, and two-session economics concurrency passed. A full CI run passed 844 unit tests, connector fixtures, lint/type checking and production build before the final reconciliation-count addition; final type checking and targeted validation cover that addition. No production deployment or policy activation occurred.

## Refinement — leakage reopening overlap protection, 8 October 2026

Dismissed/no-recovery opportunity cases may be replaced, but reopening an older case now checks whether another non-dismissed case overlaps the same target/product/window. The command returns a visible conflict before changing version or audit state. A Postgres GiST exclusion constraint enforces the same invariant for direct writes and concurrent transactions, and opportunity-linked cases require both window bounds. Manual unvalued cases retain their separate semantics.

The isolated SQL regression dismisses a case, creates its replacement, rejects reopening through the gateway without changing the original version/status, and rejects a direct-table bypass. Fresh deployment-order replay, economic integrity and two-session concurrency passed after this change. Pending migration hashes were refreshed; deployed migration SQL and production remain unchanged.

[Candidate acceptance](INSTRUMENT-ECONOMICS-CANDIDATE-ACCEPTANCE.md) now supplies the Management/Accounts workflow checks and evidence record for an isolated release candidate, including the distinction between in-memory exact retry and reload-safe opaque-reference reconciliation.

Dismissed/no-recovery cases now reject new recovery claims with a visible conflict until reopened. Existing evidence remains retained and source-driven restatements continue. Management can update/reopen the case, while the claim form is disabled with a clear explanation. Desktop/mobile acceptance covers both statuses, and the SQL fixture verifies a dismissed case cannot accept a new claim. Leakage case badges now use labelled blue/amber/green/slate states with decorative icons, matching the instrument workspace’s accessible color conventions.


Latest integrated refinement verification: full CI passed after the final missing-cost reconciliation, closed-case claim rule and status-badge integration (122 files / 845 unit tests; lint, types, connector fixtures, coverage and production build). All 58 economics browser checks passed on desktop and Pixel 7. The latest disposable deployment-order SQL replay, overlap/reopening and dismissed-claim integrity regressions, and two-session economics concurrency passed. Whitespace validation passed. Production policy, database and deployment remain unchanged.

## Refinement — capital increase approvals and actual event dates, 8 October 2026

A new regression reproduced an approval bypass: a manual positive capital event on an already approved placement could exceed the configured payback review/absolute limits even though acquisition-price revisions were checked. Approved placement/group increases now recompute gross capital less verified instrument billing using the approved-start baseline and current versioned policy. They require positive expected GP for remaining exposure, enforce the maximum payback, require an explicit director exception above the review threshold, and reject stale acquisition/billing evidence. The audit retains the exact baseline/policy IDs, net investment and expected payback. Caller-supplied derived approval fields are discarded. The command receipt and audit now identify the appended capital/contribution event.

A separate regression reproduced premature actual recovery from future-dated manual contributions. The actual capital/contribution command now accepts dates only within the target lifecycle and no later than the database business date, following the existing gateway date convention. Scheduled future postings are outside V1; expected economics remain separately versioned. The setup form explains the date and approval rules and offers an explicit director-exception checkbox.

Fresh disposable deployment-order replay passed after the fixes, including director-review rejection, absolute-limit rejection, future-contribution rejection, accepted exception audit/event linkage and two-session concurrency. Desktop/Pixel 7 acceptance passed exact signed capital adjustment and explicit director-exception submission (4 checks). Lint/type checking and focused unit/release-preflight checks passed. Pending migration hashes were refreshed; production remains unchanged.

The production build also passed after the capital-approval and actual-date changes. The earlier full suite remains recorded separately from these latest focused checks.

## Refinement — FOC classification and review execution, 8 October 2026

A deterministic regression reproduced two defects. First, an arbitrary nonempty source FOC reason was treated as classified. Rebuild now recognizes only installation, training, quality_control, replacement, commercial_support and other; unsupported/blank/unknown values remain `foc_unclassified` with a clear UNKNOWN reason. Original source evidence remains immutable. Verified actual purchase cost and negative GP remain recorded while classification is unresolved.

Second, resolving a FOC line failed because a SQL CASE expression referenced an unassigned original-sale record even though the line was not a return/credit. The gateway now uses a nullable scalar original-sale ID populated only for adjustment reviews. FOC review succeeds independently; returns/credits retain their original-sale validation.

The disposable database regression imports an unsupported source reason, verifies actual cost, checks unclassified status and negative GP, applies a supported Management review, and checks verified status with unchanged GP. Full deployment-order integrity and two-session concurrency passed. Desktop and Pixel 7 FOC form checks passed without supplying an original-sale link. Pending migration hashes and the release-preflight checks were refreshed/verified. Production remains unchanged.

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
- Changed acquisition/billing evidence: explicit evidence review; no invented expected payback. A missing planning baseline is shown separately and permits verified actual tracking.
- Pooled members show their group's investment review rather than duplicate warnings/amounts. Closed/proposed portfolio status retains its lifecycle precedence. No approval, source event or director exception is overwritten or automatically revoked.
- Threshold comparisons use the unrounded database value. If displayed months round back to the breached threshold, the UI says “Over N months.” Setup labels distinguish the director-review threshold from the absolute permitted maximum.

Local regression examples: ₹5.5 lakh gross cost less ₹2 lakh instrument billing is ₹3.5 lakh/35 months at ₹10,000 expected monthly GP. A ₹50,000 credit produces ₹4 lakh/40 months (review), and a full refund produces ₹5.5 lakh/55 months (maximum exceeded). Original approval remains 35 months. SQL coverage also checks a one-paise threshold breach, unchanged original approval basis after a new planning version, and current-policy changes. This is a management review signal, not a new approval workflow or a cash-receipt calculation.

### Evidence freshness display — 9 October 2026

Source-import and rebuild timestamps display an explicit IST timezone with an unambiguous month name. UTC instants remain stored unchanged. A regression first reproduced the month-end mismatch in a browser set to America/Los_Angeles: the same import appeared on 30 September while the Indian business date was 1 October. The UI now consistently shows 1 October at midnight IST. This changes presentation only, not source facts or reporting cutoffs.

## Refinement — 9 October 2026: slow actual recovery affects health

Portfolio health now also evaluates the unrounded actual recovery forecast against the current versioned review/maximum payback bands. This closes a reproduced case where near-target net sales and positive but low reagent GP left a 43-month recovery forecast Healthy. Above 36 months is Watch; above 48 is Critical with the seed policy, subject to the same evidence and lifecycle precedence as other commercial health signals.

The forecast is still outstanding investment divided by verified trailing actual reagent GP; it requires the existing minimum active history, complete source coverage, current instrument evidence and verified costs. No forecast is manufactured when those conditions fail. Pooled members have no independent forecast/review; their approved group owns that assessment. The read model retains the policy ID and exact comparison status, while the displayed month figure is rounded. A separate amber/red “Actual GP forecast review” explains why a placement can have acceptable approved expected economics and poor realized recovery. The original approval remains immutable.

Disposable database examples hold net sale at ₹50,000 and gross capital at ₹5.5 lakh. Verified actual cost ₹37,500 gives ₹12,500 GP, ₹5,37,500 outstanding and a 43-month one-month-window forecast (Watch). Verified actual cost ₹45,000 gives ₹5,000 GP, ₹5,45,000 outstanding and a 109-month forecast (Critical). The expected approval payback remains about 30.56 months in both. Changed purchase-cost revisions first remove the forecast until cost reverification succeeds. The one-month window is test configuration; the default trailing window remains three months.

Verified zero/negative trailing actual GP with outstanding exposure now has an explicit `non_positive_gp` review status and Critical commercial health. It produces no numeric forecast. This is distinct from missing cost/history/coverage, which retains Data incomplete or unavailable assessment. A third disposable fixture uses verified purchase cost equal to the ₹50,000 net sale: zero actual GP, full ₹5.5 lakh outstanding, Critical status and null forecast. Forecast eligibility is calculated once and shared by the status and numerical projection; pooled member forecasts stay absent.

## Proposal approval refinement — 9 October 2026

Implemented a shared server-derived approval preview using the placement-start baseline when present and current instrument investment. The review shows capital, net instrument billing, investment, expected GP/payback and color-coded approval readiness. Decisions are explicit; long payback requires an explicit director exception, while maximum/nonpositive-GP/missing-evidence proposals cannot be approved. A proposal without a planning baseline can be approved for verified actual tracking with expected payback left unset. Rejection still accepts a reason.

Approved decisions now require the current target version and workspace generation inside the financial lock. Stale baseline/policy/capital/billing/group changes cannot produce a decision using previously reviewed figures. The immutable decision audit retains the server-derived financial preview. Exact accepted retries return the same receipt before checking freshness. Two independent database sessions demonstrate stale denial after waiting behind a policy writer and successful refreshed replay.

A focused regression reproduced an additional issue: rejected newer Tally instrument evidence could leave the last admitted source appearing current. Shared source-currentness now considers unresolved canonical source exceptions. New links and acquisition review cannot silently use the old admitted source; corrected newer evidence resolves warnings while preserving the rejected import history. Purchase corrections still require explicit acquisition review. No source truth is overwritten.

Synthetic UI previews: [desktop proposal approval](UI-PREVIEWS/instrument-approval-preview-desktop.png), [mobile proposal approval](UI-PREVIEWS/instrument-approval-preview-mobile.png). The new browser checks cover the financial preview/stale error, required director exception and blocked approval with explicit rejection. Unit checks cover unavailable evidence and exact threshold status despite display rounding. Candidate acceptance now includes these scenarios.

The setup form collapses by default when proposed targets are waiting, keeping proposal review within reach on mobile. Its native disclosure can be opened and closed with the keyboard; when there are no proposals, setup forms remain open. Desktop/mobile checks verify this behavior and regenerate the proposal previews.


## Original approval GP protection — 9 October 2026

Fixed a reproduced financial-control loophole: manual capital and acquisition increases previously selected the newest expectation effective at placement start, so a backdated optimistic planning version could weaken payback checks. Both commands now resolve the immutable expectation captured by the original placement/group approval. The portfolio investment review uses the same selector. Current policy limits still apply, and missing original approval evidence never falls back to a planning estimate.

Regression coverage includes director review at the original ₹18,000 GP despite a new ₹50,000 assumption, blocked excessive manual exposure, an approved group at 49 months, revised acquisition director review and retained original baseline IDs on accepted audits. Rejected increases leave capital/review events and successful receipts unchanged. The setup explanation now states the original-approved-GP rule. The latest bounded checks above are fresh; the earlier 877-unit/80-browser integrated results are retained as earlier evidence. Pending migration hashes were refreshed, and the offline release preflight still does not certify production readiness.


The same refinement fixes a reproduced covered-investment edge case: a fully billed instrument purchase correction previously required positive expected GP despite no remaining investment. Source-backed billing covering the corrected cost now gives zero expected investment payback without division by zero; a correction introducing uncovered investment still requires positive original approved GP. SQL regression uses ₹6 lakh billing against corrected ₹5.7 lakh cost, then ₹6.5 lakh cost, and preserves the capital/source/audit history.


## Simple setup refinement — 10 October 2026

The individual product form now offers company-scoped Tally ID suggestions with display names and compatible placement overrides. The group form selects the instrument and a friendly group name/count without copying IDs. Selected instrument details retain group-rule versions and label counts as current Tally membership; historical end dates are explicitly exclusive. Group catalog evidence is imported privately and is never another editable product master. The candidate acceptance guide and finalized architecture include both whole-group and individual workflows, future-item behavior and the conservative lifetime completeness gate.

## Scroll repair — 10 October 2026

Fixed the reported hosted portfolio scroll lock. Standalone Instruments and Economics now have viewport-height vertical scroll containers. Embedded Economics uses the space beneath the frame header, with independent scrolling. The global app body lock remains intact. Six desktop/mobile user-wheel regressions and all 96 existing Economics browser tests pass, along with type checking, lint and staff build. Deployed to the isolated acceptance Worker 1e4889da-fd73-44c7-980e-21b792e24ea8 and verified normal scroll input reaches the real SYS 240 record and installation evidence. No financial data or production state changed. Regression screenshot previews use test data.

## Simplification requested by owner — 10 October 2026

Implemented an investment-first card that can render without expected sales/GP: Investment, Capital recovered, Balance to recover, and monthly reagent sales/GP with existing status colors. Invoice/planning details and the selected financial grid are expandable. Capital recovered excludes instrument billing already deducted from net investment; signed recovery, partial costs and surplus remain visible. Proposed records retain Pending approval; this change does not invent or approve actual GP.

Group and individual mapping each use two main selections. Company/model IDs are automatic; individual items come from canonical source/current catalog records. Dates/exclusion/note move into optional editable controls, with include-from-server-business-date visibly stated. Advanced model-wide/verified-ID entry remains available. No migration or calculation-policy change is part of this UI slice. Fresh verification and acceptance deployment are recorded below when complete.

Fresh checks for this simplification: the new no-expectation view test failed before implementation, then all 37 focused unit tests passed. Lint and TypeScript passed. Twelve focused desktop/mobile workflow checks passed. The wider Economics + scroll run passed 106 checks and flagged four existing assertions that expected the now-collapsed detailed values to be immediately visible. Those tests were updated to open Full financial breakdown, then all four passed on desktop/mobile. Existing financial warnings, canonical submission, role-loss handling, saved-command retry and wheel scrolling remain covered. Synthetic previews are UI-PREVIEWS/instrument-simple-investment-pricing-{desktop,mobile}.png. No financial acceptance or production promotion is inferred from these checks.

Staff build and guarded acceptance deployment passed: Worker 99169bc7-ae43-48eb-bca2-ed45f6f9b3f8. The gateway, five candidate migrations, source evidence and financial approvals are unchanged. Production promotion is still pending financial/role acceptance.

## Actual tracking without a target — 10 October 2026

Actual tracking is now decoupled from optional planning targets in the isolated acceptance candidate. Migration `20261010170000_instrument_actuals_without_plan.sql` adds an `actuals_only` approval preview and `planning_not_set` investment review while retaining current evidence, approval, ACID, version and idempotency controls. The full disposable deployment-order migration suite, accounting integrity and concurrency checks passed. The affected 53 unit checks, lint, TypeScript, staff build and the new desktop/mobile workflow passed. Acceptance Worker `35df637a-907b-41d4-be53-8baab5f3abd3` and candidate migration `20261010170000` are live. Hosted readback shows **Ready for actual tracking**, the verified investment figures, and both optional planning values as **Not set**. No real target was approved by the deployment.

## Optional planning health refinement — 10 October 2026

Migration `20261010172000_optional_plan_health.sql` prevents a missing optional planning target from causing Data incomplete after approval. Evidence gaps, missing reagent costs and unresolved attribution retain Data incomplete; complete records use verified actual GP/payback status. A database regression proves a complete actual-only target has planning Not set and a non-incomplete health state. The full deployment-order replay, economic integrity and concurrency suites passed, as did all 10 release-preflight checks. The isolated acceptance dry run listed only this migration, and hosted history now confirms version `20261010172000`. No Worker/gateway redeploy or real target approval was required to apply this migration.

The subsequent signed-in hosted readback shows the real MS Palya target is now Approved, planning remains Not set, and 28 attributed reagent lines still have unavailable purchase cost. Its Data incomplete status is therefore correct and its ₹2,25,000 investment remains unrecovered/provisional. The database migration did not submit that approval. The acceptance audit must still identify the decision actor/reason and Accounts must verify the purchase-cost evidence before GP or recovery can be certified.

## Simplified missing-cost review — 10 October 2026

Verify sale cost now opens a focused queue of mapped reagent sales that still have unavailable cost. Verified, instrument-billing and unrelated sales are removed from the selector. The screen shows the remaining count and uses compatible historical Tally purchases; a single compatible source can prefill the full sale quantity, while multi-source allocation remains explicit. Purchase choice and the evidence reference remain required, and the server still rechecks current revisions, remaining quantity and exact conservation.

Fresh validation passed 34 focused unit checks, two desktop/mobile browser checks, lint, TypeScript and the staff build. The acceptance target/project guard passed, then final Worker `c89bcda2-fa60-41b2-8c9e-cc3845cb2e65` was deployed with existing variables preserved. Hosted signed-in readback shows the real 28-line missing-cost queue, split into 24 one-match lines, one multi-match line and three no-match lines. No evidence decision or cost was posted.

## Invoice-date counting, targeted history and related suggestions — later 10 October checkpoint

Acceptance migration `20261010171033` implements invoice-date reagent counting and prevents later sales from reusing stock consumed by partially covered sales. Connector history now excludes unrelated verified historical items, retaining necessary stock movements and explicit exceptions. A small checksum-guarded pilot import changes known GP/recovery to ₹2,07,208.39 and balance to ₹17,791.61; one LDL-C cost stays unavailable. The simple suggestions/picker now follow verified related Tally groups (SYS 480 → Diasys), removing Sysmex. Cost wording distinguishes unavailable support from an absent purchase.

Complete deployment-order SQL/concurrency replay, connector fixtures, 103 affected units, eight desktop/mobile workflows, lint, typecheck and staff build passed. Final acceptance Worker `899f3e03-e5b8-48f2-afcd-c9546a0241b9`; staged connector refreshed but inactive. See the final rollout checkpoint for hashes, source totals and exceptions. Production and financial/separate-role acceptance remain pending.

## Search and compact document review — latest 10 October checkpoint

The owner clarified that explicit item search must support every Tally group. Replaced the restricted picker with one all-group search and bounded results, keeping related customer-purchase suggestions only for the empty query. Already counted items are labelled; Add/Remove remain explicit dated commands. Existing-instrument billing is searchable by item, human invoice number, date and serial with mouse/keyboard selection. Query changes clear stale source/revision/serial; explicit externally filtered results fix the stale internal-filter case reproduced in browser tests.

To do now shows Tally documents needing review with a visible count, Accounts explanation and collapsed, scrollable source details. The missing purchase-cost queue remains separate. No exception was resolved or hidden from the read model.

45 focused UI/form/recovery unit checks passed. Eight affected search/date/read-only desktop/mobile checks passed across runs (two invoice-search checks failed initially, then passed after the filter fix). Two further desktop/mobile To do checks passed, including initially collapsed details and expansion. Final lint, typecheck and staff build passed. Acceptance Worker `961b8fd5-fa9b-41bb-aedf-e9b3832807e8` supersedes intermediate search Worker `93173cec-0034-4908-a52b-09969998e672`; earlier `899f3e03-e5b8-48f2-afcd-c9546a0241b9` remains a UI rollback point. No database/gateway/connector deployment or business-data write was made in this continuation.

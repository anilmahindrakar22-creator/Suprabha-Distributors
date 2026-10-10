# Instrument economics candidate acceptance

Use this checklist only against an **isolated hosted candidate** with the authorized migrations, `stockflow-orders` function, application and read-only desktop connector deployed in the order described in [Build status — Rollout](INSTRUMENT-ECONOMICS-BUILD-STATUS.md#rollout). This is a business acceptance record, not a deployment procedure. Do not run these checks against production. Stop if the candidate contains unexpected data, identities or roles.

Local automated evidence is necessary but is not financial certification. The latest local suite and disposable database replay do not replace acceptance against representative Tally source documents. The proposed policy in [the Tally policy draft](INSTRUMENT-ECONOMICS-TALLY-POLICY-DRAFT.json) requires Accounts approval before activation; a zero-exception diagnostic alone is not approval.

## Prepare the candidate

- [x] Record candidate URL/project, deployed application and function versions, migration versions, connector build, company, and reporting/history window. Seven economics/historical-registration migrations and expected gateway/target objects are deployed to the isolated candidate; see the rollout record. Real Tally evidence was admitted through the existing import trigger. The production-pinned connector remains unchanged and has not uploaded candidate data.
- [ ] Confirm an approved rollback/disable plan that preserves immutable business history. `DisableInstrumentEconomics` is the connector feature switch; do not drop tables as rollback.
- [ ] Management confirms canonical company, customer, product, installation, and placement identities for the test sources. Accounts reviews and records approval or rejection of every proposed ledger/voucher role before any policy is activated. Retain the decision and supporting source references; do not infer a role from a name.
- [ ] Use representative, already-authorized Tally documents. Capture canonical voucher/line identity, revision, date, company, and relevant quantities/net values in the restricted acceptance record. Keep credentials and unnecessary customer data out of this document.
- [ ] Establish separate Management, Accounts, and Sales/Operations sessions. Record the expected role for each; never test using a shared account.

The existing local command is `pnpm test:ci`. It checks the local implementation, not candidate data or policy. The existing read-only Tally diagnostic can be run as documented in [Build status — live pilot](INSTRUMENT-ECONOMICS-BUILD-STATUS.md#integrated-verification-and-read-only-live-pilot--8-october-1753-ist):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File desktop-connector/economic-preflight.ps1 -Company 'SUPRABHA DISTRIBUTORS' -PolicyDraftPath docs/INSTRUMENT-ECONOMICS-TALLY-POLICY-DRAFT.json
```

This contacts the local Tally HTTP listener using Export requests and reports aggregate extraction results. It does not test the hosted candidate, load/activate live policy, or certify financial completeness. Follow the existing instructions if the company or policy draft differs; do not invent a deployment command.

## Acceptance checklist

Partial hosted evidence on 10 October 2026: the owner's real Administrator session registered the confirmed historical instrument, created a purchase-backed target, linked below-cost customer billing and saved the requested SYS 480 subgroup with 30 current items. Installation was corrected to match billing. Source reconciliation is restricted outside Git. Expected sales/GP remain not set. The latest signed-in readback shows the target Approved and correctly Data incomplete because 28 attributed reagent lines lack verified purchase cost; the migration rollout itself did not submit that decision. These completed commands do not mark the combined Accounts/role/financial scenario rows below as Pass. The approval actor/reason audit, separate Accounts and Sales/Operations sessions, representative reagent cost/FOC/return reconciliation and the remaining rows are still incomplete.

The hosted cost-review selector now contains those 28 mapped missing-cost lines only: 24 have one compatible purchase candidate, one has multiple candidates and three have no candidate. This is a review queue, not evidence approval: Accounts must still confirm each required sale quantity against the Tally purchase document and retain the reference. The multi-match/no-match lines remain explicit exceptions. No verification was submitted during deployment/readback.

For each row, record **Pass** or **Fail**, actor/role, candidate time, source identities and revisions, expected result, observed result, and a restricted evidence reference (screenshots with sensitive values masked, audit/readback, or reconciliation). A missing, unexplained, or contradictory result is a **Fail**. Do not promote on a failed or incomplete row.

| Scenario | Actor | Pass evidence | Fail if |
| --- | --- | --- | --- |
| Role boundaries | Management, Accounts, Sales/Operations | Management can manage setup, approvals, evidence and cases. Accounts can inspect economics and evidence but cannot mutate. Sales/Operations see only the service portfolio and no financial data or case actions. A service-role/API denial returns no financial figures. | A read-only role changes data, a denied request leaks figures, or visible actions exceed the role. |
| Purchase-linked instrument acquisition | Management; Accounts reviews source | Select one current, compatible purchase line for the identified instrument. Candidate derives capital from the source net value excluding GST; saved evidence links canonical company/voucher/line and revision, verifier and reference. Submission sends source evidence, not an editable amount. | Identity/date/product/unit/quantity is incompatible, a stale or cancelled source is accepted, manual and source amounts combine, or the same purchase line funds another target/cost. |
| Below-cost customer billing | Management; Accounts reconciles | Link the current compatible customer billing line. For the documented example of ₹5.5 lakh acquisition and ₹2 lakh billing, show gross cost ₹5.5 lakh, billing recovery ₹2 lakh and remaining investment ₹3.5 lakh. Evidence labels this as invoiced recovery, not cash collection; reagent revenue/GP, consumption and leakage recovery remain separate. | Values are conflated, customer billing changes acquisition cost, or instrument billing enters reagent/supply economics. |
| Subsequent capital approval | Management; Accounts reconciles | An increase above the review limit requires an explicit director exception; exceeding the maximum remains blocked. Accepted events retain baseline/policy/payback evidence and an immutable event ID. Future-dated actual capital/contributions are rejected. | A manual increase bypasses approval limits, stale instrument evidence is accepted, or future contributions immediately increase actual recovery. |
| Credit, return or cancellation restatement | Management; Accounts reconciles | Apply a representative source revision/credit/return/cancellation and rebuild/read back. The linked contribution/recovery follows the revised source once, retains source history, and repeated exact retry/rebuild does not duplicate it. An incompatible or unsupported adjustment remains an explicit exception. | Original economics remain silently overstated, an adjustment duplicates, history is overwritten, or unsupported evidence is guessed. |
| FOC with missing and verified cost | Management; Accounts verifies evidence | With missing purchase-cost evidence, GP is unavailable/null and the case remains visibly incomplete. Reconciliation shows a missing-cost line even when its sales value is zero. With compatible verified cost, FOC retains quantity, zero revenue where applicable, actual cost and resulting actual GP (which can be negative). Unsupported source reasons remain unclassified. Management can assign a supported FOC reason without an original-sale link; classification leaves actual cost and GP unchanged. | Missing cost is shown as zero, FOC is treated as costless/profitable, or evidence is silently inferred. |
| Group ownership and nonduplication | Management; Accounts reconciles | Compare member and group views before/after grouping. Opening member capital/recovery and later adjustments appear under the owning group once; a post-group credit against an opening sale reduces the same group's recovery once and remains stable after rebuild. Member recovery is not counted again. | Group and member totals double-count, a credit is assigned to the wrong owner, or pooled economics are guessed onto serials. |
| Expected versus actual economics | Accounts; Management reviews | Reconcile expected net revenue/GP separately from actual mapped Tally revenue/verified GP. Signed variances match actual minus expected. Missing coverage, incompatible attribution or missing actual cost stays unavailable as specified; variance is not added to supply-gap opportunity or presented as proof of cause. | Expected rates substitute for actuals, missing values become zero, or overlapping estimates are added/presented as causal. |
| Opportunity replacement and reopening | Management | Dismiss a case and create a replacement for the same target/product/window. Reopening the original returns a visible conflict; its version/history remain unchanged. Adjacent nonoverlapping windows remain valid. | Reopening creates two active estimates for the same opportunity or silently changes the old case. |
| Leakage action, recovery and credit reversal | Management; Accounts verifies | Create/review a case with its evidence and bounded action; record eligible follow-up recovery against source sales. Verify claims cannot exceed the supported amount across cases/revisions. Apply a credit/cancellation to a qualifying sale and confirm the recovery/outcome is restated once and remains stable after rebuild. | A case creates unsupported GP, claims exceed supported sales, the credit does not reverse the linked recovery, or an estimate is presented as proven causation. |
| Unknown-save retry and recovery | Original Management actor; Accounts may inspect status | Simulate an uncertain response in the candidate. After reload, the same actor sees only the opaque unresolved reference and status, with no automatic resend. Before reload, an in-memory retry uses the exact original action, key and payload; after reload the payload is unavailable, so check or close the opaque reference instead of reconstructing a retry. An accepted command is not duplicated. A different actor cannot retry/close it; unresolved close/check behavior matches the documented authorization and receipt status. | A new key/payload is substituted, another actor takes over, financial payload is persisted in browser storage, or duplicate events/ledger changes appear. |

## Decision record

- [ ] **Management:** all assigned workflow rows pass; unresolved assumptions and evidence owners are recorded.
- [ ] **Accounts:** source reconciliation passes; proposed Tally policy is explicitly approved or rejected with reasons. No approval is inferred from the pilot output.
- [ ] **Access:** role-boundary row passes in authenticated candidate sessions.
- [ ] **Release owner:** every row is Pass, evidence is retained in the approved restricted location, and remaining production gates are separately authorized. Any Fail blocks promotion and returns to investigation.

Candidate acceptance does not authorize production migration, policy activation, connector configuration change, data import, or deployment. Those actions require their own release authorization and the existing rollout procedure.

### Indian business date and mid-month baseline acceptance

Confirm the workspace business date is the Indian calendar date, including just after midnight IST. Audit instants remain timestamped. Change a reagent baseline halfway through a completed month: each opportunity must show its own version segment and expected units prorated against the calendar-month length. Create a case from one segment and verify its frozen expected units and potential revenue/GP exactly match that displayed opportunity. A request combining multiple segments or months must fail visibly without creating a case or audit receipt for a successful mutation.

### Investment review after instrument billing changes

- [ ] With gross cost ₹5.5 lakh, billing ₹2 lakh and approved expected GP ₹10,000/month, confirm ₹3.5 lakh investment and the original 35-month approval basis.
- [ ] Import an already-authorized ₹50,000 instrument credit: verify ₹4 lakh current investment, 40-month expected investment review, amber warning and Watch status when other evidence is complete. Verify actual reagent GP/forecast remain separate.
- [ ] Verify a full instrument refund produces ₹5.5 lakh investment, 55-month expected investment review and a red warning/Critical status when evidence is complete. Original approval stays at 35 months and any original director exception remains visible.
- [ ] Confirm Watch/Critical filtering includes these targets; pooled members defer investment review to their group. Changed source evidence keeps an explicit incomplete-evidence state.
- [ ] A new planning baseline must not replace the baseline recorded in the original approval. A policy change must show the current limits while preserving the original approval evidence. These checks do not authorize changing production Tally invoices.
- [ ] With the browser set to another timezone, confirm source-import and rebuild freshness timestamps still display the Indian calendar date and explicit IST timezone. Stored UTC audit instants must remain unchanged.

### Slow realized GP and actual recovery

- [ ] When net sales meet the commercial threshold but verified trailing GP implies more than the current payback review/maximum band, confirm Watch/Critical status and an explicit actual GP forecast warning. Expected investment review must remain separately labeled.
- [ ] When a linked purchase revision invalidates cost, confirm Data incomplete and no actual forecast before reverification. After complete reverification, confirm the forecast uses the new actual GP and the correct current policy status.
- [ ] Confirm pooled members do not show an independent actual forecast; the group owns recovery. Do not alter production invoices to create these scenarios.
- [ ] With complete verified cost/history and zero or negative trailing actual GP while capital remains outstanding, confirm Critical status, an explicit actual-GP recovery warning and no numeric/infinite forecast. Missing evidence must remain a separate state.

### Proposed placement approval and stale decisions

- [ ] Review a proposal with ₹5.5 lakh instrument capital, ₹2 lakh customer billing and ₹10,000 expected monthly reagent GP. Confirm ₹3.5 lakh investment, 35-month expected payback and the placement-start baseline date before deciding. A reporting-month baseline must not replace this approval basis.
- [ ] Confirm green/blue/amber/red proposal states, an explicit decision and reason, a required director exception above the configured review band, and blocked approval above the maximum. Rejection remains available with a reason. A missing planning baseline shows Ready for actual tracking with payback Not set; missing instrument evidence still blocks approval.
- [ ] After approving an actual-only test record with complete source coverage, verified costs and resolved attribution, confirm missing optional planning remains labeled Not set and does not by itself show Data incomplete. Remove purchase-cost evidence or introduce an unresolved mapped sale and confirm Data incomplete returns.
- [ ] In two management sessions, load a proposal, then change its baseline, policy, capital, group membership or source billing in the other session. An approval using the earlier workspace must fail visibly with a refresh instruction and no decision, audit or command receipt. Refresh and deliberately review the changed figures before retrying.
- [ ] Simulate a rejected newer instrument invoice/acquisition in the isolated candidate. The old admitted source must remain auditable, while the proposal reports instrument evidence review required. An old acquisition source cannot acknowledge the unresolved newer source. Admit corrected newer evidence, review purchase changes where required, and verify the warning resolves while the rejected evidence remains retained.
- [ ] Verify Accounts can inspect the financial preview and cannot submit a decision. Repeat an accepted request exactly after its resulting rebuild: the original receipt must replay without duplicating the approval or economic events. These checks do not authorize production invoice changes.


### Later planning assumptions cannot weaken investment controls

- [ ] In the isolated candidate, retain an approved ₹18,000 expected monthly GP baseline and record a later or backdated ₹50,000 planning assumption. The planning view may show the new estimate, while the original approval and investment review continue to reference ₹18,000.
- [ ] Attempt a capital increase crossing the director-review band. It must require an explicit exception on the original approved GP, and an increase above the current maximum must fail even with the exception. Repeat for an economic group and a revised member/instrument acquisition.
- [ ] Verify rejected commands do not post capital/acquisition review events or successful receipts. Accepted increases must audit the original approval expectation ID, current policy and exact payback; actual net Tally sales, purchase costs and reagent GP must remain separate. These checks do not authorize production Tally or placement changes.

- [ ] For an approved instrument with net billing covering capital and zero expected reagent GP, review a compatible purchase correction that remains covered. Verify actual capital is corrected, net investment remains zero and audit expected investment payback is zero. A further correction creating uncovered investment must require positive original approved GP and fail without partial posting when that evidence is absent.


### Simple product mapping

- [ ] Select the existing Set product mapping action. Confirm company/model suggestions reuse existing records and reagent suggestions contain only the entered company's products. Check two identical product names retain distinct canonical IDs, with the selected name visible before submission.
- [ ] Choose a matching placement override. Changing company clears the previous model/product/override, and changing model clears the previous override. Other companies/models and groups must not appear as placement overrides.
- [ ] Enter reviewed company/product IDs outside the imported history and a model containing spaces. Save a dated model mapping without an override. Verify the exact IDs and reason are audited and name-based matching is never used. Repeat desktop and mobile width/keyboard checks through the normal authenticated candidate.


### Whole groups with individual items

- [ ] Map an item group to a specific instrument through the existing Setup form. Confirm the displayed descendant item count, company and reviewed effective start. Items without previous invoices must still appear through the master catalog.
- [ ] Bill included and unrelated items in the isolated candidate. Only included items enter the instrument's reagent net sales/GP, using actual Tally purchase evidence. Missing cost must remain explicitly unavailable. Instrument selling invoices retain separate investment-recovery treatment.
- [ ] Add an individual item outside the group and exclude an individual group member. Confirm dates apply, old unrelated sales do not become attributed retroactively, and an item included through both group and individual mapping contributes once.
- [ ] Add/move/rename a Tally master in the isolated candidate, sync and rebuild. New group items follow automatically from the observed Indian business date; earlier membership remains stable. Verify a linked return still reverses original sale attribution/cost after a later product exclusion.
- [ ] In a second session, commit a newer master catalog while a group mapping is queued. The earlier catalog selection must fail with a refresh conflict and no rule/receipt. Review the updated selection and retry; exact accepted replay must not duplicate the rule, audit or financial events.
- [ ] Check malformed/unknown parent/cyclic/reused catalog evidence produces an explicit source exception. Group attribution must not silently use the old current catalog. Recover with verified later evidence and confirm the event ledger reconciles without duplicating GP. Independently verified individual item rules remain valid.
- [ ] Inspect retained group versions in selected instrument details on desktop/mobile and as Accounts. Displayed counts must be labelled current Tally membership, with exclusive end dates; current counts must not be represented as historical membership.


### Monthly billed-item list and GP

- [ ] In the reporting month, verify the unique billed-item count, invoice-line count and each item's net quantity/unit, net sales, known historical cost and known GP against representative Tally documents. The count excludes mapped items with no billing and instrument selling invoices.
- [ ] Repeated/group-plus-individual items count once; distinct GUIDs with identical names stay separate. Different unit rows stay separate while the unique product count remains one.
- [ ] Sum item revenues/known GP and compare with the selected target's monthly totals. Repeat for a pooled group with a later credit against a pre-pooling sale. Source detail below the summary may cover other dates.
- [ ] Check a linked return, a zero-revenue FOC line with negative GP, partly missing purchase evidence and an entirely unavailable product cost. Unknown cost/GP must never be presented as verified zero. Check desktop/mobile scrolling and keyboard access.

Historical review checkpoint: the expanded July–October extraction contains three unresolved documents. The candidate now has 280 source vouchers and three visible import exceptions; targeted historical imports do not certify lifetime completeness. Purchase-cost matches are review proposals only, including supplier zero-value amounts and missing/ambiguous evidence. No cost verification or expected baseline was invented. The actual-only capability is live, while the real proposal decision and packing-charge treatment remain open. Worker 35df637a-907b-41d4-be53-8baab5f3abd3 shows Ready for actual tracking with planning values Not set; financial and separate-role acceptance remain incomplete.

Later checkpoint: final acceptance Worker `899f3e03-e5b8-48f2-afcd-c9546a0241b9`, invoice-date migration `20261010171033`, 305 source vouchers / 19 exceptions after targeted historical reconciliation. The pilot is Approved without planning targets; known recovery ₹2,07,208.39, balance ₹17,791.61, one LDL-C cost unavailable. These supersede earlier checkpoints but do not complete this acceptance checklist.

- [ ] Verify the current Tally instrument sale date starts reagent sales inclusively, independent of physical installation. Review changed/cancelled billing without guessed dates or duplicate recovery.
- [ ] Reconcile earlier stock consumption for pilot item costs and the outstanding LDL-C source support. Review all explicit source exceptions, including packing and unsupported purchase Debit Notes; no partial reservation may be certified as full cost.
- [ ] On MS Palya's Items panel, confirm empty-query suggestions follow the verified related family while explicit search finds items across all Tally groups, including Sysmex. Search alone must not change a mapping. Add uses the exact canonical item ID and displayed date; overlapping group/individual inclusions count once. Repeat as Accounts/read-only and on mobile.
- [ ] In Set up → Register an existing instrument, search billing by item, invoice number, date or serial. Select by keyboard and mouse. Changing/clearing the search must clear the selected source revision and serial; text alone must never submit a source identity.
- [ ] To do shows the source-document review count and Accounts explanation with details initially collapsed. Expand to inspect every retained import exception. The selected instrument's unavailable purchase-cost queue remains separately visible.

Latest UI checkpoint: Worker `961b8fd5-fa9b-41bb-aedf-e9b3832807e8` supersedes the earlier related-only picker. Focused synthetic checks passed for all-group search, safe searchable billing, read-only controls and collapsed document details on desktop/mobile. No real mapping, registration, cost approval or financial acceptance was submitted during verification.

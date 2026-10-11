# Instrument Economics and Reagent Leakage rollout record

Updated: 10 October 2026, Asia/Kolkata. **Acceptance candidate deployed; production promotion pending.**

## Authority and business decision

The user requested continuation through rollout. During this rollout conversation, the user explicitly reported **“Accounts has approved these rules as written”** for invoice rounding in net sales, excluded freight, and economic exclusion of Delivery Challan / Sales-Quotation. This records the reported Accounts decision; it does not stand in for reconciliation of particular purchase costs, instrument identities or invoices. The diagnostic policy draft keeps its proposal-format marker for compatibility; its actual approval is recorded here. No repeated deployment approval is required within the authorized rollout scope.

## Deployed acceptance candidate

- Application: https://suprabha-staff-acceptance.anil-mahindrakar22.workers.dev
- Supabase project: `ayrvhemxzizpkfcycvip` (existing isolated acceptance project; no new paid environment).
- Worker version: `c89bcda2-fa60-41b2-8c9e-cc3845cb2e65` (missing-cost queue with purchase-match summary); prior version: `12147fee-61d5-445f-a1fe-49d64756d468` (focused missing-cost review); earlier version: `35df637a-907b-41d4-be53-8baab5f3abd3` (actual tracking without a planning target); simple view version: `99169bc7-ae43-48eb-bca2-ed45f6f9b3f8`; pending display version: `c97bac83-46a9-4a3e-bc25-420d744aae0e`; scroll repair version: `1e4889da-fd73-44c7-980e-21b792e24ea8`; historical registration version: `86291b75-2e98-4b55-9203-0596a3fa177b`; first economics version: `82738bd5-178f-4d90-a819-72f6a44c739a`; initial rollback version: `c6d24870-674c-489c-a398-c9b766ed7701`.
- Application built in staff acceptance mode, pinned to this project, preserving existing vars/secrets. Recovery-email enablement remains the existing acceptance setting.
- `stockflow-orders` Edge Function: version 11, bundle SHA-256 `82b966e8b785cfcc1786c73d0a36e500d7adaa30fcd03ee7af3ebf946acdfdb4`; pre-rollout version 9 source preserved in the ignored local rollback folder. Version 10 was the first economics candidate.

| Local migration | Candidate hosted version |
| --- | --- |
| `20261007180000_instrument_economics_foundation.sql` | `20261010064628` |
| `20261007181000_instrument_economic_import_and_rebuild.sql` | `20261010064717` |
| `20261007182000_instrument_economics_workspace.sql` | `20261010064724` |
| `20261007183000_instrument_economics_commands.sql` | `20261010064732` |
| `20261010071925_historical_instrument_registration.sql` | `20261010073042` |
| `20261010170000_instrument_actuals_without_plan.sql` | `20261010170000` |
| `20261010172000_optional_plan_health.sql` | `20261010172000` |

## Fresh evidence

- Complete unit suite: 123 files / 881 tests passed with coverage gates. The final run used one worker to avoid contention; a prior simultaneous build/browser run caused an existing offline PBKDF timeout and was not counted as passing.
- Connector fixtures, deployed-order clean Postgres replay and two-session concurrency passed. Full economics desktop/mobile browser checks passed: 96, including existing-instrument registration. Lint, TypeScript and staff build passed.
- Staff acceptance production artifact build and target guard passed.
- Dependency mitigation gate passed, including 21 regression checks for the existing patched braces advisory. Its upstream advisory remains open; mitigation review expires 17 October 2026.
- Economic group/integrity and historical-registration SQL suites passed against the hosted candidate inside explicit rollback transactions. Fixtures and test verifier were rolled back. Subsequently, authorized real Tally evidence and the owner-selected pilot were saved separately; current persisted state is described below.
- New economic tables all have RLS; the economic public gateway has no PUBLIC/anon/authenticated execute grants. Advisor informational no-policy entries correspond to the private gateway-only architecture; the pre-existing leaked-password-protection warning is not represented as fixed.
- Hosted sign-in returned 200/no-store. Unauthenticated economics, instruments and staff-session APIs returned 401/private/no-store. The real owner Administrator session subsequently completed registration, purchase-backed target creation, selling-invoice linkage and item-group mapping. Separate Accounts and Sales/Operations sessions remain unverified.
- Read-only Tally extraction at 12:22 IST: 237 documents, 232 verified active economic vouchers, 3 cancellations, 2 explicit exclusions, zero unverified. Financial certification remains false; successful extraction alone does not certify historical purchase-cost linkage.

## Production preflight and rollback preparation

Read-only production history check on 10 October matched **all 103 deployed migration versions and normalized hashes**, with no missing or extra version. The four economics migrations and their objects remain absent there. Hash comparison removes CR and trims surrounding whitespace; deployed historical SQL/history were not repaired or rewritten. The local migration evidence timestamp was refreshed, while the offline preflight intentionally still reports releaseReady=false/liveHistoryRechecked=false.

Production Worker rollback reference observed: `167e2b20-a56d-4057-87ab-9a5f3302b752`. Production Edge Function version 30 source is preserved in the ignored rollback folder. Its source comparison shows the local gateway additions are additive and the local hash-format guard is stronger. Current production credentials and business data remain untouched.

An approved-policy connector package, script/config SHA-256 manifest and release notes are staged in `work/instrument-economics-connector-release/`. It contains no credentials and has not been activated. The connector source is pinned to production; it must not be started to upload candidate data. Existing scheduled connector and per-user state remain untouched pending cutover.

## Remaining acceptance and cutover

1. Complete separate Accounts and Sales/Operations sessions and record role boundaries. The owner's Administrator sign-in/setup is now observed. No password should enter project files or chat.
2. Reconcile representative real Tally sale/purchase/discount/FOC/return and below-cost instrument evidence against the candidate. Record unavailable costs instead of approving guesses. Confirm installation/customer identities and retain Accounts evidence.
3. Complete the [candidate acceptance record](INSTRUMENT-ECONOMICS-CANDIDATE-ACCEPTANCE.md). Do not treat synthetic rollback tests as completion of real source or authenticated acceptance.
4. Refresh production history immediately before cutover; apply the seven accepted migrations in order, update the gateway, publish the guarded production application and restart the updated connector with the approved policy while preserving its state/credentials.
5. Verify first acknowledged economic sync, one published rebuild, item sales/GP totals, financial role boundaries and visible exceptions. Record release versions and outcomes. If promotion fails, restore prior application/function versions or disable economics while retaining immutable database history; do not drop business tables.

### Acceptance account recovery — 10 October 2026

The owner reported inability to sign in. Read-only diagnosis showed the existing owner Auth account confirmed and unbanned, with active Administrator membership. Six recent candidate Auth requests were rejected with `400: Invalid login credentials`; these were credential rejections, not wrong-project routing or missing membership. Existing private gateway session and stock-read probes both returned HTTP 200 without changing configuration or business data.

The owner explicitly authorized one password-reset email for their existing acceptance account. A single Supabase recovery request with the exact candidate `/staff-password-reset` redirect returned HTTP 200. The owner subsequently reported signed in, and the actual Administrator workspace/session was observed. No password/token was requested, printed or saved, and no production account was changed. The application's general acceptance email-action gate remains unchanged.

### Real candidate pilot and historical equipment — 10 October 2026

The read-only extraction's 237 documents and private 29-group / 1,939-product catalog were admitted to the isolated candidate using its existing snapshot import trigger. Three earlier targeted instrument sources bring the total to **240 source vouchers**, with **zero import exceptions**. The existing public stock payload hash remained `59ef9ee1097f64309687081a4195b94c50d0bf0d37ffd5740726f4a5159892e1`; the private economic envelope was removed by the existing trigger. The targeted history has completeWindow=false and does not certify lifetime completeness. The production connector was not redirected or started for candidate upload.

The selected historical instrument was registered through the real signed-in Administrator UI. Its canonical customer was copied to this isolated candidate using the existing UUID/source identity. Registration reused the equipment register with no fabricated order. The owner corrected installation to the billing date, superseding the earlier date. Purchase cost, billing and resulting investment were then linked and visibly reconciled; source IDs and actual customer amounts are retained in the restricted local reconciliation, outside Git.

The owner explicitly requested the **SYS 480 subgroup**, rather than the whole Diasys parent. One placement-scoped include rule is saved, with **30 current items** and automatic subsequent verified membership. Instrument selling invoices remain separate. The initial current catalog is the reviewed anchor for the chosen historical start; this does not assert independent historical master evidence. Later membership uses dated observations. The owner answered **not set** for expected monthly sales/GP. Expectations remain empty and the target remains Proposed; no payback, approval, leakage valuation or financial certification was invented. A proposed target does not yet contribute reagent attribution, and its empty billed-item table is not evidence of zero customer purchases.

Production promotion is waiting on representative financial reconciliation and separate staff-role acceptance, not a further generic deployment permission request. Seven migrations are now pending production; the earlier 103-history/four-migration preflight is retained as evidence at its original time and must be refreshed before cutover.

Hosted service readback also shows the same single instrument with installation **23 Jul 2026**, serial A082606037 and **No open service issues**. That green service status describes ticket evidence only; it does not certify uptime or profitability. SQL readback confirms one historical installation, one capital event, one billing link, one SYS 480 group rule, no expectations and Proposed approval. Exact identifiers/financial values are retained in the restricted reconciliation.

### Scroll repair — 10 October 2026

The owner reported inability to scroll down in the hosted instrument portfolio. Read-only browser inspection reproduced a 1,104px content main under the global body overflow:hidden, with no vertical scroll owner in a 532px viewport. Both standalone instrument pages now own a viewport-height vertical scroller. Embedded Economics receives an explicit embedded presentation with a full-height/min-height-zero scroller inside the frame's available area, keeping the application header visible. Global body locking and other workspaces remain unchanged.

Fresh focused wheel-input regressions passed on desktop/mobile for all three surfaces (6 tests). The full existing Economics browser suite passed (96 tests), as did lint, TypeScript, staff build and whitespace checks. Tests verify lower evidence enters the viewport through scrolling, no horizontal page overflow and a visible embedded navigation header. Screenshots under UI-PREVIEWS/instrument-scroll-* use synthetic test records. The guarded acceptance Worker was deployed with keep-vars and target/project checks, version 1e4889da-fd73-44c7-980e-21b792e24ea8. Actual signed-in hosted scroll input moved the portfolio main to scrollTop 572 and brought installation evidence to viewport y447 in a 532px viewport. The real instrument date/serial remained correct. No database, financial, auth or production change was required for this repair.

### July–October source review and pending attribution display — 10 October 2026

The wider read-only extraction covers 1 July through 10 October (exclusive end 11 October): 575 documents, 565 verified active economic vouchers, five cancelled, three unverified and two explicitly excluded. A targeted 68-document subset was imported without a new catalog or complete coverage declaration. Current persisted candidate state is 280 source vouchers and three import exceptions. Stock payload SHA-256 remained 59ef9ee1097f64309687081a4195b94c50d0bf0d37ffd5740726f4a5159892e1. Earlier zero-exception checkpoints describe their narrower windows only.

The three historical exceptions remain visible: two purchase invoices have an unapproved packing-charge ledger, and one Debit Note has an unsupported economic kind. Existing freight approval does not classify a separate ledger; the packing policy decision is pending. The Debit Note must retain its exception until purchase-return treatment is supported and reconciled. Financial certification is false.

The pilot's current SYS 480 mapping matches historical reagent sales after installation. Restricted purchase-cost review proposals include zero-value supplier purchase entries, positive-cost matches, missing evidence and multiple candidate purchases. No cost links or verification decisions were posted. Expected economics remain unset and target approval remains Proposed. The pending question about tracking actuals for an existing instrument has not been treated as authorization to bypass approval or invent a baseline.

Proposed cards, forecast and item GP breakdown now say Pending approval and explain that pending totals do not prove no items were billed. The approval and calculation rules are unchanged. The new unit regression reproduced the misleading zero/empty display before the fix; 29 focused unit checks, eight focused desktop/mobile browser checks, lint, TypeScript, staff build and whitespace checks passed. Guarded deployment preserved existing variables and published Worker c97bac83-46a9-4a3e-bc25-420d744aae0e. No new migration, gateway update or production change was needed for this display correction.

Hosted readback after deployment: the real signed-in Administrator session loaded the pending explanation in both the portfolio card and item sales/GP breakdown. Source imported/rebuilt timestamps advanced to 15:01:44 IST; three import_rejected rows remained rendered in Exceptions. The historical installation, capital, billing and investment stayed unchanged. The acceptance tab remains available for the pending business decisions and financial review.

### Investment-first redesign — 10 October 2026

The owner's simplification request is implemented as a presentation/setup slice. Instrument cards lead with Investment, Capital recovered and Balance to recover without requiring an expected sales/GP target. Recovery against net investment excludes instrument billing already deducted from investment; it preserves signed GP/contributions and partial-cost warnings. Proposed records remain pending rather than presenting invented actual GP. Invoice/planning details and the selected duplicate financial grid are collapsed. Status colors and source-review warnings remain visible.

Group and individual mapping use two selections in the usual flow. Canonical company/model identity is filled from the instrument; current-catalog product names assist selection without name-based attribution. Model-wide mappings and verified manual IDs remain advanced. Include-from-server-business-date is shown before saving; editable dates/exclusion/note preserve deliberate historical overrides and audit intent. No new migration, financial approval or source verification was posted.

The no-expectation regression failed before the change. Fresh validation passed 37 focused unit tests, lint, TypeScript, staff build and twelve focused desktop/mobile checks. In the wider 110-check Economics/scroll run, 106 passed; the four assertions for now-collapsed financial details were updated to open the new disclosure and then all four passed. Synthetic investment previews are retained under UI-PREVIEWS. Guarded deployment with preserved variables published Worker 99169bc7-ae43-48eb-bca2-ed45f6f9b3f8; Edge version 11 and five candidate migrations are unchanged. Production acceptance remains incomplete.

Hosted readback in the owner's signed-in Administrator session confirmed the three-value Investment & recovery section and the explicit expected-sales/GP-not-set message. The pilot's verified investment and balance remain unchanged; Capital recovered correctly says Pending approval because reagent GP has not yet been calculated. Deployment completed successfully. This verifies the published view, not approval of the pilot or financial certification.

### Actual tracking without a planning target — 10 October 2026

The approval contract now treats expected monthly sales/GP as optional planning data. A proposal with current acquisition and instrument-billing evidence receives `actuals_only` readiness and can be approved for verified Tally attribution without an expectation row. After approval, missing planning data is exposed as `planning_not_set`; actual net sales, verified purchase cost, GP and investment recovery continue through the existing immutable rebuild ledger. Evidence failures still block approval, and missing costs still prevent GP from being invented. Capital increases after approval retain the original payback guardrails and require an approved positive-GP baseline.

Fresh verification passed the complete disposable deployment-order database replay, including economic integrity and two-session concurrency; 53 affected unit checks; lint; TypeScript; staff build; and the new desktop/mobile approval workflow. A dry run against the isolated acceptance project listed only the new migration. Candidate migration `20261010170000` was then applied and Worker `35df637a-907b-41d4-be53-8baab5f3abd3` was published with preserved variables and the expected project guard. Hosted signed-in readback shows the MS Palya proposal as **Ready for actual tracking**, with instrument capital, billing and investment preserved and expected monthly GP/payback both **Not set**. The real proposal remains unapproved; production remains unchanged.

### Optional planning health status — 10 October 2026

Planning remains optional after approval. Migration `20261010172000_optional_plan_health.sql` removes the obsolete rule that classified a placement as Data incomplete solely because no expected-economics row exists. Missing or stale source evidence, missing purchase costs and unresolved attribution still produce Data incomplete. With those checks complete, the color-coded status now follows verified actual GP and payback; an actual-only record with no supported forecast can be Healthy rather than showing a false evidence warning.

The regression creates and approves an isolated actual-only target after complete source coverage, confirms planning is Not set and verifies health is no longer Data incomplete. The complete deployment-order database replay passed, including item-group attribution, GP/leakage integrity and two-session concurrency. Release-history checks passed 10/10. An acceptance dry run listed only `20261010172000_optional_plan_health.sql`; that migration was applied, and hosted history readback matched local and remote version `20261010172000`. The existing Worker and gateway require no redeploy for this read-model change.

Latest signed-in hosted readback shows the MS Palya target as **Approved**, with expected planning still Not set. It correctly remains **Data incomplete** because 28 attributed reagent lines lack verified purchase cost; capital recovery stays provisional at zero and the ₹2,25,000 investment balance is retained. This confirms the migration did not hide a real cost-evidence gap. No approval command was issued as part of this migration rollout; the decision actor and reason remain subject to the candidate audit review. Production remains unchanged.

### Focused purchase-cost review — 10 October 2026

The Verify sale cost screen now lists only current mapped reagent sales whose actual purchase cost is unavailable. Already verified sales, instrument billing and unrelated/unattributed sales are absent. It shows the remaining count, keeps compatible Tally purchase selection and exact quantity conservation, and fills the quantity only when one compatible purchase source can cover the whole sale. Accounts still chooses the evidence and enters its reference; the UI does not infer a purchase or cost.

Focused validation passed 34 unit checks, two desktop/mobile browser checks, lint, TypeScript and the staff build. The guarded dry run confirmed the acceptance Worker and project reference before deployment with preserved variables. Final Worker `c89bcda2-fa60-41b2-8c9e-cc3845cb2e65` is live. Signed-in hosted readback shows exactly **28 sale lines need cost evidence**: **24** have one compatible purchase match, **one** has multiple matches and **three** have no purchase match. Each sale option carries its match count. No cost verification was submitted, and production remains unchanged.

### Approval audit, automatic purchase cost and simple-first UI — 10 October 2026

**Approval audit (read-only).** The pilot's `approve_target` audit row is dated 10 Oct 2026 17:27:27 IST and was made by the owner Administrator account. Its reason text is "approved". It used `actuals_only` readiness with capital ₹6,25,000, billing ₹4,00,000 and approved net investment ₹2,25,000; expected GP and payback were null, and the version and generation checks were present. The paired billing reversal/repost is the normal rebuild republish, and net billing contribution remains ₹4,00,000 once.

**Owner policy change.** The owner directed that reagent purchase cost be taken automatically from Tally Prime, with no per-sale input. This supersedes the earlier rule that a single compatible purchase is not approval. The owner chose:
- Matching: same batch first; a sale without a batch uses the oldest unused purchase (FIFO). Purchase quantity is never reused, and current manual verifications are reserved first.
- Zero-value Diasys supplier purchases (1164MF, 0933DF, 1521MF/CDI/2627) are genuinely free, so their cost is ₹0.
- A sale that cannot be fully covered keeps cost unavailable.
- Manual verification remains an Administrator path under Advanced and takes precedence.
- A policy version can switch automatic costing off. Null inherits the latest explicit value; the default is on.

Migration `20261010210000_automatic_purchase_cost.sql` stores per-run, append-only allocations (`stockflow_economic_auto_cost_links`, RLS on, no API grants). Results read "Automatic Tally purchase cost (batch, then oldest first)", and cost evidence names the Tally purchase voucher.

Migration `20261010200000_source_voucher_number.sql` adds readable Tally voucher numbers to workspace source lines. It is display only.

**Simple-first UI** (owner decisions: Advanced is for Administrators only; Reagent Leakage goes under Advanced; approval is set-up step 2):
- Tabs are Instruments, To do, Set up and Advanced.
- Instrument cards show Investment, Capital recovered, Balance to recover, reagent sales and GP since installation, and one "N sales have no matching Tally purchase → See To do" line.
- To do lists only unmatched sales, each with its Tally fix, plus Tally import rejections.
- Set up has three steps: choose the instrument; record purchase, link billing and approve; choose the reagent group or items.
- Advanced holds All actions (the previous 17-action setup), Exceptions, Reagent Leakage and Reports (coverage, exclusions, reconciliation, planning/payback, item breakdown, line evidence and history).
- Accounts and Sales see Instruments and To do only.

**Validation.**
- The complete deployment-order database replay passed. It includes a new automatic-cost suite: batch precedence, FIFO, no reuse, ₹0 cost, short quantity unavailable, rebuild stability, policy switch and privileges. The legacy integrity and item-group suites now pin the manual path with an explicit manual-only policy version.
- Full unit suite: 123 files, 888 tests. Lint, TypeScript and the staff build passed.
- Economics and scroll browser suites: 114 desktop/mobile checks, including the new simple-flow check.

**Acceptance deployment.**
- The connector applied the migrations with hosted versions `20261010151545` (source_voucher_number) and `20261010151619` (automatic_purchase_cost).
- Readback confirmed both functions are patched and the helper is not executable by `authenticated`.
- Worker `c9ac5302-d0b4-4295-95bf-541a8a7960f3` was published with preserved variables and the acceptance target/project guard. The rollback reference is `f0cbe409-98d0-46dd-b50f-363f5e73f872` (₹0-warning build).
- Signed-out probes: page 200 with no-store; both financial APIs 401, private, no-store.
- Production is unchanged. For production, apply these two migrations after the seven earlier ones, in local order.

**Expected pilot effect after the next rebuild** (read-only preview; no other imported sales consume these items):
- 24 of 28 lines are costed: 6 from DO/3156/COI/2627 at ₹64,892.34, 17 from ₹0 entries, and Trulab N from oldest-first 0933DF at ₹0.
- 4 remain unavailable: HDL-C (2 sold, 1 purchased), Calcium AS FS and LDL-C Direct FS (batch mismatches 0652605/0652505 and 0802603/0802605), and Phosphate FS on 25 Jul (no prior purchase).
- Capital recovered becomes about ₹1,79,668 and the balance about ₹45,332. Status stays Data incomplete until those Tally discrepancies are fixed.
- The next rebuild runs on the next Tally sync or any Set up save.

**Owner-requested recalculation (acceptance only).** The owner authorized one rebuild, which produced run `0b674d5d-388d-4ba1-a087-2524273d166a` (previous run `57e39918-e710-4983-a93e-619d26278af7`). Readback matched the preview exactly:
- 24 of 28 reagent lines costed: reagent sales ₹3,55,530.82, automatic cost ₹64,892.34, GP ₹1,79,668.36.
- The ledger nets ₹5,79,668.36 (₹4,00,000 billing counted once plus GP). Capital recovered is ₹1,79,668.36 and the balance ₹45,331.64.
- Status is Data incomplete, with 4 lines unavailable: HDL-C, LDL-C, Calcium and Phosphate on SD/26-27/0404.

**Batch mismatch falls back to FIFO average cost.** Owner policy: when no purchase of the sale's batch can cover the whole sale, cost by FIFO across all batches of the item, so a sale spanning several purchases carries their weighted average cost. Exact batch matches are still used first. Insufficient total quantity, or no purchase on or before the sale date, still leaves cost unavailable.
- Migration `20261010220000_auto_cost_batch_fallback.sql` replaces only `stockflow_economic_auto_cost` and is applied to acceptance as hosted `auto_cost_batch_fallback`.
- To do reasons now ignore batch, and shortfall is reported before ₹0-only.
- The database replay with the new fallback cases passed, as did 888 unit tests, 114 browser checks, lint, TypeScript and the build.
- Worker `40dc6d66-7137-47a0-8c08-147af3b0c8ad` was published with the target guard; rollback is `c9ac5302-d0b4-4295-95bf-541a8a7960f3`.

The owner-requested recalculation produced run `99b4c86b-9e82-4f0c-8b3d-37614480d637`:
- Calcium AS FS is now costed at ₹0 from 1164MF (GP ₹5,860).
- Pilot reagent GP is ₹1,85,528.36, capital recovered ₹1,85,528.36 and balance ₹39,471.64.
- 3 lines remain unavailable: HDL-C (quantity), LDL-C (quantity) and Phosphate 25 Jul (no prior purchase). Status remains Data incomplete.

**One-year purchase lookback.** Owner direction: the purchases exist, so check batch matches over one year.

*Connector.* `Read-TallyEconomicEvidence` gains `PurchaseHistoryMonths`; `dashboard.ps1` adds `-EconomicPurchaseHistoryMonths`, default 12.
- Older months are exported one month at a time, because one 12-month export exceeds the 32 MB XML bound. Only their purchases are kept.
- Sales stay on the existing `EconomicHistoryMonths` window.
- A read-only measurement found about 150 vouchers and 3 MB of XML per month. Nine older months of purchases add 389 vouchers and about 392 KB of JSON, within the 2,000-voucher and 8 MB upload limits.
- The connector fixture test covers month-by-month export, purchases only, and no extra exports when the setting is off.

*Server.* Migration `20261010230000_auto_cost_one_year_lookback.sql` limits automatic candidates (batch and FIFO fallback) to purchases dated within one year before the sale. The database replay with a lookback case passed. It was applied to acceptance as hosted `auto_cost_one_year_lookback`.

*Acceptance data.* From the read-only 12-month extraction, the 9 SYS 480-related purchases missing from acceptance (8 from Nov 2025 – May 2026 plus purchase 2226 on 7 Aug) were imported through the existing snapshot trigger. The import was checksum-guarded (`md5 58b8a9b7…`); the 14 already present at the same revision were not resent. Results:
- Source vouchers went from 280 to 289, with import exceptions unchanged at 3.
- The stock payload hash is unchanged, and the private envelope was removed from the snapshot.
- The resulting run is `aa32ea4d-207c-49c3-a702-761f914ce6e9`. All 28 pilot reagent lines are costed:
  - Phosphate 25 Jul: batch 60177209 on DO/0536 (Apr), ₹1,422.04.
  - LDL-C: batch 0802603 on MO/0936 (May), ₹23,566.93.
  - HDL-C: FIFO, ₹10,332.97.
  - Cholesterol: no batch, so FIFO took older purchases, ₹2,775.
- Reagent GP is ₹2,48,177.54 against the ₹2,25,000 investment, so the balance is ₹0 and about ₹23,178 is recorded surplus.

*Known limitation.* Older months bring purchases only, so FIFO cannot see older sales to other customers that may have used up those older lots. Batch matches are unaffected.

*Owner decisions after the lookback (both yes).*
1. **Unmapped items.** Migration `20261010240000_unmapped_items_not_unresolved.sql` stops a same-customer sale of an item mapped to no instrument (`no_verified_compatible_placement`) from making a placement Data incomplete. Ambiguous placements, invalid adjustments and missing costs still count. A new SQL case covers both directions. It was applied to acceptance as hosted `unmapped_items_not_unresolved`.
2. **Items panel.** Each selected instrument on the Instruments tab now has an Items panel:
   - It lists counted groups and single items, each with Remove, which sets an exclude rule from today and keeps earlier sales.
   - Removed items can be added back from today.
   - It suggests items this customer buys that no instrument counts; Add counts them from installation.
   - A picker covers any Tally item.
   - Read-only roles see the list without buttons.

   The owner adds the agreed Diasys items (SCS 400, Trucal Lipid, Alpha-Amylase, Magnesium XL, SYS 480 Gamma GT FS, Total Protein UC FS/Standard, Gamma GT FS Diasys) from the panel. Commands require the gateway key, so they are not written directly.

Validation: database replay, 888 unit tests, connector tests, 118 desktop/mobile browser checks, lint, TypeScript and the build all passed. Worker `0c1029a5-7639-4134-a023-d80004a4ac6a` was published with the guard; rollback is `40dc6d66-7137-47a0-8c08-147af3b0c8ad`.

A concurrent local session ("Claude RC") edited the mapping forms (`onTargetChange` / `setMappingTargetId`) at about 21:56 IST, after this build. Those edits are not in this deployment and were left untouched.

*Remaining Data incomplete (resolved above).* The rule `has_unattributed` treated any non-attributed sale to the same customer as unresolved. ABG has 48 such lines, mostly Sysmex haematology, coagulation and urine items. Diasys items not mapped to this instrument include SYS SCS 400, Trucal Lipid, Alpha-Amylase, Magnesium XL, SYS 480 Gamma GT FS, Total Protein UC FS/Standard and Gamma GT FS Diasys. This needs an owner decision.

### Review and instrument invoice-date correction — 10 October 2026 (local only)

The owner clarified that reagent sales must count from the instrument sale date. New migration `20261011000000_instrument_reagent_sale_date.sql` derives `salesFrom` from the current compatible linked Tally instrument invoice, uses an inclusive attribution boundary and exposes that date separately from physical installation. UI lifetime labels and simple item/group defaults follow it; explicit mapping dates remain respected. Invoice revision/cancellation checks prove restatement and unavailable dates rather than guessed fallback. Placements without instrument billing retain their existing start date. No hosted deployment or production promotion occurred in this review.

See `INSTRUMENT-ECONOMICS-CHANGE-REVIEW-2026-10-10.md` for changed files and fresh verification. Older purchase-only imports omit sales that could have depleted the same lots; FIFO and exact-batch availability can both be affected. The earlier statement that batch matches are unaffected must not be treated as financial certification. Latest recorded pilot GP/recovery is a recorded calculation, not proof that all historical depletion was reconciled.

### Acceptance correction and related-item suggestions — 10 October 2026, later checkpoint

This checkpoint supersedes the local-only date correction and ₹2,48,177.54 pilot recovery above. Migration `20261011000000_instrument_reagent_sale_date.sql` was applied only to acceptance project `ayrvhemxzizpkfcycvip`, hosted version `20261010171033`, normalized SHA-256 `36f71cf47685815a44e34fc3629eaca2b45dea8cdc6556e44cf4b0a0f3aa6ca7`. Remote readback verifies `salesFrom=2026-07-23` and denied authenticated access to private helpers. It also fixes a reproduced allocation error: an incompletely covered sale reserves its available purchase quantity, but its whole cost/GP stays NULL. Later sales cannot reuse that quantity. Partial evidence is explicitly labelled as a stock reservation, not a complete financial cost.

The owner questioned unnecessary historical import load. Older cost history is now filtered to items sold/returned in the current reporting window. Keep whole matching vouchers across all customers, so canonical revision/content and earlier stock consumption remain consistent; keep cancellations and unverified source evidence visible. Unrelated verified historical invoices are excluded from upload/storage. Monthly Tally export requests remain bounded and unchanged in number; this reduces retained/transmitted history, not the monthly export reads. Instrument sales/GP continue to count only from the current instrument invoice date, subject to dated mappings. A combined history exceeding 2,000 vouchers fails explicitly instead of truncating.

For pilot reconciliation, reused the private same-day monthly exports and selected the 30 SYS 480 group items' older movements (before July), plus unresolved/cancellation evidence. Preview: 41 whole vouchers / 86,440 bytes, 8 already imported, 16 new verified vouchers, 17 unverified, zero revision conflicts. Applied through the existing snapshot import trigger under economic and snapshot locks, guarded against the recorded snapshot checksum and active generation; identical previously recorded exceptions were skipped. No complete-history coverage or fresh master observation was claimed. Snapshot MD5 remains `b4aaf83908c54f978c9433759256d8f0`; the private import envelope was removed.

Readback run `631f4191-25e4-4ed6-b34f-030b1b33e4c4`: 305 source vouchers, 1,253 lines, 19 import exceptions. Pilot has 28 mapped reagent lines, 27 costed, reagent sales ₹3,55,530.82, known purchase cost ₹79,422.35 and known GP/recovery ₹2,07,208.39. Investment remains ₹2,25,000; provisional balance ₹17,791.61. Ledger recovery totals ₹6,07,208.39 including the ₹4,00,000 instrument bill exactly once. SYS 480 LDL-C Direct FS, 2 units on SD/26-27/0404 dated 25 July, remains cost unavailable after earlier depletion. Status stays Data incomplete; these figures do not certify full financial reconciliation.

The owner then reported unrelated suggestions. The simple Items panel now scopes both suggestions and its item picker through the selected group's verified Tally parent family. SYS 480 belongs to Diasys Diagnostic India Pvt Ltd, so sibling Diasys items qualify and Sysmex items do not. Existing individual inclusions can also establish a related family. Suggestions still require this customer's same-company unattributed sales from the instrument sale date and never add an item automatically. Missing cost wording now says purchase-cost review / Cost unavailable, because an insufficient purchase quantity is different from an absent purchase.

Fresh verification: complete disposable deployment-order database replay, economic integrity/date/cost and two-session concurrency suites; connector fixtures including unrelated-history exclusion and combined bounds; 103 focused unit/preflight checks; eight desktop/mobile date, suggestion, cost-review navigation and read-only checks; lint, typecheck and staff build. Both desktop/mobile suggestion regressions failed against the old behavior before the fix.

Final guarded acceptance Worker `899f3e03-e5b8-48f2-afcd-c9546a0241b9`; rollback UI version `1336700f-b5ab-4176-9d92-0edf0bc10a8a` includes the same database correction, earlier rollback `0c1029a5-7639-4134-a023-d80004a4ac6a`. The existing gateway deployment is unchanged. Staged connector scripts and SHA-256 manifest were refreshed without activation. Production is unchanged and still needs financial reconciliation, unsupported-source/packing decisions and separate-role acceptance. The production history map correctly retains all 13 economics migrations as pending there.

Fresh signed-in hosted readback verifies the investment/recovery/balance and sale-date labels above. After the final Worker refresh, MS Palya's Items panel retains Alpha-Amylase/Diasys suggestions and has no Sysmex in either suggestions or its 168-item related picker. No mapping or approval was submitted during this check. Source exception categories are 3 accounting-only documents needing product/original-sale linkage, 8 unclassified document adjustments and 8 unclassified inventory voucher types; do not silently assign ledger roles or certify their amounts.

## All-group search and compact document review — latest 10 October 2026

The owner clarified that item search must cover other groups and requested searchable Instrument selling line selection. Explicit search now spans the current same-company Tally catalog/source items; related families only guide empty-query suggestions and ordering. Results are bounded, show group names, and label already counted items. Add retains canonical identity and the displayed effective date; search alone never changes attribution. Historical registration billing searches item, human invoice number, date and serial/batch. Mouse/keyboard selection retains exact source/revision; changing or clearing the query clears the previous selection and serial.

The 19 retained import exceptions are source documents requiring Accounts review across imported data, not 19 errors on the selected instrument. Their verified extraction categories remain 8 unclassified voucher types, 8 unclassified adjustments and 3 missing item/original-sale links. The current read model exposes the generic admission reason, not the extraction subtype; the UI does not fabricate a classification. To do now shows a compact visible count/explanation with source rows collapsed and scrollable. The instrument's unavailable cost queue remains separate; no exception or evidence was deleted or approved.

Acceptance-only guarded deployment: final Worker `961b8fd5-fa9b-41bb-aedf-e9b3832807e8`; intermediate search Worker `93173cec-0034-4908-a52b-09969998e672`; earlier UI rollback `899f3e03-e5b8-48f2-afcd-c9546a0241b9`. Build artifact checks confirmed the acceptance Worker and `ayrvhemxzizpkfcycvip` target; existing variables were preserved. No new database migration, gateway/connector deployment or economic command was submitted in this continuation. Production remains unchanged.

Validation: 45 focused UI/form/recovery units; eight affected search/date/read-only desktop/mobile checks passed across runs after fixing two initially failing stale internal-filter cases; two additional To do checks passed for collapsed/expanded details and separate unavailable costs. Final lint, typecheck and staff build passed. Separate background-tab signed-in inspection found Sysmex items through all-group search and exact SYS 240 invoice SD/26-27/0388 dated 23 July by serial A082606037. The owner's original tab/form was preserved.

Live mappings subsequently include seven individual items alongside SYS 480; observed published totals now show 35 reagent lines, ₹4,52,669.52 sales, known GP/recovery ₹2,76,770.94, provisional balance ₹0 and one cost unavailable. These were read-only observations, not a financial certification or changes made during UI verification. Earlier pilot figures remain dated checkpoints. Reconcile current source/cost evidence, including zero-value supplier lines, before certifying recovery. Full financial and separate-role acceptance remain pending.

**11 October 2026 readback and LDL-C finding (read-only).**

Live acceptance run `32411b40-0984-4027-9c16-355a0e383476` (22:56 IST, after the owner's seven item mappings):
- 35 reagent lines, ₹4,52,669.52 sales, known GP/recovery ₹2,76,770.94, balance ₹0.
- `salesFrom` is 2026-07-23 and there are 19 import exceptions.
- Data incomplete only because SYS 480 LDL-C Direct FS (2 units, SD/26-27/0404, ₹68,900.08) has no cost.
- Production still has 103 migrations and no economics objects.

The 12-month private extract shows batch 0802603 bought as **"LDL C Direct Fs (Diasys)"** (MO/0362 on 20 Apr and MO/0570 on 27 Apr, 1 unit each), an item with no sales in 12 months. The same batch was sold as **"SYS 480 LDL-C Direct FS"** (30 May to another customer, 1 unit; 25 Jul to ABG, 2 units), whose only purchases are MO/0936 (13 May, batch 0802603) and 1164MF (25 Jul, batch 0802605). Batch 0802603 balances (3 bought, 3 sold) only if the April purchases are the SYS 480 item, which points to a duplicate Tally item master. The 26 Sep sale of batch 0802401 has no purchase within a year. The system must not merge items by name. The recommended fix is in Tally: correct the April purchase lines or merge the duplicate item, then sync.

Final signed-in hosted UI readback verified the new compact heading/count, initially collapsed details, all 19 retained rows on expansion and the separate LDL-C unavailable-cost queue. An existing background root page retained an older UI asset after reload; navigating through the portfolio to the financial workspace loaded the current deployment. The published root response independently references the latest build asset and sends `no-store, must-revalidate`. The temporary verification tab was closed; the owner's original tab was not reloaded. A private hosted screenshot is retained only in ignored `work/instrument-economics-history/instrument-document-review-hosted.jpg`.

### Coordination — 11 October 2026

Task claims and per-milestone notes are kept in the Coordination log at the end of `docs/CLAUDE-HANDOVER-INSTRUMENT-ECONOMICS.md` (section 10). The instrument eco development session has claimed production cutover preparation (read-only), and its only owned new file is `docs/INSTRUMENT-ECONOMICS-PRODUCTION-CUTOVER-PLAN.md`.

**Milestone (11 Oct): production cutover preparation done, read-only.**
- Production is unchanged: 103 migrations, history fingerprint `3c1b617639bb39e13385dd40fb8cdb08` matching the map, no economics objects.
- Rollback: Worker `167e2b20-a56d-4057-87ab-9a5f3302b752` and `stockflow-orders` version 30.
- Acceptance holds all 13 economics migrations in local order: 11 hash-identical and 2 CLI-split.
- The staged connector matches its manifest and source.
- The ordered cutover steps, verification and rollback are in `docs/INSTRUMENT-ECONOMICS-PRODUCTION-CUTOVER-PLAN.md`. Status: **not ready**. Blockers: packing policy, 19 import exceptions, the LDL-C Tally item correction, separate-role acceptance, reconciliation sign-off, a frozen checkpoint commit and a gateway-source check.

### Coordination milestone — ChatGPT / Codex, 11 October 2026

The user explicitly designated ChatGPT / Codex in this coordination chat as the sole integration and deployment owner. Other sessions prepare/review their claimed work and hand it off here; only this designated session integrates/deploys. This designation does not waive financial/role acceptance or approve production release.

Edited only this record and the handover document: added the current ownership summary/process, preserved the concurrently posted cutover-preparation claim, reconciled stale seven-migration/manual-cost/28-missing-line handover details with the latest recorded 13-migration/automatic-cost/one-missing-line checkpoint. Claude RC's older file claims are inferred and require confirmation; reserved source files and the other session's production-cutover plan were left untouched.

Verification was documentation-only: reread both shared records before edits, reviewed current branch `codex/staff-signin-session-redirect`, HEAD `6925c91` and dirty/untracked state, and preserved intervening additions. No application tests, commit, reset, stash, hosted write, deployment or connector activation occurred. Documentation milestone complete and exclusive shared-document claims released. Next: the preparation session completes its plan; Claude confirms current claims; this chat reviews the combined work and outstanding acceptance before any deployment. Coordination is file-based and requires each agent to read updates; no automatic chat synchronization is claimed.

### Handoff — Claude Code "instrument eco development", 11 October 2026

Acknowledged ChatGPT / Codex as sole integration/deployment owner. This session will not deploy further. The completed cutover plan (`docs/INSTRUMENT-ECONOMICS-PRODUCTION-CUTOVER-PLAN.md`) is handed off for review. Production remains unchanged and not ready, pending the blockers in that plan's section 1.

### Owner decisions and checkpoint commit — 11 October 2026

Owner decisions:
- **Packing charges count** as reagent purchase cost; freight stays excluded.
- **Accounts will fix the LDL-C duplicate item** in Tally.
- **Make a checkpoint commit.**

Local commit `afbb17e` (101 files; `.codex/` local tooling deliberately excluded; not pushed) freezes the multi-agent work for integration review by ChatGPT / Codex.

A read-only Tally lookup found three packing ledgers: Packing Charges 0%, Packing & Forwarding 18 and Packing Forwarding 5, all under Indirect Expenses. Counting them needs a connector role that spreads the charge into line net values. That is a code change in a file reserved for Claude RC, so the full proposal is in section 7 of `docs/INSTRUMENT-ECONOMICS-PRODUCTION-CUTOVER-PLAN.md`. No connector, database, acceptance or production change was made.

### Packing excluded for now — 11 October 2026

The owner reversed the packing decision: "Remove packing for now". Packing is now excluded from reagent sales and cost, like freight. The three packing ledgers have the existing `charge` role in the policy file and the staged connector role file (manifest refreshed). There is no code change, and the earlier proposal for counting packing is withdrawn.

A read-only Tally preflight for July–October went from 3 unverified vouchers (2 packing adjustments) to 1 (an unclassified voucher type, likely the purchase Debit Note). Acceptance and production data are unchanged; the integrator applies this at the next import.

### Acceptance integration — ChatGPT / Codex, 11 October 2026

Independently downloaded acceptance `stockflow-orders` version 11 and compared both source files with the checkout after CRLF normalization/trailing whitespace trim: `index.ts` SHA-256 `2fce7fd3e1be50466a072ba1ac4974e7cf1c20f8abc6c5190321dbb704ad6bc5`; `request-gate.ts` `edd068f054a2f58425270a7303f4e819d49c48ad1abf792e64856e03c568cbe2`. Both match. Bundle remains `82b966e8b785cfcc1786c73d0a36e500d7adaa30fcd03ee7af3ebf946acdfdb4`; no gateway deployment needed.

The current queue previously included resolved historical errors. New migration `20261011010000_active_economic_import_exceptions.sql` derives open failures from admitted canonical company/source/revision history, preserving every rejected event. Newer and conflicting same-revision failures, unadmitted sources and global errors remain open. Applied only to acceptance as `20261010191809`; hosted normalized hash matches `687980d14a26871b7c6ecad38bfe9728925528b7db65f8662d390c4271e481c8`. Private helper remains denied to authenticated/anon. Production history map keeps all 14 economics migrations pending there.

Packing configuration handed off by Claude was parsed and checked through existing connector fixtures. The monolithic full-year XML hit the existing size bound; bounded monthly reads extracted only the eight affected canonical purchase documents for import (ten lines, 5,077 bytes). No unrelated bulk upload, fresh catalog or complete-window assertion. Rollback preview reproduced the exact expected result. Actual import used economic/snapshot locks and guarded the previous run/checksum, required zero new failures and unchanged pilot economics, and retained source/event history. Raw evidence stayed in ignored local work files.

Readback: run `ab090976-9553-4cc9-a6ff-276e6c82b56b`, 313 source vouchers, all 19 historical failure rows retained, **11 open failures** (8 voucher classifications + 3 item/original-sale linkage issues). Snapshot MD5 remains `b4aaf83908c54f978c9433759256d8f0` and economic envelope is absent. Pilot remains 35 reagent lines, sales ₹4,52,669.52, known GP/recovery ₹2,76,770.94, provisional balance ₹0, one LDL-C unavailable cost. No Tally alias or invented cost was entered.

Fresh verification: ten preflight units, connector fixtures, complete disposable deployment-order/integrity/role/date/automatic-cost replay and all two-session concurrency checks. New eleven-case queue test reproduces the old behavior and verifies resolution, immutable history, canonical company/revision isolation and helper privileges. Initial fixture updates were blocked by immutability and replaced by separate inserts; a dblink default-port failure was corrected by starting the isolated loopback test server with the correct environment. Final replay passes; existing business databases were untouched by tests.

Hosted Administrator readback shows To do (12), 11 expandable document rows and the separate LDL-C queue. Private screenshot `work/instrument-economics-history/packing-review-acceptance.jpg`. Worker `961b8fd5-fa9b-41bb-aedf-e9b3832807e8` and gateway version 11 unchanged; production read-only count remains 103 and new helper is absent. No connector activation. Local selective commit `4731652` includes seven reviewed migration/test/policy files, not pushed. Claude's unfinished Orders changes and local `.codex/` tooling remain unstaged. User deferred Accounts sign-in; financial and separate-role acceptance, LDL-C source correction and remaining explicit source-scope decisions are still required before production.

### Orders simplicity feedback — 11 October 2026

Owner challenged the Orders design for failing the easy-view/simplicity requirement. ChatGPT / Codex reviewed current source, the existing redesign plan and static mobile mockup, and recorded the findings and integration criteria in the shared handover. The previous measured screen put the first order at 626/839 px and overloaded cards/filters; review must focus on compact scanning and one clear next action on opening an order. Claude retains the active implementation files. Documentation-only feedback; no source changes, runtime tests or deployment. The local redesign remains unfinished and static previews do not certify the actual UI. Next milestone: completed Claude handoff and review of rendered mobile/desktop screens before integration.

### Order notifications planning — 11 October 2026

Channel confirmed by owner: inside the app first; owner requested a proper plan before integration. `docs/ORDER-NOTIFICATIONS.md` now defines one existing bell, event-derived unread updates/read receipts, separate workload reminders, exact-order links, access controls, foreground polling/failure handling and staged acceptance. Summary-count prototype is explicitly unverified; its application mount was removed and `app/page.tsx` has no remaining diff. An isolated fixture and two new draft files remain local, excluded from release. Claude's owned source remains preserved. Scoped whitespace check and repository-contract review only, no runtime/build certification. No hosted migration, deployment or notification activation; next milestone is backend/event receipt tests and coordinated single-bell integration after Orders handoff.

### Notification role-work correction — 11 October 2026

Owner clarified the processing objective: incoming work follows the role responsible for each stage. Updated `docs/ORDER-NOTIFICATIONS.md` to supersede passive unread-updates design: confirmation → Warehouse/Operations packing → Accounts billing → Operations dispatch/delivery; stage completion resolves prior-team tasks, while Seen leaves work pending. Derived task occurrence and current-state eligibility prevent stale tasks, internal-status spam and cross-stage assignee stranding. Badge counts distinct current work; backlog is retained; visible/online arrival target 15 seconds plus immediate local post-command refresh. Recorded changed work/seen/pending contract for Claude's active single-bell seam in handover; no owned UI edits. Documentation/policy review only, no fresh runtime certification or hosted change. Backend role-work projection/tests next; service remains unimplemented/unactivated.

### Orders live refresh acceptance release — ChatGPT / Codex, 11 October 2026

Owner authorized narrow takeover ("ok takeover"); Claude acknowledged the seam reservation. This chat integrated access-scoped revision checks in Orders, a 15-second bootstrap-cache expiry and the notification checker's revision signature while preserving all existing redesign, push and header changes. No frame changes by this chat. Main edited/new source: components/order-workspace.tsx, lib/order-live-refresh.ts, lib/order-bootstrap-cache.ts, lib/work-notifications.ts. Regression files: tests/unit/order-live-refresh.test.ts, tests/unit/work-notification-revision.test.ts, tests/unit/order-bootstrap-cache.test.ts, tests/pricing-browser/orders-cross-session.spec.ts, supabase/tests/order_summary_revision.sql; deployment runner and migration map updated.

Mechanism: existing summary reads every 15 seconds while visible and online; reload the current page on visible canonical order ID/version/status revision changes (including equal counts and reassignment), with one check in flight, bounded retry and explicit failure/access-denied messages. Creation/local commands pause checks; old list responses are invalidated before a local command. Background updates preserve the typed billing draft. This is polling, not instantaneous push. It reads existing order state; it does not trigger Tally/catalog imports.

Fresh evidence: 21 affected unit tests, 44 relevant mobile/desktop browser checks, full disposable deployment-order/role/integrity/concurrency replay. Final main cross-session rerun passes both desktop/mobile after fixing a test-only early row-existence check to wait for the customer row; no product change was needed. Main affected lint and product-scoped typecheck pass; root typecheck retains only the previously ignored downloaded Deno source under work/. Isolated release normal typecheck/lint, six live/cache unit tests, two cross-session browser checks, staff build and deployment dry run pass. A packaging attempt ran concurrent pnpm auto-installs against the shared dependency junction, causing one browser run to fail on temporarily missing dependency files. Waited for install completion and reran serially using direct local tools; final build and tests pass. package.json and pnpm-lock.yaml have no diff; no other agent's files or server were removed.

Acceptance database migration 20261011060830_order_summary_revision.sql applied remotely as 20261011062329, normalized SHA-256 33c69fe40ff220c0fbc5735935ee1aecae5af0fddfb02cfbe8543db72ea165b5 verified. Private helper remains denied to authenticated/anon; existing membership, combined-role scope and gateway secret boundaries remain. Acceptance has the same one real order; tests did not process it.

To avoid shipping unfinished changes, release artifact work/order-live-release is a plain ignored packaging folder (not a Git worktree), based on checkpoint 47316523208c0e0675c10bc5a334bdd0b05a302e. Compared all tracked app/components/lib/public/offline/config/package files with that checkpoint: only Orders and bootstrap cache changed, plus new live helper. Recorded source SHA-256: Orders 988dc836686f72458c98a27f8a00498e838c709302f946365348db51cc4fdcb7; cache 40e326836cd75f371609f602a4a70f2319d7d4e024bd8e9c4ead6fdf4fe72aaf; helper 10e00dbd902c23aa2a8f9afc7e4ddb62378d8d1e96ff4e66f859e3824462f88e. Full manifest, test/build/deployment logs are retained privately in that folder. The current compact redesign/checker/push/header work stays in the main checkout; its notification revision fix is not in this isolated checkpoint release.

Deployed acceptance Worker only: 91752798-d7d7-437a-a53c-a620c9fb6b81, previous Worker 961b8fd5-fa9b-41bb-aedf-e9b3832807e8 is the rollback target. Existing remote variables/secrets retained; acceptance target verified by generated configuration and dry run. Gateway remains version 11. Hosted existing Administrator session works after reload; Orders All orders shows the unchanged SF-260926-00021 / Acceptance Laboratory with its current Pick & pack action. No real order transition was executed. Screenshot: work/order-live-acceptance.jpg. Real cross-role mutation acceptance is still deferred with Accounts sign-in; two independent mocked browser contexts provide the regression proof.

Production read-only check remains 103 migrations with the revision helper absent. Production and connector unchanged; migration-history-map still records this migration as production not_deployed. No commit/push in this milestone. Next: actual separate-role acceptance when Accounts is available; independently review Claude's completed compact UI/checker handoff before combined release. Release the narrow live-refresh file reservation now: Claude may resume redesign edits after rereading this entry, preserving the live helper/effect and mutation/cache guards. ChatGPT / Codex remains sole integration/deployment owner.

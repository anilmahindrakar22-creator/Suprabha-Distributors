# Claude handover prompt — Suprabha OS

## Shared coordination — read before editing

Owner instruction adopted 11 October 2026 (Asia/Kolkata): coordinate through this document and the rollout record; claim tasks/files before editing, avoid another agent's owned files, record milestone changes/tests/blockers/next steps, reread both records before integration/deployment, preserve all uncommitted work, and allow only the designated integration agent to deploy.

Integration and deployment owner: **ChatGPT / Codex in this chat**, explicitly selected by the user on 11 October 2026. Other agents may prepare/review changes, but must hand off integration and deployment here. This designation does not itself approve production release or remove existing acceptance prerequisites.

| Agent | Current task | Files claimed | State / updated IST | Next step |
| --- | --- | --- | --- | --- |
| ChatGPT / Codex, this chat | Coordination setup and handover reconciliation complete; designated integration/deployment owner | None active; shared-document claims released | Complete, 11 Oct 2026 00:23 | Review the other session's completed cutover plan and confirmed claims before integration |
| Claude Code, "instrument eco development" session | Production cutover preparation (read-only), complete; plan handed off to ChatGPT / Codex | `docs/INSTRUMENT-ECONOMICS-PRODUCTION-CUTOVER-PLAN.md` only (released to the integration owner for edits) | Complete, 11 Oct 2026 | No active claim; will not deploy; takes new work only by recording a claim here |
| Claude RC | Historical claims are recorded in section 10, inferred by another session; current task is unconfirmed | Treat section 10's inferred UI/connector/database claims as reserved until confirmed/released | Awaiting Claude's confirmation | Confirm actual task/files; do not infer deployment authority |
| Instrument eco development session (identity as recorded in section 10) | Read-only production cutover preparation | `docs/INSTRUMENT-ECONOMICS-PRODUCTION-CUTOVER-PLAN.md`; short append-only coordination entries in these shared documents | Claimed in the latest shared log | Complete plan and hand off to this chat for integration/deployment |

This table is the current ownership summary; section 10 is the append-only claim/milestone log and the rollout record holds completed milestones/deployments. Reconcile newer log entries before relying on the table. Each agent updates its own status, preserving other entries and history. List exact files; do not claim an entire module without a concrete task. If a needed file is already claimed, work elsewhere until the owner releases it or the user coordinates a handoff. A stale timestamp is not permission to overwrite another agent's work. Inferred historical claims are not proof of another agent's identity or current activity; do not silently turn them into exclusive assignments.

Before writing either shared document, reread it and preserve intervening updates. Keep shared-document edits short; release claims at the milestone boundary. File claims are a coordination convention, not an automatic lock or a substitute for Git review. Separate worktrees/branches require an explicit synchronization of these documents; local uncommitted files do not automatically propagate between checkouts. Do not reset, clean or relocate the existing dirty checkout to create separation.

At each milestone record: agent, date/time, changes and files, actual tests/results (or documentation-only review), blockers and next step. Before integration or deployment, reread both records, inspect current diffs and other agent updates, reconcile overlaps, run justified checks on the combined result, and record the exact release version/environment. Do not deploy another agent's unfinished work. These files do not automatically notify the other chat; both agents must read them.

Snapshot refreshed from shared records: 11 October 2026, Asia/Kolkata. This document is a ready-to-use continuation prompt. Verify the repository and latest rollout record before changing anything; deployment versions and business state can change after this snapshot. The coordination update is documentation-only, not a new hosted readback.

Latest update: read the final 10 October sections of `docs/INSTRUMENT-ECONOMICS-ROLLOUT-RECORD.md` and `docs/INSTRUMENT-ECONOMICS-CHANGE-REVIEW-2026-10-10.md` first. Acceptance Worker `961b8fd5-fa9b-41bb-aedf-e9b3832807e8` includes all-group item search, searchable existing-instrument billing and a compact Accounts document-review summary. Related verified Tally families guide suggestions/order only; they do not restrict explicit search. Instrument-invoice-date counting and partial-stock reservations remain in hosted migration `20261010171033`. Earlier pilot financial numbers are dated checkpoints: live mappings have subsequently changed, so read current published totals and reconcile evidence before certification. Production, complete financial reconciliation and separate-role acceptance remain pending; the staged connector is inactive. Most feature files remain untracked/uncommitted—preserve them.

---

Continue the existing Suprabha OS Instrument Economics and Reagent Leakage implementation through acceptance and production rollout. Work from the existing implementation, preserve unrelated work, and keep the interface simple. First inspect the files below, summarize the actual remaining gaps, and then complete the next justified milestone. Do not restart the architecture or expand into unrelated modules.

## 1. Repository and working state

- Actual repository: `C:\Users\Admin\Documents\Codex\2026-08-30\pl\stockflow-connector-disconnect`.
- Branch at handover: `codex/staff-signin-session-redirect`.
- HEAD at handover: `6925c91`.
- The economics implementation is largely untracked/uncommitted, with integration edits in tracked files. No feature commit or push was made. Inspect `git status` and diffs before editing; do not reset or clean the checkout.
- The other workspace path, `C:\Users\Admin\OneDrive\Documents\ChatGPT\stock`, is not the repository above.
- Read `AGENTS.md`. Keep billing, Tally, security, migrations, concurrency and final integration under direct review. Do not use paid services, plan upgrades or reset credits.
- Preserve existing changes in service workspace, frame, connector dashboard, gateway, service types, package scripts and test harness. Review their individual hunks rather than treating every modified file as economics-only.

## 2. Read these durable project records first

Paths below are relative to the repository root.

1. `docs/INSTRUMENT-ECONOMICS-ROLLOUT-RECORD.md`: current deployment, business decisions, pilot state, migration mapping and rollout gaps. Its latest dated sections supersede earlier checkpoints.
2. `docs/INSTRUMENT-ECONOMICS-BUILD-STATUS.md`: implementation and validation history.
3. `docs/INSTRUMENT-ECONOMICS-AND-REAGENT-LEAKAGE-PLAN.md`: finalized joint architecture, entities, flows, calculations, scope and implementation phases.
4. `docs/INSTRUMENT-ECONOMICS-CANDIDATE-ACCEPTANCE.md`: remaining real-source and authenticated acceptance checks.
5. `docs/INSTRUMENT-ECONOMICS-TALLY-POLICY-DRAFT.json`: extraction rules. Its proposal-format marker remains for compatibility; the reported Accounts approval is recorded in the rollout document.
6. `docs/UI-PREVIEWS/`: synthetic UI previews, not proof of real financial acceptance.

Restricted customer/source reconciliation is outside Git. Keep credentials, passwords and private exports out of chat, commits and screenshots intended for sharing.

## 3. Product requirements and economics rules

The owner repeatedly requested less complexity and fewer fields. The primary instrument view must show **Investment, Capital recovered and Balance to recover**, even when no monthly target exists. Keep planning and evidence detail behind disclosures, and show plain-language, labeled, color-coded statuses. Standalone and embedded workspaces must scroll correctly on desktop and mobile.

Support a whole Tally item group plus individual items. New items in a selected group automatically follow after verified catalog synchronization. Count unique mapped items; overlapping group/individual mappings must not duplicate revenue. Only mapped reagent items contribute instrument reagent sales and GP. Instrument billing is a separate component.

Retain these rules:

- Canonical Tally company/customer/product IDs are authoritative; names are display/search aids.
- Effective-dated placement/product and group mappings, instrument-model defaults and placement overrides preserve historical attribution.
- Identical/shared instruments can use economic placement groups. Ambiguous sales stay unattributed rather than being guessed.
- Actual GP = actual net mapped Tally sale value minus verified attributable Tally purchase cost. GST is excluded; signed discounts, credit notes and returns are handled explicitly.
- FOC has zero revenue, actual cost and a reason classification; it may create negative GP.
- Cost-at-sale uses automatic compatible Tally purchase evidence under the owner's recorded policy, with revision checks and quantity conservation. Missing/unverified cost means unavailable GP, not zero cost or an estimated margin. The later automatic-cost decision in the rollout record supersedes the earlier per-sale manual approval workflow; do not restore that extra entry requirement.
- Net investment = max(0, instrument capital minus net instrument billing). Below-cost billing is an investment. Recovery against that net investment must not count instrument billing again. Retain signed GP/contributions. Economic recovery is not cash collection.
- Expected economics are separate, versioned and optional for initial actual tracking. Approval can use `actuals_only`; an approved target without planning exposes `planning_not_set`. Do not fabricate targets or leakage baselines. Subsequent capital increases retain the existing approved positive-GP/payback safeguards.
- Missing planning alone must not cause Data incomplete. Missing/stale evidence, unavailable cost and unresolved attribution still do. Lifecycle status takes precedence where implemented.
- Preserve immutable economic events/reversals, rebuildable projections, atomic published generations, ACID, advisory locks, version/generation checks and idempotent command receipts.
- Keep one source of truth, explicit failures, auditable events and modular monolith/Postgres architecture. Avoid speculative hardening.

Accounts approved including invoice rounding in net sales, excluding freight from reagent sales/cost, and excluding Delivery Challan and Sales-Quotation from economic invoices. This approval does not certify specific invoices or classify separate packing charges.

Reagent Leakage reuses verified attribution. Compare expected consumption/baselines with mapped Tally supply to the customer, quantify supported revenue/GP variance, record reasons and commercial actions, and track recovery/outcomes. Supply is a consumption proxy; do not claim measured consumption without evidence or confirmed leakage without a supported baseline.

Administrator/Management can mutate economics. Accounts has financial read/reconciliation access; Sales/Operations use the nonfinancial instrument/service portfolio. Verify actual server-side role boundaries. Preserve unknown-save recovery using the original actor, idempotency key and payload; do not store financial payloads in browser storage.

## 4. Files to work in

### Routes and UI

- `app/instrument-economics/page.tsx`, `app/api/instrument-economics/route.ts`: financial workspace and API.
- `app/instruments/page.tsx`, `app/api/instruments/route.ts`: physical/service instrument portfolio.
- `components/instrument-economics-workspace.tsx`: economics cards/detail, investment/recovery, approvals, exceptions, leakage, role controls and scrolling.
- `components/instrument-economics-evidence-forms.tsx`: historical registration, acquisition/billing, groups/items, cost evidence and allocation forms; latest focused missing-cost queue.
- `components/instrument-economics-portfolio-filters.tsx`: portfolio filters.
- `components/instrument-workspace.tsx`: nonfinancial instrument view.
- `components/economic-document-exclusions.tsx`: exclusion review.
- `components/leakage-case-history.tsx`, `components/leakage-case-status.tsx`, `components/leakage-classification-fields.tsx`, `components/leakage-economics-variance.tsx`: leakage cases, reasons, outcomes and variance.
- `components/stockflow-frame.tsx`, `components/service-workspace.tsx`: shared integration; preserve unrelated edits.

### Domain, gateway and connector

- `lib/instrument-economics.ts`: server gateway/orchestration.
- `lib/instrument-economics-types.ts`: contracts and actions.
- `lib/instrument-economics-forms.ts`: exact quantities/allocation validation and `costVerificationSaleLines` queue filtering.
- `lib/instrument-economics-recovery.ts`: investment/recovery calculations.
- `lib/instrument-portfolio.ts`, `lib/leakage-classification.ts`: portfolio/classification helpers.
- `lib/order-gateway.ts`, `lib/service-types.ts`: reused integration.
- `supabase/functions/stockflow-orders/index.ts`: Edge Function action routing.
- `desktop-connector/economics.ps1`: read-only Tally economic extraction/import.
- `desktop-connector/economic-preflight.ps1`: policy/release preflight.
- `desktop-connector/dashboard.ps1`: existing connector integration.
- `supabase/migration-history-map.json`: production migration history evidence.
- Ignored `work/instrument-economics-connector-release/`: staged credential-free connector package, manifest and notes; not activated.

### Thirteen economics migrations, in local order

1. `supabase/migrations/20261007180000_instrument_economics_foundation.sql`
2. `supabase/migrations/20261007181000_instrument_economic_import_and_rebuild.sql`
3. `supabase/migrations/20261007182000_instrument_economics_workspace.sql`
4. `supabase/migrations/20261007183000_instrument_economics_commands.sql`
5. `supabase/migrations/20261010071925_historical_instrument_registration.sql`
6. `supabase/migrations/20261010170000_instrument_actuals_without_plan.sql`
7. `supabase/migrations/20261010172000_optional_plan_health.sql`
8. `supabase/migrations/20261010200000_source_voucher_number.sql`
9. `supabase/migrations/20261010210000_automatic_purchase_cost.sql`
10. `supabase/migrations/20261010220000_auto_cost_batch_fallback.sql`
11. `supabase/migrations/20261010230000_auto_cost_one_year_lookback.sql`
12. `supabase/migrations/20261010240000_unmapped_items_not_unresolved.sql`
13. `supabase/migrations/20261011000000_instrument_reagent_sale_date.sql`

Local filenames and acceptance hosted timestamps differ. Use the rollout record/history map and refresh remote history before release. The optional-plan migration removes the obsolete missing-expectation predicate; later migrations add voucher numbers, automatic cost, bounded historical support, unmapped-item health treatment, invoice-date counting and partial-stock reservations. Preserve guarded drift checks and never rewrite deployed historical migrations.

### Tests

- `supabase/tests/instrument_economics_integrity.sql`, `instrument_economics_item_groups.sql`, `instrument_economics_concurrency.sql`, `historical_instrument_registration.sql`.
- `tests/pricing-migration-local.ps1`: clean deployment-order replay and concurrency.
- `tests/pricing-release-preflight.mjs`, `tests/unit/pricing-release-preflight.test.ts`: release/history guards.
- `tests/connector-economics.ps1`: connector fixtures.
- `tests/pricing-browser/instrument-economics.spec.ts`, `instrument-scroll.spec.ts`: desktop/mobile workflows.
- `tests/unit/instrument-economics*.test.*`, `instrument-portfolio.test.ts`, `instrument-status-ui.test.tsx`, `instruments-page.test.tsx`, `instruments-route.test.ts`, leakage and exclusion tests.
- `playwright.pricing.config.ts`, `tests/ui/`: browser harness; one worker and no retries.

## 5. Milestone status

| Milestone | Status at handover |
| --- | --- |
| Joint architecture and durable work documents | Implemented |
| Canonical/temporal mappings, whole group plus individual items | Implemented and tested |
| Tally extraction/import, source revision/cancellation/exclusion handling | Implemented; real exceptions remain visible |
| Attribution, verified costs, GP, investment/recovery ledger and concurrency | Implemented and tested; pilot cost evidence incomplete |
| Instrument portfolio/status, per-item sales/GP, historical registration | Implemented |
| Reagent Leakage baseline/variance/reasons/actions/recovery workflows | Implemented; real-source acceptance remains |
| Investment-first simplification, optional targets and scroll repair | Live in acceptance |
| Focused cost-review queue and purchase-match summary | Latest acceptance UI live |
| Real Accounts reconciliation and separate role acceptance | Incomplete |
| Production promotion and connector activation | Pending; production unchanged |

## 6. Current deployed state

- Acceptance app: `https://suprabha-staff-acceptance.anil-mahindrakar22.workers.dev`.
- Acceptance Supabase: `ayrvhemxzizpkfcycvip`.
- Latest recorded acceptance Worker: `961b8fd5-fa9b-41bb-aedf-e9b3832807e8`; UI rollback `899f3e03-e5b8-48f2-afcd-c9546a0241b9`. Recheck before deployment.
- Acceptance `stockflow-orders`: version 11; bundle SHA-256 `82b966e8b785cfcc1786c73d0a36e500d7adaa30fcd03ee7af3ebf946acdfdb4`.
- All 13 economics migrations are recorded on acceptance and pending production. The first five hosted timestamps are `20261010064628`, `20261010064717`, `20261010064724`, `20261010064732`, `20261010073042`; invoice-date migration is hosted `20261010171033`. Do not infer deployment order from acceptance timestamps. Use the complete mapping and reviewed local order in the rollout/history records.
- Production Supabase: `aormuidjbdqruglmyseh`; economics has not been promoted there.
- Recorded production Worker rollback: `167e2b20-a56d-4057-87ab-9a5f3302b752`; prior production Edge version 30 source preserved locally. Refresh references before cutover.
- Earlier read-only production preflight matched 103 deployed versions/hashes. Refresh this immediately before release.
- The repo's Supabase CLI link is acceptance. Do not blindly push the full local migration folder against either environment, repair history, or drop objects to resolve differing candidate timestamps.
- Existing scheduled connector, state and credentials were preserved. It is pinned to production; do not start it to send candidate data.

## 7. Real pilot and immediate outstanding work

Pilot: ABG Health Care Services Pvt Ltd — MS Palya; SYS 240; serial `A082606037`. Installation equals billing on **23 July 2026**, superseding an earlier 30 July answer. Verified instrument purchase ₹6,25,000 and billing ₹4,00,000 excluding GST give **₹2,25,000 investment**. Mapped group is **SYS 480**, with 30 current items and future verified members following. Expected monthly sales/GP is **Not set**.

Latest recorded readback is **Approved**, without planning targets. The rollout record's read-only approval audit identifies the owner Administrator, reason "approved", 10 Oct 2026 17:27:27 IST, actuals-only investment ₹2,25,000 and version/generation checks. The latest UI rollout did not issue that approval command.

Latest recorded run `32411b40-0984-4027-9c16-355a0e383476` has **35 reagent lines and one unavailable cost**, SYS 480 LDL-C Direct FS on SD/26-27/0404. Automatic purchase-cost policy is live. Health remains Data incomplete. The earlier 28-line manual review queue is superseded.

Latest recorded lifetime reagent sales are ₹4,52,669.52, known GP/recovery ₹2,76,770.94 and provisional balance ₹0. Sales count inclusively from the instrument invoice date, 23 July 2026, with dated mappings. The owner added seven individual items alongside SYS 480. Unknown cost remains unavailable; the visible zero balance is not financial certification. Earlier zero recovery and ₹17,791.61 remaining balances are dated checkpoints, not the current calculation.

The recorded targeted-history import has 305 source vouchers and 19 import exceptions: 8 unclassified voucher types, 8 unclassified adjustments and 3 item/original-sale linkage issues. These span imported data across instruments and remain in the compact Accounts review summary. Freight exclusion approval does not resolve packing policy. Unsupported purchase returns/adjustments remain explicit.

The latest shared read-only LDL-C finding suggests duplicate Tally item masters across April purchases and later sales. Canonical IDs must not be merged by name in the app. Accounts/Tally correction and subsequent sync/reconciliation remain pending; no source correction is authorized by this coordination milestone. See the 11 October rollout entry for the evidence and remaining out-of-window batch limitation.

## 8. Validation evidence and useful commands

Earlier broad baseline: 123 unit files / 881 tests passed; 96 economics browser checks passed at that earlier checkpoint. Later simplification checks and affected SQL/concurrency suites passed. Do not claim the full suite was freshly rerun after the final UI slice.

Latest recorded UI slice passed 45 focused UI/form/recovery units, eight search/date/read-only desktop/mobile checks across runs after fixing the reproduced stale filter, and two additional collapsed-document checks. Lint, typecheck and staff build passed; hosted read-only inspection verified search and all 19 retained rows. Earlier full SQL/connector suites are separately recorded. This coordination milestone ran no application tests and made no hosted changes.

```powershell
pnpm lint
pnpm typecheck
pnpm vitest run tests/unit/instrument-economics-forms.test.ts tests/unit/instrument-economics-ui.test.tsx --maxWorkers=1
pnpm vitest run tests/unit/pricing-release-preflight.test.ts --maxWorkers=1
pnpm exec playwright test --config playwright.pricing.config.ts tests/pricing-browser/instrument-economics.spec.ts --grep "verifies a sale against multiple compatible historical purchases"
pwsh -NoProfile -File tests/pricing-migration-local.ps1 -DeploymentOrder
pnpm build:staff
```

Vitest uses `--maxWorkers=1`; the old poolOptions flag is invalid. Build and browser suites should not contend unnecessarily.

Acceptance publishing used `pnpm exec wrangler deploy --config dist/server/wrangler.json --keep-vars` only after checking artifact Worker name and Supabase target. Production requires a separate `pnpm build:staff:production`; never publish a reused acceptance artifact to production. Inspect package scripts and existing release guards before use.

## 9. Next milestones and completion criteria

1. Confirm current live state and reconcile remaining LDL-C cost support and the proposed duplicate-master correction with Accounts/Tally evidence. Preserve canonical identities and unavailable states; review zero-value supplier evidence before financial certification.
2. Resolve packing-charge policy with Accounts and define/test supported purchase Debit Note treatment only as required by real evidence. Keep exceptions visible until resolved.
3. Complete real sale/purchase/discount/FOC/return/below-cost reconciliation and separate authenticated Accounts and Sales/Operations acceptance. Local synthetic tests do not certify real finances or roles.
4. Finish the candidate acceptance record, freeze the reviewed change set, and run appropriate integrated release checks. Review the dirty/untracked tree before creating any commit/PR.
5. Refresh production history and rollback artifacts. Reconcile the migration-history map (currently 13 economics migrations pending production), then promote the reviewed migrations in order, gateway and guarded production app; activate the staged connector policy while retaining existing state/credentials.
6. Verify acknowledged first sync, current published rebuild, per-item totals, investment/recovery, role protections and visible exceptions. Record versions/outcomes in rollout/build documents. Roll back application/function or disable economics if necessary; retain immutable business history.

Do not invent a release date while financial evidence and role acceptance are incomplete. Release readiness requires reviewed real-source reconciliation, completed role checks, explicit remaining exceptions, correct target guards and successful post-cutover verification. Keep progress updates plain and brief, and continue the authorized work without repeated deployment-permission requests. Ask only for genuinely missing business decisions or private sign-in that cannot be inferred.

---

## 10. Coordination log (append-only; newest last)

Two agents work in this checkout. Before starting, read the latest entries here and in the rollout record. Record your task and the files you will edit, and do not edit files another agent has claimed. After each milestone, record changes, tests, blockers and the next step. Before integration or deployment, reread both documents and reconcile the other agent's work. Preserve all uncommitted changes, and never reset, clean or stash someone else's work.

### Claimed by Claude RC (inferred from its 10 Oct edits; that agent should confirm or release)

- UI: `components/instrument-economics-workspace.tsx`, `components/instrument-economics-evidence-forms.tsx`, `lib/instrument-economics-types.ts`, `tests/pricing-browser/instrument-economics.spec.ts`, `tests/unit/instrument-economics-ui.test.tsx`.
- Connector: `desktop-connector/economics.ps1`, `tests/connector-economics.ps1`.
- Database: `supabase/migrations/20261011000000_instrument_reagent_sale_date.sql`, `supabase/tests/instrument_economics_sale_date.sql`.
- Docs: `docs/INSTRUMENT-ECONOMICS-CHANGE-REVIEW-2026-10-10.md`.

### 11 Oct 2026: instrument eco development session (this agent): task started

**Task:** production cutover preparation (milestone 5 prep). Refresh production history and rollback references read-only. Produce a reviewed, ordered cutover plan for the economics migrations with their acceptance hosted versions, the gateway, the guarded production app and staged connector activation, plus the rollback steps.

This task makes no production changes, no acceptance writes and no code edits. Owner decisions are still pending on the LDL-C Tally item correction, the packing-charge policy and a checkpoint commit.

**Files this agent will edit:**
- New `docs/INSTRUMENT-ECONOMICS-PRODUCTION-CUTOVER-PLAN.md`, owned by this agent.
- Append-only coordination/milestone entries in this file and `docs/INSTRUMENT-ECONOMICS-ROLLOUT-RECORD.md`.

**Files this agent will not edit:** everything claimed above, `supabase/migration-history-map.json`, the migration files, the tests and the connector. Any change found necessary goes here as a proposal for the owning agent.

### 11 Oct 2026: instrument eco development: milestone "production cutover preparation" done

**Changes:** new `docs/INSTRUMENT-ECONOMICS-PRODUCTION-CUTOVER-PLAN.md`. No code, migration, test, connector, acceptance or production change.

**Checks (all read-only):**
- Production has 103 migrations; versions and normalized hashes match the history map exactly (fingerprint `3c1b617639bb39e13385dd40fb8cdb08`). There are no economics objects.
- Production rollback references are current: Worker `167e2b20…` and `stockflow-orders` version 30. Acceptance `stockflow-orders` is still version 11.
- Acceptance has all 13 economics migrations in local file order. 11 hash-identical; 2 were CLI-split (`170000`, `172000`).
- The staged connector matches its manifest and current `desktop-connector/` source, including the 12-month purchase history.
- LDL-C root cause: a duplicate Tally item master (see the rollout record, 11 October).

**Blockers:** see section 1 of the cutover plan.
- Owner: packing policy and separate-role sign-ins.
- Accounts: the 19 import exceptions, the LDL-C Tally correction and reconciliation sign-off.
- Both agents and the owner: a frozen, reviewed checkpoint commit.
- Integrating agent: confirm that local `stockflow-orders` source is what acceptance version 11 runs.

**Proposals for the owning agents (not done by this agent):**
1. Once production is applied, the history map needs the hosted versions recorded. Do this only at cutover.
2. No code change is needed for the LDL-C fix if Accounts corrects Tally.

**Next step:** wait for the owner's decisions on packing policy and the checkpoint commit, and for the Accounts Tally correction. The gateway-source check (blocker 7) can be done next by whichever agent integrates. This agent has no claim on other files until it records a new task here.

### 11 Oct 2026: ChatGPT / Codex in the coordination chat — owner designation and milestone

The user explicitly selected **ChatGPT / Codex in this chat as the sole integration/deployment agent**. This supersedes any inferred deployment ownership. Other sessions may perform their claimed preparation and hand off a concrete reviewed result; no release was performed or newly approved here.

Task: establish the shared ownership/process section and reconcile stale handover details with newer rollout entries. Files edited: this document and `docs/INSTRUMENT-ECONOMICS-ROLLOUT-RECORD.md` only. The concurrently added read-only cutover-preparation claim and its reserved new plan file were preserved. The historical Claude RC file claims remain explicitly inferred/unconfirmed; no code ownership was fabricated and no reserved source file was edited.

Changes: added current ownership summary and read-before-edit/milestone/integration rules; recorded the designated release owner; updated the migration inventory, latest Worker, automatic-cost policy, approval audit and remaining pilot exception to the latest recorded checkpoints. Validation: reread both documents, inspected current branch/HEAD and dirty tree, reconciled intervening append-only entries; documentation-only review, no application tests needed. All existing uncommitted work remains in place; no commit, reset, stash, deployment, database write or connector activation.

Blockers/next step: Claude must confirm its actual current claims; the read-only cutover session should complete its owned plan and hand it off here. Financial/source-policy and separate-role acceptance remain prerequisites for production. Documentation task complete; ChatGPT's exclusive claims on these shared documents are released. Future short coordination appends must reread/preserve intervening updates.

### 11 Oct 2026: instrument eco development (Claude Code): handoff to the integration owner

I reread both documents after ChatGPT / Codex was designated sole integration/deployment owner, and acknowledge it. This session will not deploy to acceptance or production from now on. Its earlier acceptance deployments (Workers up to `0c1029a5…`, migrations through `unmapped_items_not_unresolved`) predate the designation and are recorded in the rollout record.

**Handoff:** `docs/INSTRUMENT-ECONOMICS-PRODUCTION-CUTOVER-PLAN.md` is complete and released to ChatGPT / Codex for review and edits. It contains:
- seven blockers;
- verified production and acceptance references from 11 Oct read-only checks;
- the exact 13-migration order with hashes and acceptance hosted versions;
- gateway, app and connector steps with target guards;
- post-cutover checks and rollback.

The two items the integrator should verify first are blocker 6 (a frozen checkpoint commit) and blocker 7 (that the local `stockflow-orders` source matches acceptance version 11).

**Tests:** read-only queries and hash comparisons only. No application tests were needed; no files outside this agent's plan and these append-only notes changed. **Blockers:** owner and Accounts decisions listed in the plan. **Next step for this session:** none until a new claim is recorded here.

### 11 Oct 2026: owner decisions, and new claim by instrument eco development (Claude Code)

**Owner decisions (relayed in this session's chat):**
1. Packing charges **count** as reagent purchase cost. This differs from freight, which stays excluded.
2. Accounts will fix the LDL-C duplicate item in Tally (blocker 3).
3. Make the checkpoint commit (blocker 6).

**New task claimed:**
- (a) A local checkpoint commit of the whole working tree on `codex/staff-signin-session-redirect`. No push, reset, stash or deployment. A commit is not a deployment, so this does not take over the integration owner's role. Before committing, review untracked files for secrets and do not commit credential material.
- (b) A read-only Tally lookup of the packing ledger, then a written implementation proposal for packing charges.

**Files this agent will edit:** git metadata (the commit), append-only notes here and in the rollout record, and its own cutover plan. It will **not** edit `desktop-connector/economics.ps1`, which is reserved for Claude RC, or the policy JSON. The packing change goes to the owning agent and integrator as a proposal.

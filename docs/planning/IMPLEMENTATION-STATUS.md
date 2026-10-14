# Implementation status (evidence-based)

**Last source and acceptance review:** 15 Oct 2026 (Asia/Kolkata).
- **Code and git:** latest completed RC code integration `codex/staff-signin-session-redirect` `47ec4c8` ([PR #50](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/pull/50)). Entire released Accounts series, Orders clarity and D-04/D-15 approval controls are merged. Register remains held. The RC is not merged to `main`; production release is not certified.
- **Acceptance:** Worker `472307e5-1938-4f7a-94bf-2ce7a317d57d` runs frozen source `955da0a6dbc64529a330090af92fb3786de4682d` (PR #50), independently at 100%; rollback `9ee38923-9294-4991-ada1-f3a8c14686a9`. Four Accounts series migrations match reviewed hashes; history 66, latest `20261014181925`. Orders Edge v13 source independently matches; Sync v4 unchanged. Financial/order data preserved. Owner-approved Sales→Management testing for Nikitesh includes an audited role change and one invitation, then fictitious contact/visit/rating activity; these are explicit test changes, not an unchanged-business claim. Real Administrator phone class note/no chip/fit verified. Thirteen hosted access/asset checks pass and email delivery gate restored false. [Release evidence](../HANDOVER-ACCOUNTS-SERIES-20261014.md). Management/erasure acceptance is still being recorded; production and financial/source gates remain open.
- **Production:** recorded migration count is 103, matching `main`. **The deployed commit is unverified** ([PRODUCTION-PILOT-2026-09.md](../PRODUCTION-PILOT-2026-09.md) records public v55 from PR #36, 3 Oct).
- **Pilot:** **HOLD** (same file, lines 51 and 63).
- **Original documentation audit:** did not inspect CI runs or the live database. Acceptance evidence above comes from the integration owner's readback, not that audit.
- **Completed RC checks:** [PR #50 exact-head CI](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/actions/runs/38612190450) passed full SQL replay, 1,368 units, static/build/connector checks, 36 general / 485 staff (+ seven intended device skips) / 20 offline browsers, dependency audit and 21 contracts. These checks do not close the production pilot or financial/source gates.

**Rules for this file:**
- A document doesn't prove a feature exists.
- Passing unit tests don't prove office acceptance.
- An unmerged branch isn't released.

**Status labels:**
- IMPLEMENTED AND VERIFIED: **none yet**; requires production pilot acceptance.
- IMPLEMENTED BUT NOT VERIFIED
- PARTIALLY IMPLEMENTED
- APPROVED DESIGN ONLY
- PROPOSED / NOT APPROVED
- DEFERRED
- SUPERSEDED

## Operational core

| Capability | Status | Evidence |
| --- | --- | --- |
| Order capture, edit, approval, attention queues, admin cancel, activity log | IMPLEMENTED BUT NOT VERIFIED | main migrations `20260830…`–`20260911…`; `components/order-workspace.tsx`; local SQL replay suites |
| Tally customer/product lookup (ledger identity) | IMPLEMENTED BUT NOT VERIFIED | `20260831123500_sync_tally_customer_ledgers.sql`, lazy customer directory |
| Billing hand-off, invoice identity match, billing review | IMPLEMENTED BUT NOT VERIFIED | `20260903…invoices`, `20260908182500_billing_reconciliation_review.sql`, split invoices |
| Invoice **quantity** reconciliation (REQ-11) | APPROVED DESIGN ONLY | REQUIREMENTS REQ-11; ROADMAP M3 "local next-release work" |
| Picking/packing, dispatch, delivery, delivery exceptions | IMPLEMENTED BUT NOT VERIFIED | `20260901…fulfilment`, `20260910…delivery_attention_queue` |
| Roles: combined role sets, row scope | IMPLEMENTED BUT NOT VERIFIED | `20261004…`, `20261005…`; `supabase/tests/combined_role_*.sql` |
| Customer pricing engine, price book, group margin, governed approval | IMPLEMENTED BUT NOT VERIFIED | `20260912…`–`20260928…`; [PRICE-BOOK-IMPLEMENTATION-STATUS](../PRICE-BOOK-IMPLEMENTATION-STATUS.md) says "not pilot-ready" |
| Fast ordering: repeat order, keyboard entry, recent customer products | PARTIALLY IMPLEMENTED (acceptance) | PR #46 ranks active products from up to 20 existing recent OMS orders, excluding cancellations; last quantity defaults and keyboard entry verified. This is recent history, not full Tally frequency; staff timing trial remains open |
| Order quantity units, possible-repeat warning, Requirements order navigation | PARTIALLY IMPLEMENTED (acceptance) | PR #49 merged and promoted; [checks and limits](../HANDOVER-ORDERS-CLARITY-20261014.md). Warning uses the selected customer's existing 20-order history and seven-day window; details preserve the draft and legitimate repeats remain permitted. Real Administrator phone unit display and contributing-order navigation verified read-only; positive warning/submission covered by fixtures. Real staff-role workflows remain open |
| Offline PIN-protected drafts, encrypted catalogue, reconnect | PARTIALLY IMPLEMENTED | RC commits of 7 Oct; in acceptance; Android device acceptance open |
| Demand-driven procurement requirements, waiting orders, stock-increase alerts | PARTIALLY IMPLEMENTED | `20261001061531…`, `20261001070000…`, `20261001073000…`; `procurement-requirements.tsx`. PO/GRN references not built; consolidation and arrival-matching depth unverified |
| Order notifications / push | PARTIALLY IMPLEMENTED | RC; phone push dormant (handover log) |
| Equipment installation and commissioning | IMPLEMENTED BUT NOT VERIFIED | `20260902113000_equipment_installations.sql` |
| Service tickets (open/resolve) and the equipment register in the Service screen | IMPLEMENTED BUT NOT VERIFIED | `20260908173500`; RC `b42c633` merged the instrument portfolio into Service |
| Service visits, parts, downtime, PM schedule | DEFERRED | owner parked, 13 Oct; [SERVICE-MILESTONE-4-DESIGN](../SERVICE-MILESTONE-4-DESIGN.md) |
| Receivables (balance only) | PARTIALLY IMPLEMENTED; rest DEFERRED | `20260908193000_customer_tally_balance.sql`; owner deferred, 13 Oct |
| Inventory ledger / FEFO allocation | SUPERSEDED (dormant in DB) | `20260902211000`, `20260902214500`, disabled by `20260903121500`; ADR-0001 |
| Backup restore drill | not evidenced | gate open |

## Intelligence

| Capability | Status | Evidence |
| --- | --- | --- |
| Instrument Economics: placements, investment, attribution, auto purchase cost, GP/recovery, historical instruments | PARTIALLY IMPLEMENTED (acceptance only) | 15 RC migrations `20261007180000`–`20261011010000`; [ROLLOUT-RECORD](../INSTRUMENT-ECONOMICS-ROLLOUT-RECORD.md); pilot ABG. Open: financial sign-off, LDL-C, 11 import exceptions, role sessions |
| Placement policy 24/36/48 months | IMPLEMENTED BUT NOT VERIFIED IN PRODUCTION | D-04/D-15 merged in PR #47 and deployed to acceptance: Management within review band, Administrator beyond it and for policy changes; eligible short-payback placements approve atomically with a frozen baseline. All four command triggers verified in disposable SQL; live Administrator checks are read-only. Separate role sessions, register and production cutover remain gated |
| Reagent leakage cases | PARTIALLY IMPLEMENTED (acceptance only) | `leakage-*` components; Economics "Reagent leakage" tab |
| Complete full-sales Tally coverage (all customers and items) | APPROVED DESIGN ONLY; activation held | [contract reply and observed counts](../FULL-SALES-IMPORT-INTEGRATION-REPLY-20261015.md) chooses one canonical source book with candidate/dependency-bounded Economics rebuild. Native complete totals, unverified amounts, generation-safe coverage and >10,000-line parity/performance replay remain open |
| Market / wallet (pins, divisions, append-only estimates, overview, Market list) | PARTIALLY IMPLEMENTED, **parked** | branch `claude/market-w1` (`2807fd8`); local SQL, unit and browser tests only; needs rework (ADR-0006/0007) |
| Pareto FOCUS engine | APPROVED DESIGN ONLY | wallet-capture §3; only an interim exists on the parked branch |
| CONSTRAINT diagnosis, ACTION (Action Center), LEARNING (outcomes) | APPROVED DESIGN ONLY | spec §§4–8, 15 |
| Strategic account classes, stages, 80% scorecard | PARTIALLY IMPLEMENTED (A/B classes in acceptance; activation held); rest design only | PR #50 ships versioned A/B policy and explicit not-linked/not-available states. False completeness seam prevents class publication; full-sales/financial reconciliation required. Stages/scorecard are separate |
| Power Maps, Social Styles | PARTIALLY IMPLEMENTED (acceptance only) | PR #50: Power Map/Who decides Administrator/Management only; style summary also available to current account owner, raw ratings Management/Administrator only; actual visitor validation and audited erasure. Real staff phone checks recorded in [release evidence](../HANDOVER-ACCOUNTS-SERIES-20261014.md); broader retention policy remains open |
| Account owners/territories, locations and visit coverage | PARTIALLY IMPLEMENTED (acceptance; no production release) | Claude Accounts W1 integrated in PR #48; [release evidence](../HANDOVER-CUSTOMER-ACCOUNTS-20261014.md) includes full SQL replay, two-session conflicts, role/idempotency checks, exact-head CI and acceptance migration/Edge/Worker readback. Real Administrator reads/search/phone scroll verified without business writes; separate staff-role workflows remain open. Mine is a filter; global visibility retained (recommended D-16/D-17 defaults) |
| Contacts and prospects | PARTIALLY IMPLEMENTED (app contacts in acceptance); prospects design only | PR #50 app-only contacts, explicit provenance, versions, governed edits/removal and Administrator erasure. Tally mirror superseded. [person-confirmed customer–Tally link screen](../CUSTOMER-TALLY-LINK-CONFIRMATION-DECISION-20261015.md) approved for separate implementation; no automatic identity mapping |
| Canonical Market Map | APPROVED DESIGN ONLY | spec §26 |
| Command Center / KPI registry | APPROVED DESIGN ONLY | KPI framework `828803b` (unmerged branch) |
| Standalone Tally dashboard and native reconciliation | PARTIALLY IMPLEMENTED (local prototype, untracked) | `standalone/tally-dashboard/` |
| Growth engines (census, principals, tenders, academy…) | PROPOSED / NOT APPROVED (future backlog) | `GROWTH-AND-SCALE-ARCHITECTURE.md` (`bc89efe`) |
| Office-PC / in-house hosting, in-house AI | PROPOSED / NOT APPROVED | `HOSTING-AND-SERVER-MIGRATION.md`; D-06 |
| AI decision automation | DEFERRED | ROADMAP §Explicitly deferred |

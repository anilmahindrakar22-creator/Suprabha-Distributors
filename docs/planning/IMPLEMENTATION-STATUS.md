# Implementation status (evidence-based)

**Last source review:** 14 Oct 2026; latest acceptance release below was independently verified on 13 Oct.
- **Code and git:** latest completed RC integration `codex/staff-signin-session-redirect` `e13c993` ([PR #46](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/pull/46)). D-04/D-15 approval controls are under primary review on `codex/handover-economics-approvals`; the register remains separate. The RC is not merged to `main` and this source status does not certify the production deployment.
- **Acceptance:** Worker `da9b3d61-f785-4147-b422-bc79fd256733` runs frozen source `e353c8fffb2c5763a72c04cfb5c60472f558904c` (PR #46); rollback `0cd18741-fa5b-46a3-8c2a-c240eb714b31`. Requirements migration `20261013100714` matches the reviewed hash; 59 recorded migrations. Existing Administrator requirements/drill-down reads and phone fit passed; anonymous APIs deny access, served assets match the artifact, business fingerprints were preserved. [ROLLOUT-RECORD](../INSTRUMENT-ECONOMICS-ROLLOUT-RECORD.md). Production and financial/Accounts gates remain open.
- **Production:** recorded migration count is 103, matching `main`. **The deployed commit is unverified** ([PRODUCTION-PILOT-2026-09.md](../PRODUCTION-PILOT-2026-09.md) records public v55 from PR #36, 3 Oct).
- **Pilot:** **HOLD** (same file, lines 51 and 63).
- **Original documentation audit:** did not inspect CI runs or the live database. Acceptance evidence above comes from the integration owner's readback, not that audit.
- **Completed RC checks:** PR #45 fixed the inherited recovery-image lint, group-margin fixture calendar and notification-permission fixture. [PR #46 exact-head CI](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/actions/runs/38379641369) passed SQL replay, 1,091 units, static/build/connector checks, 36 general / 372 staff (+ two intended device skips) / 20 offline browser checks and dependency audit. These code checks do not close the production pilot or financial/Accounts gates.

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
| Placement policy 24/36/48 months | IMPLEMENTED BUT NOT VERIFIED IN PRODUCTION | D-04/D-15 approval controls built and under primary integration review: Management within review band, Administrator beyond it and for policy changes; eligible short-payback placements approve atomically with a frozen baseline. Separate register and production cutover remain gated; hosted rollout must be checked in the record |
| Reagent leakage cases | PARTIALLY IMPLEMENTED (acceptance only) | `leakage-*` components; Economics "Reagent leakage" tab |
| Complete full-sales Tally coverage (all customers and items) | APPROVED DESIGN ONLY (owner, 13 Oct) | integration owner's untracked `MARKET-FULL-SALES-IMPORT-PLAN.md`; current connector export includes all customers/items in its configured window, but this does not establish complete historical coverage. Coverage publication and native reconciliation remain open |
| Market / wallet (pins, divisions, append-only estimates, overview, Market list) | PARTIALLY IMPLEMENTED, **parked** | branch `claude/market-w1` (`2807fd8`); local SQL, unit and browser tests only; needs rework (ADR-0006/0007) |
| Pareto FOCUS engine | APPROVED DESIGN ONLY | wallet-capture §3; only an interim exists on the parked branch |
| CONSTRAINT diagnosis, ACTION (Action Center), LEARNING (outcomes) | APPROVED DESIGN ONLY | spec §§4–8, 15 |
| Strategic account classes, stages, 80% scorecard | APPROVED DESIGN ONLY | dominance framework `12a5679` (unmerged branch) |
| Power Maps, Social Styles | APPROVED DESIGN ONLY | `cba7f67` (unmerged branch) |
| Territory/assignment, contacts, prospects, visit log | APPROVED DESIGN ONLY / gaps | see [DOCUMENT-INVENTORY §4](DOCUMENT-INVENTORY.md) |
| Canonical Market Map | APPROVED DESIGN ONLY | spec §26 |
| Command Center / KPI registry | APPROVED DESIGN ONLY | KPI framework `828803b` (unmerged branch) |
| Standalone Tally dashboard and native reconciliation | PARTIALLY IMPLEMENTED (local prototype, untracked) | `standalone/tally-dashboard/` |
| Growth engines (census, principals, tenders, academy…) | PROPOSED / NOT APPROVED (future backlog) | `GROWTH-AND-SCALE-ARCHITECTURE.md` (`bc89efe`) |
| Office-PC / in-house hosting, in-house AI | PROPOSED / NOT APPROVED | `HOSTING-AND-SERVER-MIGRATION.md`; D-06 |
| AI decision automation | DEFERRED | ROADMAP §Explicitly deferred |

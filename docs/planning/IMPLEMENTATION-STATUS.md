# Implementation status (evidence-based)

**Last verified:** 13 Oct 2026, read-only.
- **Code and git:** `main` `3804421` (103 migrations); release candidate (RC) `codex/staff-signin-session-redirect` `9cd36e0` (118 migrations, 62 commits ahead of `main`, **not merged**).
- **Acceptance:** Worker `0cd18741-fa5b-46a3-8c2a-c240eb714b31` runs frozen source `172e56e+7d7cc0d+codex-economics-summary-read` (integration owner readback, 13 Oct). The uncommitted summary-read overrides are captured by exact manifests; this is not a released Git commit. Evidence: `docs/STOCKFLOW-ECONOMICS-SUMMARY-READ-20261013.md` in the integration workspace and [ROLLOUT-RECORD](../INSTRUMENT-ECONOMICS-ROLLOUT-RECORD.md). Production and financial/Accounts gates remain open.
- **Production:** recorded migration count is 103, matching `main`. **The deployed commit is unverified** ([PRODUCTION-PILOT-2026-09.md](../PRODUCTION-PILOT-2026-09.md) records public v55 from PR #36, 3 Oct).
- **Pilot:** **HOLD** (same file, lines 51 and 63).
- **Original documentation audit:** did not inspect CI runs or the live database. Acceptance evidence above comes from the integration owner's readback, not that audit.
- **PR integration check:** [PR #43 CI run](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/actions/runs/38303150980) failed on the inherited recovery-image lint and group-margin SQL regression. Application, SQL and test trees are identical to the base branch. Documentation integration does not close these code/release gates; the locally validated acceptance source includes uncommitted overrides.

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
| Fast ordering: repeat order, keyboard entry | PARTIALLY IMPLEMENTED | `repeatOrder` in `order-workspace.tsx`; `feature/keyboard-order-entry` merged. **Customer-specific frequent products: not found** |
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
| Placement policy 24/36/48 months | PARTIALLY IMPLEMENTED | `stockflow_economic_policy_versions` (versioned); payback status labels only, **no role routing** (ADR-0013) |
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

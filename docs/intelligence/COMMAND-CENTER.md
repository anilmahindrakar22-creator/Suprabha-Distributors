# Management Command Center and KPI registry

**Purpose and scope:** verified management KPIs with definition, source, period, refresh status, calculation version and drill-down. KPIs inform; the [Action Center](ACTION-CENTER.md) decides (spec "decision-first, not dashboard-first").

**Status:**
- APPROVED DESIGN ONLY: source is the [Governed KPI framework](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/blob/839497a/docs/ROADMAP.md) (`828803b`, unmerged branch); see also ROADMAP M6 (main).
- Phase 8 of the [MASTER-ROADMAP](../planning/MASTER-ROADMAP.md).

**Sources:** the above; the dominance framework §Command Center metrics; owner brief §Phase 8.
**Last verified:** 13 Oct 2026.

## 1. Rules
- **Every KPI** carries registry metadata: definition, canonical source, formula/version, period, refresh policy, owner, drill-down.
- **Headline vs diagnostic:** a metric is headline only if it changes a management decision.
- **Management objective:** Wallet Share × GP × Cash Conversion × Capital Efficiency. Growth that destroys margin, cash or capital return is never shown as success.
- **Nothing fabricated:** no invented market size, wallet or inventory value. Unknown lowers confidence and never becomes zero. Stale Tally data is labelled stale.
- **Composite scores** (e.g. Account Health 0–100) show their components and are off until calibrated (ADR-0014).
- **No parallel reporting store:** the Command Center is never a manually maintained reporting database.

## 2. Headline set (proposed by the KPI framework; each enabled only when its data is verified)

| Group | KPIs | Data prerequisite |
| --- | --- | --- |
| Market leadership | A+B wallet, A+B weighted share, net wallet capture ₹, untapped A+B | Phase 5 |
| Profitability/capital | revenue, GP ₹, GP %, GP return on capital | Phases 0–2 |
| Customer/cash | A/B accounts ≥80%, at-risk A/B, receivables ₹, DSO | Phase 5; **receivables deferred** ([D-11](../planning/OPEN-DECISIONS.md)) |
| Attention | reagent/wallet leakage ₹, lost sales from stock-out (governed demand signal only), near-expiry stock ₹, stalled opportunities, critical service cases, 90+ receivables | Phases 1, 3, 5; service PM deferred |

**Also from the owner brief:** daily/monthly sales, orders and delivery exceptions, stock freshness, capital invested/recovered, market coverage, overdue management actions, expected vs actual outcomes.

## 3. Dependencies
- The KPI registry (Management Intelligence).
- Verified source domains.
- Inventory metrics from the Tally snapshot only (ADR-0001).

## 4. Acceptance
- Every displayed KPI resolves to a registry entry with a version.
- Every KPI drills down to records.
- Freshness is visible.
- No KPI is shown before its prerequisite data passes its phase gate.

## 5. Open decisions
D-03 (salesperson scorecard), D-11 (receivables).

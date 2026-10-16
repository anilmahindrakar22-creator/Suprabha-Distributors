# Instrument Economics and Reagent Consumption Intelligence

**Purpose and scope:**
- What each instrument placement earns, and how that recovers the capital invested in it.
- Expected vs actual reagent consumption, and the investigation of shortfalls.
- The four instrument concerns are kept distinct (ADR-0011).

**Status:** PARTIALLY IMPLEMENTED, in acceptance only.
- 15 migrations on the RC: `20261007180000` to `20261011010000`.
- ABG pilot.
- **Open gates:** financial sign-off, LDL-C cost, 11 import exceptions, role sessions.
- Details: [INSTRUMENT-ECONOMICS-ROLLOUT-RECORD](../INSTRUMENT-ECONOMICS-ROLLOUT-RECORD.md), [PRODUCTION-CUTOVER-PLAN](../INSTRUMENT-ECONOMICS-PRODUCTION-CUTOVER-PLAN.md).

**Sources:** [INSTRUMENT-ECONOMICS-AND-REAGENT-LEAKAGE-PLAN](../INSTRUMENT-ECONOMICS-AND-REAGENT-LEAKAGE-PLAN.md) (**authoritative rules**, §§1–12 and dated refinements); [BUILD-STATUS](../INSTRUMENT-ECONOMICS-BUILD-STATUS.md); owner brief §§Phase 2–3.

**Last verified:** 13 Oct 2026.

## 1. The four concerns (ADR-0011, proposed)

| Concern | Domain | Today |
| --- | --- | --- |
| Installation tracking | Orders/Fulfilment | built (`stockflow_equipment_installations`) |
| Installed-base register (canonical asset) | Installed Base | **not unified**: installations and economic targets are separate; historical instruments are registered via economics |
| Investment economics (placements, capital, attribution, recovery, payback) | Instrument Economics | partial (acceptance) |
| Reagent consumption intelligence (expected vs actual, leakage) | Instrument Economics | partial (acceptance) |

## 2. Rules (summary; the plan's text governs)
- **Authority:**
  - Tally owns sales, credits, returns and purchase-cost evidence.
  - Suprabha OS owns assets, placements, mappings, expectations, approvals and actions.
  - Derived actuals are projections over immutable source revisions (plan §1).
- **Identity:** company-scoped source IDs; no fuzzy name matching. Relocation creates a new placement (plan §2).
- **Attribution:** one deterministic engine with explicit precedence. A line is either fully attributed or UNATTRIBUTED with a reason; never a guess (plan §3).
- **Actual GP** = net Tally sale value − attributable Tally purchase cost. Missing cost is COST_UNAVAILABLE, never zero or today's rate. FOC is zero revenue at actual cost (plan §4).
- **Recovery and payback:**
  - an append-only economic event ledger;
  - recovery = verified GP + approved contributions;
  - capital remaining is shown signed;
  - a forecast appears only with sufficient positive run-rate (plan §5).
- **Cost separation:** acquisition cost, selling price and placement investment are separate.
- **Placement policy (versioned seed):**

  | Payback | Status |
  | --- | --- |
  | ≤ 24 months | approved automatically (D-15; capital must be recorded) |
  | 25–36 months | Management approves |
  | 37–48 months | Administrator approves (D-04) |
  | > 48 months | blocked |

  - **Implementation:** administrator routing (D-04) and automatic approval (D-15) are built on the released `claude/auto-approval` stack and under primary integration review. Automatic approval requires an open proposed placement, recorded positive net investment and a valid expected-GP baseline; groups stay manual. Hosted/production status must be checked in the rollout record; an integrated branch does not certify the production cutover. [D-15](../planning/OPEN-DECISIONS.md), [design](../INSTRUMENT-AUTO-APPROVAL-DESIGN.md).
- **No complex accounting in V1:** no depreciation, NPV or IRR (owner brief).
- **Leakage (plan §6):**
  - consumption-based vs commercial-expectation tiers;
  - a supply proxy, flagged as such;
  - shortfall valued as an *opportunity*, never ledger GP;
  - causes classified with evidence: lower volume, competitor (**only with evidence**), downtime, service, shortage, pricing, contract, FOC, data, substitution, unknown;
  - a case workflow with owner, due date and outcome.

## 3. Dependencies
- Tally source vouchers, which need the **full-sales export** for portfolio-wide consumption.
- Installed Base unification (Phase 2).
- Pricing (expected prices).
- Commercial Intelligence consumes the results: RECOVER/DEFEND opportunities, INSTRUMENT constraint evidence.

## 4. Acceptance (Phase 2/3 gates; detail in [RELEASE-GATES](../planning/RELEASE-GATES.md))
- Accounts signs off the pilot figures.
- Import exceptions are classified or explicitly accepted.
- The LDL-C master is corrected in Tally.
- Separate Accounts and Sales/Operations role sessions are verified.
- Approval routing matches the decided tier owner.
- Attribution totals reconcile: attributed + unattributed + excluded + quarantined = source.

## 5. Open decisions
D-04 (director tier); D-02 (Capital Priority Score).

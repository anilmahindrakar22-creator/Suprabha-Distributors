# Suprabha 80: profitable wallet capture, Pareto FOCUS and the decision engines

**Purpose and scope:** profitable wallet capture across strategic accounts. Covers wallet, account classes, stages, Pareto focus and the four engines. Screens are in [ACTION-CENTER](ACTION-CENTER.md) and [MARKET-MAPS](MARKET-MAPS.md); KPIs are in [COMMAND-CENTER](COMMAND-CENTER.md).

**Status:**
- APPROVED DESIGN ONLY.
- A partial, parked build sits on `claude/market-w1` (pins, division estimates, overview); it needs rework to ADR-0006 and ADR-0007.
- Build timing is Phase 5 of the [MASTER-ROADMAP](../planning/MASTER-ROADMAP.md).

**Sources:**
- [SUPRABHA80-PROFITABLE-WALLET-CAPTURE](../SUPRABHA80-PROFITABLE-WALLET-CAPTURE.md) §§1–17;
- [SUPRABHA80-UI-FUNCTIONAL-TECHNICAL-SPEC](../SUPRABHA80-UI-FUNCTIONAL-TECHNICAL-SPEC.md) §§1–25;
- [Strategic Account Dominance Framework](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/blob/839497a/docs/ROADMAP.md) (`12a5679`);
- owner directives, 13 Oct 2026.

**Last verified:** 13 Oct 2026.

## 1. Objective
- **Destination:** at least 80% wallet share in **targeted** A/B accounts, *where commercially rational*.
- **Guardrails:** subject to minimum acceptable GP, cash conversion and return on capital.
- **Not:** turnover maximisation, and no assumption of an exact 80/20 distribution.

## 2. Approved decisions
ADR-0003 (pricing authority), ADR-0006 (Pareto), ADR-0007 (wallet model), ADR-0012 (stage ≠ action, proposed) and ADR-0014 (scoring, proposed).

## 3. Definitions (single source)

| Term | Definition | Source |
| --- | --- | --- |
| Addressable wallet | governed estimate of a customer's monthly IVD spend, from an account snapshot plus an optional division split | ADR-0007 |
| Suprabha revenue | trailing 3-month average net Tally sales for the customer | dominance framework |
| Wallet share | revenue / wallet × 100 (only when a wallet estimate exists) | dominance framework |
| Untapped wallet | max(wallet − revenue, 0) | same |
| Capture gap to 80% | max(0.8 × wallet − revenue, 0) | same |
| Account class | A ≈ ≥ ₹2 L/month wallet; B ≈ ₹75 k–2 L. Versioned policy; C open ([D-13](../planning/OPEN-DECISIONS.md)) | same |
| Account stage | Conquest <25%, Capture 25–<50%, Grow 50–<80%, Defend ≥80% (versioned) | same; ADR-0012 |
| Divisions | Biochemistry, Haematology, Immunoassay, Molecular, Microbiology, Rapid, Coagulation, Electrolytes, Others (+HbA1c open, [D-01](../planning/OPEN-DECISIONS.md)) | ADR-0007 |
| Focus band | policy share of opportunity that defines the focus set (default 80%), computed from data | ADR-0006 |

## 4. The four engines (logical, inside Commercial Intelligence)
1. **FOCUS:** Pareto at four levels.
   - L1 accounts, by expected absolute GP opportunity.
   - L2 inside an account, by division or product gap.
   - L3 defence, by current GP at risk.
   - L4 actions, by expected risk-adjusted gain per unit of capital and effort.
   - Show the base and the confidence. Never force 80/20. NO_ACTION is valid.
2. **CONSTRAINT:** one primary binding constraint per opportunity: PRICE, PORTFOLIO, INSTRUMENT, SERVICE, RELATIONSHIP (evidence from [POWER-MAPS](POWER-MAPS.md)), CREDIT, AVAILABILITY, CLINICAL, CONTRACT_TENDER, COMPETITOR_LOCK_IN, UNKNOWN.
   - UNKNOWN leads to investigation, not a discount (spec §6).
3. **ACTION:** ATTACK, GROW, DEFEND, RECOVER, COLLECT *(disabled until receivables, [D-11](../planning/OPEN-DECISIONS.md))*, NO_ACTION.
   - Each carries an expected-value card (§5).
   - Price actions hand off to the Pricing Engine through `strategic_price_link` (ADR-0003).
4. **LEARNING:** append-only outcomes compare expected against actual for revenue, GP, GP%, share, cash and working capital.
   - A failed concession is surfaced to Pricing for review. It never becomes a silent new normal (spec §8).

## 4a. Account economics and defence (wallet-capture §§7–8)
- **Optimise the relationship, not one SKU:** Wallet capture × absolute GP × cash conversion × capital efficiency × retention value. This is a decision framework, not an automatic-discount formula.
- **Defence is part of growth:** protecting existing profitable wallet (DEFEND/RECOVER) can outrank new capture. GP protected is a first-class outcome (FR-14).

## 5. Recommendation card (seven questions; [01-PRINCIPLES §4](../architecture/01-PRINCIPLES.md))
Why it matters · evidence (source, freshness) · binding constraint · recommended action · revenue, GP, capital, risk · who acts and by when · how and when it's measured.

## 6. Functional requirements
- **Carried verbatim:** spec FR-01–FR-18.
- **Additions, traced to the dominance framework:**
  - A accounts need a management-visible account plan, a full Power Map and frequent review. B accounts need a structured plan and key stakeholders.
  - An 80% Account Scorecard per A/B account (the fields listed in the framework).
  - Estimate changes are audited, so share can't be inflated by cutting the denominator.
  - Unknown estimates show as unknown, never zero.

## 7. Non-functional requirements
- Spec §16: Action Center first useful render ≤ 2 s warm; drawer ≤ 500 ms.
- Recalculation is asynchronous and shows freshness.

## 8. Ownership and dependencies
- **Owner:** Commercial Intelligence domain.
- **Depends on:**
  - full-sales Tally export (Tally Integration);
  - customer contacts, geography and assignment (Phase 4);
  - Instrument Economics for installed-base and placement evidence;
  - Pricing for price actions.

## 9. Acceptance criteria (Phase 5 gate)
- Wallet share and untapped values reconcile with Tally revenue for a sample of accounts.
- The focus set is reproducible from a stored score snapshot and policy version.
- No recommendation lacks a constraint or an EV card field without showing it as missing.
- Price actions create only a pricing-review link.
- Outcomes are recorded for every approved action whose evaluation window has matured.

## 10. Open decisions
D-01, D-02, D-11, D-12, D-13 ([OPEN-DECISIONS](../planning/OPEN-DECISIONS.md)).

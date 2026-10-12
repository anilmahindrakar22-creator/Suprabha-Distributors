# Action Center ("Today")

**Purpose and scope:** the decision-first landing screen. It shows the smallest set of actions that accounts for most of the expected risk-adjusted economic gain, with each action's execution and outcome review.

**Status:**
- APPROVED DESIGN ONLY; nothing is built.
- Phase 5 (management queue) and Phase 8 (role views) of the [MASTER-ROADMAP](../planning/MASTER-ROADMAP.md).

**Sources:**
- spec §4 (Management Action Center), §6 (Diagnosis), §7 (Execution), §8 (Outcome review), §9 (Coverage);
- [OPERATING-MODEL-ADOPTION §1–3, §7](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/blob/839497a/docs/OPERATING-MODEL-ADOPTION.md) (role "Today" views, deterministic next best action, exception-driven management, cadence);
- owner rule: build only what drives a decision.

**Last verified:** 13 Oct 2026.

## 1. Requirements
- **Ranked queue** (spec §4 columns): rank, action type, account, division/opportunity, why now, constraint, expected revenue/GP, capital, effort, confidence, owner, due, state, next action.
  - Default sort is the versioned ranking policy, not revenue.
- **Decision drawer:** the seven-question card ([01-PRINCIPLES §4](../architecture/01-PRINCIPLES.md)), plus score drivers, evidence, pricing link and audit trail.
  - Actions: approve, modify, assign, hold, reject with reason, investigate, NO_ACTION with reason.
  - No bulk approval of commercial commitments.
- **Action lifecycle** (server-enforced): PROPOSED → APPROVED → IN_PROGRESS → OUTCOME_DUE → COMPLETED/MEASURED.
  - Alternatives: REJECTED, ON_HOLD, STOPPED, NO_ACTION.
  - Expected economics are frozen at approval.
  - A material change means re-approval.
- **Outcome review:** baseline / expected / actual / variance for revenue, GP, GP%, share, cash and working capital. Each outcome ends in continue, modify, stop or escalate.
- **Role "Today" views** (operating model):
  - management: material exceptions only;
  - sales: assigned accounts' actions;
  - order desk/operations, accounts, service: their exceptions.
- **Recommendations:** deterministic, explainable, versioned and auditable. AI is deferred.

## 2. Non-functional
First useful render ≤ 2 s warm; drawer ≤ 500 ms; filtering ≤ 200 ms (spec §16).

## 3. Dependencies
- Phase 5 engines (opportunities, constraints, actions, outcomes, scoring).
- Phase 4 assignment (owners and row scope).
- Pricing link.

## 4. Acceptance criteria
- Every row answers the seven questions or shows what's missing.
- State transitions are rejected when not allowed.
- An idempotent approval never creates duplicates.
- Stale approval → `PT409`.
- Outcomes are due when their windows mature.

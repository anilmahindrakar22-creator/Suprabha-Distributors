# Canonical Market Map

**Purpose and scope:** a geographic **decision interface** over authoritative data. It is never a system of record (ADR-0004).

**Status:**
- APPROVED DESIGN ONLY (spec §26, on `main`).
- Pin storage exists only on the parked branch `claude/market-w1`.
- Phase 7 of the [MASTER-ROADMAP](../planning/MASTER-ROADMAP.md).

**Sources:**
- [SUPRABHA80-UI-FUNCTIONAL-TECHNICAL-SPEC §26](../SUPRABHA80-UI-FUNCTIONAL-TECHNICAL-SPEC.md) (canonical);
- `cba7f67` §Territory (its modes are superseded; its fields and filters are kept);
- [SUPRABHA80-MARKET-MAP-V1-DESIGN §13](../SUPRABHA80-MARKET-MAP-V1-DESIGN.md) (the gap analysis);
- owner brief §Phase 7 and §Routing distinction.

**Last verified:** 13 Oct 2026.

## 1. Modes (one map, one query, one decision drawer)

| Mode | Question | Decision it drives |
| --- | --- | --- |
| **WALLET** | Where is the money? | which towns and accounts to target (untapped GP, share) |
| **OPPORTUNITY** | Where is profitable business we can capture or protect? | where to attack, defend or cross-sell (installed base, constraints) |
| **ACTION** | Where should our people act? | this week's visits and actions by owner and due date |
| **COVERAGE** | Where is our information incomplete or unreliable? | whose data to collect (no location, stale or low-confidence wallet, UNKNOWN constraint, no known decision maker) |

- **Shared layers and filters:** customer, installed equipment, territory, diagnostic division, salesperson, commercial constraint, account class, revenue/GP, wallet share, opportunity value, confidence.
- **List and map are projections of the same records.** A marker opens the same business object as the matching list row (MAP-FR-07).

## 2. Inputs (all canonical; nothing duplicated)

| Input | Owner | State |
| --- | --- | --- |
| Customer geography: exact pin, or **town-level** shown only as a town aggregate (never as an invented pin) | Customer (`customer_location`) | design; storage prototype on `market-w1` |
| Installed equipment overlay | Installed Base | data exists (installations, economic targets) |
| Territory / salesperson | Customer (`customer_assignment`) | **missing** |
| Wallet, opportunity, action, constraint, confidence | Commercial Intelligence | design |
| Relationship badge ("decider unknown") | Power Map | design |

## 3. Routing (ADR-0015)
- **Commercial visit planning:** opportunity value, urgency, relationship obligations, salesperson time.
- **Delivery routing:** delivery destinations, dispatch commitments, transport mode, cold chain.
- **Separate planners, never one objective.** Both advisory; neither reassigns work silently (MAP-FR-12).

## 4. Requirements
- **Functional:** MAP-FR-01–12 (spec §26.9), verbatim.
- **Technical (spec §26.10):**
  - one map component behind a provider adapter (Leaflet with OSM tiles was approved by the owner on 12 Oct; it is a new dependency and needs a CSP change);
  - viewport fetch;
  - clustering and town aggregation;
  - a geographic read model with `calculated_at` and source watermark;
  - failures never block transactions.
- **Security:** commercial fields go only through server-side role and row checks.

## 5. Dependencies
- Phase 4: geography and assignment.
- Phase 5: wallet, opportunities and actions.
- Phase 6 (optional): relationship layer.
- Full-sales Tally export.

## 6. Acceptance criteria
- For the same filter, list and map return identical records.
- No customer pin is invented; town aggregates are labelled.
- The Coverage queues match the data-quality rules.
- The map shows its freshness.
- Visit and delivery planners share no objective.

## 7. Open decisions
D-06 affects tile hosting if self-hosting is chosen.

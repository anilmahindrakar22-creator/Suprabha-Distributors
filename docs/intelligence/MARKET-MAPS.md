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

## 8. Conformance review of the v1 build (Claude with advisor second opinion, 31 Oct 2026)
**Status update.** The "parked on `market-w1`" note above is out of date. On train `claude/train-20261113`:
- pins (`stockflow_customer_locations`) are used live;
- the map and lab sheet are built (`CUSTOMER-MAP-DESIGN-20261030.md`);
- PIN aggregates are designed (`PIN-PLACEMENT-DESIGN-20261031.md`);
- Place on map and check-in are designed (`MAP-PLACE-AND-CHECKIN-DESIGN-20261031.md`).

### Matches the spec
- **No invented pins.** Town and PIN levels are labelled aggregates (§2, MAP-FR-10), and missing geography stays visible as "Not on map" (MAP-FR-09).
- **Coordinates come only from Customer geography,** written through the existing location command (MAP-FR-04/05, ADR-0004).
- **Order and Plan** go through normal domain commands (MAP-FR-11).
- **Financial fields** are role-shaped server-side, and the gateway checks roles.
- **Lab visibility matches Accounts:** the Accounts gateway also allows `scope=all` for sales.
- **Aggregates drill down** to the exact account rows (MAP-FR-08, PIN list).

### Fixed in the PIN gateway package
- **Freshness (MAP-FR-09, §6):**
  - the map returns `calculatedAt`, plus the wallet `asOf` and certified flag;
  - the sheet passes wallet `confidence` and `asOf` for financial roles.

  The UI shows them in the PIN UI package.

### Recorded v1 deviations (not built yet, by the owner's "Dont over optimise")
- **MAP-FR-01/02:** the chips (Wallet, Actions, Orders, No data) filter pins and don't switch modes. OPPORTUNITY mode is not built, and Orders is an extra filter.
- **MAP-FR-03:** no territory, salesperson or division filters on the map yet; Accounts has them.
- **§6, list and map parity:** the map chips and the Accounts list filters differ.
- **MAP-FR-07:** a pin opens the lab sheet. It links to Accounts (Contacts) and Wallet (Plan), but it isn't the Accounts record itself.
- **§4:** there's no stored geographic read model with a watermark. The gateway computes live, which is acceptable at 463 labs now that freshness is returned. Revisit if latency exceeds the budget.
- **Limits:** the 500-pin and 500-group limits have no `truncated` flag yet.
- **CSP:** the spec assumes one. Production currently sends no Content-Security-Policy header, so tiles load. This is a security-hardening item for the integration owner, outside this package.

### Owner decision pending
Sales and operations see marker **colours** that are partly wallet-derived (green means share ≥ 80%; a larger marker means a Focus lab), but never figures (`CUSTOMER-MAP-DESIGN` §82). The tone function keeps this switchable in one place.

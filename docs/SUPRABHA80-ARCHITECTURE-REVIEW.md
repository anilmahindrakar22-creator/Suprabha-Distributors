# Suprabha 80: full architecture review (Claude, 13 Oct 2026)

Covers `SUPRABHA80-PROFITABLE-WALLET-CAPTURE.md` (direction), `SUPRABHA80-UI-FUNCTIONAL-TECHNICAL-SPEC.md` (approved spec) and what is built on `claude/market-w1`. The owner asked for Pareto, power maps and maps to be planned as one system.

**Owner rule applied throughout:** every element must drive a decision or give strategic guidance. Each part below names its decision.

## 1. The one decision chain
The spec's chain runs:

> **Focus** (Pareto) → **Wallet** → **Constraint** → **Action** → **Economics/Capital** → **Pricing** (hand-off only) → **Owner/Due** → **Outcome** → **Learning**

Everything (lists, maps, power maps) is a view on that chain, not a separate product. There is one Commercial Intelligence module with four logical engines: Focus, Constraint, Action and Learning.

## 2. Pareto, applied at four levels (spec Engine A)

| Level | Question | Ranking basis | Decision | Status |
| --- | --- | --- | --- | --- |
| **L1 Accounts** | Which few customers deserve attention? | Expected **absolute GP opportunity** (untapped wallet × expected GP%). Fallback: untapped wallet. Never current sales alone | Who gets management time | Built on *estimated wallet* (interim). Needs W2b plus GP |
| **L2 Inside an account** | Which 1–2 divisions or products hold most of this customer's gap? | Untapped per division | What to pitch | Not built. Belongs in the Account workspace |
| **L3 Defence** | Which existing accounts carry most of our current GP? | Current absolute GP; flag falling share or a lost champion | Whom to protect first | Not built. Needs W2b plus GP |
| **L4 Actions** | Which few actions produce most of the expected gain? | Risk-adjusted expected gain per unit of capital and effort (bands, not false precision) | What to do this week | Not built. This is the Action Center |

**Rules from the spec that our V1 must adopt:**
- **No hard-coded 80/20.** Compute the real concentration, e.g. "12 accounts = 80%" or "9 accounts = 70%". The focus band is a **versioned management policy**, default 80%. V1 hard-codes 80%; that changes in the Focus-engine slice.
- **Show the base and the confidence**, e.g. "based on 9 of 140 estimated". Already done.
- **Rank by economic potential, not turnover.**
- **NO_ACTION is valid.** The long tail is shown only on request.

## 3. Power map: who decides, per account (new; fills the spec's RELATIONSHIP gap)
The spec lists RELATIONSHIP as a primary constraint ("doctor/owner/lab relationship requires intervention") but has nowhere to record the relationship. A **power map** is that evidence.

**Per account, per person:**

| Field | Values |
| --- | --- |
| Role | Owner/MD, Pathologist/Lab director, Lab manager, Purchase, Biomedical engineer, Technician, Other |
| Influence on purchase | Decides, Strong influence, Some influence, User only |
| Stance toward Suprabha | Champion, Supporter, Neutral, Sceptic, Blocker, Unknown |
| Our relationship | Strong, Some, None |
| Our relationship owner | a member |
| Last meaningful contact | date |
| Note | short |

**View:** one compact grid per account, influence (rows) × stance (columns). It is **not decorative**: its cells drive actions:
- **High influence and Sceptic/Blocker/Unknown** → "meet the decision maker" (Constraint: RELATIONSHIP).
- **The only Champion is a User-only person** → "we have no access to the decider".
- **No contact in 90 days with a Decides person on a focus account** → a defence risk.
- **Coverage queue:** focus accounts with **no known decision maker**.

**Privacy (India DPDP Act 2023), because this is personal data about third parties:**
- Purpose: B2B relationship management only.
- Minimal fields: business role and business contact only; no personal or health details; no opinions beyond business stance.
- Visible to administrators and management, plus the assigned owner once assignment exists.
- **Erasure on request** is handled by redacting the personal fields, keeping an audit stub. It is never silently deleted, and redaction is never blocked.
- Records are reviewed for staleness.

**Domain placement:**
- The *person* (name, role, business contact) belongs to the **Customer domain** (a `customer_contacts` table), so contacts aren't duplicated.
- *Influence, stance and relationship* are **Commercial Intelligence** assessments. They are effective-dated and append-only, like wallet estimates, so history shows how a relationship changed.

## 4. Maps (spec §26; detail in `SUPRABHA80-MARKET-MAP-V1-DESIGN.md` §13)
There is one map with four modes over the same records as the lists:

| Mode | Decision |
| --- | --- |
| **Wallet** | which towns to target, from untapped GP by town |
| **Opportunity** | where to win or defend: installed-base overlay, constraints |
| **Action** | where people should go this week |
| **Coverage** | where we're blind |

**Power maps connect to the geographic map:**
- An account marker shows a small relationship badge, e.g. "decider: unknown".
- Coverage mode includes "focus accounts without a known decision maker".
- Action mode later suggests visit clusters that meet decision makers on focus accounts.

**Inputs the map needs:**
- **Customer geography:** we have pins plus a town fallback, shown as town aggregates only.
- **Installed base:** we have it.
- **Territory/assignment:** **missing**.

## 5. Data model: spec entities compared with ours

| Spec entity | Ours | Gap |
| --- | --- | --- |
| `account_wallet_snapshot` (account total) | none; totals come from division estimates | Add a total-only snapshot; the division split becomes optional, and differences are shown |
| `account_wallet_division` | `stockflow_wallet_estimates` (append-only, per division) | Add `evidence`, `source_period` and a verification step (FR-02) |
| divisions | `stockflow_wallet_divisions` | Align to the spec list (approved 13 Oct; migration pending) |
| customer geography | `stockflow_customer_locations` | Town fallback; restore pin entry in the Account workspace |
| *(none)* | *(none)* | **New:** `customer_contacts` (Customer domain), and `stakeholder_assessments` (CI, append-only) |
| *(none)* | *(none)* | **New:** prospect customers in the Customer domain (no Tally ledger, linked on first invoice) |
| *(none)* | *(none)* | **New:** customer owner/territory assignment (Customer domain) |
| `wallet_opportunity`, `opportunity_constraint` | — | Later (P7) |
| `commercial_action`, `strategic_price_link`, `action_outcome` | — | Later (P8–P9) |
| `opportunity_score_snapshot` + policy versions | — | With the Focus engine (P2); includes the focus band |

## 6. Build order (each step's decision value is stated)

| # | Slice | Decision it enables | Depends on |
| --- | --- | --- | --- |
| P0 | **W2b: our Tally sales → share and untapped** | whether a gap is real | the integration chat's full-sales export (**gate**) |
| P1 | **Account workspace:** division matrix (sales, share, untapped, GP), in-account Pareto (L2), total-only estimate, evidence and verification | what to pitch to this customer | P0 |
| P2 | **Focus engine v1:** policy-versioned focus band; L1 by untapped GP; L3 defence list; score snapshots with drivers shown | which customers get attention; which to protect | P0, P1 |
| P3 | **Power map** per account (contacts + assessments, grid, coverage queue) | whom to meet; RELATIONSHIP evidence | none (can start now) |
| P4 | **Prospects** in the Customer domain | include non-buying labs in the wallet | none (can start now) |
| P5 | **Market map:** town-level Wallet and Coverage, installed-base overlay, relationship badge | which towns to target; where we're blind | P0, P3 optional |
| P6 | **Owner/territory assignment** (Customer domain); sales sees only assigned accounts | who owns which account | none |
| P7 | **Opportunities and constraint diagnosis** (deterministic; UNKNOWN → investigate) | why we aren't winning | P1, P3 |
| P8 | **Action Center as the landing screen**, actions with frozen economics, map Action mode, pricing hand-off links | what to do this week | P2, P6, P7 |
| P9 | **Outcome review and learning**; failed concessions surfaced to Pricing | did it work | P8 |

**Can start now without Tally data:**
- the division-list migration (approved);
- P3 power map;
- P4 prospects;
- P6 assignment.

**Release:** nothing ships until P0 to P2 make the screen decision-grade, and the current release candidate has gone live.

## 7. Non-negotiables carried from the spec
- **Authorities are untouched:** Pricing, Tally, credit and inventory. Commercial Intelligence only references them.
- **Estimates stay estimates:** never presented as facts. Missing stays missing.
- **Every recommendation shows its drivers;** no opaque scores; deterministic before any AI.
- **ACID, idempotency, versioning and append-only history** for every material decision. Stale conflicts use `PT409`.
- **Server-side role checks;** commercial data is no-store.

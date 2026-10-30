# Architecture decision records (ADRs)

**Status values:**

| Status | Meaning |
| --- | --- |
| **Accepted** | backed by an approved source document or an explicit owner directive (cited) |
| **Proposed** | awaiting owner approval |
| **Decision required** | see [OPEN-DECISIONS](../planning/OPEN-DECISIONS.md) |

Superseded content is named, never silently deleted.
**Last verified:** 13 Oct 2026.

| ADR | Title | Status |
| --- | --- | --- |
| 0001 | Tally owns inventory, accounting and invoices | Accepted |
| 0002 | Modular monolith, one PostgreSQL, gateway-only writes | Accepted |
| 0003 | The Pricing Engine is the only price authority | Accepted |
| 0004 | Canonical Market Map: four decision modes | Accepted |
| 0005 | The Power Map is a relationship model, not a map | Accepted |
| 0006 | Pareto is a FOCUS-engine principle, not a dataset | Accepted |
| 0007 | Wallet model: account snapshot + optional division split | Accepted (division list partly open) |
| 0008 | One Opportunity entity shared by Suprabha 80 and Power Maps | Proposed |
| 0009 | Prospects are Customer-domain accounts | Proposed |
| 0010 | Master roadmap Phases 0–8 replace older orderings | **Accepted** (owner, 13 Oct) |
| 0011 | Instruments: four distinct concerns, one installed-base register | Accepted |
| 0012 | Account stage ≠ action type | Proposed |
| 0013 | Role names in code are canonical | Accepted; director tier = administrator (owner, 13 Oct) |
| 0014 | Deterministic, versioned scoring; no unvalidated weights | Proposed |
| 0015 | Commercial visit planning is separate from delivery routing | Accepted |
| 0016 | Derived data carries provenance; missing ≠ zero | Accepted |
| 0017 | Business conflicts use non-retryable `PT409` | Accepted |
| 0018 | Social Styles and personal data limits | Proposed |

---

## ADR-0001: Tally owns inventory, accounting and invoices
**Status:** Accepted.
**Sources:** [SUPRABHA_OS_ARCHITECTURE §Inventory authority](../SUPRABHA_OS_ARCHITECTURE.md); [REQUIREMENTS §1](../REQUIREMENTS-AND-DELIVERY-PLAN.md); [ROADMAP M2 and §Explicitly deferred](../ROADMAP.md); KPI framework "Inventory intelligence sourced from Tally"; owner brief, 13 Oct.

**Decision:**
- Tally Prime is the only system that records stock, batches, expiry, receipts, allocations, adjustments, accounting and invoices.
- Suprabha OS owns operational orders, workflow and its own business decisions.
- It reads Tally through the connector. It never keeps a stock ledger or a reservation, and never presents advisory stock as booked.

**Consequences:**
- The experimental inventory ledger and FEFO allocation objects (migrations `20260902211000`, `20260902214500`) were disabled by `20260903121500`. They are not routed by the Edge gateway and have no UI. They **remain dormant**, as the architecture doc already allows: "removing them later requires a separately reviewed archival migration".
- **Observed issue:** `20261005054431` still patches `stockflow_inventory_gateway` and `stockflow_allocation_gateway` for role unions. Harmless, but it keeps dead code alive. Timing of removal is [D-05](../planning/OPEN-DECISIONS.md).
- Procurement, PO and GRN visibility *reference* Tally transactions; nothing is created in parallel.
- **Second observed issue:** `stockflow_products` (also from `20260902211000`) is no longer refreshed after the 3 Sep trigger drop, but the price-book reads still join it. Treat it as possibly stale until D-05 decides on a replacement or refresh.

## ADR-0002: Modular monolith, one PostgreSQL, gateway-only writes
**Status:** Accepted. **Sources:** SUPRABHA_OS_ARCHITECTURE; spec §11; ROADMAP guardrails; owner brief.

**Decision:**
- One application and one authoritative PostgreSQL per environment.
- Every mutation goes through a server-side security-definer gateway that runs the role check, idempotency, version check and audit in one transaction.
- Browser code never writes tables.
- No microservices, queues, new languages or AI infrastructure without a documented, measured need (architecture decision rule).

## ADR-0003: The Pricing Engine is the only price authority
**Status:** Accepted. **Sources:** wallet-capture §6; spec FR-06, FR-08, §6 Step 4; owner brief §Pricing.

**Decision:**
- Commercial Intelligence may **recommend or initiate** a pricing review, via a `strategic_price_link` reference.
- It never approves, edits or stores governed prices.
- Low wallet share alone never triggers a discount (FR-06).

## ADR-0004: Canonical Market Map: four decision modes
**Status:** Accepted. **Sources:** spec §26 (it states it "supersedes any earlier proposal that treated Customer, Opportunity, Equipment and Sales Territory as four peer map modes"); owner brief.

**Decision:**
- The modes are WALLET, OPPORTUNITY, ACTION and COVERAGE.
- Customer, installed equipment, territory and salesperson are **entities, layers and filters**.
- List and map are two projections of one query, and both open the same business object.
- The map is never a system of record.

**Superseded:** the map-mode list in [`cba7f67` ROADMAP §Territory](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/blob/cba7f67/docs/ROADMAP.md). Its account-intelligence fields and filters are kept.

## ADR-0005: The Power Map is a relationship model, not a map
**Status:** Accepted. **Sources:** `cba7f67` §Stakeholder Power Map; owner brief §Phase 6.

**Decision:** stakeholders are linked to canonical customer contacts and opportunities. The model records:
- decision roles: Economic buyer/Decision maker, Champion, Influencer, Technical evaluator, User, Gatekeeper, Blocker, Coach;
- formal authority, kept separate from observed influence;
- directional influence relationships with strength;
- support or opposition;
- evidence, confidence and last verification.

It is shown as a graph plus a list view.

**Superseded:** the job-title / 2×2 grid model in [SUPRABHA80-ARCHITECTURE-REVIEW.md](../SUPRABHA80-ARCHITECTURE-REVIEW.md) §3. Job title becomes an ordinary contact attribute.

## ADR-0006: Pareto is a FOCUS-engine principle, not a dataset
**Status:** Accepted. **Sources:** wallet-capture §3; owner brief §Pareto.

**Decision:**
- Concentration is **computed** from the data, never assumed to be 80/20.
- The attention cut-off is a versioned **Focus band** policy, default 80%.
- Ranking is by expected economic opportunity (absolute GP), not turnover.
- Pareto applies at several levels: accounts, inside an account, defence, and actions.
- There is no "Pareto table". Rankings are stored as `opportunity_score_snapshot` rows with policy versions.
- **Naming:** the UI says "Focus band" (attention concentration) and "Wallet-share target" (the per-account 80% destination). The two are never conflated.

**Supersedes:** the fixed-80% interim on branch `claude/market-w1`.

## ADR-0007: Wallet model
**Status:** Accepted. **Sources:** spec FR-02, FR-03; dominance framework §Wallet measurement and §Division-level wallet model; owner approval of the spec division list, 13 Oct.

**Decision:**
- **Account snapshot:** one effective-dated wallet snapshot per account (method, source, confidence, verifier, as-of). The division decomposition is optional, and any unallocated amount is shown explicitly.
- **Suprabha revenue:** the trailing-3-month average from Tally.
- **Formulas:**
  - wallet share = revenue / wallet;
  - untapped = max(wallet − revenue, 0);
  - capture gap to 80% = max(0.8 × wallet − revenue, 0).
- **History:** estimates are append-only; lowering an estimate is audited, so share can't be gamed.
- **Divisions:** Biochemistry, Haematology, Immunoassay, Molecular, Microbiology, Rapid, Coagulation, Electrolytes, Others. **HbA1c is a separate division** (owner, 13 October 2026; [D-01](../planning/OPEN-DECISIONS.md)).

**Supersedes:** the division-only estimates and the Urine-inclusive seed on `claude/market-w1`.

## ADR-0008: One Opportunity entity shared by Suprabha 80 and Power Maps
**Status:** Accepted (owner, 30 Oct 2026), as refined below.

**Context:** `cba7f67` links Power Maps to "CRM opportunity records"; the spec defines `wallet_opportunity`. Two entities would duplicate the master.

**Decision:** a single `opportunity` entity in Commercial Intelligence, with type capture/defend/recover. Stakeholder relevance, constraints, actions and outcomes reference it.

**Refined 30 Oct 2026 (Claude, after building train 2026-11-06; accepted by the owner 30 Oct 2026):**
- **Scope:** an opportunity belongs to one customer and **optionally one wallet division**. Null means the whole lab, so a lab can carry separate opportunities, such as capture Immunoassay and capture Haematology. **At most one open opportunity per (customer, type, division)**.
- **Lifecycle:** open → closed with outcome won, lost or dropped, plus a reason. History is append-only; nothing is edited or deleted.
- **What hangs off it (built):**
  - one binding constraint at a time, with history, graded evidence and facts;
  - at most one open next action;
  - the owner's view (My actions);
  - a Relationship constraint can cite a contact.
- **Provenance:** who opened it, when and why. An `origin` field (manual versus suggested) is added only when the system starts suggesting opportunities.
- **Not yet:** per-opportunity stakeholder relevance on Power Map assessments, and measured outcomes (share before and after).
- **Tables:**
  - `private.stockflow_commercial_opportunities`;
  - `…_opportunity_closures`;
  - `…_constraints`;
  - `…_actions`;
  - `…_action_results`.

**Specification (binding for every slice that touches opportunities):**

1. **Identity and meaning.**
   - **Capture:** win wallet we don't hold.
   - **Defend:** protect wallet we hold that is at risk.
   - **Recover:** win back wallet we held and lost.
   - An opportunity is a **commercial intent at one lab**, optionally narrowed to one wallet division. It is not a sales order, quote or price. It never creates, changes or approves an order, price, credit limit, stock or Tally record.

2. **Invariants** (enforced in SQL, with tests):
   - **I-1:** at most one open opportunity per (customer, type, division-or-whole-lab), under the advisory lock `opportunity:{customer}:{type}:{division|all}`.
   - **I-2:** at most one open action per opportunity, under the lock `opportunity-action:{opportunity}`.
   - **I-3:** an opportunity can't close while an action is open. The closure trigger takes the same lock as I-2, so a concurrent create and close can't both succeed.
   - **I-4:** a constraint or action can be added only to an **open** opportunity.
   - **I-5:** a `price_review` action needs a current `price` constraint whose source is a document or a named person at the lab; never "our view" alone.
   - **I-6:** all five tables are append-only (`no_delete` and `immutable` triggers). A change is a new row: a new constraint supersedes, an end or close row ends. The only permitted update is privacy erasure that nulls free text, by trigger.
   - **I-7:** every write is idempotent (`begin_/finish_stockflow_command`, keys of at least 16 characters; a replay returns the original result; a changed payload under the same key gives 22023) and audited in `private.stockflow_economic_audit`.
   - **I-8:** reads that depend on sales figures fail closed. Counts that need certified Tally coverage (such as the undiagnosed Focus count and Focus without a decision maker) are **null** when coverage isn't certified, never zero.

3. **State model.**
   - **States:**
     - **open** (no closure row);
     - **closed** (a closure row with outcome won, lost or dropped and a reason).
   - **Derived states, not stored:**
     - **diagnosed:** open, with a current constraint that isn't `unknown`;
     - **planned:** open, with an open action;
     - **overdue:** an open action whose due date is before today (IST).
   - **Reopening:** a closed opportunity never reopens. Open a new one for the same scope; the history stays on the old one.
   - The richer lifecycle in the Suprabha 80 plan (QUALIFIED, APPROVED, OUTCOME_DUE, MEASURED and so on) is added only when a slice needs it, as **new append-only event rows**, never as an editable status column.

4. **Authority and visibility.**
   | Who | Can |
   | --- | --- |
   | Administrator, management | Open and close opportunities, record constraints, create and close actions, see wallet figures, Power Maps and the Actions due list |
   | Action owner (active member; sales or operations) | See **only their own** open actions: lab, action, due date, reason category and the route names. Close them with a result, and record the visit when it's a Visit |
   | Everyone else | Nothing (PT403, or 42501 for inactive members) |
   - Owners never see wallet estimates, sales, share, gap, expected gain, constraint facts and evidence, or prices.
   - Operations never sees purchase rates (unchanged).

5. **What may reference an opportunity:** constraints, actions, Power Map stakeholder relevance (future), outcome measurements (future), and pricing-review links (future).
   - **Pricing-review links are reference-only:** an approved price change still goes entirely through the Pricing Engine and its approvals, and the opportunity only records the link.
   - **Nothing may reference an opportunity to bypass** pricing, credit, stock, Tally, audit or ACID controls.

6. **Provenance and confidence.**
   - The opportunity records `opened_by`, `opened_at` and `opened_reason`.
   - Confidence lives on the **constraint**, derived from its evidence source: document = High, a named person at the lab = Medium, our view = Low.
   - When the system starts suggesting opportunities, add `origin` (`manual`, `wallet_gap`, `defend_signal`) and the policy version that produced the suggestion. A suggestion stays a suggestion until a person opens it.

7. **Privacy (D-07).** Opportunities hold business facts only. A cited contact is referenced by id. Erasing a contact nulls the free-text evidence that refers to them (by trigger), and the audit rows remain.

8. **Read models and performance.**
   - All lists are paginated (50 rows) and scoped by role.
   - Per-page reads batch by customer ids (at most 50).
   - Wallet-dependent reads reuse `private.stockflow_wallet_read`; they never duplicate it.
   - No read model caches figures across companies or roles.

9. **Closing outcomes and learning (future, trigger-based).**
   - When a lab has certified coverage for the window before opening and the window after closing, record the share before and after on the closure, and whether the action's expected gain materialised. This is reported, never automatically acted on.
   - A failed price concession must surface for review, not persist silently (Suprabha 80 principle 8).

10. **Change control.**
    - Any new opportunity type, state, outcome or referencing table updates this ADR first.
    - Every new invariant ships with a real-database test, and a race test where two writers can collide.

## ADR-0009: Prospects are Customer-domain accounts
**Status:** Proposed.

**Context:** the brief covers acquisition and competitor displacement; spec FR-01 forbids a duplicate customer master.

**Decision (proposed):**
- A prospect is a Customer-domain account with no Tally ledger yet, marked `prospect`.
- It is linked to its Tally ledger by a person when the first invoice appears.
- Never auto-merged by name.

## ADR-0010: Master roadmap Phases 0–8 replace older orderings
**Status:** Accepted (owner, 13 Oct 2026; D-09). **Sources:** owner brief phases; [MASTER-ROADMAP](../planning/MASTER-ROADMAP.md).

**Decision:**
- Phases 0–8 become the only roadmap.
- ROADMAP M1–M3 and REQUIREMENTS R0–R5 fold into Phase 0/1 hardening.
- M4–M6 map onto Phases 2, 4 and 8.

Three dependency corrections are recorded in the roadmap:
1. the full-sales export moves early;
2. Phase 4 comes before Phase 5;
3. a unified installed-base register comes first in Phase 2.

## ADR-0011: Instruments: four distinct concerns, one register
**Status:** Accepted (owner, 13 Oct 2026; D-14). Design: [INSTALLED-BASE-REGISTER-DESIGN](../INSTALLED-BASE-REGISTER-DESIGN.md); build after the Economics cutover. **Sources:** owner brief §Instruments; economics plan §§1–2; SUPRABHA_OS_ARCHITECTURE §Instruments.

**Decision (accepted):**

| Concern | Owner | Today |
| --- | --- | --- |
| Installation tracking | Orders/Fulfilment | `stockflow_equipment_installations` |
| **Installed-base register** (the canonical asset: model, serial, site, ownership/commercial model, warranty/contract, service owner) | Installed Base | *missing as a unified register* |
| Instrument investment economics (placements, capital, attribution, recovery) | Instrument Economics | economic targets/placements |
| Reagent consumption intelligence (expected vs actual, leakage) | Instrument Economics | leakage cases |

- Phase 2 unifies installations and economic placements under one register ID, without breaking existing records.
- Acquisition cost, selling price and placement investment stay distinct fields (already enforced in the economics plan §5).

## ADR-0012: Account stage ≠ action type
**Status:** Proposed. **Sources:** dominance framework (stages); spec §4 (action types).

**Decision (proposed):**
- **Stage** is a computed account state: Conquest <25%, Capture 25–<50%, Grow 50–<80%, Defend ≥80%. Thresholds are versioned.
- **Action type** is the chosen intervention: ATTACK, GROW, DEFEND, RECOVER, COLLECT or NO_ACTION.
- The stage suggests, but never fixes, the action. **COLLECT stays disabled** until governed receivables exist.

## ADR-0013: Role names in code are canonical
**Status:** Accepted; director-tier approval maps to administrator (owner, 13 October 2026; D-04).
- **Evidence:** `lib/user-types.ts` defines `administrator`, `sales`, `operations`, `warehouse`, `accounts`, `management` and `viewer`, with combined role sets and row scope (migrations `20261004…`, `20261005…`).
- **Mapping:** the architecture doc's "Order desk", "Service" and "Customer" are role *concepts*, mapped as Order desk → operations, Service → operations (no service role yet), Customer → future.
- **Approved mapping:** the director tier uses `administrator`; no director role is added. Payback status labels (`director_exception_required`) still need this routing implemented and verified ([D-04](../planning/OPEN-DECISIONS.md)).

## ADR-0014: Deterministic, versioned scoring
**Status:** Proposed. **Sources:** spec §15 ("no false mathematical precision"); wallet-capture §13; dominance framework (Capital Priority Score weights 35/25/15/10/10/5); the principles Margin of Safety and Expected Value.

**Decision (proposed):**
- V1 ranks by transparent expected-value **bands** with visible drivers, and every score snapshot is reproducible.
- Weighted composites (the Capital Priority Score, the Account Health Score, a salesperson scorecard) are versioned policies, **off by default**. They are switched on only after calibration against recorded outcomes ([D-02](../planning/OPEN-DECISIONS.md), [D-03](../planning/OPEN-DECISIONS.md)).

## ADR-0015: Commercial visit planning is separate from delivery routing
**Status:** Accepted (owner brief §Routing distinction).
- **Visit planning** uses opportunity value, urgency, relationship obligations and salesperson time.
- **Delivery routing** uses destinations, dispatch commitments, transport mode and cold chain.
- The two never share one optimisation objective. Both remain advisory; neither silently reassigns work.

## ADR-0016: Derived data carries provenance; missing ≠ zero
**Status:** Accepted. **Sources:** spec FR-16, §11 (freshness); economics plan §1; KPI framework.

**Decision:**
- Every derived or estimated value exposes source, period, `calculated_at`, confidence and calculation/policy version.
- Unknown is shown as unknown, never as zero.
- Stale snapshots are labelled stale.

## ADR-0017: Business conflicts use non-retryable `PT409`
**Status:** Accepted. **Evidence:** `supabase/tests/non_retryable_business_conflicts.sql` fails the build if any StockFlow function raises `40001`; the gateway maps `PT409` to HTTP 409.

**Decision:** stale versions and racing writes raise `PT409`; `40001` is never used.

## ADR-0018: Social Styles and personal data limits
**Status:** Proposed. **Sources:** `cba7f67` §Social Styles; owner brief §Phase 6; India DPDP Act 2023 (context).

**Decision (proposed):**
- Social Style is an editable, evidence-based **communication aid**, never a psychological diagnosis. It includes a "Not enough information" state, keeps the full questionnaire score distribution, and guides *how* to communicate, never *whether* to act.
- Stakeholder data is limited to business role, business contact and business stance.
- It is visible to administrators and management, plus the assigned account owner once assignment exists.
- An erasure request redacts the personal fields and keeps an audit stub ([D-07](../planning/OPEN-DECISIONS.md)).

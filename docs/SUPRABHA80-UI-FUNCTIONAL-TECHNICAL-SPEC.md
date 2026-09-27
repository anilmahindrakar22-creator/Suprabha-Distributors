# Suprabha 80 — UI, Functional & Technical Requirements

**Status:** Approved future design specification  
**Scope:** Commercial Intelligence / Profitable Wallet Capture  
**Implementation timing:** After Customer Pricing Engine consolidation, integrity testing and office pilot readiness  
**Architecture rule:** Analytical/advisory layer over transactional truth; never a parallel system of record.

## 1. Product objective

Suprabha 80 must turn a large customer market into a very small, explainable action list.

The UI should answer, in order:

1. Where should management focus?
2. What wallet is available?
3. Why are we not capturing it?
4. What action should we take?
5. What will that action cost in capital/time?
6. What economic gain is expected?
7. Does pricing need intervention?
8. Who owns the action and by when?
9. Did the action work?

The default experience is **decision-first, not dashboard-first**.

Core principle:

> Suprabha OS remembers. The intelligence layer explains. Management decides. The transactional domains execute.

## 2. UX principles

1. **Action before analytics.** The landing screen shows the few actions worth attention, not a wall of KPIs.
2. **Progressive disclosure.** Summary first; evidence and calculations on drill-down.
3. **No duplicate entry.** Customer, product, price, cost, revenue, receivable, instrument and order facts come from canonical domains.
4. **Exceptions over forms.** Humans enter only estimates, diagnoses, decisions or evidence not already available.
5. **Explain every recommendation.** A score without its drivers is not acceptable.
6. **Confidence is visible.** Estimated wallet and inferred opportunity are visually distinct from transactional facts.
7. **Economics over vanity metrics.** Absolute GP, cash conversion, capital required and GP protected/gained matter more than revenue alone.
8. **One-click navigation to evidence.** Every important number must expose source period/provenance.
9. **No silent automation.** Strategic price, credit, contract and other governed changes require their authoritative domain workflow.
10. **Desktop-first management UI, responsive for sales review.** Do not make the primary workflow a dense mobile dashboard.

## 3. Information architecture

Primary navigation:

- **Action Center** — ranked management work queue.
- **Accounts** — customer wallet and opportunity workspace.
- **Opportunities** — all capture/defense opportunities with filters.
- **Outcomes** — actions due for measurement and historical results.
- **Coverage** — data confidence/completeness and stale wallet estimates.
- **Policy** — scoring/version information for authorized management/admin users.

Pricing remains in the Pricing domain. Suprabha 80 links to it; it does not duplicate a pricing workspace.

## 4. Screen A — Management Action Center

### Purpose

The default landing page. Show the smallest set of actions responsible for the largest share of expected risk-adjusted economic gain.

### Header

Compact summary strip only:

- Priority actions
- Expected monthly GP gain/protected
- Capital required
- Actions overdue
- Outcomes due
- Low-confidence opportunities requiring investigation

No decorative KPI wall.

### Primary ranked table

Columns:

- Rank
- Action type: ATTACK / GROW / DEFEND / RECOVER / COLLECT / NO_ACTION
- Account
- Division / opportunity
- Why now
- Primary constraint
- Expected revenue/wallet gain
- Expected GP gain or GP protected
- Capital required
- Effort
- Confidence
- Owner
- Due date
- State
- Next action

Default sort is the current deterministic opportunity/action ranking policy, not raw revenue.

### Row behavior

Selecting a row opens a right-side decision drawer without losing queue context.

Drawer shows:

- one-sentence recommendation;
- expected economics;
- score components;
- wallet evidence;
- diagnosed constraint and evidence;
- proposed action;
- pricing link if relevant;
- capital/effort;
- confidence and uncertainty;
- owner/due date;
- approval requirement;
- audit/activity timeline.

Actions:

- Approve action
- Modify proposal
- Assign
- Put on hold
- Reject with reason
- Mark investigation required
- Open account
- Open governed pricing decision
- Choose NO_ACTION with reason

Bulk action is allowed only for safe administrative operations such as assignment or acknowledgement. Do not bulk-approve strategic commercial commitments merely for convenience.

### Filters

- Action type
- Division
- Constraint
- Owner
- Due/overdue
- Confidence
- Account
- Opportunity state
- Capital band
- GP impact band

Provide saved views later only if real use justifies them.

## 5. Screen B — Account Opportunity Workspace

### Purpose

One page answers: **What do we have, what can we win, what is blocking us, and what should we do?**

### Account header

Canonical customer identity plus:

- Current Suprabha revenue
- Estimated addressable wallet
- Current wallet share
- Untapped wallet
- Current absolute GP
- Receivable/risk summary
- Wallet estimate confidence
- Wallet as-of date
- Last verified date

Transactional values and estimates must be visually distinguishable.

### Division wallet matrix

Rows: Biochemistry, Hematology, Immunoassay, Molecular, Microbiology, Rapid, Coagulation, Electrolytes, Others, or configured divisions.

Columns:

- Estimated wallet
- Suprabha revenue
- Wallet share
- Untapped wallet
- GP
- Confidence
- Main constraint
- Open opportunity
- Recommended action

Use compact bars only where they improve scanning; exact values remain visible.

Selecting a division filters the opportunity panel below.

### Opportunity panel

Cards/table for specific product/category/instrument opportunities:

- opportunity reference;
- type: capture / defend / recover;
- estimated revenue opportunity;
- expected GP opportunity;
- confidence;
- primary constraint;
- recommended action;
- capital/effort;
- state;
- owner;
- due date.

### Account timeline

Unified commercial timeline assembled from domain references:

- wallet snapshot changes;
- constraint diagnoses;
- commercial actions;
- linked pricing decisions;
- outcome measurements;
- relevant service/instrument/order events where appropriate.

Do not copy source-domain records into Suprabha80 merely to render this timeline.

## 6. Screen C — Opportunity Diagnosis

### Purpose

Convert an observed wallet gap into an evidence-backed opportunity.

### Step 1: Scope

Pre-filled where known:

- Account
- Division
- Product/category/instrument
- Opportunity type
- Baseline period

### Step 2: Economics

System-populated when authoritative data exists:

- Current revenue
- Current GP
- Existing wallet share
- Estimated wallet/gap
- receivable behavior
- relevant pricing/cost history
- installed-base evidence

Manual estimate is allowed only where no authoritative source exists and must require:

- value;
- estimation method;
- source/evidence;
- confidence;
- as-of date;
- verifier where policy requires.

### Step 3: Constraint

Choose one primary constraint:

PRICE, PORTFOLIO, INSTRUMENT, SERVICE, RELATIONSHIP, CREDIT, AVAILABILITY, CLINICAL, CONTRACT_TENDER, COMPETITOR_LOCK_IN, UNKNOWN.

Optional secondary observations may be stored, but the system must not create an unbounded tag soup.

Require evidence and confidence.

UNKNOWN is a valid diagnosis and should normally produce an investigation action rather than a discount.

### Step 4: Candidate action

System proposes bounded action types. User can accept or modify within policy.

Display expected:

- incremental revenue;
- incremental GP;
- GP protected;
- capital requirement;
- working capital;
- effort;
- time to benefit;
- retention horizon;
- confidence.

If price action is selected, create/reference a **strategic_price_link** and hand off to Pricing Engine. Do not enter or approve governed strategic price directly here.

## 7. Screen D — Action Execution Workspace

Each `commercial_action` gets a compact execution page.

Show:

- action objective;
- account/opportunity;
- diagnosed constraint;
- expected economics frozen at approval;
- owner;
- due date;
- dependencies;
- linked pricing/placement/service/order artifacts;
- state;
- activity/audit trail.

Lifecycle:

PROPOSED → APPROVED → IN_PROGRESS → OUTCOME_DUE → COMPLETED/MEASURED

Explicit alternatives: REJECTED, ON_HOLD, STOPPED, NO_ACTION.

State transitions must be server-enforced.

For material changes after approval, preserve the approved baseline and version/reapprove rather than silently editing history.

## 8. Screen E — Outcome Review

### Purpose

Force commercial learning instead of allowing concessions to become permanent.

Queue actions whose evaluation window has matured.

Comparison view:

| Measure | Baseline | Expected | Actual | Variance |
|---|---:|---:|---:|---:|
| Revenue | | | | |
| Absolute GP | | | | |
| GP % | | | | |
| Wallet share | | | | |
| Receivables/cash | | | | |
| Working capital | | | | |

Also record:

- promised wallet delivered? yes/partial/no;
- constraint resolved?;
- action effective?;
- continue / modify / stop / escalate;
- evidence;
- reviewer;
- review date.

Outcome records are append-only evaluations. Corrections create a superseding evaluation, not destructive edits.

Strategic discounts with poor outcomes must be surfaced for pricing review; Suprabha80 must not directly change the price.

## 9. Screen F — Coverage & Data Quality

This is an operational exception screen, not an analytics dashboard.

Queues:

- Wallet snapshot stale
- Low-confidence wallet estimate
- Missing division breakdown
- Opportunity without diagnosed constraint
- Action without owner/due date
- Outcome overdue
- Broken source reference
- Pricing link awaiting decision

Purpose: make missing evidence visible and actionable.

Never fill missing commercial evidence with fabricated defaults.

## 10. Functional requirements

### FR-01 Canonical account data
The module shall reference Customer domain IDs and canonical customer metadata. It shall not create a duplicate customer master.

### FR-02 Wallet snapshots
Authorized users shall create/version effective-dated `account_wallet_snapshot` records with method, confidence, source period, evidence and verifier.

### FR-03 Division decomposition
Each account wallet snapshot may be decomposed through `account_wallet_division`. Division totals shall expose reconciliation differences against account total rather than silently force balance.

### FR-04 Opportunity creation
Users/system rules may create `wallet_opportunity` records from wallet gaps, defense risks or recovery cases. Every opportunity shall have provenance and confidence.

### FR-05 Constraint diagnosis
An opportunity shall not progress to normal commercial action approval without a current `opportunity_constraint`, except explicitly governed investigation actions.

### FR-06 Price discipline
Low wallet share alone shall never generate an automatic price reduction. PRICE must be evidenced or a governed strategic bundle/action must justify pricing review.

### FR-07 Commercial actions
`commercial_action` shall store expected economics, capital/effort, owner, due date, state, decision reason and approval evidence.

### FR-08 Strategic pricing handoff
`strategic_price_link` shall reference Pricing Engine artifacts. It shall not duplicate authoritative governed price, approval or billing snapshot data.

### FR-09 Outcome measurement
Material actions shall receive an evaluation window and create append-only `action_outcome` records comparing expected and actual results.

### FR-10 Deterministic ranking
`opportunity_score_snapshot` shall store score components, policy version, inputs/as-of references and calculated rank. The UI shall expose main drivers.

### FR-11 Reproducibility
Given the same versioned inputs and policy version, deterministic scoring shall reproduce the same output.

### FR-12 Management override
Authorized management may override ranking/action decisions with mandatory reason and audit event. Overrides do not rewrite historical score snapshots.

### FR-13 NO_ACTION
NO_ACTION is a first-class decision with reason and review date where applicable.

### FR-14 Defense
System shall support GP/revenue protected as an economic outcome, not only new revenue.

### FR-15 Search/filter
Users shall search accounts/opportunities/actions and filter the Action Center without altering canonical data.

### FR-16 Evidence drill-down
Every material estimated/derived value shall expose source, method, confidence, as-of date and calculation/policy version where applicable.

### FR-17 Role restrictions
Commercial intelligence details shall be restricted by role. Strategic price/cost/margin data must follow Pricing domain permissions.

### FR-18 Notifications
Future notifications may alert owners for overdue actions/outcomes, but notification delivery must not be required for transactional correctness.

## 11. Technical architecture

Implement inside the existing modular monolith as one **Commercial Intelligence** domain with logical Focus, Constraint, Action and Learning engines.

Do not create microservices.

### Domain boundary

Transactional domains remain authoritative:

- Customer
- Catalog
- Orders
- Pricing
- Inventory
- Finance/Tally integration
- Receivables
- Instruments
- Service where available

Commercial Intelligence stores:

- snapshots/estimates;
- opportunities;
- diagnoses;
- proposed/approved actions;
- score snapshots;
- outcome evaluations;
- references to authoritative artifacts.

It does **not** own invoices, costs, approved customer prices, inventory balances, credit truth or Tally vouchers.

### Read model pattern

Heavy opportunity aggregation should use read models/materialized projections or bounded asynchronous calculations where useful.

Do not add wallet calculations to order-save or billing transactions.

Freshness must be explicit: every projection exposes `calculated_at`, source watermark/as-of period and stale state.

### Command/query separation

Queries may combine canonical read data with intelligence records.

Commands that change opportunity/action state must execute through server-side domain services with authorization, validation, optimistic concurrency and audit.

Never let browser code directly mutate tables.

## 12. Data requirements

### account_wallet_snapshot

Required concepts:

- id UUID
- account_id FK/reference
- effective_from / as_of_date
- estimated_addressable_wallet
- current_revenue
- wallet_share
- untapped_wallet
- estimation_method
- confidence
- source_period
- evidence/source reference
- verified_by / verified_at
- version
- created_at / created_by

Historical snapshots are retained.

### account_wallet_division

- id
- wallet_snapshot_id
- division
- estimated_wallet
- current_revenue
- wallet_gap
- wallet_share
- confidence
- method/evidence
- version

Unique logical division per wallet snapshot.

### wallet_opportunity

- id
- human reference
- account_id
- wallet_snapshot/division reference
- scope type and scoped entity reference
- opportunity type CAPTURE/DEFEND/RECOVER
- estimated incremental revenue
- estimated GP opportunity/protected
- confidence
- state
- owner
- review date
- version

### opportunity_constraint

Versioned history:

- opportunity_id
- constraint_type
- primary flag
- evidence
- confidence
- diagnosed_by
- diagnosed_at
- review_at
- supersedes_id/version

Do not overwrite historical diagnosis.

### commercial_action

- id / human reference
- opportunity_id
- action_type
- expected revenue/GP/protection
- capital/working-capital requirement
- effort band
- expected time to benefit
- expected retention horizon
- expected success/confidence
- owner
- due date
- state
- approved baseline/version
- decision reason
- optimistic version

### strategic_price_link

Reference-only integration:

- action_id/opportunity_id
- pricing artifact type
- pricing artifact ID
- pricing status cache only if clearly marked non-authoritative
- linked_at

No duplicated authoritative price approval.

### action_outcome

Append-only:

- action_id
- evaluation period
- baseline snapshot reference
- expected values snapshot
- actual revenue/GP/wallet/cash/capital values
- variance
- qualitative result WON/PARTIAL/FAILED/STOPPED
- evidence
- reviewed_by / reviewed_at
- supersedes_outcome_id if corrected

### opportunity_score_snapshot

- opportunity/action reference
- policy_version
- input snapshot references
- component scores
- normalized values
- total score
- rank/band
- explanation payload
- calculated_at

Store enough information to explain and reproduce ranking without making the score the source of business truth.

## 13. API requirements

Prefer existing REST/domain conventions.

Representative endpoints:

- `GET /api/intelligence/actions`
- `GET /api/intelligence/accounts/:accountId`
- `GET /api/intelligence/opportunities/:id`
- `POST /api/intelligence/opportunities/:id/diagnosis`
- `POST /api/intelligence/opportunities/:id/actions`
- `POST /api/intelligence/actions/:id/approve`
- `POST /api/intelligence/actions/:id/transition`
- `POST /api/intelligence/actions/:id/outcomes`
- `GET /api/intelligence/coverage`

Mutation requirements:

- authenticated actor;
- role authorization;
- bounded validated payload;
- expectedVersion for mutable aggregates;
- idempotency/request key for retryable commands;
- transactional audit event;
- transactional outbox where downstream work is triggered;
- deterministic conflict response;
- no-store/private handling for sensitive commercial data.

## 14. ACID, concurrency and audit

Transactional integrity is required for material decisions.

Example action approval transaction:

1. lock/read action and current version;
2. validate state;
3. validate current opportunity/constraint;
4. validate actor permission;
5. freeze expected-economics baseline;
6. transition action;
7. increment version;
8. append audit event;
9. append outbox event if needed;
10. commit atomically.

Retry with same idempotency key must not create duplicate actions, approvals or outcomes.

Concurrent stale update must fail visibly rather than last-write-wins.

Historical snapshots/outcomes/approved baselines must not be destructively mutated.

## 15. Scoring architecture

V1 is deterministic and policy-versioned.

Do not hard-code a false mathematical precision before real outcome data exists.

Candidate components:

- absolute GP opportunity/protected;
- wallet gap;
- capture/retention confidence;
- cash/receivable quality;
- capital requirement;
- effort;
- time to benefit;
- strategic relevance;
- evidence confidence.

The UI must show the leading positive and negative drivers.

The scoring policy must be effective-dated/versioned. Recalculation creates a new `opportunity_score_snapshot`; it does not rewrite the previous score.

Future ML may estimate probabilities only after sufficient outcome history. It remains advisory and cannot directly change governed prices, stock, credit or accounting truth.

## 16. Performance requirements

Initial targets, to validate with real office data:

- Action Center first useful render: <= 2 seconds on warm office/LAN path.
- Account workspace summary: <= 2 seconds warm.
- Filtering/sorting already-loaded Action Center: perceived immediate; target <= 200 ms.
- Opening decision drawer: <= 500 ms when data is already in read model.
- Commands should acknowledge successful durable write normally within 2 seconds.
- Long recalculation runs asynchronously and show last-calculated/freshness state rather than blocking the UI.

Do not sacrifice correctness to meet UI latency.

## 17. Security requirements

- Reuse central identity/RBAC.
- Enforce permissions server-side.
- Margin, cost, strategic price and account economics are commercially sensitive.
- Sales users see only accounts/fields permitted by role/assignment policy.
- Pricing details obey Pricing permissions even when linked from Suprabha80.
- Audit material reads/writes where policy requires.
- Never expose service-role credentials to browser.
- No browser-to-Tally connection.

## 18. Accessibility and interaction

- Keyboard navigable tables/drawers.
- Status is never communicated by color alone.
- Clear focus states.
- Numeric values use Indian currency formatting where appropriate.
- Dates/times use the configured business locale/timezone.
- Tables support horizontal density without hiding decision-critical columns.
- Empty states explain what evidence is missing and the next valid action.
- Errors are actionable and never silently swallowed.

## 19. Observability

Track:

- projection/recalculation failures;
- stale read models;
- command failures/conflicts;
- idempotency collisions;
- orphan source references;
- overdue outcomes;
- score policy/version in use;
- pricing-link reconciliation failures.

Operational failures should be visible to admins without exposing sensitive details to unauthorized users.

## 20. Testing requirements

### Unit
- wallet calculations;
- constraint validation;
- action economics;
- deterministic score policy;
- state transitions;
- permission rules.

### Integration
- canonical Customer/Pricing/Tally evidence references;
- action approval ACID transaction;
- optimistic concurrency;
- idempotent retries;
- audit/outbox atomicity;
- append-only outcome correction;
- stale projection handling.

### UI/E2E
- management opens Action Center and understands top action;
- drill from action → account → evidence;
- diagnose UNKNOWN without forced price action;
- create/approve action;
- strategic price handoff opens governed Pricing flow;
- outcome review compares baseline/expected/actual;
- unauthorized role cannot see protected economics;
- stale concurrent edit produces visible conflict.

## 21. Acceptance scenarios

### Scenario A — Growth
Management opens Action Center, selects a high-GP wallet gap, sees AVAILABILITY as evidenced constraint, approves stock-related action, assigns owner and later measures incremental GP. No price change is suggested merely because wallet share is low.

### Scenario B — Strategic pricing
PRICE is verified as constraint. Suprabha80 shows account economics and expected wallet gain, then links to Pricing Engine. Pricing performs its own governed calculation/approval. Suprabha80 records the link and later measures whether promised wallet materialized.

### Scenario C — Defense
A profitable account has revenue at risk because of SERVICE. DEFEND action may outrank a new sales opportunity because expected GP protected is larger. Outcome records retained wallet/GP.

### Scenario D — Unknown
Evidence is insufficient. Constraint is UNKNOWN. System recommends investigation, not discounting.

### Scenario E — Failed concession
A strategic price action reaches outcome date and actual wallet gain is materially below expectation. Outcome is recorded; Action Center surfaces review. Pricing remains authoritative for any subsequent price correction.

## 22. Explicit non-goals for first implementation

Do not add:

- AI-generated autonomous actions;
- opaque ML ranking;
- game-theory engine;
- automatic price reductions;
- unattended Tally writes;
- separate customer/product masters;
- microservices;
- complex BI dashboard suite;
- generic CRM replacement;
- salesperson surveillance metrics;
- automated credit-limit changes.

## 23. Recommended implementation sequence

This specification does not change the current release priority.

1. Finish/correct Customer Pricing V1.
2. Consolidate migrations, ACID/concurrency tests and Tally evidence.
3. Complete office pilot gate.
4. Build wallet snapshots and division coverage as read-only intelligence.
5. Build Account Opportunity Workspace.
6. Build deterministic opportunity/constraint model.
7. Build Management Action Center.
8. Add commercial action workflow.
9. Link strategic actions to Pricing Engine.
10. Add outcome review/learning loop.
11. Calibrate scoring from real outcomes.
12. Consider ML/AI only after sufficient evidence exists.

## 24. Architectural guardrails

1. Transactional truth and analytical estimates stay separate.
2. Canonical domains are referenced, not copied.
3. Every estimate exposes method, confidence and date.
4. Every recommendation exposes why.
5. Every material action has expected economics.
6. Every strategic concession has a measurement date.
7. Every outcome preserves expected vs actual.
8. Every ranking is versioned and reproducible.
9. Pricing remains price authority.
10. Tally remains financial/statutory authority where defined.
11. Humans approve material commercial decisions.
12. Missing evidence stays missing; never guess.
13. UI reduces management attention rather than creating more alerts.
14. Build one Commercial Intelligence module, not a collection of services.
15. Keep the operational experience simple even when reasoning is sophisticated.

## 25. Definition of done

The future module is architecturally successful when management can open one screen and answer:

> What are the few most economically valuable actions Suprabha should take now, why are they recommended, what will they cost, who owns them, and did previous actions actually work?

—without re-entering data already held by Suprabha OS, without confusing estimates with financial truth, and without allowing the intelligence layer to bypass Pricing, accounting, inventory, credit, audit or other governed transactional controls.


## 26. Canonical Market Map architecture

This section supersedes any earlier proposal that treated Customer, Opportunity, Equipment and Sales Territory as four peer map modes.

The canonical UX is **decision-oriented**:

1. **WALLET — Where is the money?**
2. **OPPORTUNITY — Where can we win, defend or recover?**
3. **ACTION — What should we do, and where?**
4. **COVERAGE — What parts of the market do we not understand well enough?**

Customer, Equipment and Territory are not discarded. They become geographic entities, overlays and filters that support all four decision modes.

### 26.1 Architecture

```text
Customer/Address Geo ─┐
Equipment/Installed ──┼──> Geographic Read Model
Territory/Assignment ─┘             │
                                    │
Commercial Intelligence ────────────┤
Wallet / Opportunity / Action       │
                                    ▼
                         MARKET MAP EXPERIENCE
                     WALLET | OPPORTUNITY
                       ACTION | COVERAGE
                                    │
                         Layers + Filters
                    Customer / Equipment /
                    Territory / Division /
                    Salesperson / Constraint
```

Coordinates and normalized addresses belong to the canonical Customer/Address domain. Do not duplicate latitude/longitude into wallet_opportunity or commercial_action merely for map rendering.

### 26.2 Wallet mode

Business question: **Where is the addressable economic wallet?**

Map may represent:
- estimated addressable wallet;
- current Suprabha revenue;
- wallet share;
- untapped wallet;
- absolute GP;
- division/category;
- estimate confidence and freshness.

Selecting an account opens the same Account Opportunity Workspace used elsewhere.

### 26.3 Opportunity mode

Business question: **Where can Suprabha economically grow, defend or recover business?**

Layers may include:
- reagent/product opportunities;
- instrument opportunities;
- Suprabha installed instruments;
- competitor installed instruments where evidence exists;
- replacement opportunities;
- placement opportunities;
- primary constraints;
- expected GP opportunity/protected;
- confidence.

Equipment is primarily an Opportunity layer, not an isolated map mode.

### 26.4 Action mode

Business question: **Where should people act?**

Show bounded commercial actions such as:
- salesperson/management visit;
- demonstration;
- instrument placement;
- service intervention;
- collection;
- stock/availability action;
- account defense/recovery;
- investigation.

Allow filtering by owner, salesperson, territory, due date, action type and economic impact.

Future route/visit assistance may suggest nearby high-value actions, but routing must optimize useful economic work rather than merely shortest distance. A future objective may consider expected economic gain per salesperson day/km. This is advisory and must not silently reassign owners or alter approved actions.

### 26.5 Coverage mode

Business question: **Where is market intelligence incomplete or stale?**

Show:
- unmapped/partially mapped accounts;
- stale wallet snapshots;
- low-confidence wallet estimates;
- missing division breakdown;
- missing/low-confidence installed-base evidence;
- opportunities with UNKNOWN constraint;
- territories with weak account coverage;
- accounts requiring verification.

Coverage is a data-quality and market-census view, not a sales-performance score.

### 26.6 Shared overlays and filters

The four modes use the same underlying map engine and account geography.

Shared filters/overlays may include:
- territory;
- salesperson/owner;
- diagnostic division;
- customer type;
- equipment/installed base;
- opportunity type;
- constraint;
- confidence;
- economic impact band;
- due/overdue status;
- active/inactive account where governed.

Territory therefore applies across Wallet, Opportunity, Action and Coverage rather than existing as its own isolated mode.

Customer is the fundamental geographic entity and appears according to the active decision mode rather than being a separate Customer mode.

### 26.7 Interaction model

The Map and List experiences are two projections of the same underlying records.

```text
        Same query / read model
                │
          ┌─────┴─────┐
          ▼           ▼
       LIST VIEW    MAP VIEW
          │           │
          └─────┬─────┘
                ▼
        Same decision drawer
                ▼
        Same domain commands
```

Switching List ↔ Map must not create separate workflow state, duplicate opportunities/actions, or change business authority.

Selecting a marker should open the same decision drawer/account workspace as selecting its corresponding list row.

### 26.8 Geographic read model

Use a bounded geographic read model/projection for map performance. It may join/reference:
- canonical account ID and coordinates;
- territory/assignment;
- current wallet snapshot summary;
- current opportunity summary;
- current action summary;
- installed-base summary;
- confidence/freshness indicators.

The projection is disposable/rebuildable and non-authoritative. Source-domain records remain truth.

Expose calculated_at/source watermarks so stale geographic intelligence is visible.

### 26.9 Map functional requirements

- **MAP-FR-01:** Authorized users can switch between WALLET, OPPORTUNITY, ACTION and COVERAGE without leaving the Market Map.
- **MAP-FR-02:** Mode changes alter presentation/query semantics, not source-of-truth ownership.
- **MAP-FR-03:** Territory, salesperson and division filters apply across relevant modes.
- **MAP-FR-04:** Customer coordinates come from canonical Customer/Address geography.
- **MAP-FR-05:** Opportunity/action records reference account geography; they do not duplicate coordinates.
- **MAP-FR-06:** Equipment is an overlay/layer and may contribute to opportunity reasoning.
- **MAP-FR-07:** Marker selection opens the same business object/workspace as list selection.
- **MAP-FR-08:** Clustering/aggregation must not hide the underlying exact account records on drill-down.
- **MAP-FR-09:** Estimates display confidence/freshness; missing geography remains visibly missing.
- **MAP-FR-10:** Coverage mode never invents coordinates, wallet values or installed-base facts.
- **MAP-FR-11:** Map recommendations remain advisory; governed Pricing, Orders, Service, Credit and other domain commands retain their normal authority.
- **MAP-FR-12:** Future route suggestions use approved/current actions and must not silently create, approve or reassign commercial actions.

### 26.10 Map technical requirements

- Prefer one map component/query abstraction with mode-specific projections rather than four separate map implementations.
- Fetch only viewport/relevant records when dataset size requires it.
- Support marker clustering at wider zoom levels.
- Preserve stable account IDs through clusters/drill-down.
- Keep sensitive commercial fields behind existing server-side RBAC.
- Cache/rebuild geographic projections independently of transactional order/pricing writes.
- Geographic projection failures must not block order capture, pricing approval, billing or other transactional operations.
- No external map provider becomes a source of commercial truth.
- Provider-specific map code must remain behind an adapter/component boundary so the commercial domain does not depend on one mapping vendor.
- Exact address/geocode corrections must flow back through the governed Customer/Address process, not by editing opportunity/action records.

### 26.11 Map UX guardrail

The map exists to improve decisions, not to decorate dashboards.

The primary test is whether it helps management answer:

> Where is the economic opportunity, what is blocking it, where should our people act, and what market evidence is still missing?

If a geographic visualization does not improve one of those decisions, it should not be added.


## 27. Normal-path automation principle

> **Suprabha OS should automate the normal path and expose the exceptional path. Humans should spend their time on decisions, relationships and exceptions—not re-entering facts the system already knows.**

This is a system-wide product and architecture principle. New workflows and UI should be reviewed against it: canonical data should prefill automatically, routine deterministic work should be automated safely, and human attention should be reserved for material exceptions, approvals, relationships and judgment.


## 28. Pricing normal-path integration checkpoint

The customer-first pricing correction is now substantially represented in code: customer selection, purchased-item loading, historical selling-price evidence, cost evidence, continuity/target/recommended calculations, risk states, bulk price-book approval, protected exceptions, governed customer price decisions and governed order-pricing support.

The remaining acceptance focus is not another pricing redesign. It is an end-to-end audit of:

```text
Customer Price Book
      ↓
Order Capture
      ↓
Automatic governed customer price
      ↓
Normal path remains invisible to staff
      ↓
Only material exception interrupts
      ↓
Server revalidation
      ↓
Immutable billing snapshot
```

For a normal governed Customer × Product combination, order entry should simply display the resolved price and provenance without requiring the employee to repeat pricing work. Manual interaction belongs to genuine exceptions.

The next architecture/review checkpoint should therefore verify Price Book → Order Capture → governed price resolution → exception-only interruption → immutable billing snapshot end-to-end before adding more pricing features.


## 29. New-user UI/UX principles and V1 corrections

### 29.1 UX objective

A new operational employee should be able to use the normal Suprabha OS workflow after minimal instruction without understanding the underlying architecture, pricing engine, Tally integration, concurrency model, audit model or internal technical terminology.

Two companion principles govern the UI:

> **Suprabha OS should automate the normal path and expose the exceptional path. Humans should spend their time on decisions, relationships and exceptions—not re-entering facts the system already knows.**

> **Show employees the business decision, not the system machinery behind the decision.**

The system may collect evidence, calculate, validate, reconcile, audit, protect concurrency and maintain history underneath. The operational employee should normally see only the information required to perform the business task.

### 29.2 Organize around jobs, not software modules

Primary navigation should use familiar business jobs and be role-sensitive. A general structure is:

```text
Home
Orders
Customers
Products
Dispatch
Collections
Service

Management
Pricing
Reports
Settings
```

Users should see only the sections appropriate to their role. For example, an Order Desk user may primarily need Home, New Order, Orders and Customers.

### 29.3 Action-oriented home

Operational home screens should answer **“What do I need to do?”** before showing broad KPI dashboards.

Prioritize work queues such as orders needing correction, billing attention, overdue dispatches and collection follow-ups. Management may additionally receive financial and commercial KPIs.

### 29.4 New Order normal path

New Order is a critical V1 screen and should be intentionally simple:

```text
Select/Search Customer
        ↓
Frequently ordered / Search Products
        ↓
Quantity
        ↓
Approved Customer Price appears automatically
        ↓
Promised Delivery / Notes
        ↓
PLACE ORDER
```

Do not expose historic cost, target margin, continuity calculations, evidence hashes, policy versions, Tally source IDs, guardrails or other internal machinery on the normal order-entry surface.

### 29.5 Progressive disclosure

Normal state should show concise business information such as:

```text
₹1,240  ✓ Customer Price
```

Optional details may reveal previous selling price, current cost, GP, margin, source and approval date to authorized users. Deeper evidence/audit information remains available to management/admin without cluttering normal workflows.

### 29.6 Business language over engineering language

Operational UI should translate internal concepts into familiar business language while retaining exact technical terminology in logs/admin/audit surfaces.

Examples:
- Pricing resolution → Price
- Governed price → Approved price
- Pricing evidence → Price history
- Guardrail → Needs review
- Immutable snapshot → Approved billing price
- Reconciliation → Tally check
- Exception → Needs attention
- Idempotency conflict → Order already saved
- Recovery reference → Checking previous save
- Purchase-cost impact → Supplier price change
- Missing authoritative evidence → Cost information unavailable

### 29.7 Customer Price Book hierarchy

The customer-first Price Book should emphasize:
- customer identity,
- purchased-product count,
- Ready / Review / Fixed Agreement summary,
- Purchased / Needs Review / All Products views,
- Last Price,
- New/Current Cost,
- Recommended Price,
- GP/Margin,
- concise reason for review where relevant,
- individual exception action,
- bulk acceptance of all safe recommendations.

Advanced evidence remains progressively disclosed.

### 29.8 Supplier Price Changes

For ordinary business users, prefer **Supplier Price Changes** over **Purchase Cost Review**.

The screen should communicate:
- supplier/product,
- old cost,
- new cost,
- absolute change,
- number of affected customers,
- safe-to-update count,
- fixed/protected count,
- review-required count,
- economic impact where reliable,
- Review Customers action.

The engine performs the complex cross-customer calculations underneath.

### 29.9 Exception states

Do not rely on color alone. Prefer explicit states:
- ✓ READY
- ⚠ REVIEW
- ⛔ BLOCKED

Color is secondary reinforcement. Normal success should not create excessive visual noise; exceptions deserve visual attention.

### 29.10 Consistent entity workspaces

Use predictable pages:
- Customer: Overview | Orders | Prices | Instruments | Payments | Activity
- Product: Overview | Customers | Stock | Supplier Cost | Sales History
- Order: Order → Billing → Packing → Dispatch → Delivery

### 29.11 Universal search direction

Future search should allow a user to search Suprabha OS without first knowing the module: customer, order number, product, invoice or instrument. Results should be grouped by entity type.

### 29.12 Actionable error messages

Operational errors must explain the business problem and next safe action rather than exposing internal codes.

Examples:
- PRICE_REVIEW_REQUIRED → “Price needs approval” + reason + Request Approval.
- VERSION_CONFLICT → “This order changed while you were working” + who/when where available + See Changes / Reload Order.

Internal error codes remain available in diagnostics/audit evidence.

### 29.13 Desktop and mobile

V1 remains desktop-first for office/order-desk work. Future salesperson/service mobile UX should be action-first rather than a compressed desktop interface. Do not expand mobile scope before the transactional V1 pilot.

### 29.14 Immediate V1 UX corrections

Before broader UI expansion, prioritize:
1. Role-based simplified navigation.
2. Action-oriented Home / Needs Attention.
3. Extremely simple New Order normal path.
4. Customer Price Book with Purchased / Needs Review / All Products and safe bulk acceptance.
5. Replace engineering terminology with business terminology on operational surfaces.
6. Progressive disclosure of pricing, Tally, audit and technical detail.

Avoid a broad visual redesign while Pricing and the transactional spine are being consolidated.

### 29.15 New-user usability acceptance test

Pilot the interface with at least one employee who has not followed the development process. Without step-by-step assistance, ask the employee to:
1. Create an order for an existing customer.
2. Add three products.
3. Find yesterday's order.
4. Identify why a price needs review.
5. Determine whether an order was dispatched.

Every instance of “Where do I click?”, incorrect navigation, unexplained terminology, repeated data entry or inability to identify the next action is UX evidence to record and correct. The purpose is to validate learnability of the operational flow, not merely visual appearance.


## 30. Performance and workflow-speed architecture

Performance means three things: system response speed, workflow completion speed, and human decision speed. Optimize all three, with workflow/human speed taking priority over infrastructure complexity.

### 30.1 Performance targets
- App/home useful: <1.5s target.
- Warm order list: <1s target.
- Customer/product search: <100ms perceived where locally cached.
- Customer selection: near-instant shell with dependent data loaded in parallel.
- Governed price appearance: <300ms perceived where evidence is available/cached.
- Add/edit order line: immediate local interaction.
- Typical order save: <1s target, subject to authoritative server confirmation.
- Existing order open: <500ms perceived where cached/read-model data is available.
- Operational queue switch: <300ms perceived.

Measure p50 and p95 rather than averages.

### 30.2 Keep the core architecture simple
Retain the modular monolith, PostgreSQL/Supabase transactional authority and trusted local Tally connector. Do not introduce Redis, Kafka, Elasticsearch, Kubernetes, microservices or a separate pricing service without measured need.

### 30.3 Purpose-built read models
After V1 stabilization, introduce rebuildable/non-authoritative projections for high-frequency UI reads, e.g. order queue, customer order summary, customer price book, product cost impact and customer account summary. Transactional normalized tables remain authoritative.

### 30.4 Cache, version and prefetch
Cache relatively stable customer/product/master data with explicit versions. On app/order-desk entry, prefetch likely order-capture dependencies in the background. On customer selection, load frequent/recent products, governed prices and lightweight account context in parallel rather than serially.

### 30.5 Customer-specific fast capture
Use deterministic transaction history to surface frequently/recently ordered products and repeat-order actions. This is not predictive AI; it is a convenience projection from authoritative history.

### 30.6 Invisible normal-path pricing
For a normal governed Customer × Product combination, order entry shows the resolved approved price without opening Pricing. Only material exceptions interrupt capture.

### 30.7 Optimistic interaction boundaries
Use immediate local UI for safe reversible interactions such as adding lines, changing quantities, notes and navigation. Keep final pricing approval, billing snapshots, authoritative stock/invoice reconciliation and financial operations server-confirmed.

### 30.8 UI decomposition
Gradually decompose large operational workspaces into focused components such as OrderQueue, OrderSearch, OrderDetail, NewOrder, CustomerPicker, FrequentProducts, OrderLines, BillingPanel, FulfilmentPanel and AttentionPanel. This is a UI/code organization change, not a microservice split.

### 30.9 Search, pagination and refresh
Search cached customer/product data locally first where safe; use server search as needed. Paginate/virtualize large operational lists. Prefer stale-while-refresh behavior where safe: show usable cached data immediately, indicate freshness, then replace with current server state.

### 30.10 Exception-first and keyboard-first UX
Needs Attention queues reduce both query/render load and human scanning. Order capture should support keyboard-first operation with intelligent autofocus, Enter selection, arrow-key navigation and shortcuts for common actions.

### 30.11 Performance instrumentation
Capture at least app_boot_ms, order_list_ms, customer_search_ms, catalog_search_ms, pricing_preview_ms, order_save_ms, order_open_ms, pricing_book_ms and tally_reconcile_ms, plus workflow timing from customer selection to first line and order submission.

### 30.12 Sequence
P0 during/before pilot: instrument timings; simplify New Order; prefetch/cache masters; invisible normal-path pricing; remove unnecessary loading states; keyboard-first capture.
P1 after pilot: focused UI components; selected read models; frequent/repeat products; stale-while-refresh queues; role-specific Needs Attention.
P2 only if measurement justifies: deeper query/index optimization, incremental sync, larger projection infrastructure/background workers.


## 31. Fast order capture and demand-driven replenishment

### 31.1 Fast phone-order capture
Order capture should minimize clicks and repeated entry. After customer selection, immediately surface a compact list of the customer's frequently/recently purchased products with governed customer prices already resolved where safe.

Target interaction:
```text
Select customer
  → frequent/recent products appear
  → enter quantity beside product
  → price resolves automatically
  → cursor returns to product search
  → save
```

Support keyboard-first rapid entry: type product shorthand/search, select with Enter, enter quantity, Enter to add and return focus to product search. Avoid separate Add Product dialogs, pricing screens or confirmations on the normal path. Target customer + five routine products in approximately 20–30 seconds under normal warm conditions.

### 31.2 Products not yet used vs products not in the canonical catalog
If an item exists in the synced Tally catalog, it must remain searchable in order capture even if it has never been ordered before or is excluded from reorder monitoring.

If a requested item genuinely does not exist in the canonical Tally/catalog master, do not let ordinary users silently create a Product Master. Provide a controlled **Request new product / Requested item** path capturing description, requested quantity, customer and optional note. The requested line remains explicitly unmapped/non-inventory until an authorized user maps it to an existing canonical Tally item or completes the proper master-creation process.

This preserves one source of truth and prevents duplicate/near-duplicate product masters.

### 31.3 Customer demand must override reorder-monitoring scope
A configured reorder subset is useful for proactive stock replenishment, but it must never hide real customer demand.

Rule:

> **Unfulfilled confirmed customer demand automatically creates or contributes to a procurement requirement. Reorder settings are not allowed to hide real customer demand.**

Therefore an item with insufficient available Tally stock for confirmed/open customer demand must appear in the Requirements/Reorder operational view even if the item is not part of the configured reorder-monitoring subset.

### 31.4 Separate demand shortage from proactive replenishment
The Requirements/Reorder UI should distinguish:

**Customer Demand**
- item,
- current authoritative/advisory Tally stock with freshness,
- open customer demand,
- shortage quantity,
- affected order count,
- oldest/priority affected order,
- procurement attention state.

**Stock Replenishment**
- configured monitored item,
- current stock,
- reorder level/policy,
- suggested replenishment quantity,
- freshness/provenance.

Actual customer shortage has higher operational priority than policy-based replenishment.

### 31.5 Derived requirement, not duplicate inventory truth
The procurement requirement is derived from authoritative open customer demand and the latest trusted Tally stock snapshot. It must not create a second stock ledger or pretend StockFlow owns inventory. Tally remains inventory authority.

The requirement projection should be rebuildable and should reconcile when orders are cancelled/changed, Tally stock changes, or item mapping is corrected.

### 31.6 Stock-arrival continuation
When a later Tally sync shows stock becoming available for an item with open shortage demand, Suprabha OS should surface the affected waiting orders and quantity now available so operations can continue fulfilment. Do not silently allocate or change financial/inventory truth without the governed workflow.

### 31.7 Priority
Treat confirmed-demand → shortage → procurement requirement visibility as a V1/P1 operational priority before sophisticated demand forecasting. Losing visibility of a real customer order is a higher-risk failure than imperfect forecast-based replenishment.

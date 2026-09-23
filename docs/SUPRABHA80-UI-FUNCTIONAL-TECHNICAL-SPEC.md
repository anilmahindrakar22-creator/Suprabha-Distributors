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

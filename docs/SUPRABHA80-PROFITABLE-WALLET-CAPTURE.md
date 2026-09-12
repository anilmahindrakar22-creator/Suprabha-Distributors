# Suprabha 80 — Profitable Wallet Capture & Effort Optimization System

## 1. Objective

Suprabha 80 is a profitable wallet-share strategy, not a price-minimisation strategy.

> Reach at least 80% of the addressable wallet in selected priority accounts, subject to minimum acceptable gross profit, cash conversion, and return on capital.

The 80% target is a destination for accounts where the economics justify it. It is not a requirement to capture 80% from every mapped customer.

The system should optimize scarce resources — management attention, salesperson time, working capital, credit exposure, instrument capital, inventory, service capacity, and manufacturer relationships — rather than simply maximize turnover.

## 2. Core design philosophy: minimum effort, maximum economic gain

Suprabha OS should reduce a large market into a very small, ranked action list.

Conceptual flow:

All accounts → Pareto opportunity set → wallet gaps → constraint diagnosis → candidate actions → expected-value/capital ranking → governed pricing/commercial decision → execution → measured outcome → learning.

The management experience should answer:

> What are the few highest-value actions we should take now, why, what will they cost, and what economic gain should they produce?

The system should prefer five high-impact actions over one hundred low-value alerts.

## 3. Engine A — Pareto Opportunity Engine: WHERE to focus

Pareto is a prioritisation heuristic, not a hard-coded 80/20 law. The actual concentration may be 70/30, 90/10, or another distribution and should be calculated from real data.

Accounts should be ranked primarily by economic potential rather than current sales alone.

Inputs should eventually include:

- estimated addressable wallet;
- current Suprabha revenue;
- current wallet share;
- wallet capture gap;
- expected absolute GP opportunity;
- payment quality and receivable behaviour;
- capture probability;
- retention / strategic value;
- capital requirement;
- effort requirement;
- portfolio / division gaps;
- instrument and installed-base opportunities.

The first output is a small priority-account set. Within each priority account, a second Pareto pass identifies the few products, divisions, instruments, or interventions capable of capturing most of the available wallet.

Do not force an exact 20% cutoff. The engine should calculate cumulative opportunity concentration and allow management policy to define the practical focus band.

## 4. Engine B — Constraint Engine: WHY we are not winning

Before price is changed, the system should identify the primary constraint preventing wallet capture.

Candidate constraint categories:

- PRICE — competitor price / commercial terms;
- PORTFOLIO — Suprabha does not currently carry the required product/company;
- INSTRUMENT — competitor instrument or placement controls reagent consumption;
- SERVICE — service quality or unresolved issue is blocking business;
- RELATIONSHIP — doctor/owner/lab relationship requires intervention;
- CREDIT — payment terms or credit availability;
- AVAILABILITY — stock/procurement/lead-time problem;
- CLINICAL — method, quality, validation, regulatory or clinical preference;
- CONTRACT/TENDER — commercial or procurement structure;
- COMPETITOR_LOCK_IN — switching cost, installed base or bundled agreement;
- UNKNOWN — evidence is insufficient and investigation is required.

Non-negotiable rule:

> Never recommend a price reduction merely because wallet share is low. Price action is justified only when price/commercial terms are a demonstrated constraint or when an approved strategic bundle has measurable account economics.

This prevents unnecessary margin destruction.

## 5. Engine C — Action & Expected Value Engine: WHAT to do

Once the constraint is identified, generate a bounded set of candidate actions.

Examples:

- price match or strategic price;
- management visit;
- salesperson visit;
- product demonstration;
- instrument placement proposal;
- add missing product/company;
- resolve service issue;
- improve stock availability;
- negotiate bundle/contract;
- collect overdue receivable before increasing exposure;
- defend an at-risk account;
- deliberately take no action.

Each action should carry an expected economic case rather than a generic priority label.

Conceptual scoring factors:

- expected incremental monthly revenue;
- expected incremental absolute GP;
- probability of capture/success;
- expected retention duration/value;
- capital required;
- working-capital requirement;
- credit/collection risk;
- management/sales/service effort;
- time to benefit;
- strategic value;
- confidence in underlying evidence.

A conceptual ranking objective is:

> Risk-adjusted economic gain per unit of scarce capital and effort.

Do not hard-code a naive multiplication/division formula until variables are normalized and validated. Early versions should use transparent deterministic scoring bands and show the factors behind the score.

## 6. Engine D — Pricing Engine integration: HOW aggressively to price

The existing Customer Pricing Engine remains the authority for governed pricing decisions. Suprabha 80 supplies opportunity and constraint context but must never bypass pricing approvals, ACID controls, margin guardrails, audit, or immutable billing snapshots.

For each Customer × Product opportunity, pricing should consider:

- approved customer contract;
- eligible Tally selling history;
- current purchase / landed cost evidence;
- GP amount and GP percentage;
- margin erosion;
- current wallet share and wallet capture gap;
- verified constraint;
- expected incremental wallet and GP from the proposed commercial action;
- payment quality and capital exposure.

Pricing roles:

1. **Milk / traffic products** — frequently purchased or highly price-visible products where an aggressive governed price may be justified to win or retain the wider account wallet.
2. **Normal products** — protect configured target margin unless a governed exception has a clear economic case.
3. **Specialty / differentiated products** — protect stronger margins where service, availability, technical value, differentiation, or lower price transparency supports them.

A low margin on a milk/traffic product is acceptable only when expected total-account economics justify it.

Pricing levels remain governed:

Normal / target price → Strategic price → Management approval threshold → Absolute commercial floor → Block.

No wallet-share algorithm or user may silently cross the configured absolute floor.

Strategic discounts require an attributable reason such as competitor match, wallet capture, instrument placement, contract commitment, tender, bundle/portfolio commitment, strategic account, stock clearance, or other governed reason.

## 7. Account economics — optimize the relationship, not one SKU

Do not optimize GP percentage in isolation.

A lower percentage margin may be rational when it produces materially higher absolute GP and durable wallet capture. Large low-margin turnover may be rejected when stock, credit, collections, service burden, or capital consumption produces inadequate return.

The commercial objective should consider:

> Wallet Capture × Absolute GP × Cash Conversion × Capital Efficiency × Retention Value

This is a decision framework, not an automatic-discount formula.

## 8. Defense is part of growth

The action engine must consider revenue/GP at risk as well as new wallet capture.

A service intervention that protects an existing high-GP account may rank above a new sales opportunity. Therefore candidate actions include ATTACK, GROW, DEFEND, RECOVER, COLLECT, and NO_ACTION.

This prevents the system from chasing new turnover while valuable existing wallet leaks away.

## 9. Closed-loop learning: DID the action work?

Every material recommendation should become a measurable commercial experiment.

Store at decision time:

- account and opportunity;
- diagnosed constraint;
- action selected;
- baseline wallet/revenue/GP;
- proposed price or commercial commitment where applicable;
- expected incremental wallet;
- expected incremental GP;
- expected capital requirement;
- expected success probability;
- reason and approving user;
- evidence confidence;
- evaluation date/window.

At the evaluation date compare expected vs actual:

- wallet-share movement;
- incremental revenue;
- incremental absolute GP;
- realized GP percentage;
- payment/receivable behaviour;
- working-capital change;
- whether the promised additional wallet materialized;
- whether the customer retained the lower price without delivering the expected wallet;
- whether the action should be repeated, changed, stopped, or escalated.

A strategic discount that fails to produce its intended wallet gain should not silently become the new normal.

## 10. Recommended data model — future implementation

Keep this modular and auditable rather than embedding opaque scores in the customer table.

Suggested bounded entities:

### account_wallet_snapshot
Effective-dated estimate of total addressable wallet, current Suprabha revenue, wallet share, untapped wallet, method, confidence, verifier and source period.

### account_wallet_division
Wallet estimate/current revenue/gap by diagnostic division or commercial category.

### wallet_opportunity
Specific capture/defense opportunity with account, category/product/instrument, estimated revenue/GP opportunity, state, confidence and evidence.

### opportunity_constraint
Versioned diagnosis of the primary constraint, supporting evidence, confidence, owner and review date.

### commercial_action
Proposed/approved/rejected/in-progress/completed/no-action intervention with expected economics, required effort/capital, owner, due date and idempotent command history.

### strategic_price_link
Reference from a commercial action/opportunity to the governed Pricing Engine decision/exception/contract. Do not duplicate price authority in Suprabha 80.

### action_outcome
Append-only evaluation of expected versus actual wallet, revenue, GP, cash and capital outcomes.

### opportunity_score_snapshot
Versioned deterministic ranking output with component scores and policy version so management can understand why an action was ranked.

Use internal UUIDs, human-readable references where useful, effective dating, audit events, optimistic versioning and append-only history for material decisions.

## 11. Workflow/state model

Suggested opportunity lifecycle:

IDENTIFIED → QUALIFIED → CONSTRAINT_DIAGNOSED → ACTION_PROPOSED → APPROVED → IN_PROGRESS → OUTCOME_DUE → MEASURED → WON / PARTIAL / FAILED / STOPPED.

ON_HOLD and REJECTED should be explicit exceptions.

Pricing exceptions remain inside the Pricing Engine; opportunity workflow references them rather than reimplementing approval logic.

## 12. Management Action Center — deliberately small

The primary management screen should not be another dashboard full of metrics.

It should present a short ranked list such as:

1. Action
2. Customer
3. Why now / diagnosed constraint
4. Expected monthly wallet gain or GP protected
5. Expected GP gain
6. Capital/effort required
7. Confidence
8. Due date / owner
9. Recommended next action

Default view should be aggressively Pareto-filtered. Management may drill into the long tail, but the system should not demand attention for low-value opportunities.

A useful weekly objective is:

> Show the smallest set of actions responsible for the largest share of expected risk-adjusted economic gain.

## 13. Deterministic V1 before AI

Do not start this with an LLM or opaque machine-learning model.

V1 should use explicit, versioned business rules and transparent scoring bands. Every recommendation must expose WHY it exists.

Only after sufficient outcome history exists should the system estimate empirical probabilities such as price-response likelihood, placement success, churn risk, or action effectiveness. Any future model remains advisory and may not directly change governed prices, financial truth, stock truth, credit limits, or approved commercial commitments.

## 14. Anti-complexity rules

To preserve the lightweight Suprabha OS philosophy:

- do not create twelve independent optimization services;
- implement one commercial intelligence module with four logical engines: Focus, Constraint, Action, Learning;
- reuse Customer, Pricing, Orders, Tally evidence, Receivables and Instruments data rather than duplicate it;
- compute read models asynchronously where possible; do not burden order-entry transactions with wallet analytics;
- pricing remains transactional; opportunity ranking is analytical/advisory;
- missing or low-confidence wallet data must be visible, never invented;
- allow management override, but require reason and audit;
- no recommendation should be presented without its main evidence and expected economics;
- NO_ACTION is a valid recommendation.

## 15. Proposed implementation sequence

This design must not expand the current pricing build before consolidation and pilot readiness.

Recommended later sequence:

1. Complete, test, consolidate and pilot the current Customer Pricing Engine.
2. Establish reliable customer/division wallet snapshots and confidence scoring.
3. Build Pareto account/opportunity ranking as a read-only management view.
4. Add explicit constraint diagnosis and evidence capture.
5. Add deterministic action ranking and the small Management Action Center.
6. Link strategic price actions to the existing governed Pricing Engine.
7. Record expected outcomes and build the outcome-review loop.
8. After enough real history, calibrate scoring/probabilities from actual Suprabha outcomes.
9. Only then consider predictive ML/AI assistance.

## 16. Non-negotiable principles

1. **Profitable wallet capture, not maximum turnover.**
2. **Pareto decides where attention goes; it does not force an exact 80/20 distribution.**
3. **Diagnose the constraint before discounting.**
4. **Price is one lever, not the default lever.**
5. **Optimize absolute economic gain and scarce capital/time, not GP% alone.**
6. **Protect existing profitable wallet as seriously as acquiring new wallet.**
7. **Every strategic concession must have an expected outcome and later measurement.**
8. **A failed discount must not silently become permanent.**
9. **Recommendations must be explainable, versioned and auditable.**
10. **The system should tell people what not to work on.**
11. **No AI or wallet algorithm may bypass Pricing Engine, accounting, credit, audit or ACID controls.**
12. **Keep the operational experience simple even when the underlying reasoning is sophisticated.**

## 17. Implementation status

This document is the approved design direction and future integration specification. It does not mean Pareto wallet optimization, constraint diagnosis, action ranking, or learning loops are currently coded.

The current Customer Pricing Engine remains the transactional foundation. Its authority boundary, restricted commercial access, ACID approval workflow, immutable pricing/billing snapshots, Tally authority boundary, and deployment gates remain unchanged. The Suprabha 80 optimization layer should be implemented only after the current pricing build is consolidated, tested and ready for office pilot.

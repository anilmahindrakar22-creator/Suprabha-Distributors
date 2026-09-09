# Suprabha OS delivery roadmap

The roadmap grows one transactional spine. It is not authorization to build every listed domain simultaneously.

The current detailed requirements, acceptance gates and ordered recovery slices are in [Requirements and delivery plan](REQUIREMENTS-AND-DELIVERY-PLAN.md). That plan takes precedence over conflicting historical milestone wording below. Next implementation: durable connector recovery (R1), after the R0 deployment and measurement audit.

## Current baseline — StockFlow OMS Phase 3

Preserve and release the existing order flow, Tally catalog/customer lookup, fulfilment data, audit history, user management, delivery exceptions, installation/commissioning and operations dashboard. Phase 3 is complete only after the feature branch passes CI, review and an explicitly approved production release.

## Milestone 1 — Core hardening

**Goal:** make current OMS commands safe foundations for inventory and future modules.

- Central permission and row-scope policy.
- Central order-transition policy with obsolete reservation states removed from the active path.
- Idempotency for every mutation, not only order creation.
- Structured before/after audit payloads with request IDs.
- Database-enforced prohibition of hard deletion for business records.
- Constraint, concurrency and rollback integration tests.

**Exit gate:** two simultaneous users cannot overwrite an order; repeated commands cannot duplicate work; every critical change is attributable.

## Milestone 2 — Tally inventory boundary and delivery integrity

**Goal:** keep Tally Prime as the only inventory authority while StockFlow controls the order-to-delivery workflow.

- Read the complete product catalog and stock snapshot from Tally.
- Do not enter, reserve, allocate or adjust stock in StockFlow.
- Record fulfilment quantities without claiming that Tally stock is booked.
- Capture dispatch docket, transporter, date and optional vehicle.
- Capture delivery time, receiver and optional proof-of-delivery reference.
- Preserve idempotency, database constraints and audit history for every OMS step.

**Exit gate:** an order reaches delivery with evidence and a complete user log, while every inventory transaction remains in Tally.

## Milestone 3 — Tally billing reconciliation

- Transactional outbox worker with acknowledgement, retry and dead-letter visibility.
- Idempotent Tally invoice handoff and external voucher ID.
- Match OMS orders to Tally sales vouchers without writing stock from StockFlow.
- Surface unmatched or conflicting invoice references for accounts.
- Retain partial fulfilment and dispatch/delivery closure audit.

**Current slice:** the connector exports read-only voucher identity and billed orders show verified, unmatched or awaiting-sync status.

**Local next-release work:** reuse cached sales-voucher lines to compare exact Tally item names and aggregated quantities, display differences separately from invoice identity, and let authorised Accounts/Operations users record an immutable reconciliation review. This does not query or write Tally during browser use.

**Exit gate:** an order reaches billing and dispatch once, with verified customer/invoice identity and recoverable integration failures. Batch records remain in Tally.

## Immediate priority — lightweight recovery

Feature delivery now proceeds before the remaining [lightweight recovery work](LIGHTWEIGHT-RECOVERY.md), while every new slice must preserve the same-app, Tally-source-of-truth boundary. Performance improvements remain the next dedicated stream after the agreed features. Do not describe the OMS as fully offline-capable until reconnect and account-isolation tests pass.

## Milestone 4 — Installed-base and service operations

- Installed-equipment register derived from completed order installations.
- Promote installation records into canonical instruments/assets.
- Ownership, placement, warranty and contract.
- Service ticket logging and resolution linked to installed equipment, with priority, server-side permissions and immutable activity history (foundation delivered locally; visits, parts and downtime remain).
- Preventive-maintenance queue.
- Estimated reagent consumption gap, clearly labelled as an estimate.

## Milestone 5 — Customer, commercial and finance controls

- Expanded customer master with duplicate controls, contacts, addresses and assignments.
- Credit policy and Tally receivables reconciliation.
- Customer-specific pricing and approval thresholds.
- CRM/quotations and salesperson row scope.
- Placement approval and recorded overrides.

## Milestone 6 — Governed intelligence and external access

- KPI registry containing definition, formula, source, time range, refresh and drill-down.
- Command Center built only on verified transactional data.
- Forecasting and opportunity scoring with method/confidence metadata.
- Future customer interface using the same API, identity, customer, catalog and order engine.

### Territory and account intelligence

This is a future intelligence layer and must not expand or delay the current Phase 3 production/pilot gate.

- Territory Map built from the canonical customer/account master; the map is a visualization, never a second customer database.
- Customer, Opportunity, Equipment and Sales Territory map modes using the same underlying verified data.
- Account intelligence may include customer type, assigned salesperson, installed equipment, key contacts, actual revenue, estimated wallet, wallet share, untapped wallet, open opportunities, last visit and account/credit status.
- Derived metrics such as wallet share and untapped wallet must be calculated from canonical inputs rather than stored as competing truths.
- Estimated market intelligence must carry method/source, confidence and last-verified metadata.
- Filters may include division, customer type, salesperson, brand/equipment, account status, wallet share, revenue, GP, opportunity value, last visit, credit risk, placement status and geography.

### Stakeholder Power Map

The Power Map answers who influences a customer decision and how influence flows through the account. It is linked to the canonical customer/contact and CRM opportunity records rather than duplicating contacts.

- Classify relevant contacts by decision role, including Decision Maker/Economic Buyer, Champion, Influencer, Technical Evaluator, User, Gatekeeper, Blocker and Coach where applicable.
- Capture formal authority separately from observed actual influence.
- Represent directional stakeholder relationships and influence strength (for example strong, medium or low) with evidence/confidence and last verification.
- Capture relationship with Suprabha, sentiment/engagement, brand preference, price sensitivity, technical influence, access, relationship owner, last interaction and key concern where useful.
- Allow opportunity-level views to identify the likely decision maker, champion, blocker and strongest known influence path.
- Future recommendations may use verified opportunity and stakeholder data to suggest account actions, but AI decision automation remains explicitly deferred.

### Social Styles for stakeholder communication

Social Style is a salesperson-observed communication aid, not a psychological diagnosis. Classification must remain evidence-based, editable and explicitly uncertain when observations are insufficient.

- Supported observed styles: Analytical, Driving, Expressive and Amiable.
- Store primary style, optional secondary style, score distribution, confidence, evidence/notes, recorded_by and last_verified_at.
- Include a `Not enough information` state; avoid forcing a classification from weak evidence.
- Prefer classification only after several meaningful interactions (guideline: approximately 3–5 interactions).
- Analytical guidance: lead with data, technical evidence, accuracy, method, throughput, validation, CPT and comparisons.
- Driving guidance: be concise and lead with results, ROI, price, turnaround, commercial outcome and a clear recommendation.
- Expressive guidance: emphasize innovation, differentiation, future potential, demonstrations and relevant success stories.
- Amiable guidance: emphasize trust, service, training, continuity, references and implementation reassurance.

#### Salesperson observation questionnaire

A future CRM workflow may use ten quick observational questions rather than asking the customer to self-classify. The questions should cover:

1. What the stakeholder asks about first when evaluating an instrument: data/specifications, result/price/timeline, novelty/differentiation, or service/support/reliability.
2. Decision speed: methodical, fast/decisive, intuitive, or consultative.
3. Meeting behaviour: detailed questioning, directing/controlling, enthusiastic/conversational, or listening/cooperative.
4. Best response trigger: evidence/comparisons, bottom-line benefits, ideas/possibilities, or trust/reassurance.
5. Option evaluation: careful comparison, asks for the best option, explores interesting options, or seeks the safe/comfortable choice.
6. Communication style: precise/factual, short/direct, animated/conversational, or calm/friendly.
7. Main pre-purchase concern: technical correctness, results, differentiation, or support.
8. Behaviour under pressure: asks for more information, becomes more forceful, becomes more animated/emotional, or avoids conflict/delays.
9. Importance of relationship: follows demonstrated competence, secondary to results, very important, or extremely important.
10. Proposal preference: detailed comparison, short recommendation with numbers, attractive presentation/demo, or explanation plus follow-up discussion.

Questionnaire scoring: A = Analytical, B = Driving, C = Expressive, D = Amiable. Retain the full score distribution and use it to derive primary/secondary style and confidence rather than reducing every person to a single permanent label.

**Intelligence guardrail:** Territory Maps, Power Maps and Social Styles must inherit existing authorization/row scope, auditability and one-source-of-truth principles. Observations and estimates must never be presented as verified facts without provenance/confidence metadata.

## Explicitly deferred

- Returns, until the product decision changes.
- Stock entry, reservation, batch allocation and adjustment in StockFlow.
- Native mobile applications.
- AI decision automation.
- Advanced forecasting and market-share algorithms.
- Courier and WhatsApp automation.
- Microservices, Kafka and Kubernetes.

## Cost and portability guardrails

- Prefer PostgreSQL, TypeScript, GitHub CI and existing managed/free tiers while limits remain operationally adequate.
- Keep the application deployable locally or on managed infrastructure through configuration.
- Add paid infrastructure only for a measured reliability, security or capacity need.
- Never make a daily-use Tally workstation the only database or only backup location.

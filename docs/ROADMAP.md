# Suprabha OS delivery roadmap

The roadmap grows one transactional spine. It is not authorization to build every listed domain simultaneously.

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

**Exit gate:** an order reaches billing and dispatch once, with traceable batches and recoverable integration failures.

## Milestone 4 — Installed-base and service operations

- Installed-equipment register derived from completed order installations.
- Promote installation records into canonical instruments/assets.
- Ownership, placement, warranty and contract.
- Service tickets, visits, parts, downtime and resolution.
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

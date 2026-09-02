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

## Milestone 2 — Minimal inventory vertical slice

**Goal:** one batch-aware ledger flow without replacing Tally.

- Canonical product mapping and tracking requirements.
- Warehouse/location and batch/expiry model.
- Append-only inventory movement ledger.
- Goods receipt and authorised adjustment.
- Derived on-hand, reserved and available balances.
- FEFO allocation for expiry-tracked reagents.
- Atomic internal reservation and release.
- Reconciliation view against the latest Tally snapshot.

**Exit gate:** a phone order can reserve the correct batches under concurrent use without negative availability, while Tally remains untouched.

## Milestone 3 — Billing and dispatch integrity

- Transactional outbox worker with acknowledgement, retry and dead-letter visibility.
- Idempotent Tally invoice handoff and external voucher ID.
- Pick list from allocated batches.
- Batch/expiry verification and partial fulfilment.
- Cold-chain checklist and packing evidence.
- Dispatch, delivery and closure audit.

**Exit gate:** an order reaches billing and dispatch once, with traceable batches and recoverable integration failures.

## Milestone 4 — Installed-base and service operations

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


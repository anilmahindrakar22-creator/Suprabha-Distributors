# Suprabha OS architecture

## Purpose

Suprabha OS is a lightweight, transaction-safe operating system for a diagnostics equipment and reagent distribution business. StockFlow OMS is its first operational module. Existing order, stock dashboard, delivery exception, installation, user-management and Tally connector behavior remains part of the same application and database.

The system starts as a **modular monolith with PostgreSQL**. It must remain portable between managed hosting and a local office server. Microservices, Kafka, Kubernetes and multiple transactional databases are out of scope until measured operational scale creates a clear need.

## Architecture

```text
Staff / Sales / Management UI        Future Customer UI
                 \                    /
                  One HTTPS API layer
                           |
        Modular TypeScript application layer
                           |
 Customer | Catalog | Orders | Inventory | Dispatch
 Finance Integration | Instruments | Service | Intelligence
                           |
                 PostgreSQL system of record
                           |
              Transactional integration outbox
                           |
              Worker -> Tally / notifications
```

There is one authoritative transactional database per environment. Local and cloud deployments must never accept independent writes to the same business scope. A future customer interface uses the same order engine and canonical masters; it does not create a second order database.

## Deployment evolution

1. **Current:** managed web application and PostgreSQL, with the office connector supplying Tally data.
2. **Local-capable:** the same application can run on an office server through configuration, with automated backups and a local Tally worker.
3. **Hybrid/cloud-ready:** remote interfaces use HTTPS APIs. PostgreSQL is never exposed directly to the internet. Any replication has an explicitly documented authority and conflict policy.

Application code uses configuration such as `DATABASE_URL`; it must not depend on a drive letter, machine name or hard-coded office path.

## Bounded domains

| Domain | Owns | Initial scope |
|---|---|---|
| Identity | users, roles, permissions, assignments | active membership and server-side RBAC |
| Customer | canonical customer, contacts, addresses, credit configuration | Tally-ledger identity and duplicate prevention |
| Catalog | products, brands, tax, pack size, tracking requirements | canonical Tally SKU mapping |
| Orders | capture, validation, approval and state machine | current StockFlow OMS |
| Inventory | batches, locations, movements, reservations | next transactional vertical slice |
| Dispatch | pick, quality check, packing, cold chain, delivery | extend existing fulfilment flow |
| Procurement | suppliers, purchase orders and receipts | later operational phase |
| Finance integration | Tally invoices, receipts, outstanding and reconciliation | outbox-driven acknowledgement |
| Instruments | installed assets, placements, contracts and consumption | extend Phase 3 installation records |
| Market/CRM | leads, visits, opportunities and account ownership | later commercial phase |
| Intelligence | governed KPIs, forecasting and decision support | only after transactional truth exists |

Domains own their rules and tables. Cross-domain mutation occurs through an application command inside one database transaction or through an outbox event after commit. UI components do not bypass domain commands.

## Transactional inventory model

Inventory is an append-only movement ledger, not a mutable `stock_quantity` field.

```text
Product -> Batch -> Warehouse -> Location
                         |
                 Inventory movement
```

Movement types initially include goods receipt, reservation, reservation release, dispatch, damage, quarantine, expiry and authorised adjustment. Every movement records quantity, product, batch, location, source document, actor, request ID and timestamp.

Balances are derived projections:

```text
available = on_hand - reserved - quarantine - damaged - expired
```

Negative available or physical stock is rejected by default. Batch allocation uses FEFO where the product requires expiry tracking.

StockFlow reservation is an **internal operational hold**. It does not create or alter a Tally voucher. Reservation must lock inventory deterministically and commit the reservation, order transition and audit event atomically. Failure rolls back the entire command.

## Order state machine

The current lightweight OMS remains usable while its internal states converge on these business stages:

```text
Captured -> Validated -> Approved -> Stock allocated
-> Ready for billing -> Invoiced -> Pick/pack -> Dispatched -> Delivered/closed
```

Cancellation and hold are explicit exception outcomes. Returns remain deferred by current product decision. No arbitrary backward transition is allowed. Each command declares allowed source states, target state, role, required evidence and audit event.

## Authorization

Authorization is evaluated server-side using named permissions and row scope. Initial roles map to permissions rather than being scattered through UI conditionals:

- Management/owner: global operational and financial oversight.
- Order desk: customers, order capture and permitted pre-billing edits.
- Warehouse: receipts, batches, allocation, picking, packing and dispatch.
- Sales: assigned customers, quotations and orders within permitted commercial scope.
- Accounts: Tally reconciliation, credit and receivables.
- Service: installed instruments and service operations.
- Customer: future self-service access restricted to its own records.

The current role names may be migrated without breaking active accounts. Sensitive pricing, margin, credit and territory data requires explicit permissions and row filters.

## Reliability patterns

- All mutating commands carry a request/idempotency key.
- A repeated completed command returns the original result.
- Editable aggregates use optimistic versions and return a conflict rather than overwrite newer work.
- External integration is `pending -> processing -> synced` or `failed -> retrying`; sending is not success.
- The transactional outbox is written in the same commit as the business change.
- Audit events are append-only and include actor, entity, action, before, after, reason and request ID.
- Business transactions cannot be hard-deleted through application or service roles.

## Non-functional requirements

- Normal operational pages target a sub-two-second response at expected office load.
- Internet/Tally outages do not corrupt committed orders; dependent work remains visible and retryable.
- Backups are automated, encrypted where copied off-site, retained by policy and restore-tested.
- Secrets remain outside source control; production traffic uses HTTPS.
- Logs are structured and exclude credentials and unnecessary customer data.
- Critical flows require unit, integration, constraint, API, concurrency, rollback and workflow tests.

## Architecture decision rule

A new service, database, queue or proprietary platform is adopted only when a documented problem cannot be met safely by the modular monolith and PostgreSQL. The decision records operational benefit, cost, failure modes, migration and rollback.


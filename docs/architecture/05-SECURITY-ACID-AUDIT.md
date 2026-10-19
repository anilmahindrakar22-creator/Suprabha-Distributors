# Security, ACID, concurrency and audit

**Status:** canonical.
**Sources:** [SUPRABHA_OS_ARCHITECTURE §Authorization, §Reliability](../SUPRABHA_OS_ARCHITECTURE.md); spec §§14, 17; ADR-0002, ADR-0013, ADR-0017, ADR-0018; code: `supabase/tests/*.sql`.
**Last verified:** 13 Oct 2026.

## 1. Write path (every mutation)
1. The signed-in user calls an app API route. The route validates a bounded payload.
2. The route calls the Edge gateway with the gateway key. The Edge gateway calls a `security definer` SQL gateway.
3. The SQL gateway runs, in **one transaction**:
   - checks the gateway key;
   - checks the active member's role set against the action, plus row scope;
   - `begin_stockflow_command(actor, action, key, payload)`: a replay returns the stored result, and the same key with a different payload is rejected;
   - validates input;
   - locks the aggregate `FOR UPDATE` and checks `expectedVersion`; stale raises **`PT409`**;
   - applies the change and bumps the version;
   - appends an audit event (and an outbox record if downstream work follows);
   - `finish_stockflow_command(...)`.
4. The route maps errors: `42501` → 403, `PT409` → 409, validation → 400. Commercial data is sent `private, no-store`.

## 2. Guarantees
- **No hard delete:** business tables carry `prevent_business_delete`; event tables carry `prevent_order_event_mutation`, which blocks update and delete.
- **Grants:** gateways are executable by `service_role` only. Revoke from `public`, `anon` and `authenticated`. RLS is enabled on private tables.
- **External boundaries:** acknowledgement, retry and reconciliation. Sending is not success. ACID never claims to span browser → cloud → Tally.

## 3. Roles (as built; ADR-0013)
- The roles are `administrator`, `sales`, `operations`, `warehouse`, `accounts`, `management` and `viewer`, assigned as role sets.
- **Commercial-sensitive reads:** Economics and pricing evidence are limited to administrator, management and accounts (per the existing routes). Market/Commercial Intelligence is limited to administrator and management until `customer_assignment` exists, at which point sales gets row-scoped access.
- **Open:** a director tier ([D-04](../planning/OPEN-DECISIONS.md)).

## 4. Required tests per new domain
- SQL suite in `tests/pricing-migration-local.ps1`:
  - access denial for each role;
  - idempotent replay;
  - changed-payload rejection;
  - stale `PT409`;
  - immutability;
  - two-session concurrency where races are possible.
- Route unit tests: 401, 400, passthrough of 403 and 409.
- Browser tests on phone and desktop.

## 5. Personal data
- Stakeholder and contact data is minimal and business-only, visible according to role and assignment, and erased by redaction ([ADR-0018](06-DECISION-RECORDS.md), proposed).
- Logs exclude credentials and unnecessary customer data.

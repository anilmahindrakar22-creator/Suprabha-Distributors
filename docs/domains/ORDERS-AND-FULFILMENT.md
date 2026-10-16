# Orders and fulfilment

**Purpose and scope:** order capture → confirmation → pick/pack → Tally billing hand-off → dispatch → delivery, plus the related notifications.
**Status:** IMPLEMENTED BUT NOT VERIFIED; pilot on HOLD ([IMPLEMENTATION-STATUS](../planning/IMPLEMENTATION-STATUS.md)).
**Sources:** [REQUIREMENTS §3 (REQ-01–11)](../REQUIREMENTS-AND-DELIVERY-PLAN.md); [SUPRABHA_OS_ARCHITECTURE §Order state machine](../SUPRABHA_OS_ARCHITECTURE.md); [ORDERS-UI-REDESIGN-PLAN](../ORDERS-UI-REDESIGN-PLAN.md); [ORDER-NOTIFICATIONS](../ORDER-NOTIFICATIONS.md); [PUSH-NOTIFICATIONS](../PUSH-NOTIFICATIONS.md); spec §31 (fast capture).
**Last verified:** 13 Oct 2026.

## Approved decisions
- Visible stages: To confirm → Preparing (pick and pack together) → Tally billing → Dispatch → Delivered.
- Cancellation and hold are exceptions. Returns are deferred.
- No arbitrary backward transitions.
- Each command declares its source states, target, role, evidence and audit (architecture doc; REQ-05).
- No reservation, separate picking/packed confirmations, or mandatory hold step (REQ-05).
- Edits after billing invalidate and recheck reconciliation and keep history (REQ-06).
- Invoice identity is verified on company + financial year + voucher + customer ledger. Quantity reconciliation is separate (REQ-08–11).

## Functional requirements
REQ-01–REQ-11, verbatim in the source.

**Phase 1 additions:**
- customer-specific frequent products;
- keyboard-first entry;
- minimal mandatory fields;
- pack/unit clarity (spec §31).

## Non-functional
Order save p95 < 2 s; useful list < 2 s warm; ≤ 50 summaries per page (REQUIREMENTS §6).

## Dependencies
Customer, Catalog, Pricing, Tally integration.

## Acceptance
Phase 0 gates ([RELEASE-GATES](../planning/RELEASE-GATES.md)).

## Open decisions
None specific.

# Procurement requirements (demand-driven)

**Purpose and scope:**
- Turn unfulfillable customer demand into traceable procurement requirements.
- Follow them until Tally shows that stock has arrived.

**Status:** PARTIALLY IMPLEMENTED.
- Migrations: `20261001061531_customer_demand_requirements`, `20261001070000_requirement_waiting_orders`, `20261001073000_reported_stock_increase_alerts`.
- UI: `components/procurement-requirements.tsx`.
- PO/GRN references are not built. Consolidation and arrival-matching depth is unverified.

**Sources:** spec §31 (demand-driven replenishment); owner brief §Phase 1; ADR-0001.
**Last verified:** 13 Oct 2026.

## Approved decisions
- **Inputs:** a fresh Tally snapshot decides shortage. Advisory stock is never treated as available.
- **Linking and consolidation:**
  - requirements link to the demand that originated them;
  - compatible requirements are consolidated without losing that traceability;
  - duplicates are prevented.
- **Visibility:**
  - pending procurement and the customer orders it affects;
  - Tally arrivals matched to open requirements;
  - orders that can now be fulfilled are highlighted.
- **Tally stays authoritative:** future POs and GRNs **reference** Tally transactions. No competing ledger.

## Dependencies
Orders; Catalog; Tally snapshot freshness.

## Acceptance
Phase 1 gates.

# Customer domain

**Purpose and scope:** the single canonical account master used by every module. It covers:
- accounts (Tally-linked; prospects proposed);
- contacts;
- addresses and geography;
- owner and territory assignment;
- account classification.

**Status:**
- **Accounts:** IMPLEMENTED BUT NOT VERIFIED (`stockflow_customers`, Tally ledger sync, lazy directory, Tally balance).
- **Contacts, assignment, classification, geography, prospects:** APPROVED DESIGN ONLY or gaps ([DOCUMENT-INVENTORY §4](../planning/DOCUMENT-INVENTORY.md)).

**Sources:** [REQUIREMENTS REQ-02](../REQUIREMENTS-AND-DELIVERY-PLAN.md); [SUPRABHA_OS_ARCHITECTURE §Bounded domains](../SUPRABHA_OS_ARCHITECTURE.md); spec FR-01, §26 (MAP-FR-04/05, 26.10); dominance framework; ADR-0009.
**Last verified:** 13 Oct 2026.

## Approved decisions
- **Identity:** the Tally ledger identity (`tally_key`) plus the display name. Never silently create or merge Tally ledgers. Ambiguous legacy names need a visible mapping step (REQ-02).
- **No duplicate customer master** in any module (FR-01).
- **Coordinates** belong here, never on opportunity or action records. Corrections go through the customer process (MAP-FR-04/05).

## Proposed (Phase 4)
- **`customer_contact`:** business role and contact only (ADR-0018).
- **`customer_location`:** exact pin, or town, with a precision flag, source, verification and confidence. Never auto-geocoded with customer data.
- **`customer_assignment`:** effective-dated owner and territory. Drives sales row scope (spec §17).
- **Classification:** A/B under a versioned policy ([SUPRABHA80 §3](../intelligence/SUPRABHA80.md)).
- **Prospects:** accounts with no Tally ledger, linked when the first invoice arrives, with a person confirming (ADR-0009).

## Dependencies
Tally integration (ledgers); Identity (row scope).

## Acceptance
Phase 4 gates.

## Open decisions
D-07, D-08, D-13.

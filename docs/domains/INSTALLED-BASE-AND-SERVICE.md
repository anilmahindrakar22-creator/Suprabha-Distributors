# Installed base, installations and service

**Purpose and scope:**
- installation and commissioning;
- the canonical installed-base register;
- service tickets.

Investment economics live in [INSTRUMENT-ECONOMICS](../intelligence/INSTRUMENT-ECONOMICS.md).

**Status:**
- **Installations and service tickets:** IMPLEMENTED BUT NOT VERIFIED (`20260902113000`, `20260908173500`). The Service screen holds the equipment register (RC `b42c633`).
- **Unified installed-base register:** PROPOSED (ADR-0011); design: [INSTALLED-BASE-REGISTER-DESIGN](../INSTALLED-BASE-REGISTER-DESIGN.md).
- **Visits, parts, downtime, PM:** DEFERRED (owner, 13 Oct; [SERVICE-MILESTONE-4-DESIGN](../SERVICE-MILESTONE-4-DESIGN.md)).

**Sources:** [SUPRABHA_OS_ARCHITECTURE §Instruments](../SUPRABHA_OS_ARCHITECTURE.md); [ROADMAP M4](../ROADMAP.md); economics plan §2; owner brief §Phase 2.
**Last verified:** 13 Oct 2026.

## Approved decisions
- **Installations come from orders.** Completed installations form the register today. Historical instruments are registered from Tally sale lines (`20261010071925`).
- **Relocation creates a new placement.** Old history is never rewritten (economics plan §2).
- **Warranty, contract and service-owner fields** belong to the register (Phase 2), not to the deferred service workflow.

## Proposed (Phase 2)
One `installed_instrument` register, which:
- links each installation to its economic placement;
- carries manufacturer, model, serial, site, ownership/commercial model, warranty/contract, supplier/purchase evidence and responsible people.

## Open decisions
D-04 (approval tier); service workflow remains deferred.

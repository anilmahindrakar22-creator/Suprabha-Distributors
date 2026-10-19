# Functional requirements: index and status

**Status:** canonical index.
- Requirement text stays in its source document, so nothing is duplicated.
- This table records ID ranges, the canonical home and the status.

**Last verified:** 13 Oct 2026.

| Requirement set | Source (text) | Canonical home | Status |
| --- | --- | --- | --- |
| OMS REQ-01–07 (capture, flow, edits, history) | [REQUIREMENTS §3](../REQUIREMENTS-AND-DELIVERY-PLAN.md) | [ORDERS-AND-FULFILMENT](../domains/ORDERS-AND-FULFILMENT.md) | IMPLEMENTED BUT NOT VERIFIED |
| REQ-08–10 invoice identity | REQUIREMENTS §3 | [04-TALLY-INTEGRATION](../architecture/04-TALLY-INTEGRATION.md) | IMPLEMENTED BUT NOT VERIFIED |
| REQ-11 quantity reconciliation | REQUIREMENTS §3 | same | APPROVED DESIGN ONLY |
| REQ-12–16 connector | REQUIREMENTS §4 | same | PARTIALLY IMPLEMENTED (full-sales export pending) |
| REQ-17–20 offline and privacy | REQUIREMENTS §5 | [05-SECURITY-ACID-AUDIT](../architecture/05-SECURITY-ACID-AUDIT.md) | PARTIALLY IMPLEMENTED (device acceptance open) |
| Performance budgets | REQUIREMENTS §6; spec §§16, 30 | [RELEASE-GATES](../planning/RELEASE-GATES.md) | targets, not measured |
| Pricing rules | [CUSTOMER-PRICE-BOOK-AND-BASE-PRICE](../CUSTOMER-PRICE-BOOK-AND-BASE-PRICE.md); spec §28 | [CATALOG-AND-PRICING](../domains/CATALOG-AND-PRICING.md) | IMPLEMENTED BUT NOT VERIFIED |
| Fast capture, demand-driven replenishment | spec §31 | [PROCUREMENT](../domains/PROCUREMENT.md), Orders | PARTIALLY IMPLEMENTED |
| Instrument economics and leakage | [economics plan §§1–12](../INSTRUMENT-ECONOMICS-AND-REAGENT-LEAKAGE-PLAN.md) | [INSTRUMENT-ECONOMICS](../intelligence/INSTRUMENT-ECONOMICS.md) | PARTIALLY IMPLEMENTED (acceptance) |
| Suprabha 80 FR-01–18 | spec §10 | [SUPRABHA80](../intelligence/SUPRABHA80.md) | APPROVED DESIGN ONLY |
| Account dominance (classes, stages, scorecard) | [`12a5679`](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/blob/839497a/docs/ROADMAP.md) | SUPRABHA80 | APPROVED DESIGN ONLY (D-02, D-03 open) |
| Action Center, Diagnosis, Execution, Outcomes, Coverage | spec §§4–9 | [ACTION-CENTER](../intelligence/ACTION-CENTER.md) | APPROVED DESIGN ONLY |
| MAP-FR-01–12 | spec §26.9 | [MARKET-MAPS](../intelligence/MARKET-MAPS.md) | APPROVED DESIGN ONLY |
| Power Map, Social Styles | [`cba7f67`](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/blob/cba7f67/docs/ROADMAP.md) | [POWER-MAPS](../intelligence/POWER-MAPS.md) | APPROVED DESIGN ONLY |
| KPI registry and Command Center | [`828803b`](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/blob/839497a/docs/ROADMAP.md) | [COMMAND-CENTER](../intelligence/COMMAND-CENTER.md) | APPROVED DESIGN ONLY |
| Service visits, PM, downtime | [SERVICE-MILESTONE-4-DESIGN](../SERVICE-MILESTONE-4-DESIGN.md) | [INSTALLED-BASE-AND-SERVICE](../domains/INSTALLED-BASE-AND-SERVICE.md) | DEFERRED |
| Receivables and collections | KPI framework; ROADMAP M5 | Command Center (later) | DEFERRED |
| Growth engines | [GROWTH-AND-SCALE](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/blob/839497a/docs/GROWTH-AND-SCALE-ARCHITECTURE.md) | MASTER-ROADMAP §Future | PROPOSED / NOT APPROVED |
| Inventory ledger, reservation, FEFO allocation | early Sep migrations | ADR-0001 | SUPERSEDED |

The full source → requirement trace is in [DOCUMENT-INVENTORY §3](../planning/DOCUMENT-INVENTORY.md).

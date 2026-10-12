# Catalog and pricing

**Purpose and scope:**
- the catalog mirrors Tally items (pack, unit, item group → diagnostic division);
- the Customer Pricing Engine is the **only** governed price authority (ADR-0003).

**Status:** IMPLEMENTED BUT NOT VERIFIED. The pricing status doc says "not pilot-ready" ([PRICE-BOOK-IMPLEMENTATION-STATUS](../PRICE-BOOK-IMPLEMENTATION-STATUS.md)).
**Sources:**
- [CUSTOMER-PRICE-BOOK-AND-BASE-PRICE](../CUSTOMER-PRICE-BOOK-AND-BASE-PRICE.md) (authoritative rules);
- [CUSTOMER-PRICING-ENGINE-IMPLEMENTATION](../CUSTOMER-PRICING-ENGINE-IMPLEMENTATION.md);
- [TALLY-PRICING-HISTORY-AND-SAFE-BILLING-TEST](../TALLY-PRICING-HISTORY-AND-SAFE-BILLING-TEST.md);
- REQ-03;
- wallet-capture §6 (pricing roles, governed levels);
- spec §28 (pricing normal path).

**Last verified:** 13 Oct 2026.

## Approved decisions
- **Price book:** a per-customer price book with base price, governed approval, group gross margin and exception approval. Prices are applied to orders from governed decisions.
- **Pricing roles:** milk/traffic, normal and specialty products.
- **Governed levels:** target → strategic → management threshold → absolute floor → block. Nothing silently crosses the floor (wallet-capture §6).
- **Commercial Intelligence** may only *initiate* a pricing review via `strategic_price_link` (ADR-0003).
- **Catalog search** covers every Tally item. Pack names are never parsed as quantities (REQ-03).

## Dependencies
Tally (sales and purchase price evidence); Customer.

## Open
- **Branch content:** check `feature/customer-pricing-engine` content before retiring it ([D-10](../planning/OPEN-DECISIONS.md)).
- **Division mapping:** keyed on the Tally item group (Phase 5; ADR-0007).

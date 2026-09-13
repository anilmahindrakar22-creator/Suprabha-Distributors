# Customer Price Book and Product Base Price

## Status

This is the required next pricing slice. The current build is still order-centric and supports one customer-item price contract at a time. This document defines the customer-first pricing workflow to implement next.

## Customer-first pricing workflow

1. Open Pricing.
2. Select a customer.
3. Prefill the workspace with all Tally items the customer has genuinely purchased before.
4. For every row show: item, last eligible Tally rate, Product Base Price, customer-specific price, effective price source, latest purchase/landed cost, GP amount and GP percentage.
5. Allow direct editing of one or more customer-specific prices in the table.
6. Add Product / All Products remains available for items never bought before.
7. Submit only changed rows as effective-dated governed customer-price proposals.

Recommended tabs: Purchased (default), Special Prices, All Products.

Each effective price should clearly show its source, for example:
- ₹425 · Customer Special
- ₹460 · Base Price
- ₹438 · Last Tally Rate
- Review Required

## Product Base Price

Add a separate effective-dated Product Base Price layer. It applies to every customer unless a valid approved customer-specific override exists.

Required resolution order:
1. Customer-specific approved price
2. Product Base Price
3. Last genuine Tally selling rate for the exact customer and item
4. Price review required

A base-price change must never overwrite negotiated customer prices.

Example: if Customer A has ₹425 special, Customer B uses base ₹450, Customer C has ₹440 special, and Customer D uses base ₹450, changing base price to ₹460 leaves A at ₹425 and C at ₹440 while B and D become ₹460.

## Base-price impact preview

Before proposing a base-price change, show the commercial impact.

```text
Change Glucose base price

₹450 → ₹460

Customers affected:             83
Customers with special price:   17
Customers actually changing:    66

Current cost:                  ₹310
New GP:                        ₹150
New GP%:                       32.6%

[ Review affected customers ]

         [Cancel] [Propose Change]
```

Definitions:
- Customers affected = distinct active customers with genuine historical purchase evidence for that item.
- Customers with special price = affected customers with a valid approved customer-specific price on the proposed effective date.
- Customers actually changing = affected customers who will inherit the new Product Base Price because no valid override exists.
- Current cost = latest eligible authoritative purchase/landed cost for the effective date.
- New GP = proposed base price minus current cost.
- New GP% = New GP / proposed base price × 100.

If cost evidence is missing, show Cost unavailable and require review rather than calculating a guessed GP.

Review affected customers must show a bounded paginated list with customer, current effective price, source, proposed effective price, and whether the customer changes or remains protected by a special price.

## Governance

Base-price proposals must be effective-dated, versioned, idempotent and auditable. Administrator/Management approval is required. Approval supersedes the prior base-price version without deleting history.

Impact must be recomputed server-side at approval time. If concurrent customer-specific price changes or cost evidence materially changes the preview, approval must require refresh/review rather than silently activating stale economics.

A base-price change is one governed product-level event, not one write per customer.

## Acceptance criteria

1. Customer selection loads previously purchased items without opening an order.
2. Last Tally rate, Product Base Price and customer-specific price are visible together.
3. Multiple customer prices can be edited in one customer session.
4. Base price applies automatically only where no valid customer-specific override exists.
5. Base-price impact preview shows affected, special-price and actually-changing counts.
6. Review affected customers shows exactly who changes and who remains protected.
7. Current cost, new GP and new GP% are server-derived.
8. Pricing resolution is Customer Special → Product Base Price → Last Tally Rate → Review Required.
9. Existing customer-specific prices are never overwritten by a base-price change.
10. Effective-date boundaries, stale previews, missing cost, concurrency and precedence are covered by tests.

## Implementation boundary

This document records the approved design. It does not claim the feature is coded yet. Implementation requires database migration, gateway/API actions, Pricing workspace UI, tests, migration replay and office validation before release.
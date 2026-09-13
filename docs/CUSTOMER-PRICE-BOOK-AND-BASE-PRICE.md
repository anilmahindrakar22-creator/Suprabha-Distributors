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
- ₹438 · Last Tally Rate
- ₹460 · Base Price
- Review Required

## Product Base Price

Add a separate effective-dated Product Base Price layer. It applies generally, but customer-specific evidence takes precedence where it is still economically valid.

Required resolution order:
1. Customer-specific approved price
2. Last genuine Tally selling rate for the exact customer and item, **only when authoritative purchase/landed cost has not increased since that sale**
3. Product Base Price
4. Price review required

A base-price change must never overwrite negotiated customer prices.

### Last genuine customer price eligibility

The customer's last genuine Tally rate is useful evidence because it reflects the actual commercial relationship with that exact customer. It should therefore outrank a generic Product Base Price when the underlying economics are unchanged.

However, the last Tally rate must not be reused blindly after a purchase-cost increase.

For the last genuine Customer × Item Tally price to be eligible as the effective proposed rate:

- the sale must be genuine and non-exceptional;
- the rate must be positive;
- the invoice date must be on or before the pricing date;
- authoritative purchase/landed cost evidence must exist for the historic sale date and current pricing date;
- current authoritative cost must not be higher than the cost applicable to that historic sale, subject to the configured materiality/rounding tolerance.

If current purchase/landed cost has increased, the historic customer rate is retained and shown as evidence, but it is **not automatically proposed as the current selling price**. The resolver should move to Product Base Price if a valid base price exists. If no valid base price exists, pricing becomes Review Required.

A cost decrease does not invalidate the historic customer rate by itself. Existing margin and commercial policy guardrails still apply.

The UI should make this explicit, for example:

- `₹438 · Last Tally Rate · Cost unchanged`
- `Last Tally ₹438 · not reused: purchase cost increased`
- `₹460 · Base Price · historic customer rate skipped after cost increase`

Example: if Customer A has ₹425 special, Customer B last genuinely bought at ₹438 and cost is unchanged, Customer C has ₹440 special, and Customer D has no valid customer history but uses base ₹450, then the effective prices are A ₹425, B ₹438, C ₹440, D ₹450. If B's purchase cost has increased since the ₹438 sale, B falls through to the valid Product Base Price instead of silently reusing ₹438.

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
- Customers actually changing = affected customers whose effective price resolves to Product Base Price on the proposed effective date. Customers with an eligible unchanged-cost Last Tally Rate do not automatically change merely because the Product Base Price changes.
- Current cost = latest eligible authoritative purchase/landed cost for the effective date.
- New GP = proposed base price minus current cost.
- New GP% = New GP / proposed base price × 100.

If cost evidence is missing, show Cost unavailable and require review rather than calculating a guessed GP.

Review affected customers must show a bounded paginated list with customer, current effective price, source, proposed effective price, last genuine Tally rate, whether historic cost still matches current cost, and whether the customer changes or remains protected by a higher-precedence source.

## Governance

Base-price proposals must be effective-dated, versioned, idempotent and auditable. Administrator/Management approval is required. Approval supersedes the prior base-price version without deleting history.

Impact must be recomputed server-side at approval time. If concurrent customer-specific price changes, Tally history, or cost evidence materially changes the preview, approval must require refresh/review rather than silently activating stale economics.

A base-price change is one governed product-level event, not one write per customer.

## Acceptance criteria

1. Customer selection loads previously purchased items without opening an order.
2. Last Tally rate, Product Base Price and customer-specific price are visible together.
3. Multiple customer prices can be edited in one customer session.
4. Pricing resolution is Customer Special → eligible Last Tally Rate → Product Base Price → Review Required.
5. Last Tally Rate is eligible only when current authoritative purchase/landed cost has not increased since the historic sale, subject to configured materiality tolerance.
6. A cost-increased historic rate remains visible as evidence but is skipped for automatic resolution.
7. Base price applies automatically only where neither a valid customer-specific override nor an eligible unchanged-cost Last Tally Rate exists.
8. Base-price impact preview shows affected, special-price and actually-changing counts based on the final resolution hierarchy.
9. Review affected customers shows exactly who changes and why, including customers protected by Customer Special or eligible Last Tally history.
10. Current cost, new GP and new GP% are server-derived.
11. Existing customer-specific prices are never overwritten by a base-price change.
12. Effective-date boundaries, stale previews, missing cost, concurrency, cost-change detection and precedence are covered by tests.

## Implementation boundary

This document records the approved design. It does not claim the feature is coded yet. Implementation requires database migration, gateway/API actions, Pricing workspace UI, tests, migration replay and office validation before release.
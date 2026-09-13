# Customer Price Book and Margin-Optimized Pricing

## Status

This is the approved next pricing design. The current coded build remains order-centric; this document defines the simpler customer-first pricing model to implement after current pricing consolidation and integrity work.

## Core operating principle

The system proposes the price. Staff should normally decide whether to accept the recommendation rather than manually maintaining a selling rate for every Customer × Product combination.

For an existing customer and product, the customer's last genuine Tally selling price is the commercial starting point. The engine compares the authoritative purchase/landed cost applicable to that historic sale with current authoritative cost.

Continuity Price = Last Genuine Customer Selling Price + max(Current Cost - Historic Cost, 0)

A purchase-cost increase is therefore passed through as an absolute rupee increase to the customer's established selling price. A cost decrease does not automatically reduce the customer's selling price.

Example: Customer A last paid ₹420 when cost was ₹300. Current cost is ₹310. Continuity Price = ₹430.

## Price hierarchy

1. Valid fixed contractual/tender/governed customer price, where the agreement prevents automatic repricing.
2. Last genuine Customer × Item Tally selling price as the customer-specific commercial baseline.
3. Apply any positive authoritative purchase/landed-cost increase since that sale to calculate the Continuity Price.
4. For a customer/product with no genuine history, use the approved Product Base / Default Price.
5. If neither reliable history nor a valid base/default price exists, Price Review Required.

Exceptional, FOC, zero-rate, future, ambiguous or otherwise ineligible Tally transactions must never silently establish the customer baseline.

## Margin engine

The Continuity Price preserves the established customer economics by passing through absolute cost increases. The engine must separately calculate a Target-Margin Price from current authoritative cost and the applicable effective-dated pricing policy.

Target-Margin Price = Current Cost / (1 - Target Margin %)

Apply the configured versioned rounding rule.

For each decision show at least:
- Last customer price
- Historic cost
- Current cost and absolute change
- Continuity Price
- Target-Margin Price
- Recommended Price
- GP amount and GP% at each relevant option
- Difference to customer
- Additional GP per unit
- Expected monthly GP impact when reliable customer buying-volume evidence exists

The recommendation should optimize margin without hiding commercial continuity. V1 remains deterministic and explainable; no opaque AI pricing.

## Recommended decision UX

Example:

```text
ANUGRAHA — GLUCOSE

Last customer price                    ₹420
Purchase cost then                     ₹300
Purchase cost now                      ₹310  ↑ ₹10

────────────────────────────────────────────

Maintain old economics                 ₹430
Target-margin price                    ₹445

★ RECOMMENDED                          ₹445

At ₹430       GP ₹120       27.9%
At ₹445       GP ₹135       30.3%

Difference to customer                  ₹15
Additional GP / unit                    ₹15

[ Maintain ₹430 ]  [ Recommended ₹445 ]  [ Custom ]
```

Use simple status language:
- Green: Recommended — meets target economics.
- Amber: Continuity — passes through cost increase but remains below target margin.
- Red: Below minimum margin / loss-making — management approval required.

A Custom price remains possible but requires a reason when changing/reviewing and follows the existing approval guardrails.

## Customer-first pricing workspace

1. Open Pricing.
2. Select customer.
3. Prefill all genuinely purchased Tally items.
4. Show the customer-specific price book without requiring an order.
5. Default tab: Purchased. Additional tabs: Exceptions / Special Prices and All Products.
6. Staff normally choose a recommendation rather than type prices manually.
7. Only material exceptions or explicit governed prices create manual customer-price maintenance work.

Suggested row columns:
Item | Last Customer Rate | Cost Then | Cost Now | Continuity | Target | Recommended | GP% | Monthly GP Impact | Status / Action

## Purchase-cost change workflow

When authoritative purchase/landed cost increases for a product, the system should automatically calculate the impact across customers who genuinely buy that item. Staff must not manually update every customer rate.

Example:

```text
PURCHASE COST CHANGE — GLUCOSE

Previous cost                 ₹300
New cost                      ₹310
Increase                       ₹10

Customers purchasing product    83
Contract/fixed customers          5
Customers requiring review       78

Customer        Last Rate   Continuity   Recommended
──────────────────────────────────────────────
Hospital A          ₹420         ₹430          ₹445
Lab B               ₹435         ₹445          ₹450
Clinic C            ₹450         ₹460          ₹460
Hospital D          ₹410         ₹420          ₹445

[ Review Customers ]

[ Pass Through Cost Increase ]
[ Apply Recommended Prices ]
```

One management action represents the commercial decision for the product/cost-change event. The implementation must not require a person to type 78 prices individually.

## Impact-oriented decision screen

Before a bulk commercial decision, show consequences rather than only the proposed price:
- customers affected;
- customers protected by fixed contracts/tenders;
- customers receiving continuity pass-through;
- customers where target-margin recommendation is higher than continuity;
- customers below minimum margin;
- customers receiving a material percentage increase;
- estimated current monthly GP;
- estimated monthly GP under Continuity prices;
- estimated monthly GP under Recommended prices;
- incremental monthly GP between alternatives;
- high-impact customer exceptions ranked first.

Use actual recent buying volume when reliable. Prioritize absolute rupee impact, not GP% alone. A small rate improvement on a high-volume customer may be economically more important than a large percentage improvement on a low-volume customer.

Illustrative table:

```text
Customer        Current   Suggested   GP%    Monthly GP Impact
ABC Hospital      ₹420       ₹445      30%       +₹4,250
XYZ Lab           ₹440       ₹450      31%       +₹1,800
City Lab          ₹410       ₹445      30%         +₹950
Small Lab         ₹420       ₹445      30%          +₹25
```

The default review should be Pareto-oriented: highest absolute economic impact first, with the long tail available by drill-down.

## Product Base / Default Price

Product Base Price is primarily a starting/default price for a customer who has no genuine Customer × Item selling history. It is not the central mechanism for maintaining existing customer prices.

Base/default prices remain effective-dated, versioned and governed. They must be checked against current cost, minimum margin and target margin before use.

## Fixed agreements and exceptions

Tender, written contract, strategic fixed-price and other explicit governed commitments must not be silently repriced. When cost increases, show the deteriorating GP/margin and flag the account for review according to the agreement terms.

FOC, scheme, exceptional and ambiguous transactions must not become the normal customer baseline unless explicitly governed.

## Cost decreases

Do not automatically pass purchase-cost decreases to customers. Preserve the established selling price, show improved GP/GP%, and allow Management to choose whether a strategic price reduction is justified.

## V1 rules to freeze

1. Existing customer: start from the last genuine Customer × Item selling price.
2. Cost increase: calculate the absolute increase and add it to that customer's last genuine selling price to produce Continuity Price.
3. Margin engine: independently calculate Target-Margin Price from current cost and effective policy.
4. Recommendation: present an explainable recommended price, normally favoring target economics while showing continuity impact.
5. New customer/product: use governed Product Base / Default Price as the starting point.
6. Fixed contract/tender: respect the agreement; flag margin deterioration rather than silently changing it.
7. Cost decrease: never automatically lower the customer's price.
8. Manual/custom price: permitted with reason; below guardrails requires approval.
9. Bulk cost change: automatically recalculate affected customers; never require manual maintenance of dozens of rates.
10. Every material decision shows economic impact: GP ₹, GP%, customer impact, estimated monthly GP impact, affected customers and exceptions.
11. Recommendations are deterministic, versioned, explainable and auditable.
12. Missing cost/history/volume evidence must be visible and never guessed.

## Governance and ACID requirements

Pricing policy, fixed customer prices and Product Base / Default prices remain effective-dated and versioned. Material approvals are idempotent and auditable. Server-side impact must be recomputed at approval time. If cost evidence, customer agreement state, Tally history or other material inputs change between preview and approval, require refresh/review rather than silently activating stale economics.

Existing immutable billing snapshots, optimistic concurrency, pricing approvals, audit events and transactional-outbox boundaries remain authoritative.

## Scope boundary

Stop V1 pricing expansion here. Wallet-share optimization, competitor response, game theory and predictive pricing may later influence recommendations, but they must not complicate the core engine before office data and pricing outcomes are collected.

Implementation sequence remains: consolidate current pricing build → pass migration/integrity/full tests → validate live read-only Tally cost evidence → configure real Suprabha policy → implement this customer-first continuity/margin layer → shadow-test recommendations against real billing decisions → office pilot → measure outcomes.

This document records the approved design. It does not claim this customer-first/bulk-repricing UX is coded yet.
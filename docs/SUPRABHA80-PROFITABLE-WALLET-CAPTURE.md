# Suprabha 80 — Profitable Wallet Capture Policy

## Objective

Suprabha 80 is a profitable wallet-share strategy, not a price-minimisation strategy.

The operating objective is:

> Reach at least 80% of the addressable wallet in priority accounts, subject to minimum acceptable gross profit, cash conversion, and return on capital.

Wallet share is therefore never pursued at any price. A higher wallet share is valuable only when the account remains economically sustainable.

## Pricing Engine integration

The Customer Pricing Engine and Suprabha 80 should eventually operate as one governed commercial decision system.

For each Customer × Product opportunity, the system should consider:

- current wallet share and estimated addressable wallet;
- wallet capture gap to the account target;
- approved customer price and eligible Tally selling history;
- current purchase or landed cost;
- gross profit amount and gross margin percentage;
- payment quality / cash conversion;
- working-capital requirement;
- retention and strategic-account value;
- expected incremental wallet and GP from a proposed discount.

The Pricing Engine remains the authority for governed price decisions. Suprabha 80 supplies commercial context; it must not bypass pricing approvals, margin guardrails, audit, or immutable billing snapshots.

## Product pricing roles

Products may be classified by commercial role rather than applying one margin philosophy to every SKU:

1. **Milk / traffic products** — frequently purchased or highly price-visible products where a deliberately aggressive price may be justified to win or retain the wider account wallet.
2. **Normal products** — protect the configured target margin unless a governed exception has a clear economic case.
3. **Specialty / differentiated products** — protect stronger margins where service, availability, technical value, differentiation, or lower price transparency supports them.

A low margin on a milk/traffic product is acceptable only when the expected economics of the total customer relationship justify it. The system must not automatically lower all prices merely because an account is below 80% wallet share.

## Decision principle

Do not optimise only for GP percentage. Evaluate absolute GP and capital efficiency at account level.

A lower margin percentage can be rational when it produces materially greater absolute gross profit and strategic wallet capture. Conversely, large low-margin turnover can be rejected when the additional stock, credit, collection risk, or capital requirement produces inadequate economic return.

The commercial optimisation objective should therefore consider:

> Wallet Capture × Absolute GP × Cash Conversion × Capital Efficiency × Retention Value

This is a decision framework, not a licence for automatic discounting.

## Guardrails

The pricing workflow should retain governed price levels:

Normal / target price → Strategic price → Management approval threshold → Absolute commercial floor → Block.

No user or wallet-share algorithm should silently cross the configured absolute floor.

Strategic discounts should require a reason such as:

- competitor match;
- wallet capture;
- instrument placement;
- contract commitment;
- tender;
- bundle / portfolio commitment;
- strategic account;
- stock clearance;
- other governed reason.

Approval thresholds and the absolute floor must remain versioned policy, not hard-coded business assumptions.

## Closed-loop learning

Every strategic discount should later be evaluated against its intended outcome. The system should be able to answer:

- Did the discount increase wallet share?
- How much incremental revenue was captured?
- How much incremental absolute GP was created?
- Did payment behaviour or receivable days deteriorate?
- How much additional working capital was required?
- Was the lower price retained without the expected wallet gain?
- Should the same strategy be repeated, changed, or stopped?

This creates a feedback loop from pricing decision → actual customer purchases → wallet-share movement → GP/cash/capital outcome → future commercial decision.

## Non-negotiable rule

**Suprabha 80 must optimise for profitable wallet capture, not maximum turnover and not the lowest possible selling price.**

The 80% target must never override pricing integrity, minimum economic guardrails, cash discipline, or capital sustainability.

## Implementation status

This document defines strategy and future integration requirements. It does not mean wallet-share optimisation is currently implemented in the Pricing Engine. Existing Pricing Engine authority boundaries, ACID approval workflow, security controls, and deployment gates remain unchanged until the integration is deliberately designed, coded, tested, reviewed, and released.

# Tally pricing history, governed pricing architecture, and safe billing test plan

## Purpose

Preserve Suprabha's real billing workflow while reducing manual Tally lookup, protecting sensitive commercial pricing, and creating a transaction-safe foundation for assisted billing.

The pricing engine and Tally billing are one governed subsystem. Historical selling price is never evaluated in isolation from authoritative purchase cost when cost data is available.

## Core commercial truth

There is no universal selling price. The governed context is:

```text
Customer × Product × Effective Price Context
```

Operational pricing evidence is:

```text
Customer × Stock Item × Last invoice rate × Invoice date × Recent rates
```

The last billed rate is a suggested historical reference, not an unquestionable permanent rate.

## Pricing authority hierarchy

Pricing resolution is deterministic and never guesses:

```text
ORDER ITEM
  -> valid approved Customer × Product contract price
  -> valid customer-specific agreement / scheme
  -> valid customer-group / contract rule
  -> last real Tally billed rate for exact Customer × Stock Item
  -> standard/list reference only if explicitly configured
  -> otherwise PRICE REVIEW REQUIRED
```

A lower-priority source never silently overrides a higher-priority valid source.

## Customer × Product governed prices

Explicit customer prices are effective-dated immutable history, not a single overwritten value. Recommended logical entity:

```text
customer_product_price
- id UUID PK
- customer_id FK
- product_id FK
- price_amount NUMERIC
- currency
- valid_from
- valid_to nullable
- source_type
- agreement_reference nullable
- scheme_reference nullable
- status: DRAFT | PENDING_APPROVAL | APPROVED | SUPERSEDED | REJECTED | CANCELLED
- approved_by nullable
- approved_at nullable
- created_by
- created_at
- supersedes_price_id nullable
- version INTEGER
```

Database constraints prevent overlapping active approved periods where exclusivity is required. Old approved price history is never destructively overwritten.

## Tally pricing-history reference

When no higher-priority approved price exists, retrieve the most recent actual Tally history for the exact Customer × Stock Item. Accounts/Admin may see last billed rate, last invoice date/reference, bounded recent rate history, and source provenance. Do not average recent rates automatically. One-off quotations, FOC/scheme-adjusted invoices, tender pricing, corrections, introductory pricing, credit-note effects, or unusual discounts must not silently become the future default. No prior history means `PRICE REVIEW REQUIRED`.

## Purchase-cost guardrail

Customer pricing must never be evaluated from historical selling price alone when reliable purchase-cost data is available.

For every price resolution compare, where available:

- last customer selling price;
- latest authoritative purchase price / landed cost;
- purchase cost applicable around the previous sale;
- purchase-cost change amount and percentage;
- current GP amount and GP% at the historical selling price;
- previous GP% where reconstructable;
- margin erosion in percentage points.

The latest purchase cost must come from the governed authoritative source. Missing purchase cost is never guessed or fabricated.

If purchase cost increased, continue to show the genuine last customer selling price as historical evidence, but prominently flag `PURCHASE PRICE INCREASED`. A purchase-cost increase does **not** automatically change the customer's selling price.

Example:

```text
Last billed price        ₹485
Last invoice             18-Aug-2026
Previous purchase cost   ₹310
Latest purchase cost     ₹350
Purchase cost change     +12.9%
Current GP               ₹135
Current GP %             27.8%
Previous GP %            36.1%
Margin erosion           -8.3 percentage points
Status                   PURCHASE PRICE INCREASED
Suggested price          (₹548)
```

### Cost-aware suggested selling price

When a purchase-cost increase is detected and enough reliable evidence exists, the Accounts/Admin pricing view should show a **suggested selling price in brackets** next to the warning/context.

Compact presentation:

```text
Last billed: ₹485 · Cost ↑ 12.9% · Suggested (₹548)
```

The suggested price is advisory only. It must never silently replace the historical selling price or become an approved customer price without the normal authorization/approval flow.

The deterministic suggestion should normally preserve the governed target margin. Where policy explicitly permits and reliable historical economics are available, a versioned rule may instead preserve the previously approved margin. The rule used must be identifiable in the pricing decision. Example formula for preserving target GP% `m` from current authoritative cost `c`:

```text
suggested_price = c / (1 - m)
```

Apply a configurable, versioned commercial rounding rule after calculation. Never hide the unrounded calculation from audit/reconstruction. If the target margin/rule or reliable purchase cost is unavailable, do not fabricate a suggested price; show `PRICE REVIEW REQUIRED` instead.

Suggested-price provenance should preserve at least the cost reference/version, target-margin or rule version, pre-rounding result, rounding rule/version and final suggested amount. A later change to the cost or pricing rule must not rewrite the historical suggestion used for an earlier decision.

Pricing resolution must distinguish at least:

```text
PRICE_OK
COST_INCREASE
PRICE_REVIEW_REQUIRED
```

`PRICE_OK` means cost/margin remains within approved policy. `COST_INCREASE` means purchase cost increased but the resulting margin remains within permitted policy. `PRICE_REVIEW_REQUIRED` applies when current purchase cost causes margin below configured minimum, a loss, missing/untrustworthy required evidence, or another pricing-policy violation.

A price violating configured margin policy cannot silently proceed to billing. Required review/approval is enforced server-side.

Purchase-cost history is not destructively overwritten. The approved pricing decision or immutable billing snapshot preserves the exact authoritative cost reference/value/version used for the decision so historical economics can be reconstructed.

A material authoritative purchase-cost change after pricing approval but before billing must invalidate or re-check the pricing decision according to policy. The system must not silently bill using stale economics.

## Pricing confidentiality and authorization

Pricing is privileged commercial information. Default access:

```text
ADMIN / OWNER / authorised management    full pricing access
ACCOUNTS                                 pricing access
ORDER DESK                               no price values/history
SALES                                    no internal price values/history by default
WAREHOUSE                                no price values/history
DISPATCH                                 no price values/history
SERVICE                                  no price values/history
CUSTOMER                                 no internal pricing history
```

Non-authorised roles may see only workflow status such as `PRICING PENDING`, `PRICING VERIFIED`, `COST REVIEW`, `APPROVAL REQUIRED`, or `PRICE REVIEW REQUIRED`.

Restricted values include selling rate, suggested selling price, last billed rate, recent rates, contract rate, discounts, purchase/landed cost, GP amount/%, margin erosion, override history and sensitive approval metadata. Authorization is enforced at API/database boundaries, not by UI hiding. Restricted values must not leak through APIs, browser payloads, exports, caches, logs, searches or error messages.

## Order-entry operating model

```text
Order Desk
  -> Customer + Product + Quantity
  -> submits pricing state

Accounts/Admin
  -> receives resolved pricing context
  -> sees approved contract or Tally history
  -> sees purchase-cost/margin warning and bracketed suggested price where applicable
  -> confirms/changes proposed price
  -> pricing validation/approval runs

System
  -> freezes approved pricing/billing snapshot
  -> order becomes ready for billing
```

## Price exceptions

Authorized changes to proposed rates are evaluated against deterministic, configurable and versioned thresholds. Store reference rate, entered rate, difference, GP impact, reason, requester, approver, timestamps and source. Required approvals cannot live only in frontend code. No exception becomes billable until the approval transaction succeeds.

## ACID transaction model

### Atomicity
A pricing approval transaction succeeds entirely or rolls back entirely. It validates order/item state, price/cost source, authorization, exception thresholds and freshness; persists immutable pricing decision/version, approval metadata, audit event, billing snapshot/pricing state and transactional outbox event where required.

### Consistency
Database constraints enforce valid customer/product references, monetary invariants, pricing states/transitions, contract exclusivity, permission requirements, no billable line without approved resolved price, no Tally billing command without immutable approved snapshot, and transactional coupling of audit/outbox records.

### Isolation
Concurrent price edits cannot silently overwrite each other. Use optimistic versioning and/or row locks for approval-critical operations. Stale updates fail with a conflict and require refresh. A concurrent material purchase-cost change must also make a stale pricing approval fail or require revalidation.

### Durability
Committed approvals and audit history remain durable in PostgreSQL regardless of Tally availability. External commands remain queued through the transactional outbox rather than being lost or silently retried outside transactional control.

## Immutable pricing/billing snapshot

Every billable order line preserves the facts approved at that moment, including customer/product, price, quantity, discount/tax commercial fields, price source, Tally source invoice/date where applicable, contract reference, pricing-rule version, approved by/at, override reason, snapshot hash, authoritative purchase-cost reference/value/version, and suggested-price calculation provenance where used.

After approval the snapshot is immutable. Material order, price, or relevant authoritative cost changes invalidate/re-check the prior approval and require a new version rather than mutation.

## Tally authority boundary

```text
Order/workflow/price approval authority   Suprabha OS
Accounting authority                      Tally
Inventory authority                       Tally
GST invoice/voucher authority             Tally
```

Browser clients never communicate directly with Tally. Live pricing-history capability begins read-only and retrieves only required exact customer/item history and governed cost evidence where safely available. Do not replicate the entire Tally database merely for convenience.

## Billing handoff and idempotency

Approved order -> immutable billing snapshot -> validation -> transactional outbox -> local Tally connector -> Sales Voucher -> acknowledgement -> voucher identity -> reconciliation.

Every billing attempt uses an immutable unique idempotency key. Ambiguous timeout requires verify-before-create. Retry must never create a duplicate invoice.

Recommended `billing_handoff` includes order/snapshot version, unique idempotency key, status, payload hash, requester/approver, Tally company identity, voucher GUID/number, attempt metadata, sanitised failure information, reconciliation timestamp and audit timestamps.

## Audit requirements

Append-only application audit covers price proposed/source selected, cost evidence used, purchase-price hike detected, suggested-price calculation and rule version, margin erosion, price change, exception reason, approval requested/granted/rejected, snapshot created/invalidated, stale-cost revalidation, billing request, Tally acknowledgement and reconciliation result.

## Safe test plan

### Stage 0 — Protect live data
Fresh backup, demonstrated restore, explicit live/test company identities, private-LAN Tally endpoint, no credentials or broad raw financial responses in browser/Git/general logs.

### Stage 1 — Read-only live Tally
Test exact customer ledger/item lookup, historical sales vouchers, last rate/date/reference, bounded recent rates and authoritative purchase-cost evidence required by the pricing guardrail. No create/alter/cancel/delete/master writes. Compare 20–50 known combinations manually and test edge cases and unauthorized access.

### Stage 2 — Shadow pricing
Accounts/Admin sees proposed selling price plus cost/margin guardrail and bracketed suggested price where calculable. Real Tally billing remains manual. Compare proposed/suggested vs actual chosen rate, source, purchase-cost warning, GP impact, tax, quantity/UOM, discount and total.

### Stage 3 — Separate restored test company
Use a clearly named integration-test Tally company. Write-capable connector must refuse the wrong company identity.

### Stage 4 — Assisted billing in test company only
Test normal and multi-item invoices, contract vs history fallback, expired price, purchase-cost increase, suggested-price calculation/rounding, acceptable margin after cost hike, margin breach, loss-making price, missing cost/target-margin evidence, stale approval after cost change, overrides, concurrency, GST, schemes, missing ledger/item, Tally unavailable, timeout/retry, duplicate idempotency, changed order, connector restart, reconciliation mismatch, unauthorized APIs and audit completeness.

### Stage 5 — Production gate
Require read-only agreement, stable shadow pricing, authorization tests, ACID/concurrency tests, test-company writes, idempotency proof, backup/restore, LAN restriction, complete audit and explicit live configuration/company identity. Initial production write mode is assisted billing only; unattended posting is a later decision.

## Initial combined build scope

Continue the current transactional build through the pricing engine before the next major consolidation/pilot gate:

1. Complete current order/operations hardening.
2. Accounts/Admin-only Customer × Stock Item history lookup.
3. Last invoice rate/date/reference and bounded recent rates.
4. Explicit effective-dated Customer × Product contract model.
5. Deterministic pricing resolver.
6. Authoritative latest purchase-cost/landed-cost comparison.
7. Purchase-price hike notification without automatic selling-price change.
8. GP and margin-erosion calculation for authorized roles.
9. Bracketed cost-aware suggested selling price using a deterministic versioned margin/rounding rule.
10. Cost-aware price review/approval policy.
11. Price exception + approval workflow.
12. Immutable approved order-item pricing/billing snapshot including cost and suggestion provenance.
13. Stale-price/cost revalidation before billing.
14. Read-only live-Tally mode and shadow pricing.
15. API/database-level pricing authorization and audit.
16. Transactional outbox/idempotency/reconciliation foundation.
17. Test-company-only assisted voucher creation where the safe test gate permits it; never live unsafe writes.

## Build/release sequence

```text
CURRENT TRANSACTIONAL BUILD
  -> order/operations hardening
  -> Customer Pricing Engine
  -> purchase-cost guardrails + suggested price
  -> full consolidation
  -> full tests/build/ACID/security review
  -> PR and merge
  -> office pilot
  -> then decide next development phase
```

Do not artificially stop at a Phase-3 label before pricing is complete. Do not expand this combined build into full CRM, opportunities, installed-base/service expansion, AI, advanced forecasting, wallet intelligence, Power Maps/Social Styles, native mobile, microservices, elaborate dashboards, or unattended live Tally posting.

## Required pricing tests

At minimum cover exact contract, validity dates, expired/future contract, Tally fallback, recent-rate context, no prior price, unusual/FOC history, purchase cost unchanged/decreased/increased, small increase with acceptable GP, increase below margin threshold, selling price below current cost, suggested-price formula, rounding, missing suggestion inputs, rule-version provenance, missing cost history, concurrent cost/price changes, stale decision after cost change, exception approval/rejection, unauthorized pricing/cost/suggestion read and mutation, authorized Accounts/Admin access, idempotency, snapshot immutability, order change after approval, audit creation, rollback on failure, sensitive-data leakage and migration safety.

## Non-negotiable principles

1. Never guess a selling price, suggested price or purchase cost.
2. Last selling price remains historical evidence; a purchase-cost hike creates a warning/review, not an automatic selling-price increase.
3. Suggested price is shown in brackets and is advisory until authorized approval.
4. Never expose pricing, cost, suggestion or margin data to unauthorized roles.
5. Never overwrite approved price or purchase-cost history.
6. Never make an order billable without an approved immutable price snapshot.
7. Material cost change before billing must trigger revalidation.
8. Never allow retry to create a duplicate Tally voucher.
9. Browser never talks directly to Tally.
10. Tally unavailability never loses an approved command.
11. Tally and Suprabha OS never compete as accounting/inventory authorities.
12. Every sensitive price decision is attributable and auditable.
13. Every approval-critical mutation obeys ACID and concurrency controls.

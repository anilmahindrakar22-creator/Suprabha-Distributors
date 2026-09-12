# Tally pricing history, governed pricing architecture, and safe billing test plan

## Purpose

Preserve Suprabha's real billing workflow while reducing manual Tally lookup, protecting sensitive commercial pricing, and creating a transaction-safe foundation for assisted billing.

The pricing engine and Tally billing should be treated as one governed subsystem. Automated billing is not trustworthy until Suprabha OS can determine which rate a particular customer should receive for a particular stock item and can prove how that rate was selected.

## Core business rule

There is no assumption of one universal selling price for a product.

The commercial truth is primarily:

```text
Customer × Product × Effective Price Context
```

During transition, Tally history provides the strongest practical pricing reference:

```text
Customer
  ×
Stock Item
  ×
Last invoice rate
  ×
Invoice date
  ×
Recent rates
```

The last billed rate is a **suggested rate**, not an unquestionable rate. Historical Tally prices are evidence and context; they must not silently become permanent approved customer prices.

## Pricing authority hierarchy

Pricing resolution must be deterministic and must never guess.

```text
ORDER ITEM
    |
    v
1. Valid approved Customer × Product contract price
    |
    +-- exists -> propose this rate
    |
    v
2. Valid customer-specific agreement / scheme
    |
    v
3. Valid customer-group / contract rule
    |
    v
4. Last real Tally billed rate for exact Customer × Stock Item
    |
    v
5. Standard/list selling reference, if explicitly configured
    |
    v
6. No trustworthy price
       -> PRICE REVIEW REQUIRED
```

A lower-priority source must never silently override a higher-priority valid source.

## Customer × Product price contracts

Where Suprabha explicitly agrees a customer-specific price, store it as a governed, effective-dated contract rather than overwriting a single mutable value.

Example:

```text
Customer: Anugraha
Product:  Glucose

₹750  01-Apr-2025 -> 31-Mar-2026
₹720  01-Apr-2026 -> 30-Sep-2026
₹700  01-Oct-2026 -> current
```

Old price rows are never rewritten merely because a new rate is agreed. Closing an old validity period and creating a new version preserves historical truth.

Recommended logical entity:

```text
customer_product_price
- id UUID PK
- customer_id FK
- product_id FK
- price_amount NUMERIC
- currency
- valid_from DATE/TIMESTAMPTZ
- valid_to DATE/TIMESTAMPTZ nullable
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

Database constraints should prevent overlapping active approved periods for the same Customer × Product where the business rule requires exclusivity.

## Tally pricing-history reference

For an order line, when no higher-priority approved price exists, retrieve the most recent actual Tally billing history for the exact Customer × Stock Item combination.

The Accounts/Admin UI should show:

```text
Last billed rate
Last invoice date
Last invoice number/reference
Recent bounded rate history
Source = TALLY_HISTORY
```

Recent rates are context only. Do not average them automatically and do not infer a permanent customer contract from them.

One-off quotations, FOC/scheme-adjusted invoices, tender pricing, corrections, introductory pricing, credit-note effects, or unusual discounts must not silently become the future default.

If no prior Customer × Stock Item invoice exists, the system must display `PRICE REVIEW REQUIRED` rather than inventing a rate.

## Pricing confidentiality and authorization

Pricing is privileged commercial/financial information.

Default access policy:

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

Non-authorised roles may see operational status such as:

```text
PRICING PENDING
PRICING VERIFIED
PRICE REVIEW REQUIRED
```

They must not receive internal rate history, cost, GP, margin, discounts, override history, or pricing-source details.

This is a server/database authorization rule, not a UI-hiding rule. Restricted pricing fields must not be returned by APIs, exports, logs, browser payloads, or background queries to unauthorised roles.

Sensitive pricing fields include at minimum:

- current selling rate;
- last billed rate;
- recent rate history;
- customer contract rate;
- discount;
- purchase/landed cost;
- GP amount;
- GP percentage;
- margin calculations;
- pricing override reason/history;
- commercial approval metadata where sensitive.

## Order-entry operating model

Routine staff should not need to search Tally manually.

```text
Order Desk
  -> selects Customer + Product + Quantity
  -> submits pricing request/state

Accounts/Admin
  -> receives resolved pricing context
  -> sees approved contract rate or Tally history
  -> confirms or changes proposed price
  -> pricing validation/approval runs

System
  -> freezes approved billing snapshot
  -> order becomes ready for billing
```

This preserves commercial confidentiality while allowing other employees to continue operational work.

## Price exception handling

If an authorised user changes the proposed rate, the system evaluates the change against deterministic rules.

Example:

```text
Reference rate       ₹720
Entered rate         ₹680
Difference           -5.56%
Estimated GP         24.1%
Status               PRICE EXCEPTION
Reason               required
Approval             required if threshold breached
```

Thresholds should be configurable and versioned. Approval requirements must not live only in frontend code.

No price exception may become billable until the required approval transaction succeeds.

## ACID transaction model

Pricing approval must follow the same transaction-safe philosophy as the rest of Suprabha OS.

### Atomicity

A pricing decision is committed as one transaction. For an approval event, all of the following succeed together or none succeed:

1. validate order/item state;
2. resolve or validate price source;
3. validate authorisation;
4. validate exception threshold;
5. create/update immutable pricing decision/version;
6. write approval metadata;
7. write audit event;
8. create billing snapshot or mark item pricing verified as applicable;
9. create transactional outbox event if downstream action is required.

If any step fails, the transaction rolls back.

### Consistency

Database constraints enforce business invariants, including:

- positive/valid monetary values where applicable;
- valid Customer/Product foreign keys;
- allowed pricing states only;
- no invalid state transition;
- no duplicate active contract version where prohibited;
- no billable order line without a resolved approved price;
- no Tally billing command without an immutable approved billing snapshot;
- approval user must possess the required permission;
- audit/outbox records are created transactionally with the business change.

### Isolation

Concurrent price edits must not silently overwrite one another.

Use optimistic versioning and/or row locks for approval-critical operations. A stale editor receives a conflict and must refresh rather than overwriting a newer approved price.

Example guard:

```text
UPDATE customer_product_price
SET ... , version = version + 1
WHERE id = :id
  AND version = :expected_version
```

Zero updated rows means concurrency conflict.

### Durability

Once a pricing approval commits, it remains durable in PostgreSQL and its audit trail. Downstream Tally availability does not determine whether the approval itself exists.

If Tally is unavailable, the approved billing command remains queued through the transactional outbox instead of losing the decision or silently retrying outside the database transaction.

## Immutable pricing decision snapshot

Every billable order line should preserve the pricing facts that were approved at that moment.

Recommended logical entity:

```text
order_item_price_snapshot
- id UUID PK
- order_id FK
- order_item_id FK
- customer_id FK
- product_id FK
- price_amount
- currency
- quantity
- discount fields as applicable
- tax-relevant commercial fields as applicable
- price_source_type
- source_reference_id nullable
- source_invoice_number nullable
- source_invoice_date nullable
- contract_price_id nullable
- recent_rate_context_hash nullable
- pricing_rule_version
- approved_by
- approved_at
- override_reason nullable
- snapshot_hash
- created_at
```

After billing approval, the snapshot is immutable. A material order or price change invalidates the prior approval and creates a new version/snapshot rather than mutating history.

## Billing boundary with Tally

Authority remains separated:

```text
Order/workflow/price approval authority   Suprabha OS
Accounting authority                      Tally
Inventory authority                       Tally
GST invoice/voucher authority              Tally
```

Flow:

```text
Approved order
   -> immutable billing snapshot
   -> validation
   -> transactional outbox
   -> local Tally connector
   -> create Sales Voucher
   -> Tally acknowledgement
   -> voucher identity returned
   -> reconciliation
```

The browser must never communicate directly with Tally.

The connector receives only the minimum approved billing payload required to perform its job.

## Idempotency and duplicate prevention

Every billing attempt must use an immutable idempotency key, for example:

```text
SUPRABHA-ORDER-2026-00584-BILLING-V1
```

Retries use the same key. Before creating a voucher after an ambiguous timeout, the connector/system must verify whether the intended voucher was already created.

A retry must never create a second invoice simply because the previous HTTP acknowledgement was lost.

Recommended billing handoff fields:

```text
billing_handoff
- id
- order_id
- billing_snapshot_version
- idempotency_key UNIQUE
- status
- payload_hash
- requested_by
- requested_at
- approved_by
- approved_at
- tally_company_identity
- tally_voucher_guid nullable
- tally_voucher_number nullable
- attempt_count
- last_attempt_at nullable
- failure_code nullable
- failure_message_sanitised nullable
- reconciled_at nullable
- created_at
- updated_at
```

Suggested states:

```text
DRAFT
VALIDATING
READY
QUEUED
SENDING
ACKNOWLEDGED
RECONCILED
FAILED
REVIEW_REQUIRED
CANCELLED
```

## Audit requirements

Every sensitive pricing event must produce an audit record containing enough information to reconstruct responsibility without leaking unnecessary financial data into general logs.

Audit events include:

- price proposed;
- price source selected;
- price changed;
- exception reason supplied;
- approval requested;
- approval granted/rejected;
- pricing snapshot created/invalidated;
- billing requested;
- Tally acknowledgement received;
- reconciliation passed/failed.

Audit logs are append-only from the application perspective.

## Tally-history bootstrap strategy

Tally can help Suprabha gradually build explicit Customer × Product pricing knowledge.

```text
TALLY HISTORY
      ↓
Customer × Stock Item history
      ↓
Suggested customer price
      ↓
Accounts/Admin review
      ↓
APPROVED CUSTOMER × PRODUCT CONTRACT
```

Do not automatically promote every historical rate into the approved price master.

Over time, stable recurring prices can be reviewed and promoted into explicit contracts, reducing repeated lookups while preserving the original Tally evidence.

## Safe test principle

**No write tests against the live Tally company.**

Testing is staged so live Tally is read-only first. Any voucher-creation test must use a separate restored/copied test company.

## Stage 0 — Protect live data

Before integration testing:

- Take a fresh Tally company backup to a separate location.
- Verify that the backup can be restored.
- Record live and test company identities/data paths so the connector cannot confuse them.
- Keep the Tally HTTP/ODBC endpoint available only on the office machine/private LAN; never expose it publicly.
- Do not store Tally credentials, broad company data, or full integration responses in browser code, Git, or normal application logs.

## Stage 1 — Read-only pricing-history test against live Tally

Allowed operations:

- exact customer ledger lookup;
- exact stock-item lookup;
- historical sales-voucher search;
- return last invoice rate;
- return invoice date/reference;
- return a bounded recent-rate list.

No voucher create, alter, cancel, delete, master create, or master alter command is permitted in this mode.

Suggested acceptance tests:

1. Pick 20–50 known Customer × Stock Item combinations.
2. Staff manually checks Tally's last bill.
3. Suprabha OS performs the read-only lookup.
4. Compare customer, item, invoice number/date, last rate, and recent rates.
5. Require exact agreement before progressing.
6. Include edge cases: one prior invoice, many prior invoices, no prior invoice, zero/FOC line, special discount, duplicate-looking item names, customer aliases, cancelled/altered vouchers where applicable.
7. Verify unauthorised roles cannot obtain pricing values through UI or API.

## Stage 2 — Shadow pricing in Suprabha OS

Suprabha OS displays the proposed rate to Accounts/Admin but does not create any Tally voucher.

The billing operator continues creating the real bill manually in Tally. Compare:

- proposed rate vs actual chosen rate;
- price source;
- tax treatment;
- quantity/UOM;
- discount;
- invoice total.

Use discrepancies to refine pricing/history rules before enabling writes.

## Stage 3 — Create a separate Tally test company

Restore a current backup into a clearly named test company, for example:

```text
SUPRABHA DISTRIBUTORS - INTEGRATION TEST - DO NOT USE FOR LIVE BILLING
```

The connector must be configured explicitly for this test company. Write-capable integration must refuse to run if the selected company identity does not match the configured test identity.

## Stage 4 — Assisted billing writes only to test company

Test the full command path:

```text
Approved Suprabha order
      ↓
Immutable billing payload snapshot
      ↓
Validation
      ↓
Idempotency key
      ↓
Create Sales Voucher in TEST Tally company
      ↓
Tally acknowledgement
      ↓
Return voucher number / identity
      ↓
Reconcile against expected payload
```

Required tests include:

- normal invoice;
- multiple items with different customer-specific prices;
- contract price vs Tally-history fallback;
- expired contract price;
- price override approval;
- concurrent price-edit conflict;
- GST/tax combinations used in real operations;
- discount and scheme cases;
- missing ledger;
- missing stock item;
- Tally closed/unavailable;
- retry after timeout;
- duplicate-send attempt using the same idempotency key;
- changed order after approval;
- connector restart during processing;
- invoice acknowledgement/reconciliation mismatch;
- unauthorised pricing API access;
- audit completeness.

## Stage 5 — Production gate

Do not enable live writes until all of the following are true:

- read-only lookup agrees with manual Tally checks;
- shadow billing is stable on real orders;
- pricing authorization tests pass;
- ACID/concurrency tests pass;
- write tests pass in the copied test company;
- duplicate-voucher/idempotency tests pass;
- backup and restore have been demonstrated;
- connector is restricted to the approved office host/private LAN;
- billing/pricing audit records are complete;
- live write mode requires an explicit environment/configuration switch and expected live company identity.

Initial production mode should be **assisted billing** only: Accounts/Admin reviews the invoice preview and explicitly selects Generate in Tally. Unattended auto-posting is a later decision after a proven period of successful assisted operation.

## Security and data-minimisation guardrails

- Tally remains accounting and inventory authority.
- Suprabha OS stores only the Tally-derived fields required for workflow, pricing reference, audit, and reconciliation.
- Do not replicate the entire Tally dataset into PostgreSQL merely for convenience.
- Browser clients never communicate directly with Tally.
- Raw Tally responses containing broad financial data are not written to normal application logs.
- Price APIs enforce Accounts/Admin authorization before retrieval, not after retrieval.
- Non-authorised responses must omit sensitive values entirely.
- Every billing command is auditable and idempotent.
- No silent retries that can create duplicate vouchers.
- No hard delete of approved pricing history or billing snapshots.

## Initial build scope

The first implementation should remain narrow:

1. Accounts/Admin-only Customer × Stock Item history lookup.
2. Last invoice rate.
3. Invoice date/reference.
4. Bounded recent rates.
5. No-history state requiring review.
6. Explicit Customer × Product contract-price model with effective dating.
7. Deterministic pricing resolver.
8. Price exception + approval workflow.
9. Immutable approved order-item pricing snapshot.
10. Read-only live-Tally mode.
11. Shadow pricing comparison.
12. Test-company-only assisted voucher creation.
13. Transactional outbox + idempotency + reconciliation.
14. API/database-level pricing authorization and audit.

## Build sequence

```text
PHASE 3 PILOT
      ↓
CUSTOMER × PRODUCT PRICING ENGINE
      ↓
TALLY ASSISTED BILLING
      ↓
CRM / CUSTOMER FOUNDATION
      ↓
OPPORTUNITIES
      ↓
INSTALLED BASE / SERVICE
      ↓
ACTION CENTER
```

The pricing engine and Tally-assisted billing are one architectural programme, but implementation must be sliced so the current Phase-3 transactional pilot/hardening work is not destabilised.

## Non-negotiable principles

1. Never guess a price.
2. Never expose pricing values to an unauthorised role.
3. Never overwrite approved history when a new price is created.
4. Never make an order billable without an approved immutable price snapshot.
5. Never allow a retry to create a duplicate Tally voucher.
6. Never let the browser talk directly to Tally.
7. Never let Tally unavailability silently lose an approved billing command.
8. Never make Tally and Suprabha OS competing accounting or inventory authorities.
9. Every sensitive pricing decision must be attributable and auditable.
10. Every approval-critical mutation must obey ACID rules and concurrency controls.

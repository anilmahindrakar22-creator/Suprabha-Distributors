# Tally pricing history and safe billing test plan

## Purpose

Preserve Suprabha's real billing workflow while reducing manual Tally lookup and avoiding risk to live accounting data.

## Pricing-history rule

For an order line, the first pricing reference should be the most recent actual Tally billing history for the exact customer and stock item.

Canonical lookup dimensions:

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

The order-entry UI should show the last invoice rate, its invoice date/reference, and a short recent-rate history so staff can see whether the previous price was normal or exceptional.

## Pricing decision order

1. If an explicit approved contract/customer price exists and is currently valid, show it first.
2. Otherwise retrieve the most recent real Tally invoice for the exact Customer × Stock Item combination.
3. Show recent rates for context, not as an automatic average.
4. If no prior customer-item invoice exists, do not guess. Require price review/manual confirmation.
5. If the user changes the proposed rate materially, capture a reason and apply the configured approval rule.

Historical Tally prices are evidence, not automatically a permanent customer price master. One-off quotations, FOC/scheme-adjusted invoices, tender pricing, corrections, or unusual discounts must not silently become the future default.

## Safe test principle

**No write tests against the live Tally company.**

Testing is staged so live Tally is read-only first. Any voucher-creation test must use a separate restored/copied test company.

## Stage 0 — Protect live data

Before integration testing:

- Take a fresh Tally company backup to a separate location.
- Verify that the backup can be restored.
- Record the live company identity/data path and the test company identity/data path so the connector cannot confuse them.
- Keep the Tally HTTP/ODBC endpoint available only on the office machine/private LAN; never expose it publicly.
- Do not store Tally credentials, raw company data, or full integration responses in browser code, Git, or application logs.

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
6. Include edge cases: one prior invoice, many prior invoices, no prior invoice, zero/FOC line, special discount, duplicate-looking item names, customer aliases, cancelled/altered voucher if applicable.

## Stage 2 — Shadow pricing in Suprabha OS

Suprabha OS displays the proposed rate from Tally history but does not create any Tally voucher.

The billing operator continues creating the real bill manually in Tally. Compare:

- proposed rate vs actual chosen rate;
- tax treatment;
- quantity/UOM;
- discount;
- invoice total.

Use discrepancies to refine the pricing/history rules before enabling writes.

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
Billing payload snapshot
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
- multiple items with different customer-specific historical rates;
- GST/tax combinations used in real operations;
- discount and scheme cases;
- missing ledger;
- missing stock item;
- Tally closed/unavailable;
- retry after timeout;
- duplicate-send attempt using the same idempotency key;
- changed order after approval;
- connector restart during processing;
- invoice acknowledgement/reconciliation mismatch.

## Stage 5 — Production gate

Do not enable live writes until all of the following are true:

- read-only lookup agrees with manual Tally checks;
- shadow billing is stable on real orders;
- write tests pass in the copied test company;
- duplicate-voucher/idempotency tests pass;
- backup and restore have been demonstrated;
- connector is restricted to the approved office host/private LAN;
- billing audit records are complete;
- live write mode requires an explicit environment/configuration switch and the expected live company identity.

Initial production mode should be **assisted billing** only: Accounts reviews the invoice preview and explicitly selects Generate in Tally. Unattended auto-posting is a later decision after a period of successful assisted operation.

## Security and data-minimisation guardrails

- Tally remains the accounting and inventory authority.
- Suprabha OS stores only the minimum Tally-derived fields needed for operations and reconciliation.
- Do not replicate the entire Tally dataset into PostgreSQL merely for convenience.
- Browser clients never communicate directly with Tally.
- Raw Tally responses containing broad financial data are not written to normal application logs.
- Store bounded operational results such as ledger/item identity, last rate, invoice date/reference, recent rates, voucher acknowledgement, and reconciliation status.
- Every billing command is auditable and idempotent.
- No silent retries that can create duplicate vouchers.

## Initial build scope

The first implementation should include only:

1. Customer × Stock Item history lookup.
2. Last invoice rate.
3. Invoice date/reference.
4. Bounded recent rates.
5. No-history state requiring review.
6. Read-only live-Tally mode.
7. Shadow pricing comparison.
8. Test-company-only assisted voucher creation.

This feature belongs with the future Tally-assisted-billing work and must not compromise the current Phase-3 transactional pilot/hardening work.

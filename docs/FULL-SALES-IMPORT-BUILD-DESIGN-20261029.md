# Full-sales import: build design (29 Oct 2026)

**Owner direction (29 Oct 2026):** "Do full sales import. But understand that Tally is read only. No touching or editing Tally data."
**Author:** Claude (design and review). Codex builds, and the integration chat reviews the financial side and deploys, as before.
**Builds on:** [contract proposal](FULL-SALES-IMPORT-CONTRACT-PROPOSAL.md), the [15 Oct integration reply](FULL-SALES-IMPORT-INTEGRATION-REPLY-20261015.md) (its conditions are binding) and [the Market plan](MARKET-FULL-SALES-IMPORT-PLAN.md).

## 0. Hard rule: Tally is read-only
- Every Tally call already goes through one function, `Invoke-Tally` in `desktop-connector/dashboard.ps1`. Before any network call it **refuses** a body unless it contains exactly one `<TALLYREQUEST>Export</TALLYREQUEST>` (case-insensitive, whitespace-tolerant) and **no** other `<TALLYREQUEST>`. It also refuses any body containing `IMPORTDATA` or an `ACTION="…"` attribute; Tally import marks object writes with `ACTION`.
- **Bare words are never rejected:** voucher fetch lists legitimately contain `AlterID`, so a substring check for "Alter" would block every economics export.
- A unit test, extending the existing "without enabling Tally writes" test in `tests/unit/tally-invoice-connector.test.ts`, checks two things. Every Tally request template in `desktop-connector/` is an Export. Nothing in `desktop-connector/` reaches port 9000 except `Invoke-Tally` (no `Invoke-WebRequest`, `WebClient`, `HttpClient` or `Invoke-RestMethod` aimed at `9000` elsewhere).
- No TDL that writes, no voucher creation and no master change. The connector only reads collections and reports.

## 1. What production shows (read-only, 29 Oct)
| Fact | Value |
| --- | --- |
| Canonical economic source vouchers / lines | 1,901 / **7,437** (Oct 2025 – Oct 2026, company-wide) |
| Lines added per month (sales + purchases) | about 500–790 |
| Sale vouchers per month | 88–138 (the largest month, Aug 2026, has 138 sales, 52 purchases and 790 lines) |
| Coverage rows ever written | **0** |
| Import exceptions | 968 rows, all from **2 vouchers**: SD/25-26/0781 and 0782, both dated 3 Oct 2025, GST SALE with no inventory lines (accounting-only, awaiting Accounts linkage) |
| Rebuild guard | `stockflow_rebuild_instrument_economics` raises `54000` when total lines exceed 10,000. The snapshot import trigger calls it **without a handler**. |

Conclusions:
1. **The company's sales are already imported.** The exporter is company-wide. What is missing is *certified completeness*, a clean reporting window and an independent control.
2. Coverage is never written because every upload also carries a year of cost history, which includes the two unresolved October 2025 vouchers, so `rejected > 0` on every upload.
3. **A production outage is coming.** At about 650 lines a month, the source passes 10,000 lines around **late February 2027**. The rebuild then raises inside the snapshot trigger, which aborts **every** office upload: stock, catalogue and pricing all stop. This is independent of the full-sales work and must be contained first.

## 2. Packages
### P1. Containment (server, Astra, smallest and first)
- In the snapshot import trigger, wrap the rebuild call in a handler for `sqlstate '54000'` **only**:
  - record the pause in a **status row**, not in `stockflow_economic_import_exceptions` (an undated import exception would make coverage fail closed for the whole company for good). Use a new single-row-per-company table `private.stockflow_economic_rebuild_status(company_id, state 'ok'|'paused', reason, since, updated_at)`. The next successful rebuild sets `ok`. The Economics read returns it so the UI can show "Economics results paused since …";
  - keep the last published economic results unchanged;
  - let the snapshot continue.
- Every other error still propagates. This neither raises nor drops the guard and publishes nothing partial, consistent with the 15 Oct reply's rule against bypassing failures by partial publication.
- Test: with the guard temporarily lowered in a test transaction, a snapshot upload succeeds, stock and catalogue are updated, economic results are unchanged and one exception is recorded.

### P2. Reporting-window coverage run (connector, Astra)
- **Window:** the last three **complete** calendar months in Asia/Kolkata, `[first day of month − 3, first day of the current month)`, half-open.
- **Run:** **once per IST calendar day**, at the first sync cycle at or after 22:00 IST, or the first cycle of the next day if the PC was off (catch-up), outside billing hours (REQ-13). The last successful run date is kept in the connector's state file. It makes serial Export requests with the existing 30 s timeouts and records metrics.
- **Envelope:** the same `economicEvidence` schema version 1, uploaded **instead of** the normal economic envelope on that one cycle.
  - It contains every voucher whose date falls in the window: sales, returns, credits, purchases, non-economic and cancellations, by the same conversion.
  - It has **no** older cost-history vouchers and **no** current partial month.
  - `completeWindow=true`, `windowFrom` / `windowTo` (exclusive), `sourceVersion`, and a new informational key `purpose: 'sales_coverage'`.
- **Size bound:** at most 1,800 vouchers per envelope. Real volume is about 450 for three months. If a window exceeds it, the run fails visibly with a connector health line and an `economicSyncError`, and is never truncated. No splitting machinery is needed at this volume (A of the contract is satisfied by "fail visibly").
- **Gating:** the normal economic sync stays exactly as it is today. The next normal cycle restores the current month and cost history (the importer is idempotent by company, source and revision).
- **Native control totals,** read-only, in the same nightly run:
  - for each of the three months, Tally's own period totals of every ledger under the **Sales Accounts** group (net of GST);
  - plus, under the **Sundry Debtors** group, each customer ledger's period total of sales-voucher debits, if a reliable read-only collection exists; Codex must report what is feasible.
  - **Profit-and-loss ledgers:** for a mid-year window, Tally's sales-ledger figure is likely closing minus opening, not the closing balance. Emit `openingPaise`, `closingPaise` and the derived `netPaise` per ledger, and cover it with a fixture test of a Jul–Sep window against a known movement.
  - **Customer debits include GST:** label them `grossPaise`, and the server must compare them with app `net + gst_paise`, never net alone.
  - Upload them as a new payload key `salesControlTotals`, `{ companyId, sourceVersion, months: [{ month: 'YYYY-MM', salesLedgers: [{ ledgerId, name, netPaise }], customers?: [{ customerSourceId, netPaise }] }] }`, bounded to 3 months, 500 sales ledgers and 5,000 customers.

### P3. Completeness read, control ingestion, reconciliation (server, Astra)
- `private.stockflow_sales_coverage_status(p_company text, p_from date, p_to_inclusive date) returns jsonb`. It converts the inclusive end to an exclusive boundary.
  - `complete=true` only if **one** coverage row (one `source_version`, i.e. one generation, never a union of stale exports) covers `[from, to+1)`, and **no** import exception for that company was recorded after that row's `imported_at` that is either dated inside the period (from the evidence `date`) or undated (fail closed at company scope).
  - Connector sync errors are recorded undated, so they **intentionally** keep coverage false until the next clean nightly run.
  - The result is `{ complete, coveredFrom, coveredTo, sourceVersion, importedAt, blockingExceptions }`.
  - The last complete generation stays readable, and `importedAt` lets the UI show its age (stale, not hidden).
- **Omission exceptions must name the missing vouchers.** When a complete window omits known vouchers, record their `source_id`s (at most 50, plus the total count) in the exception evidence, so "N blocking items" is actionable.
  - Follow-up, not this build: a reviewed *confirm-deleted* path for vouchers deleted in Tally (they can never send a cancellation revision).
- `salesControlTotals` is **always** removed from the stored snapshot payload, on every path including invalid and skipped ones. It is per-customer sales, and the snapshot row is read more widely than the economics tables.
- The table `private.stockflow_sales_control_totals(company_id, month date, kind 'sales_ledger'|'customer', source_key, name, net_paise bigint, source_version, imported_at)` is append-only per `source_version` and ingested by a separate snapshot trigger. A bad payload is skipped and counted, **never** aborting the snapshot (lesson from 28 Oct).
- `private.stockflow_sales_reconciliation(p_company, p_month)` compares:
  - the app's total, the sum of `net_sales_paise` over the latest non-cancelled revision of sale, return and credit lines dated in the month;
  - against Tally's Sales Accounts total for that month, and per customer where customer controls exist.
  - Customer controls compare Tally `grossPaise` with app `net + gst`.
  - It returns both figures, the difference in paise and the state: `matches` (difference 0), `differs` or `no_control`.
  - **It never certifies anything.** Certification stays a human Accounts sign-off, per the 15 Oct reply.
- The economics gateway gets a new read action `get_sales_coverage` (administrator, management, accounts). It returns the completeness result for the reporting window plus the 3-month reconciliation.
  - **Add it to the Edge allowlist and to the Next route validator** (lessons of 28 Oct).
- **The A/B class seam stays false.** It is not switched on here, per the 15 Oct reply; that waits for Accounts to accept the reconciliation.

### P4. UI (Sol)
In Economics, administrators, management and Accounts see one card, **Sales coverage**:
- `Jul–Sep 2026 · complete · as of 30 Oct, 22:14`, or `incomplete: 2 blocking items`;
- three month rows, each showing `App ₹x · Tally ₹y · matches`, or `differs by ₹z`, or `no Tally control`.

There are no actions, and it is read-only.

### Deferred: D (candidate-bounded rebuild)
- The real fix for the 10,000-line limit is the 15 Oct reply's option D: select instrument-relevant lines plus every cost dependency, including **all customers'** consumption of mapped reagents.
- It is financially sensitive and needs a measured performance test on more than 10,000 lines. Its own design and review come after P1–P4.
- P1 makes the limit safe (results pause visibly; no outage) in the meantime.

## 3. Acceptance (written before code)
1. No request built anywhere in `desktop-connector/` reaches Tally unless it is an Export (unit test plus the `Invoke-Tally` guard).
2. A snapshot upload above the rebuild limit succeeds, its stock is updated, economic results are unchanged and one visible exception is recorded.
3. A coverage envelope for Jul–Sep with no rejected vouchers writes one coverage row, and `stockflow_sales_coverage_status('…', '2026-07-01', '2026-09-30')` is true.
4. A later exception dated in August, or undated, makes it false. One dated outside the period does not.
5. A coverage row for Jul–Aug alone does not satisfy Jul–Sep (no unions).
6. Known vouchers omitted from a complete window write no coverage and record an exception (existing rule, regression-tested).
7. A bad `salesControlTotals` payload never aborts a snapshot, and the stored snapshot payload never contains `salesControlTotals`.
11. The rebuild pause never creates an import exception, and coverage stays true while the rebuild is paused.
12. An omission exception lists the missing source IDs.
8. Reconciliation reports `matches` only for an exact paise equality, uses the latest non-cancelled revisions, and doesn't double-count revisions.
9. `get_sales_coverage` is denied to roles other than administrator, management and accounts, passes the Edge allowlist and the Next route, and redacts nothing that those roles may see.
10. The card shows `no Tally control` instead of `₹0` when controls are missing.

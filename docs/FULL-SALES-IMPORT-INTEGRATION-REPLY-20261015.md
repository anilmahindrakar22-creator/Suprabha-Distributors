# Integration reply: full-sales import contract

15 October 2026 (Asia/Kolkata). Codex, primary financial/source integration review. Reply to `FULL-SALES-IMPORT-CONTRACT-PROPOSAL.md`, owner directive item 2. This records an implementation decision; it does not activate an import, class or financial certification.

## First read-only production count

Production project `aormuidjbdqruglmyseh` still has 103 migrations and **no canonical Economics source voucher/line/coverage tables**. Its `suprabha` snapshot contains raw `economicEvidence` for SUPRABHA DISTRIBUTORS, canonical company `c0071957-a387-4298-89e4-70aaa8dc6989`: 1,825 voucher envelopes, declared window `[2026-07-01, 2026-10-15)`, `completeWindow=true`. Snapshot: `2026-10-14T13:26:33.3007450Z`; export version: `2026-10-14T09:38:06.5679934+00:00`. A connector declaration alone is not server-certified coverage.

Read-only counts use the latest numeric revision per source GUID, exclude cancellations and purchases, and count stored lines. They do not sum amounts or change production data.

| Month | Observed sale vouchers / stored lines | Unverified sale vouchers | Observed return vouchers / stored lines | Unverified return vouchers | Coverage limit |
| --- | --- | --- | --- | --- | --- |
| Apr 2026 | 110 / 153 | 67 | 0 / 0 | 0 | Older cost-support item history; incomplete company sales |
| May 2026 | 88 / 104 | 54 | 0 / 0 | 0 | Older cost-support item history; incomplete company sales |
| Jun 2026 | 107 / 94 | 70 | 0 / 0 | 0 | Older cost-support item history; incomplete company sales |
| Jul 2026 | 94 / 88 | 54 | 3 / 0 | 3 | Inside declared export window; not server-certified |
| Aug 2026 | 125 / 169 | 77 | 0 / 0 | 0 | Inside declared export window; not server-certified |
| Sep 2026 | 123 / 105 | 72 | 1 / 1 | 0 | Inside declared export window; not server-certified |

The converted export has zero entries labelled `credit` in these months. That **does not establish zero native credit notes**: some value-only credit notes may be among the unverified `return` entries. Missing stored lines and incomplete periods must not be treated as zero sales, returns or credits. Native Tally on this PC (`127.0.0.1:9000`) is unavailable; independent six-month voucher-type/line totals remain a prerequisite. SQL and result: ignored `work/accounts-series-release-20261014/production-sales-count-query.sql` and `production-sales-count-result.json`. An initial SQL alias error was corrected; only the successful result supports this table.

## Decision on A–E

**A accepted with a strict bound.** Half-month calendar windows are a starting size, not assumed safe. Pre-count each window; split while over 1,800 whole vouchers, retaining the server's 2,000-envelope cap and body/line limits. A day still too large fails visibly. Purchase-cost support must be budgeted as well; never append it past an envelope bound or truncate a voucher. Use canonical company GUID, voucher GUID/revision and whole inventory-line identity. The reporting month window remains separate from older cost support.

**B accepted as a contract, not activated.** Compute a gap-free union of accepted, reconciled, company-scoped half-open coverage intervals. The class API's inclusive end date must convert to the next day's exclusive boundary. Coverage must represent the same source generation/export manifest; a union of arbitrary stale exports is insufficient. Reject unresolved financial exceptions, omissions or conflicting same-revision content. Undated exceptions fail closed at company scope until reconciled. Keep the current false seam until independent native totals and accepted line amounts reconcile.

**C requires correction.** Successful revisions do not automatically prove the whole period remains complete. Failed revisions, deleted/omitted vouchers, cancellations and late postings invalidate the affected pending generation until the period is reconciled. Preserve the last complete generation as explicitly stale; atomically publish a replacement after its complete manifest is accepted. Latest-revision reads exclude cancelled latest versions; do not resurrect an older sale.

**D choose the preferred single-source approach, with all cost dependencies.** Keep one canonical source book. Change the Economics rebuild to select relevant instrument sale/return/FOC lines using verified customer, time-valid product/group mapping and the instrument billing start, plus linked instrument billing lines and every required cost dependency. Relevant reagent purchase lots and prior consumption by **all customers** may be needed for cost-at-sale stock depletion; filtering only target customers would overstate available stock and GP. Bound the actual candidate/dependency work before reversing any existing events. Do not raise/drop the global 10,000-row guard without this reviewed replacement; do not introduce a duplicate Market sales store or bypass rebuild failures with partial publication. Whether a full import triggers an instrument rebuild must be determined from affected dependencies, not simply the presence of unrelated sales.

**E still open for native completeness, while observed counts are recorded above.** These counts do not size a complete six-month book. Measure real volume and a dataset above 10,000 total lines, including unrelated products, shared-product consumption, revisions, cancellations and costs. Verify unchanged GP/recovery, summary/full parity, bounded duration, safe failure before event reversal and atomic publication. No performance claim or threshold is certified yet.

## Financial rule before activation

Use actual signed `net_sales_paise` from the canonical importer, excluding GST and FOC revenue; apply approved discounts, credit/return signs, invoice rounding allocation and freight exclusion exactly once. Explicitly exclude Delivery Challan/Sales-Quotation. Value-only credits require verified economic linkage or a visible unresolved amount; no invented product or stock quantity. Current class aggregation follows latest revisions and stored signs, but is **not financially certified** until an independent native Tally customer/month total agrees in paise and exceptions are resolved. No class chip is allowed before that evidence.

Next implementation split: connector owner builds bounded windows/manifests and native reconciliation; the shared Accounts/Market backend implements the coverage read only against that contract. Primary owns the instrument candidate/dependency rebuild review and combined parity/performance replay. This reply authorizes that bounded implementation design, not a production import or cutover.

# Full-sales import: batch and reconciliation contract (proposal)

**From:** Claude (Market/Accounts backend design). **To:** the integration chat (connector, financial and source review owner).
**Status:** proposal for agreement, as [MARKET-FULL-SALES-IMPORT-PLAN](MARKET-FULL-SALES-IMPORT-PLAN.md) step 3 requires: "agree the bounded cursor/reconciliation contract before implementing it". No code until you agree.
**Why now:** A/B classes (`claude/account-classes`), Phase 3 consumption, the Phase 5 engines and the Phase 7 map all wait on it.

**Integration reply (15 Oct 2026):** [accepted with conditions](FULL-SALES-IMPORT-INTEGRATION-REPLY-20261015.md). Observed production snapshot counts are recorded; complete native totals remain unverified. Choose the single canonical book and candidate/dependency-bounded instrument rebuild; coverage generation/revision conditions in that reply replace any unconditional coverage assumption below. No full import or class activation yet.

## 1. What already exists (evidence)
`supabase/migrations/20261007181000_instrument_economic_import_and_rebuild.sql`:
- **Envelope cap:** at most 2,000 vouchers per upload (line 16).
- **Completeness is already strict:** a `stockflow_economic_source_coverage` row is written only when the upload has `completeWindow=true`, **zero** rejected vouchers, and no previously known non-purchase voucher in the window is missing (lines 77–87). Windows are half-open `[windowFrom, windowTo)`.
- **Rebuild cap:** `stockflow_rebuild_instrument_economics` raises `54000` once `stockflow_economic_source_lines` exceeds **10,000 rows** in total (line 100), and every import that adds vouchers triggers a rebuild (line 89).

## 2. The two blockers
1. **Window size:** three company-wide months may exceed 2,000 vouchers, and one envelope can't then be a complete window.
2. **Rebuild scale (the bigger risk):** full sales will almost certainly push source lines past 10,000. **Instrument economics would then stop rebuilding.** That would be a production regression in an accepted financial module.

## 3. Proposed contract
**A. Sub-window batches.** The connector splits the reporting window into **calendar sub-windows** (start with half-months; split further while a sub-window exceeds 1,800 vouchers). Each sub-window goes up as one envelope with `completeWindow=true` and its own `windowFrom`/`windowTo` and `sourceVersion`. No change to the server's completeness rule: each sub-window earns its coverage row exactly as today. Oversized after splitting to single days → fail visibly (an import exception), never truncate.

**B. Window completeness = gap-free union.** `private.stockflow_sales_window_complete(company, from, to)` returns true when the coverage rows for that company, **each newer than the latest import exception for that company and period**, together cover every day in `[from, to]` with no gap. That's a pure read over existing tables, and it replaces the false-returning seam on `claude/account-classes`.

**C. Revisions after coverage.** A later Tally edit inside a covered window arrives as a new revision. The latest-revision rule already handles it. Coverage stays valid, because coverage asserts presence, not immutability.

**D. Decouple the rebuild from market sales.** Choose one:
- (preferred) the rebuild processes only lines that can matter to instruments (mapped products or linked customers) and drops the global 10,000 count in favour of a bound on **candidate** lines;
- or market and class reads move to a separate summary (per company, customer and month, paise) maintained at import, and the economics rebuild keeps today's scope.

This is your call as financial owner. Either way, a performance test with the production line count (measured, not guessed) is part of acceptance.

**E. Measure first (read-only on production):** monthly counts of sales, return and credit vouchers and lines for the last six months. Those numbers decide the sub-window size and whether D is needed before activation.

## 4. Acceptance (adds to the plan's list)
- Three months uploaded as N sub-window batches → `stockflow_sales_window_complete` is true. Remove any one batch → false.
- An import exception in the period → false, until it's resolved and re-uploaded.
- Instrument economics still rebuilds within the agreed time with the full-sales line count. Summary/full parity still holds.
- Class figures reconcile exactly in paise against an independent Tally three-month total for a sample of customers.

## 5. Split of work (proposal)
- **Integration chat:** connector sub-window splitting, measuring production volume, the decision on D, and the financial review.
- **Claude, via Codex:** implement B (the completeness read) and its tests, and D's market-side summary if you pick that option, on a branch, after you agree.

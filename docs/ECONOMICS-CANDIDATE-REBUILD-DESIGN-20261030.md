# Economics rebuild: candidate-bounded scope (option D), design

**Date:** 30 Oct 2026. **Author:** Claude (design). **Builder:** Codex Astra. **Financial sign-off:** the integration chat, before release; this changes an accepted financial module.
**Why:** the 15 Oct integration reply chose option D (single source book, candidate- and dependency-bounded rebuild). The 30 Oct containment (`20261030100000`) stops the 10,000-line limit from breaking office uploads. This change removes the limit's cause.

## 1. Measured on production (read-only, 30 Oct)
| Fact | Value |
| --- | --- |
| Lines the rebuild loop processes today (non-purchase, latest non-cancelled revision) | 5,633 |
| Lines that can affect any target | **276** |
| Cost products (mapped include plus group mappings plus purchase-return products) | 37 |
| Placements | 2 |
| Result rows across all runs | 171,847 over 31 runs |

The loop calls several functions and lateral queries per line. 95% of the lines always end as `unattributed / no_verified_compatible_placement`, with no cost, no target and no events.

## 2. Rule: candidate lines
A non-purchase line, at its latest non-cancelled revision, is a **candidate** if **any** of the following holds:
1. its voucher kind is not `sale` (returns, credits and purchase returns, which are tiny volumes);
2. `(company_id, customer_source_id)` has **any** `stockflow_economic_targets` row of kind `placement`, whatever its approval or dates. This is deliberately broader than the loop's own filter, so it never drops a line the loop could attribute;
3. it is referenced by `stockflow_economic_instrument_billings` (`company_id`, `source_id`, `line_key`);
4. its product is in the run's `cost_products` set (the same CTE the function already builds). Every customer's consumption of a mapped reagent must still deplete stock for automatic cost (15 Oct reply);
5. it has a `stockflow_economic_line_reviews` or `stockflow_economic_cost_verifications` row (human-reviewed evidence always stays in the full path).

Every other line is a **non-candidate**. Proven from the function text: with no placement for that customer, no billing and a product outside `cost_products`, the loop produces exactly `status='unattributed'`, `reason='no_verified_compatible_placement'`, `share_bps=10000`, `quantity=l.quantity`, `revenue_paise=l.net_sales_paise`, with `target_id`, `cost_paise`, `gp_paise` and `recovery_origin_date` all null, and no events.

## 3. Change (one migration, anchor patches on the final definition)
- **Keep the old body** as `private.stockflow_rebuild_instrument_economics_full_scan(text)` (not called), for the parity test and rollback.
- In the live function:
  - **Guard:** replace the total-line guard with a guard on the **candidate** count (same `54000`, same 10,000 bound, message `Economic rebuild candidate lines exceed V1 limit`). The containment still applies.
  - **Before the loop:** one set-based `insert into stockflow_economic_results` for the non-candidate lines, with the exact column values in §2.
  - **The loop's `where`:** add the candidate predicate, so only candidates are processed. The order, reversals, events and activation are unchanged.
- Nothing else changes: the summary and full reads, the events and the policies.

## 4. Acceptance (written before code)
1. **Byte parity:** on a fixture with placements, group members, allocations, billings, returns, credits, purchase returns, auto-cost FIFO across several customers, FOC and line reviews, the old `full_scan` and the new function produce identical results.
   - Compared per `source_line_id`: `(target_id, status, reason, share_bps, quantity, revenue_paise, cost_paise, gp_paise, recovery_origin_date)`.
   - Identical event sets (`target_id, kind, amount_paise, effective_date`) and identical summary and full reads.
2. **Depletion:** a mapped reagent sold to a customer **without** a placement, earlier in time, still consumes FIFO stock. The later placement customer's cost is equal in both functions.
3. **Scale:** with more than 10,000 synthetic non-candidate lines and fewer than 500 candidates, the new rebuild succeeds (no 54000) and is measured: duration logged in the test output, and much faster than the full scan on the same data. The old function raises 54000 on the same data.
4. **Guard:** more than 10,000 *candidate* lines still raise 54000, which the containment turns into a visible pause.
5. The existing economics tests and parity tests still pass unchanged.

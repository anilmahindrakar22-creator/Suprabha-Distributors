# Economics result pruning: design

**Date:** 30 Oct 2026. **Author:** Claude (design). **Builder:** Codex. **Financial sign-off:** the integration chat, before release. This deletes derived rows from an accepted financial module.

## 1. Measured on production (read-only, 30 Oct)
| Fact | Value |
| --- | --- |
| Database size | 95 MB |
| `stockflow_economic_results` | 45 MB, 171,847 rows over 31 runs (16 to 28 Oct) |
| Rows belonging to inactive runs | 166,214 |
| Inactive-run rows referenced by a ledger event (`events.source_result_id`) | 784 |
| Runs in the last 7 days | 10 |

Growth is about 1.45 MB per run, roughly 65 MB a month. The free-plan database limit (500 MB) would be reached around April 2027. Paid upgrades are not allowed.

## 2. Rule
- Every read uses only the **active** run (`where active`). Rows of inactive runs are recomputed, superseded output, except where a ledger event points at them.
- **Keep:**
  - the active run's results;
  - all results of the **3 most recent inactive runs**, for comparison and diagnosis;
  - any result row referenced by `stockflow_economic_events.source_result_id`. The ledger is append-only and must keep its evidence.
- **Delete** every other result row of an older inactive run.
- Run rows themselves are never deleted. Each pruned run records `results_pruned_at` and `results_pruned_rows`, so the audit trail shows that the run existed and how many derived rows were removed.
- Auto-cost links (1.3 MB) and events are untouched.

## 3. Change
- Migration `20261030120000_economic_result_pruning.sql`:
  - adds `results_pruned_at timestamptz` and `results_pruned_rows integer` to `private.stockflow_economic_runs`;
  - creates `private.stockflow_prune_economic_results()`, revoked from every role. It prunes each eligible run where `results_pruned_at is null`, using the rule in §2;
  - patches the live `private.stockflow_rebuild_instrument_economics(text)` with one exactly-one anchor, so the prune runs right after the new run is activated (same transaction, same advisory lock). The `_full_scan` reference copy is not patched;
  - prunes the existing backlog once, inside the migration.
- In steady state each rebuild prunes one run (about 5,500 rows).

## 4. Acceptance (written before code)
1. After 6 rebuilds, the active run and the 3 newest inactive runs keep all their results. The 2 oldest inactive runs keep only the rows that events reference.
2. A result referenced by an event is never deleted, whatever its run's age.
3. The summary and full economics reads are identical before and after pruning.
4. `results_pruned_rows` equals the number of rows actually deleted, and a pruned run is never processed again.
5. The prune function is not executable by `anon`, `authenticated` or `service_role`.
6. The existing economics tests, the containment test and the candidate-rebuild parity test still pass.

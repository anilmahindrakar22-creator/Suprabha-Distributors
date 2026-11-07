# Economics result pruning: design (refresh of 30 Oct)

**Date:** 7 Nov 2026. **Decision:** the owner approved option 3 of `docs/STORAGE-OPTIONS-20261107.md` on 7 Nov ("option 3"). **Author:** Claude (design and review). **Builder:** Codex (heavy tier). **Financial sign-off:** the integration chat, before release. **Train:** 22 Nov, not 15 Nov. The 15 Nov train is already at acceptance, and the deadline is January.

This replaces `ECONOMICS-RESULT-PRUNING-DESIGN-20261030.md` on `claude/result-pruning-parked`. It deletes derived rows from an accepted financial module.

## 1. Measured on production (read-only, 7 Nov)
| Fact | Value |
| --- | --- |
| Database size | 132 MB |
| `stockflow_economic_results` | 67.5 MB, 223,492 rows, 40 runs (1 active) |
| Inactive-run rows cited by `stockflow_economic_events.source_result_id` | 1,072 |
| Delete guard on results | `no_delete` trigger, `private.prevent_business_delete()`; it raises for every row, with no exception path |
| Update guard on results | `immutable`, `private.prevent_immutable_pricing_update()` |
| Reference into results | only the foreign key `stockflow_economic_events.source_result_id`; **no index** on that column |
| Rebuild lock | `pg_advisory_xact_lock(hashtextextended('instrument-economics-v1',0))` |
| `stockflow_economic_runs` columns | `id, active, actor, created_at, engine_version` |
| Table privileges on results | `postgres` only; API roles have none |
| Triggers on `stockflow_economic_runs` | `no_delete` only; no update guard, so the two new columns need no exception |
| Readers of results | 12 functions. All of them read the active run, either through `where active` or through a `p_run` that every caller fills from the active run. The rebuild reads only its own new run. No app, Edge or connector code reads the table |
| Ledger | each rebuild reverses the previous postings and cites the new run's rows, so the event-cited rows in older runs are history the foreign key keeps |
| Acceptance (`ayrvhemxzizpkfcycvip`) | 23 runs, 22 inactive, 16,623 rows, so the prune does real work there |

## 2. Rule (unchanged from 30 Oct)
- Every read uses the **active** run only.
- **Keep:**
  - the active run;
  - all results of the **3 newest inactive runs**;
  - every result row cited by an event.
- **Delete:** every other result row of an older inactive run.
- **Never deleted:** run rows. Each pruned run records `results_pruned_at` and `results_pruned_rows`.
- **Not touched:** events, auto-cost links and every other economics table.

## 3. What changed from 30 Oct
1. **The prune runs in its own nightly job, not inside the rebuild.**
   - Reason: the rebuild runs inside the upload save, which already takes 13–14 s against a 20 s limit, so deleting about 5,880 rows there adds risk.
   - Benefit: the live rebuild function is not patched, so there is no anchor edit.
2. **A guarded delete exception instead of no guard.**
   - `no_delete` on `stockflow_economic_results` only is replaced by a trigger on a new function, `private.prevent_economic_result_delete()`. It still raises `42501` with the same message unless all of these hold:
     - transaction-local setting `stockflow.economic_result_prune` is `'on'`, which only the prune function sets, with `set_config(..., true)`;
     - the row's run is inactive;
     - the row's run is not one of the 3 newest inactive runs.
   - The cited-row case is already refused by the foreign key, and the prune skips those rows anyway.
   - Every other table keeps `private.prevent_business_delete()` unchanged.
   - **Limits:** this guard stops accidental deletes, not a privileged bypass. Only `postgres` can delete from this table, and `postgres` could set the setting or disable the trigger anyway.
   - The prune function sets the setting back to `'off'` before it returns.
3. **Index** `stockflow_economic_events(source_result_id)`. Without it, each deleted row's foreign-key check scans the events table.
4. **Concurrency:** the prune takes `pg_try_advisory_xact_lock(hashtextextended('instrument-economics-v1',0))`. If a rebuild holds the lock, it returns 0 and does nothing. The next night retries.
5. **Bound:** at most 10 runs per call, oldest first. That is about 59,000 rows, inside the job's own timeout.
6. **Backlog:** the migration does **not** prune. The existing 36 eligible runs are pruned by the job over four nights.
   - **Export first:** before the migration goes on production, the integration chat exports the result rows of inactive runs to a compressed file in `C:\Users\Admin\StockFlowBackups\`, then runs a full backup.
   - **Reclaim space:** after the backlog is gone, the integration chat runs one `VACUUM FULL private.stockflow_economic_results` outside billing hours. It locks the table for the run (expect under a minute at 68 MB) and needs that much free space. That is a separate step with its own go-ahead.

## 4. Change: one migration, `20261122090000_economic_result_pruning.sql`
- Adds `results_pruned_at timestamptz` and `results_pruned_rows integer` to `private.stockflow_economic_runs`. Runs have no update guard, so none is added or changed.
- Creates `create index stockflow_economic_events_source_result on private.stockflow_economic_events(source_result_id) where source_result_id is not null;`
- Creates `private.prevent_economic_result_delete()`, as in §3.2, and swaps the `no_delete` trigger on results to it.
- Creates `private.stockflow_prune_economic_results(max_runs integer default 10) returns integer`. It:
  - takes the try-lock (§3.4);
  - sets the transaction-local setting;
  - prunes eligible runs where `results_pruned_at is null`, oldest first, up to `max_runs`;
  - records the counts on each pruned run;
  - returns the rows deleted.
  - It is `security definer`, revoked from `public, anon, authenticated, service_role`.
- Schedules, inside the same `pg_cron` guard as `20261118120000_cron_log_trim.sql`: `cron.schedule('stockflow-economic-result-prune','40 20 * * *',$$select private.stockflow_prune_economic_results(10)$$)`. That is 02:10 IST, after the analyze at 20:30 UTC and the log trim at 20:10 UTC.
- Comments are short and factual.

## 5. Acceptance (written before code; replay SQL test `supabase/tests/economic_result_pruning.sql`)
1. **Keeps the right runs:** after 6 rebuilds and one prune, the active run and the 3 newest inactive runs keep all their rows. The 2 oldest keep only event-cited rows.
2. **Never deletes a cited row,** whatever its run's age.
3. **Reads are unchanged:** the summary and full economics reads give the same output before and after pruning.
4. **Counts are exact:** `results_pruned_rows` equals the rows deleted, and a pruned run is never processed again. A second call returns 0.
5. **The guard still refuses a direct delete as `postgres`:**
   - without the setting, the active run's rows can't be deleted, and neither can old rows;
   - with the setting on, a row of the active run or of one of the 3 newest inactive runs is still refused.
   - The error code is `42501` in each case.
6. **Other tables are unchanged:** a delete on `stockflow_economic_runs` and `stockflow_economic_events` is still refused, even with the setting on.
7. **Lock:** when the advisory lock is held by another session, the function returns 0 and deletes nothing. If a second session isn't possible in the replay, test the code path by checking the function body for the try-lock and the early return.
8. **Permissions:** `anon`, `authenticated` and `service_role` cannot execute the prune function.
9. **Bound:** with `max_runs = 1`, exactly one run is pruned.
10. **Existing checks still pass:** the economics tests, containment, candidate-rebuild parity, the bare DELETE/UPDATE catalog guard (the prune's delete has a `where`), both replays, the preflight unit test and tsc.

## 6. Release (22 Nov train; integration chat)
1. Export the inactive-run result rows to `StockFlowBackups`, then take a backup.
2. Apply the migration and run `ANALYZE`.
3. **Acceptance first.** It has 22 inactive runs, so the first night prunes 10 of them.
   - Before applying, record the summary read's output, the row count and the count of event-cited rows.
   - The next morning, check that the job succeeded and that the rows removed equal the sum of `results_pruned_rows`.
   - Check that cited rows are unchanged and the summary read is identical.
4. After four nights on production, schedule the `VACUUM FULL` (own go-ahead), then record the database size.
- **Rollback:**
  - unschedule `stockflow-economic-result-prune`;
  - put `no_delete` back on `private.prevent_business_delete()`.
  - Deleted rows come back only from the export; nothing reads them.

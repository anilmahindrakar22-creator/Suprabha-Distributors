# Release package: train 15 Nov 2026 (DRAFT)

**Status:** draft from 7 Nov. Claude prepared it; the **Codex integration chat releases it**. The final SHA and gate results are filled in at the cut on Fri 13 Nov. It needs the owner's go-ahead naming the night.

**Read only this file plus the scripts it names.** The plan and evidence are in `docs/RELEASE-PLAN-20261115.md`.

## 1. What ships
- **Branch** `claude/train-20261115`, based on `61a86db` (the code live since 6 Nov). Final SHA: to be set at the cut.
- **Features:**
  - A stale data warning on Today and Orders.
  - A line saying when the Economics update is waiting or paused.
  - The Economics rebuild can move out of the upload save. It ships switched off (`inline`).
  - The connector's sales coverage works on real Tally data, with a queue for older months.
  - Monthly reconciliation leaves out invoice round-off, which Tally books outside Sales Accounts. Stored amounts don't change.
  - A rejected control import is no longer logged on every upload.
- **Excluded:** Service stays deferred.

## 2. Before production
1. **Gate on the final SHA:** `pnpm run ci`, `pnpm test:connector` with pwsh 7, and both replays (`pnpm test:pricing:deployment`, `pnpm test:pricing:db`).
2. **Backup** per `docs/BACKUP-RESTORE-RUNBOOK.md`, just before the migrations.
3. **Uploads are healthy.** Run the query below, and read the last `cloud_upload` line in the connector log. Stop if the snapshot is over 1 hour old during office hours, or the last `cloud_upload` failed. A release on top of a broken upload hides which one caused the fault.
   ```sql
   begin transaction read only;
   select fetched_at, updated_at, now() - updated_at as cloud_age from public.stockflow_snapshots where id = 'suprabha';
   rollback;
   ```
4. **Acceptance first:** apply the 3 migrations and deploy the Worker there, then repeat the checks in section 5 that apply.
5. **Owner's go-ahead** for the production window, outside billing hours.

## 3. Production steps, in order
1. **Database:** apply these **3 migrations in filename order, one at a time**. Stop at the first failure and report it.
   - `20261118090000_control_null_and_source_time`
   - `20261118100000_deferred_economic_rebuild`
   - `20261118110000_reconciliation_rounding`

   Production's last migration is `20261106083351 supplier_prices_safe_delete`, and acceptance has it too (read-only checks, 7 Nov). `supabase/migration-history-map.json` now records the 6 Nov release: all 38 of its migrations matched production's stored SQL by hash, so `tests/pricing-release-preflight.mjs` should list exactly these 3 as pending. If it lists anything else, stop.
2. **`ANALYZE`** the whole database straight after the migrations. Without statistics, a save took 99.6 s locally, and this caused the failures from 1 Nov.
3. **Edge functions:** no change.
4. **App (Worker):** deploy `build:staff:production`. No new environment variables, secrets or dependencies. The service worker cache doesn't change.
5. **Office-PC connector:** install `desktop-connector/{dashboard,economics}.ps1` from this branch, using the reviewed copy and restart path. `recovery.ps1` is unchanged.
   - The live copies match `61a86db` apart from line endings, so nothing local is lost.
6. **Push alerts stay OFF.**

## 4. Required: first real upload
Local Postgres can't load `safeupdate`, and acceptance can't be used instead:
- Acceptance holds a 768-byte stub snapshot, so re-posting it misses the import branches.
- `LOAD 'safeupdate'` is refused there, so a rolled-back rehearsal isn't possible.
- A full made-up upload would replace acceptance data.

The bare-statement guard in `supabase/tests/control_null_and_source_time.sql` covers this class of bug before release. It scans every function we own, and would have failed the 6 Nov delete. **The proof on production is the next real upload, so wait for it.**

Within 30 minutes of the connector restart:
- The log shows `cloud_upload` succeeded, and `updated_at` has moved.
- `stockflow-sync` shows no 500 in its logs.

If it fails, stop and report. Use section 8.

## 5. Smoke checks (production)
1. **Today and Orders** open with no stale data warning, and the warning logic matches the snapshot age.
2. **Economics** shows no paused or waiting line while mode is `inline`.
3. **As Operations,** no ₹ on Today, Orders or Requests.
4. **Sales coverage:** the first run is due after 22:00 IST. Next morning, it should have no new failure in the connector log, and the last 3 complete months show as covered.

## 6. Post-release checks (read-only, next morning)
```sql
begin transaction read only;
select jobname, schedule, active from cron.job order by jobname;
select mode from private.stockflow_economic_rebuild_settings;
select window_from, window_to, imported_at from private.stockflow_economic_source_coverage order by imported_at desc limit 3;
rollback;
```
Expect `stockflow-economic-rebuild`, `stockflow-nightly-analyze` and `stockflow-push-every-minute`, with mode `inline`.

## 7. Separate steps, each with its own owner go-ahead
1. **Switch the rebuild to `deferred`.** Not part of the release night.
   - **Prove it on acceptance first:** set `deferred`, call `private.stockflow_request_economic_rebuild` by SQL, and within 5 minutes confirm a succeeded row in `cron.job_run_details` and a new `tally-sync` run.
   - Confirm the 20 s limit against real rebuild time before production.
   - Rollback is setting mode back to `inline`.
2. **Certify Feb–Jul 2026.** This replaces the 8 Nov package's section 7, step 2, which had no mechanism behind it.
   - After a good nightly run, create `%LOCALAPPDATA%\SuprabhaStockFlow\sales-coverage-backfill-v1.json` containing `{"company":"SUPRABHA DISTRIBUTORS","windows":["2026-05-15","2026-08-15"]}`.
   - `2026-05-15` covers Feb–Apr and `2026-08-15` covers May–Jul. One runs per night, so it takes two nights.
   - Recover appears only when all 9 months match. Local proof on real Tally data gave ₹0.00 gap in all 9; production proof comes from these runs.
3. **Clear the 30 test orders**, as in the 8 Nov package.

## 8. Rollback
- **Worker:** the previous production version. Confirm its ID before deploying.
- **Connector:** the previous office copies, which are the git blobs at `61a86db`.
- **Database:** leave the migrations in place and fix forward. They are additive, and the rebuild stays `inline`. To stop the new cron jobs, unschedule `stockflow-economic-rebuild` and `stockflow-nightly-analyze`.
- Never hand-delete audit, history or economics rows.

## 9. Evidence
To be filled in at the cut. Local proof so far is in section 5a of the plan.

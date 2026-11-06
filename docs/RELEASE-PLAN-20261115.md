# Release plan: StockFlow "Trust the data", Sunday 15 Nov 2026

**Author:** Claude (plan, design, review). **Builder:** Codex. **Release owner:** the integration chat. **Written:** 6 Nov 2026.
**Train:** `claude/train-20261115`, branched from `claude/train-20261120` at `61a86db`. Cut Fri 13 Nov, gate Sat 14 Nov, release Sun 15 Nov. Anything not ready by Thu 12 Nov moves to the next train.

## 1. What this release is
A small reliability release with no new commercial screens. It has two aims:
1. A data freeze can never again go unseen for six days.
2. Recover can actually become certified, which it can't today (section 3).

Production shows why new features would be wasted now:

| Production, 6 Nov | Count |
| --- | --- |
| Wallet snapshots | 0 |
| Commercial opportunities | 0 |
| Contact influences | 0 |
| Sales control totals | 0 |
| Active members | 3 administrators, 1 warehouse/viewer |
| Active Sales, Operations or Accounts members | 0 (the one Operations member is suspended) |

The Market layer we just shipped has no data yet, and the 5-working-day office pilot from Phase 0 hasn't run. The next useful evidence comes from real people using it, not from more screens.

## 2. Evidence (read-only, 6 Nov)
- **Uploads:** 28 straight successes since the fix. End to end 9.1–16.7 s, apart from one 25.6 s catch-up upload at 14:04.
- **Save in the database:** mean 7.3 s, max 18.2 s, against a 24 s limit. The mean covers all 694 calls in the statistics, so it may include older saves.
- **Rebuild:** ran at 14:04 and 18:25 today, not on every save. Two to three runs a day since 16 Oct. The 18:25 upload took 15.9 s against about 11–12 s typically, but uploads without a rebuild also reached 16.7 s. **So the rebuild may not be the main cost of a save, and the plan must not assume it is.** P1 measures this first.
- **Payload:** the same 4,174,965 bytes every cycle, so unchanged sections may be re-imported on every save.
- **Storage:** free plan, 500 MB limit. Database 130 MB, of which `stockflow_economic_results` is 67 MB (about 1.7 MB per run).
- **Today:** 2 calls on record, 576 ms and 954 ms in the database. Too few to judge; under the 2 s budget.
- **`pg_cron`:** on both production and acceptance. The only job is the push job.
- **Already shipped, so not in this plan:** Tally PO receipts and Contracts ending soon. Both design docs still say "next train".

## 3. Correction: Feb–Oct certification can't be done yet
The release package (section 7, step 2) and Claude's closing note offered "certify Feb–Oct" as an owner go-ahead. **No mechanism exists for that.**
- Recover needs all 9 months certified: complete coverage and a matching reconciliation for each.
- The connector only ever covers the last three complete months (`Get-SalesCoverageWindow`), and there is no backfill path.
- Production coverage rows only start at 1 Aug.
- Without a backfill, Recover stays empty until about May 2027.

P4 builds the backfill.

## 4. Before the train: Saturday 7 Nov, read-only
The first sales coverage run is due tonight, at the first economics read after 22:00 IST (about 22:25, if the office PC stays on). It's the first real run of the heaviest upload through the 24 s save. If it fails 3 times it is dropped and normal uploads carry on, so it can't freeze the data. It retries the next night.

Claude checks, with the package section 6 repeat:
1. `request=sales_coverage` and `cloud_upload` lines for that cycle in `connector-health.log`.
2. Rows in `private.stockflow_sales_control_totals`, and a `stockflow_sales_control_imports` row with `valid_months` set.
3. `stockflow_sales_coverage_status` and `stockflow_sales_reconciliation` for Aug, Sep and Oct.

If Aug–Oct don't match Tally, P4 waits. Fixing that difference comes first, and it may be the ₹100 September item.

## 5. Packages
| # | Package | Tier | Lane | Needs | Done when |
| --- | --- | --- | --- | --- | --- |
| P0 | **Full CI on the branch point.** It wasn't run at `498fa3f` or `61a86db`. | Claude runs | read-only | none | `pnpm run ci` exit 0 at `61a86db`, or failures listed |
| P1 | **Measure the save.** Fresh dump, `ANALYZE`, `track_functions`, per-trigger time with and without a rebuild, then per-table statistics to find which table caused the 25–30 s plan. | Claude runs | local only | none | A table of time per trigger, written here, that picks the P2 design |
| P2 | **Save headroom.** Design chosen by P1 (below). | astra (heavy) | migration, concurrency, economics | P1 | Worst-case save under 12 s locally on the fresh dump, with all P2 checks passing |
| P3 | **Data freshness warning on Today and Orders** (below). | sol (standard) | UI + read | none | Browser checks at 375 and 1280, Claude design review |
| P4 | **One-off sales coverage backfill** (below). | astra (heavy) | connector, Tally read-only | P2, section 4 result | Dry run on the dump: Feb–Jul coverage rows, no change to Aug–Oct |
| P5 | **Small fixes.** Stop logging a rejected control import on every upload (the trigger skips SQL null, but the connector sends JSON null). Extend the bare-statement guard to UPDATE. | luna (light) | migration, small | none | SQL test: JSON null writes no import row; a real rejection still does; guard covers UPDATE |
| P6 | **Release gate fixes** (below). | Claude docs, luna script | process | none | Package template updated; script run once on acceptance |

P0, P1, P3, P5 and P6 run in parallel. P2 waits for P1, and P4 waits for P2.

### P1 result (6 Nov, production backup, local)
| Save | Time |
| --- | --- |
| Rebuild runs, statistics current | 6.4–11.1 s (rebuild itself 3.7–8.1 s) |
| No rebuild | 1.5–2.0 s |
| Rebuild runs, no statistics anywhere | 99.6 s |
| Rebuild runs, one of 7 tested tables without statistics | 4.4–9.7 s |

- The rebuild is about 70% of the worst case, so the rebuild moves out of the save.
- No single tested table explains the statistics effect, so the nightly job analyzes the whole database.
- **Time limits:** a function's `statement_timeout` works through the API but not from `psql` or `pg_cron`. A local `psql` test ignored it, while production logged statement timeouts: at 07:41 UTC on 6 Nov, Edge returned 500 after 24.1 s with the limit at 20 s. That fits PostgREST applying the function's setting before the call, with about 4 s for the 4 MB upload (inferred, not measured). So the save limit is real, and the worker's limit has to go in its cron command.
- **Upload budget:** on that estimate, the 24 s limit plus transfer time passes the Edge function's 25 s abort, so about 21 s is the usable database time. Taking the rebuild out of the save makes this much less tight.

### P2: save headroom
- **Design:** the save only marks a rebuild as pending. A `pg_cron` worker checks every 5 minutes. Its 20 s limit is set in the cron command, so a save waiting on it still fits inside the Edge function's 25 s abort.
- **Stops after 3 failures:** it stays pending and visible until new evidence arrives, so a slow rebuild can't keep taking the lock uploads need. The nightly `ANALYZE` should clear the usual cause.
- **Switch:** `private.stockflow_economic_rebuild_settings.mode` stays `inline` until a deployment step sets `deferred`. Rollback is setting it back, with no migration.
- **Remaining risk:** a save still takes the economics lock, so one that lands during a rebuild waits for it. `authenticator` has `lock_timeout=8s`, and that probably still applies, so a save may fail after waiting 8 s. No lock timeouts were in the 10 log matches I read for the last 24 hours, but there was no such contention then either. At worst that's one missed 15-minute cycle, not a freeze.

**Before anyone sets `deferred`:**
1. Prove the job on acceptance: set `deferred`, call `stockflow_request_economic_rebuild` by SQL, then within 5 minutes confirm a succeeded row in `cron.job_run_details` and a new `tally-sync` run. Local Postgres has no `pg_cron`, so this is its only test before production.
2. Confirm 20 s against the real coverage cycle's rebuild time.
3. The admin line for a paused or long-pending rebuild must be live. If it isn't, the release ships with `inline`.

Checks for any design:
- One rebuild at a time per company (advisory lock). Two sessions: exactly one runs.
- The active run switches atomically. A reader sees the old run or the new one, never a mix.
- No more runs than today. Unchanged inputs create no run, because each run costs storage.
- Economics screens show "Economics as of …", and a pending or failed rebuild is visible. Stale figures never appear as current.
- Audit, actor (`tally-sync`), grants and search path stay the same.
- A failed rebuild never loses the snapshot and never leaves work stuck silently.
- A snapshot that changes nothing stays accepted, and the upload acknowledgement behaves as it does today.

### P3: freshness warning
- **Rule (changed when the train started):** one strip in the app frame, from `stockflow_snapshots.updated_at` through the existing order summary. Age is counted in office time only: Monday to Saturday, 10:30–19:00 IST. Amber at 45 office minutes, red at 510 (one office day). A plain 24-hour limit would turn red every Sunday night, so it was dropped.
- **Administrators and management:** "Tally data last reached StockFlow 3 hours ago. Check the office connector."
- **Everyone else:** "Stock figures are from 3 hours ago." The app stays usable.
- **Moved to P2:** the line for a paused rebuild or failing coverage, because P2 changes that state.
- **Limits:** small type, no new card, no push (push stays off). A failed read of the freshness data shows nothing and never blocks the page.
- **Tests:** just under and just over each limit, Sunday, overnight, and each role.

### P4: coverage backfill
- A connector switch runs `Read-TallySalesCoverage` for a named 3-month window: Feb–Apr, then May–Jul. Reads from Tally only. No Tally writes.
- One window per night, never on a normal cycle, and it must keep the existing 3-attempt drop.
- Existing Aug–Oct coverage and control totals stay unchanged. Check how a newer, older-dated window interacts with `stockflow_sales_coverage_status`, and with the omission exceptions, on the local dump first.
- Each window's differences are listed for Accounts. Nothing is forced to match.
- Runs only after release, with the owner's go-ahead. Recover appears only once all 9 months match.

### P6: release gate fixes
- Add `ANALYZE` after migrations as a written deploy step. Add a nightly job only if P1 shows autoanalyze falls behind.
- Add one synthetic upload through the acceptance Edge function. It goes through `safeupdate` and would have caught the 6 Nov bug. Synthetic data only; no production data on acceptance.
- Add snapshot age and last `cloud_upload` to the pre-release checks.

## 6. Calendar
| Day | What happens |
| --- | --- |
| Sat 7 Nov | Section 4 read-only checks. P0. |
| Sun 8 Nov | No release. The 6 Nov release covers this week. |
| Mon 9 Nov | P1 result, P2 design. P3, P5, P6 start. |
| Tue 10 – Wed 11 Nov | P2, then P4 |
| Thu 12 Nov | Cut-off. Claude design review of P3. |
| Fri 13 Nov | Cut, freeze commit |
| Sat 14 Nov | Full gate: both replays, browser suite, unit, phone screens. One release package. |
| Sun 15 Nov | Integration chat releases. Connector update and first backfill window need owner go-ahead. |

## 7. Owner items (these don't block the train)
1. **Start the pilot.** Add real Sales, Operations and Accounts users, then clear the 30 test orders (needs your go-ahead). This also closes the role checks not yet proven on production.
2. **Wallet estimates** for the top 20–30 labs, and deciders for those labs, so Market and the map become useful.
3. **Storage decision, by mid-December.** Superseded economics runs use about 1.7 MB each, and nightly coverage may add one a night. That leaves roughly 2.5–4 months before the 500 MB free limit, and paid plans are ruled out. Any removal of old runs touches the "never delete economics rows" rule, so it's your decision. Claude will bring options and numbers after P2.

## 8. Not in this release
Reagent consumption intelligence, Command Center, Market Map, Power Map diagram (all wait for data), Service (deferred), push alerts (off), dev-only audit findings (`ws`, `sharp`, `tinypool`, picked up only if the audit gate fails).

**Measure only:** Today. Let real calls collect, then look at the plan only if the median stays above 500 ms in the database.

## 9. Risks and rollback
- **P2 is the risk in this train.** It touches the upload path, which only production proves. If it isn't solid by Thu 12 Nov, it moves out, P4 moves with it, and the rest still ships.
- **Rollback:** Worker and Edge by recorded version. P2 ships with a migration that restores the in-save rebuild. Connector: the previous office copy.
- **The connector runs from the `stockflow-connector-disconnect` worktree.** Its uncommitted connector files are live, so builders must not edit them there. The integration chat should plan a proper install location.

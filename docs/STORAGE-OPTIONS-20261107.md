# Storage options, 7 Nov 2026

**Decision needed from the owner by mid-December:** whether old Economics results may be deleted. The free plan allows 500 MB. Above that, Supabase puts the database into read-only mode, so uploads and order saves would fail.

## Where the space goes (production, read-only, 7 Nov)
| Item | Size | Growth |
| --- | --- | --- |
| Whole database | 132 MB | 100–180 MB a month (estimate) |
| `stockflow_economic_results` | 67.5 MB | about 1.7 MB per run; each run writes a full copy of about 5,880 rows |
| `cron.job_run_details` | 9.3 MB | about 24 MB a month; nothing trims it |
| `stockflow_request_log` | 8.9 MB | small: about 3 rows a day |

Runs happen about 1.5–3 times a day. At the estimated growth, the database reaches 500 MB between early January and the end of February 2027.

**Unknown:** the Feb–Jul backfill may add result rows to every run, which would shorten this. Measure on a restored backup before the backfill runs.

## Options
| | Option | Effect | Cost or risk | Who decides |
| --- | --- | --- | --- | --- |
| 1 | Trim the `pg_cron` log to 7 days | Stops about 24 MB a month | None to the business | Done on this train |
| 2 | Rebuild Economics once a night | 1 run a day, about 51 MB a month; lasts until about June 2027 with option 1 | Economics can be up to a day behind. Needs `deferred` switched on first. No code change: a schedule change | Owner, with the `deferred` go-ahead |
| 3 | Delete old Economics results | Results stop growing; about 60 MB can be reclaimed; lasts for years | Lifts a recorded "no hard delete" guarantee on derived rows | Owner, plus financial sign-off |

## Option 3 in detail
Old results are protected by a `no_delete` trigger. This is why the 30 Oct design is parked on `claude/result-pruning-parked`.

- **Rows kept:** the active run, the 3 newest older runs, and every row a ledger event cites (1,072 such rows in older runs today). Run records stay, with a count of what was removed.
- **Rows removed:** only superseded calculation output. Every screen reads the active run only.
- **Before anything is deleted:** export the old rows to a compressed file in `C:\Users\Admin\StockFlowBackups\`.
- **Afterwards:** a one-off `VACUUM FULL` on that table, because deleted space is otherwise reused but not returned. It locks the table while it runs, so do it outside billing hours.
- **Parked code:** it needs refreshing, because the rebuild has changed since 30 Oct and its design doesn't yet say how the trigger is handled.

## Ruled out
- **Skip identical runs:** only 3 of the last 26 runs were identical.
- **Store only the changes between runs:** runs change few rows, but this means rewriting the financial engine and every read.
- **Drop the 18 MB index:** it's in use, with about 20,000 scans.
- **Paid plan:** not allowed under the standing rule.

## Recommendation
1. Option 1 now.
2. Option 3 for the train after this one, once the owner and financial sign-off agree. It's the only option that stops the growth.
3. Option 2 if option 3 is refused, or as extra margin.

Check database size at every release. Act at 350 MB at the latest.

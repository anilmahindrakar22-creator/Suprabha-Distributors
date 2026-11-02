# Local server-read baseline, 2 November 2026

From the repository root run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests\perf\run-perf.ps1
```

Requires the local PostgreSQL installation/data directory used by
`tests/pricing-migration-local.ps1`. The runner replays all migrations and tests,
seeds a disposable kept database, measures reads, then drops that database.
It leaves PostgreSQL running because replay does not expose startup ownership.
All output is saved as UTF-8 to `work/perf/perf-yyyyMMdd-HHmm.txt`.

Synthetic `PERF ` data adds 464 customers (42 empty cities), 169 with sales,
1,374 sale vouchers and 7,573 lines dated 2025-10-03 through 2026-10-31,
three administrators and two completed installations. Wallet assumptions:
150 snapshots across 100 customers (10 with three, 30 with two, 60 with one),
40 open capture opportunities, 20 lab-size reports, 120 exact pins and 302 town
locations derived from city. Names are synthetic; fixture rows remain in place
and add small overhead beyond these counts. The latest map gateway displays
exact pins and postcode centroids; town-only locations remain approximate data.

Nov 2025-Oct 2026 has complete source coverage and matching synthetic monthly
controls. Fixture companies also receive matching controls because Wallet checks
all linked companies. Ten labs fall from 6,000,000 to 3,600,000 paise/month in
Aug-Oct. Controls exercise certification; they are derived from seeded lines,
not an independent accounting accuracy test. The harness uses the real current
IST date and expects November 2026 for these fixed historical windows; outside
that month its certification/Recover assertion may reject the dataset.

Each read has one warm-up and five measured executions. The report shows median
and maximum server time, including SQL gateway authorization and JSON building,
and the final result's text byte size. It excludes HTTP, app transformations,
network transfer and rendering. Diagnoses reads a full 50-customer page; Accounts
and Wallet use page 1 with empty search. Map uses the whole market bbox
(south 15.4, west 75.0, north 18.6, east 77.9).

The two highest medians select the EXPLAIN targets. Wallet's shared main CTE is
extracted from the replayed function and its variables bound to the current
date, policy and certified seed state. This shows the actual main query plan;
nested helper function plans remain opaque. Other embedded gateway branches
print a skip reason. EXPLAIN runs after sampling and is excluded from timings.

Record machine, PostgreSQL version, execution date and log path with results.
Rule: **compare the same dataset, same machine, before and after**.
No speed claims follow from an unmeasured change.

| Read | Median ms | Max ms | Bytes |
| --- | --- | --- | --- |
| get_today | 104.6 | 106.5 | 1,543 |
| wallet_diagnoses | 81.2 | 82.1 | 6,450 |
| recover | 59.5 | 60.2 | 1,650 |
| customer_map | 48.8 | 49.9 | 20,064 |
| wallet_all | 34.3 | 35.1 | 17,888 |
| wallet_account | 33.1 | 33.6 | 3,227 |
| wallet_focus | 32.6 | 33.6 | 17,889 |
| accounts | 15.4 | 15.5 | 30,142 |
| service_workspace | 0.5 | 0.6 | 3,086 |

**Run details:**
- 2 Nov 2026, the owner's Windows 10 desktop, local portable PostgreSQL;
- train3 at `9a4e87d`;
- log `work/perf/perf-20261102-1708.txt`.

**Reading (Claude):**
- Every server read is under about 105 ms at production scale.
- Payloads are at most about 30 KB.
- The requirement is a useful list in under 2 s warm (REQUIREMENTS §6), so no server read needs optimising now.
- What this does not measure: HTTP, Edge hop, network and rendering. Production timing of the Today gateway on deploy day (integration chat) is still the real check.
- **Limitation:** the seed's certification windows are fixed to Nov 2025–Oct 2026. From December 2026 the harness needs its windows moved forward.

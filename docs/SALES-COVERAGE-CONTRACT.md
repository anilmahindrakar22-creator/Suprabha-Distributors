# `get_sales_coverage` response contract (fixed; server and UI both build to this)

Request: economics gateway action `get_sales_coverage`, payload `{}`. Roles: administrator, management, accounts; any other role gets 42501. Company: the canonical company of the latest economic evidence (the same one the other economics reads use).

Response JSON:

```json
{
  "window": { "from": "2026-07-01", "to": "2026-09-30" },
  "complete": true,
  "coveredFrom": "2026-07-01",
  "coveredTo": "2026-09-30",
  "importedAt": "2026-10-30T16:44:00Z",
  "sourceVersion": "2026-10-30T16:43:51Z",
  "blockingCount": 0,
  "blockingItems": [ { "sourceId": "c0071957-…-00005966", "reason": "…", "recordedAt": "2026-10-30T16:44:00Z" } ],
  "rebuild": { "state": "ok", "since": null, "reason": null },
  "months": [
    { "month": "2026-07", "appNetPaise": 123456789, "tallyNetPaise": 123456789, "differencePaise": 0, "state": "matches" },
    { "month": "2026-08", "appNetPaise": 98765432, "tallyNetPaise": null, "differencePaise": null, "state": "no_control" },
    { "month": "2026-09", "appNetPaise": 5550000, "tallyNetPaise": 5560000, "differencePaise": -10000, "state": "differs" }
  ]
}
```

Rules:
- **`window`:** the last three complete IST calendar months. `to` is the inclusive last day; internally the window is half-open, `[from, to+1)`.
- **`complete`, `coveredFrom`, `coveredTo`, `importedAt`, `sourceVersion`:** taken from `private.stockflow_sales_window_complete`. When there has never been a coverage row: `complete=false` and the covered fields are `null`.
- **`blockingItems`:** at most 20, newest first. `blockingCount` is the full count. These are the exceptions that make `complete` false.
- **`rebuild`:** from `private.stockflow_economic_rebuild_status`. When no row exists: `{ "state": "ok", "since": null, "reason": null }`.
- **`months`:** always three rows, in ascending order.
  - `appNetPaise`: the sum of `net_sales_paise` over the latest non-cancelled revision of `sale`/`return`/`credit` lines dated in that month.
  - `tallyNetPaise`: the latest `salesControlTotals` sales-ledger net for that month, or `null`.
  - `differencePaise = appNetPaise − tallyNetPaise`, or `null`.
  - `state`: `matches` only when the difference is exactly 0; `differs` otherwise; `no_control` when `tallyNetPaise` is null.
- All money values are integers in paise; JSON numbers are safe up to 9e15.

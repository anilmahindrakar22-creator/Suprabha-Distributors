# Office connector validation — 5 September 2026

Read-only probes against the office Tally endpoint identified that static date variables alone did not constrain the sales voucher collection. An explicit collection filter and typed date variables corrected the returned range. Runtime validation now rejects out-of-window dates before merging.

| Request | Vouchers | Response bytes | Duration |
|---|---:|---:|---:|
| Today, original date-variable-only request | 4,742 | 32,047,803 | 10,135 ms |
| Today, explicit collection filter | 3 | 15,933 | 114 ms |
| Last 30 days, explicit collection filter | 193 | 1,726,814 | 494 ms |

These are single sequential observations, not a benchmark or proof of improved interactive billing latency. The 30-day response ranged from 2026-08-06 to 2026-09-05. Recovery and sales-window fixture tests passed under the scheduled task's Windows PowerShell runtime.

The scheduled connector points to this checkout's desktop-connector/dashboard.ps1. It was restarted with the updated installer (15-minute extraction, five-minute upload retry). A later controlled five-year rebuild exceeded the 60-second safety ceiling; it was aborted without replacing the last successful snapshot. Automatic full-history reconciliation was therefore removed. Older last-supply facts are retained as a compact per-item summary while voucher reconciliation stays limited to the recent 30-day window.

Outstanding: representative billing latency comparison, separate master scheduling, per-domain health, and broader offline OMS work. The web application's invoice matching change has a separate deployment lifecycle.

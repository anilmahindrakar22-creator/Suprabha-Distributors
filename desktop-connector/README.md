# StockFlow Tally connector

`dashboard.ps1` runs beside TallyPrime on the office Windows computer. It refreshes reorder figures and the latest seven days of Sales vouchers every 15 minutes by default. Once daily, the Sales window expands to 30 days so backdated edits and cancellations are reconciled. The complete product catalog and active `Sundry Debtors` customer ledgers use separate durable caches refreshed every four hours. A small company-identity request runs before every cycle. A missing or different company leaves the last good snapshot untouched and prevents upload.

The upload credential must be stored in the Windows user environment as `STOCKFLOW_UPLOAD_KEY`. It must never be committed to source control. After updating this script on the office computer, restart the connector while TallyPrime is open with `SUPRABHA DISTRIBUTORS` loaded.

## Install automatic startup

Run the following once in PowerShell from this folder while signed in as the Windows user who operates TallyPrime:

```powershell
.\install-startup.ps1
```

This creates or updates the per-user **Suprabha StockFlow Tally Sync** task, starts it immediately, and restarts it at every Windows sign-in. Windows also retries the connector after an unexpected failure. The connector remains lightweight, extracts operational data every 15 minutes, refreshes product and customer masters every four hours, and retries a pending cloud upload every five minutes without rereading Tally. Successful and failed cloud uploads are recorded in `%LOCALAPPDATA%\SuprabhaStockFlow\connector-health.log` without storing the credential or business payload.

# StockFlow Tally connector

`dashboard.ps1` runs beside TallyPrime on the office Windows computer. It refreshes reorder figures and the latest seven days of Sales vouchers every 15 minutes by default. Once daily, the Sales window expands to 30 days so backdated edits and cancellations are reconciled. The complete product catalog and active `Sundry Debtors` customer ledgers use separate durable caches refreshed every four hours. A small company-identity request runs before every cycle. A missing or different company leaves the last good snapshot untouched and prevents upload.

The upload credential must be stored in the Windows user environment as `STOCKFLOW_UPLOAD_KEY`. It must never be committed to source control. After updating this script on the office computer, restart the connector while TallyPrime is open with `SUPRABHA DISTRIBUTORS` loaded.

## Install automatic startup

Run the following once in PowerShell from this folder while signed in as the Windows user who operates TallyPrime:

```powershell
.\install-startup.ps1
```

This creates or updates the per-user **Suprabha StockFlow Tally Sync** task, starts it immediately, and restarts it at every Windows sign-in. Windows also retries the connector after an unexpected failure. The connector remains lightweight, extracts operational data every 15 minutes, refreshes product and customer masters every four hours, and retries a pending cloud upload without rereading Tally. Failed uploads use a bounded 5, 10, 20 and then 30-minute backoff; the next fresh snapshot uploads immediately after recovery. Successful and failed cloud uploads, including consecutive failure counts, are recorded in `%LOCALAPPDATA%\SuprabhaStockFlow\connector-health.log` without storing the credential or business payload.

## Office administrator controls

These controls run only on the Tally computer and do not add anything to the everyday web app:

```powershell
.\connector-control.ps1 -Action Status
.\connector-control.ps1 -Action Pause
.\connector-control.ps1 -Action Resume
.\connector-control.ps1 -Action Restart
.\connector-control.ps1 -Action SetSchedule -SyncMinutes 20
```

The supported schedule is 5–120 minutes. Pausing stops Tally reads until an administrator resumes the task. Status shows the Windows task state, latest cloud-upload result, and the accepted row counts for each available data domain without exposing its credential or business payload.

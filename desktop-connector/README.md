# StockFlow Tally connector

`dashboard.ps1` runs beside TallyPrime on the office Windows computer. It exports stock, reorder information and recent invoices every 15 minutes by default. Active `Sundry Debtors` customer ledgers are stored in a separate durable cache and refreshed every four hours, avoiding a full ledger read during each stock cycle. Before accepting an extraction, it verifies that Tally reports `SUPRABHA DISTRIBUTORS`; a missing or different company leaves the last good snapshot untouched and prevents upload.

The upload credential must be stored in the Windows user environment as `STOCKFLOW_UPLOAD_KEY`. It must never be committed to source control. After updating this script on the office computer, restart the connector while TallyPrime is open with `SUPRABHA DISTRIBUTORS` loaded.

## Install automatic startup

Run the following once in PowerShell from this folder while signed in as the Windows user who operates TallyPrime:

```powershell
.\install-startup.ps1
```

This creates or updates the per-user **Suprabha StockFlow Tally Sync** task, starts it immediately, and restarts it at every Windows sign-in. The connector remains lightweight, extracts operational data every 15 minutes, refreshes customer ledgers every four hours, and retries a pending cloud upload every five minutes without rereading Tally.

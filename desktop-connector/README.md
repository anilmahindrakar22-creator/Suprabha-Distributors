# StockFlow Tally connector

`dashboard.ps1` runs beside TallyPrime on the office Windows computer. It exports the tracked stock catalog, reorder information, recent supply history, and active `Sundry Debtors` customer ledgers to the secured StockFlow snapshot every five minutes.

The upload credential must be stored in the Windows user environment as `STOCKFLOW_UPLOAD_KEY`. It must never be committed to source control. After updating this script on the office computer, restart the connector while TallyPrime is open with `SUPRABHA DISTRIBUTORS` loaded.

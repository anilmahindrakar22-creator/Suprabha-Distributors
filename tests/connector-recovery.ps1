$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../desktop-connector/recovery.ps1')
$dashboardSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../desktop-connector/dashboard.ps1') -Raw
if ($dashboardSource -notmatch 'request=local_http status=disconnected' -or $dashboardSource -notmatch 'catch \[System\.Net\.Sockets\.SocketException\]') {
    throw 'Local HTTP client disconnects are not contained by the connector'
}
$directory = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($directory) | Out-Null
$path = Join-Path $directory 'snapshot.json'
$snapshot = @{ company = 'TEST'; fetchedAtIso = [datetimeoffset]::UtcNow.ToString('o'); catalog = @(@{ tallyKey = 'A' }); tallyInvoices = @() }
Save-ConnectorSnapshot $path $snapshot
$restored = Read-ConnectorSnapshot $path 'TEST'
if ($restored.fetchedAtIso -ne $snapshot.fetchedAtIso -or $restored.catalog[0].tallyKey -ne 'A') { throw 'Restart recovery lost data or changed freshness' }
if ($null -ne (Read-ConnectorSnapshot $path 'OTHER')) { throw 'Wrong company accepted' }
$customerPath = Join-Path $directory 'customers.json'
$customerSnapshot = @{ company = 'TEST'; fetchedAtIso = [datetimeoffset]::UtcNow.ToString('o'); customers = @(@{ tallyKey = 'CITY LAB'; name = 'City Lab' }) }
Save-ConnectorSnapshot $customerPath $customerSnapshot
$restoredCustomers = Read-CustomerSnapshot $customerPath 'TEST'
if ($restoredCustomers.customers[0].tallyKey -ne 'CITY LAB') { throw 'Customer master cache was not restored' }
if ($null -ne (Read-CustomerSnapshot $customerPath 'OTHER')) { throw 'Wrong-company customer master cache accepted' }
$customerSnapshot.customers = @()
Save-ConnectorSnapshot $customerPath $customerSnapshot
if ($null -ne (Read-CustomerSnapshot $customerPath 'TEST')) { throw 'Empty customer master cache accepted' }
if ((Read-CustomerSnapshot "$customerPath.bak" 'TEST').customers[0].tallyKey -ne 'CITY LAB') { throw 'Last good customer master backup was not retained' }
$catalogPath = Join-Path $directory 'catalog.json'
$catalogSnapshot = @{ company = 'TEST'; fetchedAtIso = [datetimeoffset]::UtcNow.ToString('o'); document = '<ENVELOPE><COLLECTION><STOCKITEM NAME="KIT" /></COLLECTION></ENVELOPE>' }
Save-ConnectorSnapshot $catalogPath $catalogSnapshot
if (-not (Read-CatalogSnapshot $catalogPath 'TEST').document.Contains('STOCKITEM')) { throw 'Catalog master cache was not restored' }
if ($null -ne (Read-CatalogSnapshot $catalogPath 'OTHER')) { throw 'Wrong-company catalog master cache accepted' }
$catalogSnapshot.document = '<ENVELOPE><COLLECTION /></ENVELOPE>'
Save-ConnectorSnapshot $catalogPath $catalogSnapshot
if ($null -ne (Read-CatalogSnapshot $catalogPath 'TEST')) { throw 'Empty catalog master cache accepted' }
if (-not (Read-CatalogSnapshot "$catalogPath.bak" 'TEST')) { throw 'Last good catalog master backup was not retained' }
[xml]$correctCompany = '<ENVELOPE><COLLECTION><COMPANY NAME="SUPRABHA DISTRIBUTORS" /></COLLECTION></ENVELOPE>'
Assert-TallyCompanyIdentity $correctCompany 'suprabha distributors'
[xml]$correctCompanyNode = '<ENVELOPE><COLLECTION><COMPANY><NAME>SUPRABHA DISTRIBUTORS</NAME></COMPANY></COLLECTION></ENVELOPE>'
Assert-TallyCompanyIdentity $correctCompanyNode 'SUPRABHA DISTRIBUTORS'
$wrongCompanyRejected = $false
try {
    [xml]$wrongCompany = '<ENVELOPE><COLLECTION><COMPANY NAME="OTHER COMPANY" /></COLLECTION></ENVELOPE>'
    Assert-TallyCompanyIdentity $wrongCompany 'SUPRABHA DISTRIBUTORS'
} catch { $wrongCompanyRejected = $_.Exception.Message -like '*No data was merged or uploaded*' }
if (-not $wrongCompanyRejected) { throw 'Wrong live Tally company identity accepted' }
$missingCompanyRejected = $false
try {
    [xml]$missingCompany = '<ENVELOPE><COLLECTION /></ENVELOPE>'
    Assert-TallyCompanyIdentity $missingCompany 'SUPRABHA DISTRIBUTORS'
} catch { $missingCompanyRejected = $true }
if (-not $missingCompanyRejected) { throw 'Missing live Tally company identity accepted' }
$snapshot.catalog = @(@{ tallyKey = 'B' })
Save-ConnectorSnapshot $path $snapshot
if ((Read-ConnectorSnapshot $path 'TEST').catalog[0].tallyKey -ne 'B') { throw 'Atomic replacement failed' }
if ((Read-ConnectorSnapshotWithBackup $path 'TEST').catalog[0].tallyKey -ne 'B') { throw 'Valid main snapshot was not preferred' }
[IO.File]::WriteAllText($path, '{broken')
if ((Read-ConnectorSnapshotWithBackup $path 'TEST').catalog[0].tallyKey -ne 'A') { throw 'Main snapshot did not recover from its last good backup' }
if ($null -ne (Read-ConnectorSnapshotWithBackup $path 'OTHER')) { throw 'Wrong-company main snapshot backup accepted' }
$salesPath = Join-Path $directory 'sales.json'
$salesSnapshot = @{ company = 'TEST'; fetchedAtIso = [datetimeoffset]::UtcNow.ToString('o'); sourceScope = 'sales_vouchers_v1'; catalog = @(); tallyInvoices = @(); records = @(@{ masterId = 'A' }) }
Save-ConnectorSnapshot $salesPath $salesSnapshot
$salesSnapshot.records = @(@{ masterId = 'B' })
Save-ConnectorSnapshot $salesPath $salesSnapshot
if ((Read-TrustedSalesSnapshotWithBackup $salesPath 'TEST').records[0].masterId -ne 'B') { throw 'Valid sales history was not preferred' }
[IO.File]::WriteAllText($salesPath, '{broken')
$recoveredSales = Read-TrustedSalesSnapshotWithBackup $salesPath 'TEST'
if ($recoveredSales.records[0].masterId -ne 'A') { throw 'Sales history did not recover from its last good backup' }
if ($null -ne (Read-TrustedSalesSnapshotWithBackup $salesPath 'OTHER')) { throw 'Wrong-company sales history backup accepted' }
$salesSnapshot.sourceScope = 'purchase_vouchers_v1'
[IO.File]::WriteAllText($salesPath, (@{ schemaVersion = 1; snapshot = $salesSnapshot } | ConvertTo-Json -Depth 12 -Compress))
if ((Read-TrustedSalesSnapshotWithBackup $salesPath 'TEST').records[0].masterId -ne 'A') { throw 'Wrong-domain sales cache was not rejected in favor of the trusted backup' }

$healthPath = Join-Path $directory 'health.log'
if ((Get-ConnectorUploadFailureCode ([pscustomobject]@{ Exception = [pscustomobject]@{ Response = [pscustomobject]@{ StatusCode = 500 } } })) -ne 'http_500') { throw 'Cloud HTTP failure status was not classified' }
if ((Get-ConnectorUploadFailureCode ([pscustomobject]@{ Exception = [pscustomobject]@{ Response = [pscustomobject]@{ StatusCode = 401 } } })) -ne 'http_401') { throw 'Cloud authorization failure status was not classified' }
if ((Get-ConnectorUploadFailureCode ([pscustomobject]@{ Exception = [pscustomobject]@{ Response = $null } })) -ne 'network') { throw 'Cloud network failure was not classified' }
if ((Get-ConnectorUploadFailureCode ([pscustomobject]@{ Exception = [pscustomobject]@{ Response = [pscustomobject]@{ StatusCode = 'secret-data' } } })) -ne 'network') { throw 'Untrusted HTTP status reached health log' }
if (-not (Test-ConnectorUploadAuthFailure 'http_401') -or -not (Test-ConnectorUploadAuthFailure 'http_403')) { throw 'Cloud authorization failures must stop automatic retries' }
if (Test-ConnectorUploadAuthFailure 'http_500' -or (Test-ConnectorUploadAuthFailure 'network')) { throw 'Temporary cloud failures must remain retryable' }
if ((Get-TallyRetryDelayMinutes 15 1) -ne 15) { throw 'First Tally failure must retain the normal retry interval' }
if ((Get-TallyRetryDelayMinutes 15 2) -ne 30 -or (Get-TallyRetryDelayMinutes 15 3) -ne 60) { throw 'Repeated Tally failures did not back off' }
if ((Get-TallyRetryDelayMinutes 15 8) -ne 60 -or (Get-TallyRetryDelayMinutes 120 8) -ne 120) { throw 'Tally retry delay exceeded its cap or shortened the configured interval' }
$freshness = Get-ConnectorSourceFetchedAt '2026-09-29T12:00:00Z' @{ fetchedAtIso = '2026-09-29T08:00:00Z' } @{ fetchedAtIso = '2026-09-29T04:00:00Z' }
if ($freshness.stock -ne '2026-09-29T12:00:00Z' -or $freshness.catalog -ne '2026-09-29T08:00:00Z' -or $freshness.customers -ne '2026-09-29T04:00:00Z') { throw 'Source freshness was incorrectly advanced by a stock-only refresh' }
if ((Get-ConnectorSourceFetchedAt '2026-09-29T12:00:00Z' $null $null).catalog) { throw 'Missing catalog source must not appear fresh' }
if (-not (Write-BoundedConnectorLog $healthPath 'first-entry' 1)) { throw 'Initial health log write failed' }
if (-not (Write-BoundedConnectorLog $healthPath 'second-entry' 1)) { throw 'Rotated health log write failed' }
if ((Get-Content -LiteralPath "$healthPath.previous" -Raw).Trim() -ne 'first-entry') { throw 'Health log rotation did not retain the previous log' }
if ((Get-Content -LiteralPath $healthPath -Raw).Trim() -ne 'second-entry') { throw 'Health log rotation did not write the current log' }
if (Write-BoundedConnectorLog $directory 'ignored') { throw 'Health log failure was not contained' }
if ($null -ne (Read-ConnectorSnapshot $path 'TEST')) { throw 'Corrupt cache accepted' }
$lockPath = Join-Path $directory 'connector.lock'
$handle = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
try {
    $blocked = $false
    try { $duplicate = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None'); $duplicate.Dispose() } catch { $blocked = $true }
if (-not $blocked) { throw 'Duplicate instance lock failed' }
} finally { $handle.Dispose() }
$baseline = Convert-RowsToLastSupplyBaseline @([pscustomobject]@{ item='Kit'; lastSuppliedDate='05 Sep 2026'; lastSuppliedParty='City Lab'; lastSuppliedQty=2 })
if ($baseline['Kit'].dateKey -ne '20260905' -or $baseline['Kit'].quantity -ne 2) { throw 'Last-supply baseline conversion failed' }
[IO.File]::Delete($path)
[IO.File]::Delete("$path.bak")
[IO.File]::Delete($lockPath)
[IO.File]::Delete($customerPath)
[IO.File]::Delete("$customerPath.bak")
[IO.File]::Delete($catalogPath)
[IO.File]::Delete("$catalogPath.bak")
[IO.File]::Delete($salesPath)
[IO.File]::Delete("$salesPath.bak")
[IO.File]::Delete($healthPath)
[IO.File]::Delete("$healthPath.previous")
[IO.Directory]::Delete($directory)
Write-Output 'PASS: disconnect containment, restart and backup recovery, timestamp preservation, durable customer/catalog caches, saved/live company validation, atomic replacement, bounded Tally retry, bounded health log, corrupt cache, exclusive lock, compact baseline'

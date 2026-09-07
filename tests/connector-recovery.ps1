$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../desktop-connector/recovery.ps1')
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
[IO.File]::WriteAllText($path, '{broken')
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
[IO.Directory]::Delete($directory)
Write-Output 'PASS: restart recovery, timestamp preservation, durable customer/catalog caches, saved/live company validation, atomic replacement, corrupt cache, exclusive lock, compact baseline'

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
[IO.Directory]::Delete($directory)
Write-Output 'PASS: restart recovery, timestamp preservation, company validation, atomic replacement, corrupt cache, exclusive lock, compact baseline'

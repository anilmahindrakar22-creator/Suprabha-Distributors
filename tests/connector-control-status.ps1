$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../desktop-connector/connector-control.ps1')

$directory = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($directory) | Out-Null
try {
    $snapshotPath = Join-Path $directory 'snapshot-v1.json'
    $uploadStatePath = Join-Path $directory 'cloud-upload-state-v1.json'
    $company = 'TEST COMPANY'
    $snapshot = [ordered]@{
        company = $company
        fetchedAtIso = [datetimeoffset]::UtcNow.ToString('o')
        catalog = @([ordered]@{ tallyKey = 'private-catalog-marker' })
        tallyInvoices = @()
    }
    Save-ConnectorSnapshot $snapshotPath $snapshot
    $storedSnapshot = Read-ConnectorSnapshotWithBackup $snapshotPath $company
    $snapshotJson = $storedSnapshot | ConvertTo-Json -Depth 6 -Compress
    $snapshotHash = Get-StableEvidenceVersion $snapshotJson
    $pending = Get-CloudUploadDisplayStatus $snapshotPath $uploadStatePath $company
    if ($pending -ne 'Pending upload') { throw "Unacknowledged snapshot should be pending; got '$pending'" }

    Save-ConnectorUploadState $uploadStatePath @{ company = $company; kind = 'cloud_upload_state_v1'; ackedHash = $snapshotHash; blockedKeyHash = $null }
    $acknowledged = Get-CloudUploadDisplayStatus $snapshotPath $uploadStatePath $company
    if ($acknowledged -ne 'Acknowledged (current snapshot)') { throw "Current acknowledged snapshot was not reported; got '$acknowledged'" }

    Save-ConnectorUploadState $uploadStatePath @{ company = $company; kind = 'cloud_upload_state_v1'; ackedHash = $snapshotHash; blockedKeyHash = Get-StableEvidenceVersion 'unavailable-to-status-command' }
    $paused = Get-CloudUploadDisplayStatus $snapshotPath $uploadStatePath $company
    if ($paused -ne 'Paused after rejected upload key; awaiting successful upload') { throw "Rejected key should be reported as paused; got '$paused'" }
    Save-ConnectorUploadState $uploadStatePath @{ company = $company; kind = 'cloud_upload_state_v1'; ackedHash = $snapshotHash; blockedKeyHash = $null }
    $cleared = Get-CloudUploadDisplayStatus $snapshotPath $uploadStatePath $company
    if ($cleared -ne 'Acknowledged (current snapshot)') { throw 'Cleared rejection state did not return to the acknowledged status' }

    Save-ConnectorUploadState $uploadStatePath @{ company = $company; kind = 'cloud_upload_state_v1'; ackedHash = $null; blockedKeyHash = $null; rejectedPayloadHash = $snapshotHash }
    $payloadPaused = Get-CloudUploadDisplayStatus $snapshotPath $uploadStatePath $company
    if ($payloadPaused -ne 'Paused after rejected snapshot; waiting for changed data') { throw 'Rejected snapshot status missing' }
    $snapshot.catalog[0].tallyKey = 'changed-private-marker'
    Save-ConnectorSnapshot $snapshotPath $snapshot
    if ((Get-CloudUploadDisplayStatus $snapshotPath $uploadStatePath $company) -ne 'Pending upload') { throw 'Changed snapshot should be eligible for upload' }

    foreach ($status in @($pending, $acknowledged, $paused, $payloadPaused)) {
        if ($status.Contains('unavailable-to-status-command') -or $status.Contains('private-catalog-marker') -or $status -match '[a-f0-9]{64}') {
            throw 'Cloud upload status exposed a key, hash, or snapshot payload marker'
        }
    }

    if ((Get-CloudUploadDisplayStatus (Join-Path $directory 'missing.json') $uploadStatePath $company) -ne 'No local snapshot available') {
        throw 'Missing local snapshot status was not reported clearly'
    }
} finally {
    foreach ($file in @($snapshotPath, "$snapshotPath.bak", $uploadStatePath, "$uploadStatePath.bak")) {
        if (Test-Path -LiteralPath $file) { [IO.File]::Delete($file) }
    }
    [IO.Directory]::Delete($directory)
}

Write-Host 'Connector control status tests passed.'

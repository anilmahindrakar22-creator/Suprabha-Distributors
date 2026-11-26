$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../desktop-connector/recovery.ps1')
function Assert-Delta($Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
$dashboardPath=Join-Path $PSScriptRoot '../desktop-connector/dashboard.ps1'
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($dashboardPath,[ref]$tokens,[ref]$parseErrors)
Assert-Delta ($parseErrors.Count -eq 0) 'Dashboard parser errors'
foreach($name in @('Get-EconomicEntryHash','New-EconomicEvidenceIndex','Read-EconomicEvidenceIndex','Save-EconomicEvidenceIndex','ConvertTo-EconomicEvidenceDelta','Publish-CloudSnapshot','Get-ServerTimingFields')) {
    $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
    Assert-Delta ($null -ne $definition) "Missing helper $name"
    Invoke-Expression $definition.Extent.Text
}
function New-TestEvidence($Ids,[string]$Version='v1') {
    return [ordered]@{
        schemaVersion=1;companyId='test-company';sourceVersion=$Version
        windowFrom='2026-11-01';windowTo='2026-11-26';completeWindow=$true
        itemCatalog=@(@{productId='P'});customerLedgers=@(@{sourceId='L'})
        vouchers=@($Ids | ForEach-Object { [ordered]@{sourceId=[string]$_;revision='1';amount='100';lines=@(@{productId='P';quantity=1})} })
    }
}
$now=[datetimeoffset]'2026-11-26T03:00:00+05:30'
$e1=New-TestEvidence @('A','B','C')
$selected=ConvertTo-EconomicEvidenceDelta $e1 $null $now
Assert-Delta ($selected.full -and [object]::ReferenceEquals($selected.document,$e1) -and $selected.document.schemaVersion -eq 1) 'No index must return unchanged full evidence'
$index=New-EconomicEvidenceIndex $e1 'TEST' $true $null '2026-11-26'
$e2=New-TestEvidence @('A','B','C','D') 'v2'
$e2.vouchers[1].revision='2'
$selected=ConvertTo-EconomicEvidenceDelta $e2 $index $now
$delta=$selected.document
Assert-Delta (-not $selected.full -and $delta.schemaVersion -eq 2 -and $delta.baseVersion -ceq 'v1') 'Delta version/base incorrect'
Assert-Delta (($delta.vouchers.sourceId -join ',') -ceq 'B,D') 'Delta did not contain exactly changed and new entries'
Assert-Delta ($delta.manifest.Count -eq 4) 'Manifest omitted entries'
for($i=0;$i -lt 4;$i++) {
    Assert-Delta ($delta.manifest[$i].Count -eq 2 -and $delta.manifest[$i][0] -ceq $e2.vouchers[$i].sourceId -and $delta.manifest[$i][1] -ceq $e2.vouchers[$i].revision) 'Manifest pair/order changed'
}
foreach($key in $e2.Keys) {
    Assert-Delta ($delta.Contains($key)) "Full document key lost: $key"
    if($key -notin @('schemaVersion','vouchers')) {
        Assert-Delta (($delta[$key] | ConvertTo-Json -Depth 6 -Compress) -ceq ($e2[$key] | ConvertTo-Json -Depth 6 -Compress)) "Full document value changed: $key"
    }
}
Assert-Delta ($e2.schemaVersion -eq 1 -and $e2.vouchers.Count -eq 4 -and -not $e2.Contains('manifest')) 'Conversion mutated full evidence'
$sameRevision=New-TestEvidence @('A','B','C') 'v3'
$sameRevision.vouchers[2].amount='200'
$selected=ConvertTo-EconomicEvidenceDelta $sameRevision $index $now
Assert-Delta ($selected.document.vouchers.Count -eq 1 -and $selected.document.vouchers[0].sourceId -ceq 'C') 'Content hash change was omitted'
$selected=ConvertTo-EconomicEvidenceDelta $e1 $index $now
Assert-Delta (-not $selected.full -and $selected.document.vouchers.Count -eq 0 -and $selected.document.manifest.Count -eq 3) 'Unchanged evidence did not produce empty delta'
$index.fullDate='2026-11-25'
Assert-Delta ((ConvertTo-EconomicEvidenceDelta $e1 $index $now).full) 'Daily full safety net missing'
Assert-Delta (-not (ConvertTo-EconomicEvidenceDelta $e1 $index ([datetimeoffset]'2026-11-26T01:00:00+05:30')).full) 'Safety net ran before 02:00 IST'
$index.fullDate='2026-11-26'
Assert-Delta (-not (ConvertTo-EconomicEvidenceDelta $e1 $index $now).full) 'Safety net repeated on same date'
foreach($invalid in @('empty_revision','nonnumeric_revision','blank_source','duplicate_source')) {
    $invalidEvidence=New-TestEvidence @('A','B')
    switch($invalid) {
        'empty_revision' { $invalidEvidence.vouchers[0].revision='' }
        'nonnumeric_revision' { $invalidEvidence.vouchers[0].revision='1x' }
        'blank_source' { $invalidEvidence.vouchers[0].sourceId=' ' }
        'duplicate_source' { $invalidEvidence.vouchers[1].sourceId='A' }
    }
    $invalidSelection=ConvertTo-EconomicEvidenceDelta $invalidEvidence $index $now
    Assert-Delta ($invalidSelection.full -and [object]::ReferenceEquals($invalidSelection.document,$invalidEvidence)) "Invalid manifest must return unchanged full evidence: $invalid"
    $invalidEvidence.vouchers=@($invalidEvidence.vouchers)+@((New-TestEvidence @(1..1999)).vouchers)
    Assert-Delta ($null -eq (ConvertTo-EconomicEvidenceDelta $invalidEvidence $index $now)) "Over-cap invalid manifest must skip evidence: $invalid"
}
$caseEvidence=New-TestEvidence @('A','a')
Assert-Delta (-not (ConvertTo-EconomicEvidenceDelta $caseEvidence $index $now).full) 'Source ID duplicate check must be ordinal and case-sensitive'
foreach($field in @('purpose','backfillEntry')) {
    $special=New-TestEvidence @('A')
    $special[$field]=if($field -eq 'purpose'){'sales_coverage'}else{'entry-1'}
    Assert-Delta ((ConvertTo-EconomicEvidenceDelta $special $index $now).full) "$field must remain full"
}
$large=New-TestEvidence @(1..2001) 'large-v1'
Assert-Delta ($null -eq (ConvertTo-EconomicEvidenceDelta $large $null $now)) 'Over-cap full upload allowed'
$largeIndex=New-EconomicEvidenceIndex $large 'TEST' $true $null '2026-11-25'
$selected=ConvertTo-EconomicEvidenceDelta $large $largeIndex $now
Assert-Delta (-not $selected.full -and $selected.document.manifest.Count -eq 2001 -and $selected.document.vouchers.Count -eq 0) 'Over-cap safety net did not use usable index'
$emptyIndex=New-EconomicEvidenceIndex (New-TestEvidence @()) 'TEST' $true $null '2026-11-26'
Assert-Delta ($null -eq (ConvertTo-EconomicEvidenceDelta $large $emptyIndex $now)) 'Over-cap changed entries allowed'
$wrongIndex=New-EconomicEvidenceIndex $e1 'TEST' $true $null '2026-11-26'
$wrongIndex.companyId='other'
Assert-Delta ((ConvertTo-EconomicEvidenceDelta $e1 $wrongIndex $now).full) 'Wrong company ID used for delta'
$wrongIndex.companyId=$e1.companyId;$wrongIndex.baseVersion=' '
Assert-Delta ((ConvertTo-EconomicEvidenceDelta $e1 $wrongIndex $now).full) 'Blank base used for delta'
$directory=Join-Path $PSScriptRoot ('../work/tmp/economic-delta-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($directory) | Out-Null
try {
    $economicIndexPath=Join-Path $directory 'index.json'
    Save-ConnectorSnapshot $economicIndexPath $index
    $restored=Read-EconomicEvidenceIndex $economicIndexPath 'TEST'
    Assert-Delta ($restored.baseVersion -ceq $index.baseVersion -and $restored.fullDate -ceq $index.fullDate) 'Index metadata round trip failed'
    foreach($id in $index.entries.Keys) {
        Assert-Delta ($restored.entries.$id.revision -ceq $index.entries[$id].revision -and $restored.entries.$id.hash -ceq $index.entries[$id].hash) 'Index entries round trip failed'
    }
    Assert-Delta ($null -eq (Read-EconomicEvidenceIndex $economicIndexPath 'OTHER')) 'Wrong company index accepted'
    [IO.File]::WriteAllText($economicIndexPath,'corrupt')
    Assert-Delta ($null -eq (Read-EconomicEvidenceIndex $economicIndexPath 'TEST')) 'Corrupt index accepted'
    Save-ConnectorSnapshot "$economicIndexPath.bak" $index
    Assert-Delta ($null -ne (Read-EconomicEvidenceIndex $economicIndexPath 'TEST')) 'Backup index was not recovered'
    $bad=New-EconomicEvidenceIndex $e1 'TEST' $true $null '2026-11-26'
    $bad.schemaVersion=2
    Save-ConnectorSnapshot $economicIndexPath $bad
    Remove-Item -LiteralPath "$economicIndexPath.bak" -Force
    Assert-Delta ($null -eq (Read-EconomicEvidenceIndex $economicIndexPath 'TEST')) 'Wrong schema accepted'

    # Exercise the actual failure and acknowledgement paths without startup or network.
    $script:health=@()
    function Write-ConnectorHealth([string]$Message) { $script:health+= $Message }
    function Invoke-WebRequest { throw 'Simulated HTTP 500' }
    function Get-ConnectorUploadFailureCode($Failure) { return 'http_500' }
    $companyName='TEST';$cloudSyncUrl='unused';$cloudUploadKey='generic-test-key'
    $uploadStatePath=Join-Path $directory 'upload.json'
    $snapshotPath=Join-Path $directory 'snapshot.json'
    $script:uploadState=@{company='TEST';ackedHash=$null;rejectedPayloadHash=$null;blockedKeyHash=$null}
    $script:cloudUploadFailures=0
    $script:lastEconomicEvidence=$e2
    $script:pendingEconomicIndex=New-EconomicEvidenceIndex $e2 'TEST' $false $index '2026-11-26'
    $script:economicIndex=$index
    $script:economicDeltaForceFull=$false
    $script:pendingUpload=@{economicEvidence=$delta}
    $script:pendingUploadJson=$script:pendingUpload | ConvertTo-Json -Depth 6 -Compress
    Assert-Delta (-not (Publish-CloudSnapshot $script:pendingUploadJson)) 'Failure unexpectedly succeeded'
    $retry=$script:pendingUploadJson | ConvertFrom-Json
    Assert-Delta ($script:economicDeltaForceFull -and $null -eq $script:economicIndex -and -not $script:uploadPayloadBlocked) 'Failure did not force full or incorrectly blocked payload'
    Assert-Delta ($retry.economicEvidence.schemaVersion -eq 1 -and $retry.economicEvidence.vouchers.Count -eq 4 -and $null -eq $retry.economicEvidence.manifest) 'Retry would resend failed delta'
    Assert-Delta (-not (Test-Path -LiteralPath $economicIndexPath) -and -not (Test-Path -LiteralPath "$economicIndexPath.bak")) 'Failed delta left stale index on disk'
    function Invoke-WebRequest { return @{StatusCode=200;Headers=@{}} }
    Assert-Delta (Publish-CloudSnapshot $script:pendingUploadJson) 'Full retry did not succeed'
    Assert-Delta (-not $script:economicDeltaForceFull -and $script:economicIndex.baseVersion -ceq $e2.sourceVersion -and (Test-Path -LiteralPath $economicIndexPath)) 'Acknowledgement did not save and advance index'
    $script:lastEconomicEvidence=$large
    $script:pendingUploadJson=@{economicEvidence=$selected.document} | ConvertTo-Json -Depth 6 -Compress
    function Invoke-WebRequest { throw 'Simulated HTTP 500' }
    $null=Publish-CloudSnapshot $script:pendingUploadJson
    Assert-Delta ($null -eq ($script:pendingUploadJson | ConvertFrom-Json).economicEvidence) 'Over-cap retry retained failed delta'
    Assert-Delta (@($script:health | Where-Object { $_ -match 'request=economic_evidence status=skipped reason=full_upload_over_cap count=2001' }).Count -gt 0) 'Over-cap retry skip was not logged'
} finally {
    # The generated absolute path stays within the repository test scratch directory.
    $scratch=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../work/tmp/'))
    $resolved=[IO.Path]::GetFullPath($directory)
    if(-not $resolved.StartsWith($scratch,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected test scratch path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
$source=Get-Content -LiteralPath $dashboardPath -Raw
Assert-Delta ($source.Contains('$script:economicDeltaForceFull = $true') -and $source.Contains('request=economic_delta status=fallback')) 'Delta failure fallback missing'
Assert-Delta ($source.Contains('Save-EconomicEvidenceIndex $script:pendingEconomicIndex') -and $source.Contains('Save-ConnectorSnapshot $economicIndexPath $Index')) 'Ack path index save missing'
Write-Output 'PASS: economic delta contract, caps, index recovery, acknowledgement and full retry'

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../desktop-connector/recovery.ps1')
$old = @(@{masterId='1';date='20250101'},@{masterId='2';date='20260901'},@{masterId='3';date='20240101'})
$fresh = @(@{masterId='3';date='20260902';cancelled=$true})
$merged = @(Merge-SalesRecords $old $fresh '20260801')
if ($merged.Count -ne 2) { throw 'Incorrect voucher count' }
if (-not ($merged | Where-Object masterId -eq '1')) { throw 'Older history lost' }
if ($merged | Where-Object masterId -eq '2') { throw 'Deleted recent voucher retained' }
if (@($merged | Where-Object masterId -eq '3').Count -ne 1 -or -not ($merged | Where-Object masterId -eq '3').cancelled) { throw 'Moved/cancelled voucher not replaced' }
$empty = @(Merge-SalesRecords $old @() '20260801')
if ($empty.Count -ne 2) { throw 'Empty window must preserve only older history' }
$rejected = $false
try { Merge-SalesRecords $old @(@{date='20260901'}) '20260801' | Out-Null } catch { $rejected = $true }
if (-not $rejected) { throw 'Missing identity accepted' }
[xml]$legacy = '<ENVELOPE><COLLECTION><VOUCHER><MASTERID>9</MASTERID><DATE>20260905</DATE><VOUCHERNUMBER>SD/26-27/0009</VOUCHERNUMBER><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>City Lab</PARTYLEDGERNAME><ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Kit</STOCKITEMNAME><BILLEDQTY> 2 qty</BILLEDQTY><RATE>485.00/box</RATE><AMOUNT>-970.00</AMOUNT></ALLINVENTORYENTRIES.LIST></VOUCHER></COLLECTION></ENVELOPE>'
$converted = @(Convert-LegacySalesRecords $legacy.OuterXml)
if ($converted.Count -ne 1 -or $converted[0].date -ne '20260905' -or $converted[0].voucherNumber -ne 'SD/26-27/0009' -or $converted[0].voucherType -ne 'Sales' -or $converted[0].party -ne 'City Lab' -or $converted[0].lineItems[0].quantity -ne 2 -or $converted[0].lineItems[0].rate -ne 485 -or $converted[0].masterId -ne 'master:9') { throw 'Legacy cache conversion failed' }
$evidence = @(Get-PricingSalesEvidence $converted @(@{name='City Lab';tallyKey='ledger:city'}) 5 50)
if ($evidence.Count -ne 1 -or $evidence[0].customerTallyKey -ne 'ledger:city' -or $evidence[0].tallyItemKey -ne 'Kit' -or $evidence[0].rate -ne 485 -or $evidence[0].invoiceDate -ne '2026-09-05' -or -not $evidence[0].sourceVersion) { throw 'Pricing sales evidence was not built safely' }
$gstSaleEvidence = @(Get-PricingSalesEvidence @(Convert-LegacySalesRecords $legacy.OuterXml.Replace('<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>','<VOUCHERTYPENAME>GST SALE</VOUCHERTYPENAME>')) @(@{name='City Lab';tallyKey='ledger:city'}) 5 50)
if ($gstSaleEvidence.Count -ne 1) { throw 'Approved GST sales voucher type was excluded' }
$quotationEvidence = @(Get-PricingSalesEvidence @(Convert-LegacySalesRecords $legacy.OuterXml.Replace('<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>','<VOUCHERTYPENAME>Sales-Quotation</VOUCHERTYPENAME>')) @(@{name='City Lab';tallyKey='ledger:city'}) 5 50)
if ($quotationEvidence.Count -ne 0) { throw 'Quotation was accepted as invoiced selling-price evidence' }
$ambiguousEvidence = @(Get-PricingSalesEvidence $converted @(@{name='City Lab';tallyKey='ledger:city-one'},@{name=' city lab ';tallyKey='ledger:city-two'}) 5 50)
if ($ambiguousEvidence.Count -ne 0) { throw 'Ambiguous customer ledger name was accepted for pricing' }
$focXml = $legacy.OuterXml.Replace('<RATE>485.00/box</RATE><AMOUNT>-970.00</AMOUNT>','<RATE>0.00/box</RATE><AMOUNT>0.00</AMOUNT>')
$focEvidence = @(Get-PricingSalesEvidence @(Convert-LegacySalesRecords $focXml) @(@{name='City Lab';tallyKey='ledger:city'}) 5 50)
if ($focEvidence.Count -ne 1 -or -not $focEvidence[0].exceptional -or $focEvidence[0].exceptionType -ne 'foc') { throw 'FOC evidence was not classified' }
$unmarkedSpecialXml = $legacy.OuterXml.Replace('<VOUCHERNUMBER>SD/26-27/0009</VOUCHERNUMBER>', '<VOUCHERNUMBER>SD/26-27/0009</VOUCHERNUMBER><REFERENCE>Tender 2026</REFERENCE>')
$unmarkedSpecialEvidence = @(Get-PricingSalesEvidence @(Convert-LegacySalesRecords $unmarkedSpecialXml) @(@{name='City Lab';tallyKey='ledger:city'}) 5 50)
if ($unmarkedSpecialEvidence.Count -ne 1 -or $unmarkedSpecialEvidence[0].exceptional -or $null -ne $unmarkedSpecialEvidence[0].exceptionType) { throw 'Positive-rate evidence was incorrectly classified from free text' }
$purchaseXml = $legacy.OuterXml.Replace('<VOUCHERNUMBER>SD/26-27/0009</VOUCHERNUMBER>', '<VOUCHERNUMBER>PUR/009</VOUCHERNUMBER>').Replace('<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>', '<VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>')
$purchaseEvidence = @(Get-PricingPurchaseCostEvidence @(Convert-LegacySalesRecords $purchaseXml 'purchase') 5 50)
if ($purchaseEvidence.Count -ne 1 -or $purchaseEvidence[0].tallyItemKey -ne 'Kit' -or $purchaseEvidence[0].amount -ne 485 -or $purchaseEvidence[0].effectiveAt -ne '2026-09-05' -or $purchaseEvidence[0].kind -ne 'purchase_price' -or -not $purchaseEvidence[0].sourceVersion) { throw 'Purchase-cost evidence was not built safely' }
$zeroPurchaseEvidence = @(Get-PricingPurchaseCostEvidence @(Convert-LegacySalesRecords $purchaseXml.Replace('<RATE>485.00/box</RATE><AMOUNT>-970.00</AMOUNT>','<RATE>0.00/box</RATE><AMOUNT>0.00</AMOUNT>') 'purchase') 5 50)
if ($zeroPurchaseEvidence.Count -ne 0) { throw 'Zero purchase cost was accepted' }
$unscoped = [pscustomobject]@{ company='TEST'; records=@([pscustomobject]@{ party='Purchase supplier' }) }
if ($null -ne (Get-TrustedSalesSnapshot $unscoped 'TEST')) { throw 'Unscoped historical supply cache accepted' }
$salesScoped = [pscustomobject]@{ company='TEST'; sourceScope='sales_vouchers_v1'; records=@() }
if ($null -eq (Get-TrustedSalesSnapshot $salesScoped 'TEST')) { throw 'Sales-only cache was rejected' }
$purchaseScoped = [pscustomobject]@{ company='TEST'; sourceScope='purchase_vouchers_v1'; records=@() }
if ($null -eq (Get-TrustedPurchaseSnapshot $purchaseScoped 'TEST')) { throw 'Purchase-only cache was rejected' }
if ($null -ne (Get-TrustedPurchaseSnapshot $salesScoped 'TEST')) { throw 'Sales cache was accepted as purchase evidence' }
$today = [datetime]'2026-09-07'
$firstWindow = Get-SalesWindow $today '' 7 30 24
if ($firstWindow.fromDate -ne '20260808' -or -not $firstWindow.reconciliation) { throw 'Initial sales reconciliation window is incorrect' }
$freshWindow = Get-SalesWindow $today ([datetimeoffset]::UtcNow.AddHours(-1).ToString('o')) 7 30 24
if ($freshWindow.fromDate -ne '20260831' -or $freshWindow.reconciliation) { throw 'Frequent sales window is incorrect' }
$staleWindow = Get-SalesWindow $today ([datetimeoffset]::UtcNow.AddHours(-25).ToString('o')) 7 30 24
if ($staleWindow.fromDate -ne '20260808' -or -not $staleWindow.reconciliation) { throw 'Daily sales reconciliation was not scheduled' }
$fallback = Get-SalesRecordIdentity '' '20260905' 'SD/26-27/0099' 'City Lab'
if (-not $fallback.StartsWith('fallback:') -or $fallback -ne (Get-SalesRecordIdentity '' '20260905' 'SD/26-27/0099' 'City Lab')) { throw 'Fallback identity is not deterministic' }
if ($null -ne (Get-SalesRecordIdentity '' '20260905' '' 'City Lab')) { throw 'Incomplete fallback identity accepted' }
Write-Output 'PASS: historical retention, deleted window rows, moved IDs, cancellation replacement, empty window, invalid identity'

. (Join-Path $PSScriptRoot '../desktop-connector/economics.ps1')
function Assert-Backfill($Condition,[string]$Message) { if (-not $Condition) { throw $Message } }

# Exercise the production helper bodies with in-memory file operations. These
# tests must never create an operational backfill queue, even temporarily.
class SalesCoverageMemoryFile {
    static [hashtable] $Files = @{}
    static [bool] $FailReplace = $false
    static [int] $Replacements = 0
    static [bool] Exists([string]$Path) { return [SalesCoverageMemoryFile]::Files.ContainsKey($Path) }
    static [string] ReadAllText([string]$Path) {
        if (-not [SalesCoverageMemoryFile]::Exists($Path)) { throw 'Missing memory file' }
        return [SalesCoverageMemoryFile]::Files[$Path]
    }
    static [void] WriteAllText([string]$Path,[string]$Text,[Text.Encoding]$Encoding) { [SalesCoverageMemoryFile]::Files[$Path] = $Text }
    static [void] Replace([string]$Source,[string]$Destination,[string]$Backup) {
        if ([SalesCoverageMemoryFile]::FailReplace) { throw 'Fixture replace failure' }
        if (-not [SalesCoverageMemoryFile]::Exists($Destination)) { throw 'Missing replacement target' }
        [SalesCoverageMemoryFile]::Files[$Destination] = [SalesCoverageMemoryFile]::ReadAllText($Source)
        [SalesCoverageMemoryFile]::Files.Remove($Source)
        [SalesCoverageMemoryFile]::Replacements++
    }
    static [void] Delete([string]$Path) { [SalesCoverageMemoryFile]::Files.Remove($Path) }
}
$tokens=$null;$parseErrors=$null
$economicsAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../desktop-connector/economics.ps1'),[ref]$tokens,[ref]$parseErrors)
Assert-Backfill ($parseErrors.Count -eq 0) 'Economics parser errors'
foreach($name in @('Get-NextSalesCoverageBackfill','Remove-SalesCoverageBackfillEntry')) {
    $definition=$economicsAst.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
    Invoke-Expression $definition.Extent.Text.Replace('[IO.File]','[SalesCoverageMemoryFile]')
}
$salesCoverageBackfillPath='memory-backfill'
$companyName='SUPRABHA DISTRIBUTORS'
Assert-Backfill ($null -eq (Get-NextSalesCoverageBackfill $salesCoverageBackfillPath $companyName)) 'Missing queue was accepted'
foreach($invalid in @(
    '{broken',
    '{"company":"OTHER","windows":["2026-05-15"]}',
    '{"company":"suprabha distributors","windows":["2026-05-15"]}',
    '{"company":"SUPRABHA DISTRIBUTORS","windows":["bad-date"]}',
    '{"company":"SUPRABHA DISTRIBUTORS","windows":["2026-02-30"]}',
    '{"company":"SUPRABHA DISTRIBUTORS","windows":["2026-5-15"]}',
    '{"company":"SUPRABHA DISTRIBUTORS","windows":[]}',
    '{"company":"SUPRABHA DISTRIBUTORS","windows":"2026-05-15"}',
    '{"company":"SUPRABHA DISTRIBUTORS","windows":[null]}',
    '{"company":"SUPRABHA DISTRIBUTORS"}',
    '[{"company":"SUPRABHA DISTRIBUTORS","windows":["2026-05-15"]}]',
    '[]', 'null'
)) {
    [SalesCoverageMemoryFile]::Files[$salesCoverageBackfillPath]=$invalid
    Assert-Backfill ($null -eq (Get-NextSalesCoverageBackfill $salesCoverageBackfillPath $companyName)) 'Invalid queue was accepted'
}
$queueJson='{"company":"SUPRABHA DISTRIBUTORS","windows":["2026-05-15","2026-08-15"]}'
[SalesCoverageMemoryFile]::Files[$salesCoverageBackfillPath]=$queueJson
foreach($expected in @(
    @{entry='2026-05-15';from='2026-02-01';to='2026-05-01'},
    @{entry='2026-08-15';from='2026-05-01';to='2026-08-01'}
)) {
    $next=Get-NextSalesCoverageBackfill $salesCoverageBackfillPath $companyName
    Assert-Backfill ($next -is [datetimeoffset] -and $next.Hour -eq 12 -and $next.Offset.TotalMinutes -eq 330 -and $next.ToString('yyyy-MM-dd') -eq $expected.entry) 'Queue date lost noon IST or ordering'
    $window=Get-SalesCoverageWindow $next
    Assert-Backfill ($window.From.ToString('yyyy-MM-dd') -eq $expected.from -and $window.To.ToString('yyyy-MM-dd') -eq $expected.to) 'Backfill window boundaries are incorrect'
    Remove-SalesCoverageBackfillEntry $salesCoverageBackfillPath $expected.entry
}
$emptyQueue=[SalesCoverageMemoryFile]::Files[$salesCoverageBackfillPath] | ConvertFrom-Json
Assert-Backfill ($emptyQueue.company -ceq $companyName -and $emptyQueue.windows -is [array] -and $emptyQueue.windows.Count -eq 0 -and $emptyQueue.PSObject.Properties.Name.Count -eq 2) 'Queue shape or empty list was lost'
Assert-Backfill ([SalesCoverageMemoryFile]::Replacements -eq 2 -and [SalesCoverageMemoryFile]::Files.Count -eq 1) 'Removal did not use atomic replacement or left a temporary file'
Assert-Backfill ($null -eq (Get-NextSalesCoverageBackfill $salesCoverageBackfillPath $companyName)) 'Drained queue scheduled coverage'
Remove-SalesCoverageBackfillEntry $salesCoverageBackfillPath '2026-08-15'
Assert-Backfill ([SalesCoverageMemoryFile]::Replacements -eq 2) 'Repeated removal rewrote the queue'
[SalesCoverageMemoryFile]::Files[$salesCoverageBackfillPath]='{"company":"SUPRABHA DISTRIBUTORS","windows":["2026-05-15","2026-05-15","2026-08-15"]}'
Remove-SalesCoverageBackfillEntry $salesCoverageBackfillPath '2026-05-15'
Assert-Backfill (([SalesCoverageMemoryFile]::Files[$salesCoverageBackfillPath] | ConvertFrom-Json).windows.Count -eq 2) 'Removal consumed more than one matching entry'
Write-Output 'PASS: backfill validation, noon IST, Feb-Apr and May-Jul windows, atomic removal and empty queue'

# Extract dashboard functions and its actual coverage-due body without startup,
# HTTP, Tally, or filesystem side effects.
$dashboardAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../desktop-connector/dashboard.ps1'),[ref]$tokens,[ref]$parseErrors)
Assert-Backfill ($parseErrors.Count -eq 0) 'Dashboard parser errors'
$coverageBranch=$dashboardAst.Find({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and $node.Clauses[0].Item1.Extent.Text -eq '$coverageDue'},$true)
$body=$coverageBranch.Clauses[0].Item2.Extent.Text
$readCoverage=[scriptblock]::Create($body.Substring(1,$body.Length-2))
function Read-TallySalesCoverage($Company,$LedgerRoles,$VoucherRoles,[datetimeoffset]$Now) {
    $script:readNow=$Now
    return @{economicEvidence=@{purpose='sales_coverage'}}
}
$coverageNow=[datetimeoffset]'2026-11-15T22:00:00+05:30'
$istDate='2026-11-15';$ledgerRoles=@{};$voucherRoles=@{}
[SalesCoverageMemoryFile]::Files.Clear()
. $readCoverage
Assert-Backfill ($script:readNow -eq $coverageNow -and $coverageDate -eq $istDate -and -not $coverage.economicEvidence.ContainsKey('backfillEntry') -and $null -eq $script:pendingBackfillEntry) 'Absent queue changed normal coverage'
[SalesCoverageMemoryFile]::Files[$salesCoverageBackfillPath]=$queueJson
. $readCoverage
Assert-Backfill ($script:readNow.ToString('o') -eq '2026-05-15T12:00:00.0000000+05:30' -and $coverageDate -eq $istDate -and $coverage.economicEvidence.backfillEntry -eq '2026-05-15' -and $script:pendingBackfillEntry -eq '2026-05-15') 'Queued coverage used the wrong date or lost its marker'
foreach($name in @('Publish-CloudSnapshot','Remove-PendingSalesCoverage')) {
    $definition=$dashboardAst.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
    Invoke-Expression $definition.Extent.Text
}
function Invoke-WebRequest { if($script:failCloud){throw 'Fixture offline'};return @{Content='ok'} }
function Write-ConnectorHealth([string]$Message) { $script:healthLines+=,$Message }
function Save-ConnectorSnapshot($Path,$Snapshot) {
    if($Path -eq 'coverage-state') {
        if($script:failState){throw 'Fixture state failure'}
        Assert-Backfill (([SalesCoverageMemoryFile]::Files[$salesCoverageBackfillPath] | ConvertFrom-Json).windows[0] -eq '2026-05-15') 'Queue advanced before coverage state saved'
    }
}
function Save-ConnectorUploadState($Path,$State) {}
$salesCoverageStatePath='coverage-state';$snapshotPath='snapshot';$uploadStatePath='upload-state'
$cloudSyncUrl='https://fixture.invalid';$cloudUploadKey='fixture'
$uploadJson=@{economicEvidence=$coverage.economicEvidence;salesCoverageDate=$coverageDate} | ConvertTo-Json -Depth 6 -Compress
foreach($mode in @('success','rewrite_failure','state_failure','three_failures')) {
    [SalesCoverageMemoryFile]::Files[$salesCoverageBackfillPath]=$queueJson
    [SalesCoverageMemoryFile]::FailReplace=$mode -eq 'rewrite_failure'
    $script:failState=$mode -eq 'state_failure';$script:failCloud=$mode -eq 'three_failures'
    $script:healthLines=@();$script:cloudUploadFailures=0;$script:salesCoverageUploadFailures=0
    $script:uploadState=@{company=$companyName;rejectedPayloadHash=$null;blockedKeyHash=$null}
    $script:pendingUpload=$uploadJson | ConvertFrom-Json
    $script:pendingUploadJson=$uploadJson
    $accepted=Publish-CloudSnapshot $uploadJson
    if($mode -eq 'three_failures') {
        Assert-Backfill (-not $accepted) 'Offline upload succeeded'
        1..2 | ForEach-Object { Assert-Backfill (-not (Publish-CloudSnapshot $uploadJson)) 'Offline retry succeeded' }
        Assert-Backfill ($null -eq $script:pendingUpload.economicEvidence -and $script:salesCoverageUploadFailures -eq 3) 'Three failures did not drop coverage'
        Assert-Backfill (@($script:healthLines | Where-Object {$_ -match 'request=sales_coverage_backfill status=retry entry=2026-05-15$'}).Count -eq 1) 'Backfill retry log missing'
    } elseif($mode -eq 'state_failure') {
        Assert-Backfill (-not $accepted) 'Failed state save acknowledged coverage'
    } else {
        Assert-Backfill $accepted 'Queue handling failed the accepted upload'
        $status=if($mode -eq 'success'){'done'}else{'failed'}
        Assert-Backfill (@($script:healthLines | Where-Object {$_ -match "request=sales_coverage_backfill status=$status entry=2026-05-15$"}).Count -eq 1) 'Backfill completion log missing'
    }
    $remaining=[SalesCoverageMemoryFile]::Files[$salesCoverageBackfillPath] | ConvertFrom-Json
    if($mode -eq 'success') {
        Assert-Backfill ($remaining.windows.Count -eq 1 -and $remaining.windows[0] -eq '2026-08-15') 'Success did not remove only its uploaded entry'
    } else {
        Assert-Backfill ([SalesCoverageMemoryFile]::Files[$salesCoverageBackfillPath] -ceq $queueJson) 'Failure changed the queue'
    }
    Assert-Backfill ([SalesCoverageMemoryFile]::Files.Count -eq 1) 'Failed rewrite leaked a temporary file'
}
Write-Output 'PASS: dashboard date selection, evidence marker, success removal, rewrite failure isolation and three-failure retry'

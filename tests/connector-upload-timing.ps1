$ErrorActionPreference='Stop'
function Assert-Timing($Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
$tokens=$null;$parseErrors=$null
$dashboardAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../desktop-connector/dashboard.ps1'),[ref]$tokens,[ref]$parseErrors)
Assert-Timing ($parseErrors.Count -eq 0) 'Dashboard parser errors'
$definition=$dashboardAst.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-ServerTimingFields'},$true)
Assert-Timing ($null -ne $definition) 'Server timing helper missing'
Invoke-Expression $definition.Extent.Text
Assert-Timing ((Get-ServerTimingFields 'stockflow;dur=12345.6, database;dur=7400.2') -ceq ' serverMs=12345.6 databaseMs=7400.2') 'Server timing values were not parsed'
Assert-Timing ((Get-ServerTimingFields 'database;dur=7400.2, stockflow;dur=12345.6') -ceq ' serverMs=12345.6 databaseMs=7400.2') 'Swapped timing header was not parsed'
foreach($header in @($null,'','garbage','stockflow;dur=1.2','stockflow;dur=x, database;dur=2')) {
    $caught=$false
    try { $value=Get-ServerTimingFields $header } catch { $caught=$true }
    Assert-Timing (-not $caught -and $value -ceq '') 'Missing or malformed timing header did not return empty'
}
$source=Get-Content (Join-Path $PSScriptRoot '../desktop-connector/dashboard.ps1') -Raw
Assert-Timing ($source -match 'request=cloud_upload durationMs=.*?bytes=\$payloadBytes\$serverTimingFields\$economicVoucherField consecutiveFailures=0 status=ok"') 'Success line field order or final status changed'
Assert-Timing ($source.Contains('request=economic_voucher_headroom status=warning count=$economicVoucherCount limit=2000')) 'Voucher headroom warning missing'

# Run the actual final snapshot assembly statements without dashboard startup or Tally.
$assembly=$dashboardAst.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Read-ReorderData'},$true)
Assert-Timing ($null -ne $assembly) 'Snapshot assembly missing'
$hashAssignment=$assembly.Find({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Right.Extent.Text -eq 'Get-PricingHistoryHash $snapshot.pricingHistory'},$true)
Assert-Timing ($null -ne $hashAssignment) 'Pricing history selection missing'
$selectionStatements=@($assembly.Body.EndBlock.Statements | Where-Object { $_.Extent.StartOffset -ge $hashAssignment.Extent.StartOffset })
$selectPricing=[scriptblock]::Create(($selectionStatements | ForEach-Object { $_.Extent.Text }) -join "`n")
# The fixtures use a fixed hash; exercise the production comparison and selection.
function Get-PricingHistoryHash($PricingHistory) { if ($null -ne $PricingHistory) { return 'changed-history' } }
$script:pricingHistoryAckedHash=$null
$script:pricingHistoryDeferrals=0
$snapshot=[ordered]@{pricingHistory=@{price=10};economicEvidence=@{purpose='normal'}}
$selected=. $selectPricing
Assert-Timing (-not $selected.Contains('pricingHistory') -and $script:pricingHistoryDeferrals -eq 1 -and $null -eq $script:pendingPricingHistoryHash) 'Changed pricing history was not deferred alongside evidence'
$snapshot=[ordered]@{pricingHistory=@{price=10};economicEvidence=$null}
$selected=. $selectPricing
Assert-Timing ($selected.Contains('pricingHistory') -and $script:pricingHistoryDeferrals -eq 0 -and $script:pendingPricingHistoryHash -eq 'changed-history') 'Next snapshot without evidence did not send pricing history'
foreach($cycle in 1..5) {
    $snapshot=[ordered]@{pricingHistory=@{price=10};economicEvidence=@{purpose='sales_coverage'}}
    $selected=. $selectPricing
    if($cycle -le 4) {
        Assert-Timing (-not $selected.Contains('pricingHistory') -and $script:pricingHistoryDeferrals -eq $cycle -and $null -eq $script:pendingPricingHistoryHash) "Deferral $cycle failed"
    } else {
        Assert-Timing ($selected.Contains('pricingHistory') -and $null -ne $selected.economicEvidence -and $script:pricingHistoryDeferrals -eq 0 -and $script:pendingPricingHistoryHash -eq 'changed-history') 'Fifth snapshot did not send both blocks at the starvation cap'
    }
}
# Execute the actual acknowledgement branch as well as the unchanged-hash selection.
$ackBranch=$dashboardAst.Find({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and $node.Clauses[0].Item2.Extent.Text.Contains('$script:pricingHistoryAckedHash = $script:pendingPricingHistoryHash')},$true)
Assert-Timing ($null -ne $ackBranch) 'Pricing history acknowledgement missing'
$uploaded=$selected
$script:pricingHistoryDeferrals=3
Invoke-Expression $ackBranch.Extent.Text
Assert-Timing ($script:pricingHistoryAckedHash -eq 'changed-history' -and $script:pricingHistoryDeferrals -eq 0) 'Acknowledgement did not reset deferrals'
foreach($withEvidence in @($false,$true)) {
    foreach($deferrals in 0..4) {
        $script:pricingHistoryDeferrals=$deferrals
        $snapshot=[ordered]@{pricingHistory=@{price=10};economicEvidence=$(if($withEvidence){@{purpose='normal'}}else{$null})}
        $selected=. $selectPricing
        Assert-Timing (-not $selected.Contains('pricingHistory') -and $null -eq $script:pendingPricingHistoryHash) 'Acknowledged pricing history was included'
    }
}
Write-Output 'PASS pricing history deferral, next cycle, starvation cap and acknowledgement'
Write-Output 'PASS connector upload timing'

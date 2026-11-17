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
Write-Output 'PASS connector upload timing'

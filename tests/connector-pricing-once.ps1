$ErrorActionPreference = 'Stop'
function Assert-PricingOnce($Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
$dashboardPath = Join-Path $PSScriptRoot '../desktop-connector/dashboard.ps1'
$source = Get-Content -LiteralPath $dashboardPath -Raw
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($dashboardPath,[ref]$tokens,[ref]$parseErrors)
Assert-PricingOnce ($parseErrors.Count -eq 0) 'Dashboard parser errors'
$definitions = @{}
foreach ($name in @('Get-PricingHistoryHash','Read-ReorderData','Publish-CloudSnapshot')) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name },$true)
    Assert-PricingOnce ($null -ne $definition) "$name function missing"
    $definitions[$name] = $definition
}
$stableVersion = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '../desktop-connector/recovery.ps1') -Raw)
$versionAst = [Management.Automation.Language.Parser]::ParseInput($stableVersion,[ref]$tokens,[ref]$parseErrors)
$versionDefinition = $versionAst.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-StableEvidenceVersion' },$true)
Assert-PricingOnce ($null -ne $versionDefinition) 'Stable evidence version helper missing'
. ([scriptblock]::Create($versionDefinition.Extent.Text))
. ([scriptblock]::Create($definitions['Get-PricingHistoryHash'].Extent.Text))
Assert-PricingOnce ($null -eq (Get-PricingHistoryHash $null)) 'Null pricing history hash was not null'
$pricing = [ordered]@{ sales = @([ordered]@{ item='A'; rate=10 }); purchaseCosts = @(); supplierPrices = @() }
$firstHash = Get-PricingHistoryHash $pricing
$secondHash = Get-PricingHistoryHash $pricing
Assert-PricingOnce ([string]::Equals($firstHash,$secondHash,[StringComparison]::Ordinal)) 'Same pricing history produced different hashes'
$changedPricing = [ordered]@{ sales = @([ordered]@{ item='A'; rate=11 }); purchaseCosts = @(); supplierPrices = @() }
Assert-PricingOnce (-not [string]::Equals($firstHash,(Get-PricingHistoryHash $changedPricing),[StringComparison]::Ordinal)) 'Changed rate did not change the hash'
Assert-PricingOnce ($source.Contains('$script:pricingHistoryAckedHash=$null')) 'Pricing acknowledgment state is not initialized'
Assert-PricingOnce ($source.Contains('$script:pendingPricingHistoryHash = $hash')) 'Pending pricing hash is not set during snapshot build'
$builderSource = $definitions['Read-ReorderData'].Extent.Text
$removeIndex = $builderSource.IndexOf("$snapshot.Remove('pricingHistory')",[StringComparison]::Ordinal)
$compareIndex = $builderSource.IndexOf('[string]$hash, [string]$script:pricingHistoryAckedHash',[StringComparison]::Ordinal)
Assert-PricingOnce ($removeIndex -ge 0 -and $compareIndex -ge 0 -and $removeIndex -gt $compareIndex) 'Pricing history removal is not guarded by the acknowledged hash comparison'
Assert-PricingOnce ($builderSource.Contains('[StringComparison]::Ordinal')) 'Pricing history comparison is not ordinal'
$publishSource = $definitions['Publish-CloudSnapshot'].Extent.Text
$ackIndex = $publishSource.IndexOf('$script:pricingHistoryAckedHash = $script:pendingPricingHistoryHash',[StringComparison]::Ordinal)
$catchIndex = $publishSource.LastIndexOf('catch {',[StringComparison]::Ordinal)
$successIndex = $publishSource.IndexOf('status=ok',[StringComparison]::Ordinal)
Assert-PricingOnce ($ackIndex -ge 0 -and $successIndex -gt $ackIndex -and $catchIndex -ge 0 -and $ackIndex -gt $catchIndex) 'Pricing ack assignment is not in the success path after the upload failure catch'
Assert-PricingOnce ($publishSource.Contains('$null -ne $uploaded.pricingHistory -and $null -ne $script:pendingPricingHistoryHash')) 'Pricing ack assignment is not guarded by uploaded content and pending hash'
Assert-PricingOnce ($source.Contains('pricingHistory=acked')) 'Pricing acknowledgment health field missing'
Assert-PricingOnce ($publishSource.Contains('$null -ne $uploaded -and $null -eq $uploaded.pricingHistory -and $null -ne $script:pricingHistoryAckedHash')) 'Pricing acknowledgment health field does not require an uploaded snapshot without pricing history and an acknowledged hash'
Write-Output 'PASS connector pricing once'

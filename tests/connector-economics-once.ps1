$ErrorActionPreference = 'Stop'
function Assert-EconomicOnce($Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
$dashboardPath = Join-Path $PSScriptRoot '../desktop-connector/dashboard.ps1'
$source = Get-Content -LiteralPath $dashboardPath -Raw
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($dashboardPath,[ref]$tokens,[ref]$parseErrors)
Assert-EconomicOnce ($parseErrors.Count -eq 0) 'Dashboard parser errors'
$definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Select-UploadEconomicEvidence' },$true)
Assert-EconomicOnce ($null -ne $definition) 'Economic evidence selector missing'
. ([scriptblock]::Create($definition.Extent.Text))
$evidence = [pscustomobject]@{ sourceVersion = 'v1'; marker = 'last' }
$coverageEvidence = [pscustomobject]@{ sourceVersion = 'coverage'; marker = 'coverage' }
$coverage = [pscustomobject]@{ economicEvidence = $coverageEvidence }
Assert-EconomicOnce ([object]::ReferenceEquals((Select-UploadEconomicEvidence $coverage $evidence 'v1'),$coverageEvidence)) 'Coverage evidence was not always selected'
Assert-EconomicOnce ($null -eq (Select-UploadEconomicEvidence $null $null $null)) 'Null evidence was not preserved'
Assert-EconomicOnce ([object]::ReferenceEquals((Select-UploadEconomicEvidence $null $evidence $null),$evidence)) 'Unacknowledged evidence was omitted'
Assert-EconomicOnce ($null -eq (Select-UploadEconomicEvidence $null $evidence 'v1')) 'Acknowledged evidence was resent'
Assert-EconomicOnce ([object]::ReferenceEquals((Select-UploadEconomicEvidence $null $evidence 'v0'),$evidence)) 'Different acknowledged version suppressed evidence'
$emptyVersionEvidence = [pscustomobject]@{ sourceVersion = ''; marker = 'empty' }
Assert-EconomicOnce ([object]::ReferenceEquals((Select-UploadEconomicEvidence $null $emptyVersionEvidence 'v1'),$emptyVersionEvidence)) 'Evidence without sourceVersion was omitted'
Assert-EconomicOnce ($source.Contains('economicEvidence = Select-UploadEconomicEvidence $coverage $script:lastEconomicEvidence $script:economicEvidenceAckedVersion')) 'Snapshot builder does not use the evidence selector'
Assert-EconomicOnce ($source.Contains('$script:economicEvidenceAckedVersion=$null')) 'Ack version state is not initialized'
Assert-EconomicOnce ($source.Contains('$script:nextEconomicRead=(Get-Date).AddMinutes($PurchaseSyncMinutes)')) 'Economic read cadence changed'
$publish = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Publish-CloudSnapshot' },$true)
Assert-EconomicOnce ($null -ne $publish) 'Cloud upload function missing'
$publishSource = $publish.Extent.Text
$ackIndex = $publishSource.IndexOf('$script:economicEvidenceAckedVersion = [string]$uploaded.economicEvidence.sourceVersion',[StringComparison]::Ordinal)
$catchIndex = $publishSource.LastIndexOf('catch {',[StringComparison]::Ordinal)
$successIndex = $publishSource.IndexOf('status=ok',[StringComparison]::Ordinal)
Assert-EconomicOnce ($ackIndex -ge 0 -and $successIndex -gt $ackIndex -and $catchIndex -ge 0 -and $ackIndex -gt $catchIndex) 'Ack assignment is not in the success path after upload catch'
Assert-EconomicOnce ($publishSource.Contains("economicEvidence=acked")) 'Acknowledged evidence health field missing'
Write-Output 'PASS connector economics once'

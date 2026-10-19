param(
    [Parameter(Mandatory=$true)][ValidateNotNullOrEmpty()][string]$Company,
    [ValidateRange(1,12)][int]$HistoryMonths=1,
    [ValidateRange(1,65535)][int]$Port=9000,
    [string]$PolicyDraftPath
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'economics.ps1')
. (Join-Path $PSScriptRoot 'recovery.ps1')
# This entry point never starts the connector, uploads evidence or loads live role
# configuration. It emits aggregate counts only, without customer/invoice values.
function Invoke-Tally([string]$Body,[int]$TimeoutSeconds,[string]$MetricName){
    if($Body -notmatch '<TALLYREQUEST>Export</TALLYREQUEST>'){throw 'Read-only preflight permits Tally exports only.'}
    try{
        return (Invoke-WebRequest -Uri ('http://127.0.0.1:'+$Port) -Method Post -Body $Body -UseBasicParsing -TimeoutSec $TimeoutSeconds).Content
    }catch{throw 'Local Tally export failed. Check that Tally is running and the selected company is open.'}
}
$roles=@{LedgerRoles=@{};VoucherRoles=@{}}
if($PolicyDraftPath){$roles=Convert-EconomicPolicyDraft (Get-Content -LiteralPath $PolicyDraftPath -Raw) $Company}
$evidence=Read-TallyEconomicEvidence $Company $HistoryMonths $roles.LedgerRoles $roles.VoucherRoles
$summary=Get-EconomicPreflightSummary $evidence
if($PolicyDraftPath){$summary.Add('policyState','PROPOSED diagnostic only; requires Accounts approval before activation')}
$summary | ConvertTo-Json -Depth 5

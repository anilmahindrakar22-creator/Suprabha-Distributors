param(
    [switch]$DoNotStartNow,
    [ValidateRange(5, 120)][int]$SyncMinutes = 15
)

$ErrorActionPreference = 'Stop'
$taskName = 'Suprabha StockFlow Tally Sync'
$connectorPath = Join-Path $PSScriptRoot 'dashboard.ps1'

if (-not (Test-Path -LiteralPath $connectorPath)) {
    throw "StockFlow connector was not found at $connectorPath"
}

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$connectorPath`" -NoBrowser -SyncMinutes $SyncMinutes"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Refreshes Tally every $SyncMinutes minutes; retries saved cloud uploads independently." -Force | Out-Null

if (-not $DoNotStartNow) {
    Start-ScheduledTask -TaskName $taskName
}

Write-Host "StockFlow automatic Tally sync is installed for $currentUser." -ForegroundColor Green
Write-Host "It starts at Windows sign-in, self-recovers after a failure, reads Tally every $SyncMinutes minutes and retries saved uploads with backoff." -ForegroundColor Cyan

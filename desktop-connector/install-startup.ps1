param([switch]$DoNotStartNow)

$ErrorActionPreference = 'Stop'
$taskName = 'Suprabha StockFlow Tally Sync'
$connectorPath = Join-Path $PSScriptRoot 'dashboard.ps1'

if (-not (Test-Path -LiteralPath $connectorPath)) {
    throw "StockFlow connector was not found at $connectorPath"
}

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$connectorPath`" -NoBrowser"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Refreshes Tally every 15 minutes; retries saved cloud uploads independently.' -Force | Out-Null

if (-not $DoNotStartNow) {
    Start-ScheduledTask -TaskName $taskName
}

Write-Host "StockFlow automatic Tally sync is installed for $currentUser." -ForegroundColor Green
Write-Host 'It starts at Windows sign-in, reads Tally every 15 minutes and retries saved uploads every five minutes.' -ForegroundColor Cyan

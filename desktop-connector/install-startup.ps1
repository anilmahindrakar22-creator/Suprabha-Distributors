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

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Keeps the Suprabha StockFlow cloud snapshot synchronized with TallyPrime every five minutes.' -Force | Out-Null

if (-not $DoNotStartNow) {
    Start-ScheduledTask -TaskName $taskName
}

Write-Host "StockFlow automatic Tally sync is installed for $currentUser." -ForegroundColor Green
Write-Host 'It starts at Windows sign-in and retries every five minutes while running.' -ForegroundColor Cyan

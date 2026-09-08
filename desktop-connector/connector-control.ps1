param(
    [ValidateSet('Status', 'Pause', 'Resume', 'Restart', 'SetSchedule')]
    [string]$Action = 'Status',
    [ValidateRange(5, 120)][int]$SyncMinutes = 15
)

$ErrorActionPreference = 'Stop'
$taskName = 'Suprabha StockFlow Tally Sync'
$installer = Join-Path $PSScriptRoot 'install-startup.ps1'
$stateDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'SuprabhaStockFlow'
$healthLog = Join-Path $stateDirectory 'connector-health.log'

function Get-ConnectorTask {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if (-not $task) { throw 'StockFlow automatic sync is not installed. Run install-startup.ps1 first.' }
    return $task
}

function Show-ConnectorStatus {
    $task = Get-ConnectorTask
    $info = $task | Get-ScheduledTaskInfo
    $latestUpload = if (Test-Path -LiteralPath $healthLog) {
        Get-Content -LiteralPath $healthLog -Tail 200 | Where-Object { $_ -match 'request=cloud_upload' } | Select-Object -Last 1
    }
    Write-Host "StockFlow connector: $($task.State)" -ForegroundColor $(if ($task.State -eq 'Running') { 'Green' } else { 'DarkYellow' })
    Write-Host "Last started: $($info.LastRunTime)"
    if ($latestUpload) { Write-Host "Latest cloud result: $latestUpload" }
}

switch ($Action) {
    'Pause' {
        Stop-ScheduledTask -TaskName $taskName
        Write-Host 'StockFlow automatic sync is paused. Tally will not be queried.' -ForegroundColor DarkYellow
    }
    'Resume' {
        Start-ScheduledTask -TaskName $taskName
        Write-Host 'StockFlow automatic sync is running.' -ForegroundColor Green
    }
    'Restart' {
        Stop-ScheduledTask -TaskName $taskName
        Start-ScheduledTask -TaskName $taskName
        Write-Host 'StockFlow automatic sync restarted.' -ForegroundColor Green
    }
    'SetSchedule' {
        & $installer -DoNotStartNow -SyncMinutes $SyncMinutes
        Start-ScheduledTask -TaskName $taskName
        Write-Host "StockFlow will now read Tally every $SyncMinutes minutes." -ForegroundColor Green
    }
    default { Show-ConnectorStatus }
}

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

function Wait-ConnectorState([string]$ExpectedState, [int]$TimeoutSeconds = 15) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $state = [string](Get-ConnectorTask).State
        if ($state -eq $ExpectedState) { return }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    throw "StockFlow connector did not reach $ExpectedState within $TimeoutSeconds seconds. Current state: $state"
}

function Stop-ConnectorSafely {
    if ((Get-ConnectorTask).State -ne 'Ready') {
        Stop-ScheduledTask -TaskName $taskName
        Wait-ConnectorState 'Ready'
    }
}

function Start-ConnectorSafely {
    if ((Get-ConnectorTask).State -ne 'Running') {
        Start-ScheduledTask -TaskName $taskName
        Wait-ConnectorState 'Running'
    }
}

function Show-ConnectorStatus {
    $task = Get-ConnectorTask
    $info = $task | Get-ScheduledTaskInfo
    $healthLines = if (Test-Path -LiteralPath $healthLog) { @(Get-Content -LiteralPath $healthLog -Tail 200) } else { @() }
    $latestUpload = $healthLines | Where-Object { $_ -match 'request=cloud_upload' } | Select-Object -Last 1
    Write-Host "StockFlow connector: $($task.State)" -ForegroundColor $(if ($task.State -eq 'Running') { 'Green' } else { 'DarkYellow' })
    Write-Host "Last started: $($info.LastRunTime)"
    if ($latestUpload) { Write-Host "Latest cloud result: $latestUpload" }
    foreach ($domain in @('reorder', 'sales', 'catalog', 'customers')) {
        $latestDomain = $healthLines | Where-Object { $_ -match "domain=$domain(?: |$)" } | Select-Object -Last 1
        if ($latestDomain) { Write-Host "Latest $domain data: $latestDomain" }
    }
}

switch ($Action) {
    'Pause' {
        Stop-ConnectorSafely
        Write-Host 'StockFlow automatic sync is paused. Tally will not be queried.' -ForegroundColor DarkYellow
    }
    'Resume' {
        Start-ConnectorSafely
        Write-Host 'StockFlow automatic sync is running.' -ForegroundColor Green
    }
    'Restart' {
        Stop-ConnectorSafely
        Start-ConnectorSafely
        Write-Host 'StockFlow automatic sync restarted.' -ForegroundColor Green
    }
    'SetSchedule' {
        Stop-ConnectorSafely
        & $installer -DoNotStartNow -SyncMinutes $SyncMinutes
        Start-ConnectorSafely
        Write-Host "StockFlow will now read Tally every $SyncMinutes minutes." -ForegroundColor Green
    }
    default { Show-ConnectorStatus }
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dashboard = readFileSync(new URL('../../public/stockflow.html', import.meta.url), 'utf8');
const connector = readFileSync(new URL('../../desktop-connector/dashboard.ps1', import.meta.url), 'utf8');
const startupInstaller = readFileSync(
  new URL('../../desktop-connector/install-startup.ps1', import.meta.url),
  'utf8',
);
const connectorControl = readFileSync(
  new URL('../../desktop-connector/connector-control.ps1', import.meta.url),
  'utf8',
);

describe('Tally stock sync health', () => {
  it('automatically checks the cloud snapshot every five minutes', () => {
    expect(dashboard).toContain('const CLOUD_REFRESH_INTERVAL_MS=5*60*1000');
    expect(dashboard).toContain('setInterval(()=>void refreshData(),CLOUD_REFRESH_INTERVAL_MS)');
    expect(dashboard).toContain("document.addEventListener('visibilitychange'");
    expect(dashboard).toContain("window.addEventListener('focus'");
    expect(dashboard).toContain("window.addEventListener('online'");
    expect(dashboard).toContain("window.addEventListener('pageshow'");
  });

  it('allows the normal fifteen-minute connector cycle before warning at twenty minutes', () => {
    expect(dashboard).toContain('const TALLY_STALE_AFTER_MS=20*60*1000');
    expect(dashboard).toContain("$('liveText').textContent='Tally sync overdue'");
    expect(dashboard).toContain('Latest Tally upload is overdue');
  });

  it('publishes a machine-readable timestamp with every connector snapshot', () => {
    expect(connector).toContain("fetchedAtIso = (Get-Date).ToUniversalTime().ToString('o')");
  });

  it('records per-domain counts and consecutive Tally failures', () => {
    expect(connector).toContain('consecutiveFailures=$($script:tallyFailures[$requestName])');
    expect(connector).toContain('domain=catalog count=');
    expect(connector).toContain('domain=customers count=');
    expect(connector).toContain('domain=sales records=');
    expect(connector).toContain('domain=reorder rows=');
  });

  it('provides a repeatable per-user Windows startup task', () => {
    expect(startupInstaller).toContain("$taskName = 'Suprabha StockFlow Tally Sync'");
    expect(startupInstaller).toContain('New-ScheduledTaskTrigger -AtLogOn');
    expect(startupInstaller).toContain("-NoBrowser");
    expect(startupInstaller).toContain('-RestartCount 10');
    expect(startupInstaller).toContain('-MultipleInstances IgnoreNew');
    expect(startupInstaller).toContain('[ValidateRange(5, 120)][int]$SyncMinutes = 15');
    expect(startupInstaller).toContain('-SyncMinutes $SyncMinutes');
  });

  it('records cloud upload outcomes without logging credentials or payloads', () => {
    expect(connector).toContain('request=cloud_upload');
    expect(connector).toContain('consecutiveFailures=$($script:cloudUploadFailures)');
    expect(connector).not.toContain("x-upload-key=$cloudUploadKey");
  });

  it('backs off cloud retries during an outage and resets after recovery', () => {
    expect(connector).toContain('$script:cloudUploadFailures = 0');
    expect(connector).toContain('[Math]::Min(30, 5 * [Math]::Pow(2');
    expect(connector).toContain('$script:nextUpload = (Get-Date).AddMinutes($retryMinutes)');
  });

  it('provides office-only status, pause, resume, restart, and schedule controls', () => {
    expect(connectorControl).toContain("[ValidateSet('Status', 'Pause', 'Resume', 'Restart', 'SetSchedule')]");
    expect(connectorControl).toContain('Stop-ScheduledTask -TaskName $taskName');
    expect(connectorControl).toContain('Start-ScheduledTask -TaskName $taskName');
    expect(connectorControl).toContain('& $installer -DoNotStartNow -SyncMinutes $SyncMinutes');
    expect(connectorControl).toContain("Wait-ConnectorState 'Ready'");
    expect(connectorControl).toContain("Wait-ConnectorState 'Running'");
    expect(connectorControl).toContain('Stop-ConnectorSafely');
    expect(connectorControl).toContain('Start-ConnectorSafely');
    expect(connectorControl).not.toContain('STOCKFLOW_UPLOAD_KEY');
  });
});

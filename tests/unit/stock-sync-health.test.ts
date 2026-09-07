import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dashboard = readFileSync(new URL('../../public/stockflow.html', import.meta.url), 'utf8');
const connector = readFileSync(new URL('../../desktop-connector/dashboard.ps1', import.meta.url), 'utf8');
const startupInstaller = readFileSync(
  new URL('../../desktop-connector/install-startup.ps1', import.meta.url),
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

  it('warns when the latest Tally snapshot is more than ten minutes old', () => {
    expect(dashboard).toContain('const TALLY_STALE_AFTER_MS=10*60*1000');
    expect(dashboard).toContain("$('liveText').textContent='Tally sync overdue'");
    expect(dashboard).toContain('Latest Tally upload is overdue');
  });

  it('publishes a machine-readable timestamp with every connector snapshot', () => {
    expect(connector).toContain("fetchedAtIso = (Get-Date).ToUniversalTime().ToString('o')");
  });

  it('provides a repeatable per-user Windows startup task', () => {
    expect(startupInstaller).toContain("$taskName = 'Suprabha StockFlow Tally Sync'");
    expect(startupInstaller).toContain('New-ScheduledTaskTrigger -AtLogOn');
    expect(startupInstaller).toContain("-NoBrowser");
    expect(startupInstaller).toContain('-RestartCount 10');
    expect(startupInstaller).toContain('-MultipleInstances IgnoreNew');
  });

  it('records cloud upload outcomes without logging credentials or payloads', () => {
    expect(connector).toContain('request=cloud_upload');
    expect(connector).not.toContain("x-upload-key=$cloudUploadKey");
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const worker = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8');

describe('service worker cache boundary', () => {
  it('does not precache the authenticated application route', () => {
    const allowlist = worker.match(/const PUBLIC_ASSETS = (\[[\s\S]*?\])/i)?.[1] || '';
    expect(allowlist).not.toContain("'/'");
    expect(allowlist).toContain("'/stockflow.html'");
    expect(allowlist).toContain("'/suprabha-logo.png'");
  });

  it('handles only explicit same-origin public GET assets without query strings', () => {
    expect(worker).toContain("event.request.method !== 'GET'");
    expect(worker).toContain('url.origin !== self.location.origin');
    expect(worker).toContain('!PUBLIC_ASSETS.includes(url.pathname)');
    expect(worker).toContain('url.search');
    expect(worker).not.toContain("url.includes('/api/')");
  });

  it('rejects redirects and errors and deletes only obsolete StockFlow caches', () => {
    expect(worker).toContain('!response.ok || response.redirected');
    expect(worker).toContain("OWNED_CACHE_PREFIXES = [CACHE_PREFIX, 'suprabha-stockflow-v']");
    expect(worker).toContain('key !== CACHE && OWNED_CACHE_PREFIXES.some');
    expect(worker).not.toContain('keys.filter(key=>key!==CACHE)');
  });
});

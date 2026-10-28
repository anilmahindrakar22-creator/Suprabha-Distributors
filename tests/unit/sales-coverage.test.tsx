import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SalesCoverageCard, SalesCoverageContents } from '@/components/sales-coverage-card';
import { fetchSalesCoverage, formatPaise, parseSalesCoverage, type SalesCoverage } from '@/lib/sales-coverage';

// Contract example (work/codex-handoffs/sales-coverage-contract.md), committed as a fixture.
const example = JSON.parse(readFileSync('tests/fixtures/sales-coverage-example.json', 'utf8')) as SalesCoverage;
afterEach(() => vi.unstubAllGlobals());

describe('sales coverage contract', () => {
  it('accepts the fixed contract example', () => {
    expect(parseSalesCoverage(example)).toEqual(example);
  });
  it('rejects missing months and string money without defaulting to zero', () => {
    const { months: _months, ...missing } = example;
    expect(parseSalesCoverage(missing)).toBeNull();
    expect(parseSalesCoverage({ ...example, months: example.months.map(row => ({ ...row, appNetPaise: String(row.appNetPaise) })) })).toBeNull();
  });
  it.each([null, {}, { ...example, rebuild: null }, { ...example, importedAt: 'invalid' },
    { ...example, blockingCount: -1 }, { ...example, months: example.months.slice(1) },
    { ...example, months: example.months.map(row => ({ ...row, tallyNetPaise: undefined })) },
    { ...example, months: [...example.months].reverse() }])('rejects malformed evidence %#', input => {
    expect(parseSalesCoverage(input)).toBeNull();
  });
  it('accepts never-covered and paused evidence', () => {
    expect(parseSalesCoverage({ ...example, complete: false, coveredFrom: null, coveredTo: null, importedAt: null, sourceVersion: null })).not.toBeNull();
    expect(parseSalesCoverage({ ...example, rebuild: { state: 'paused', since: example.importedAt, reason: 'Review required' } })).not.toBeNull();
  });
  it.each([[0, '₹0'], [25000000, '₹2,50,000'], [12345, '₹123.45'], [-12345, '−₹123.45'], [101, '₹1.01']])('formats %s paise', (input, expected) => {
    expect(formatPaise(input as number)).toBe(expected);
  });
  it('GETs the coverage action with cancellation and no caching', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => example });
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    expect(await fetchSalesCoverage(signal)).toEqual(example);
    expect(fetch).toHaveBeenCalledWith('/api/instrument-economics?action=get_sales_coverage', { cache: 'no-store', signal });
  });
  it.each([{ ok: false, json: async () => example }, { ok: true, json: async () => ({}) }])('treats HTTP and parse failures as errors', async response => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(fetchSalesCoverage(new AbortController().signal)).rejects.toThrow('Sales coverage unavailable');
  });
});

describe('sales coverage card', () => {
  it('shows no Tally control without inventing a zero', () => {
    const html = renderToStaticMarkup(<SalesCoverageContents coverage={example} />);
    expect(html).toContain('no Tally control');
    expect(html).not.toContain('₹0');
    expect(html).toContain('Jul–Sep 2026 · complete · as of 30 Oct, 10:14 pm');
    expect(html).toContain('differs by −₹100');
    expect(html).toContain('matches');
  });
  it.each(['administrator', 'management', 'accounts'])('renders for %s', role => {
    const html = renderToStaticMarkup(<SalesCoverageCard roles={[role]} />);
    expect(html).toContain('Sales coverage');
    expect(html).toContain('Loading sales coverage…');
    expect(html).toContain('aria-label="Refresh sales coverage"');
  });
  it.each([['sales'], ['operations'], ['viewer'], [], ['accounts', 'invalid']])('hides for disallowed role set %s', (...roles) => {
    expect(renderToStaticMarkup(<SalesCoverageCard roles={roles} />)).toBe('');
  });
  it('shows incomplete details and the paused warning', () => {
    const html = renderToStaticMarkup(<SalesCoverageContents coverage={{ ...example, complete: false, blockingCount: 2,
      blockingItems: [{ sourceId: 'source-1', reason: 'Missing ledger', recordedAt: example.importedAt! }, { sourceId: 'source-2', reason: 'Missing party', recordedAt: example.importedAt! }],
      rebuild: { state: 'paused', since: example.importedAt, reason: 'Sales review required' } }} />);
    expect(html).toContain('incomplete · 2 blocking items');
    expect(html).toContain('<details');
    expect(html).toContain('Missing ledger · 30 Oct, 10:14 pm · source-1');
    expect(html).toContain('Missing party · 30 Oct, 10:14 pm · source-2');
    expect(html).toContain('Economics results paused since 30 Oct, 10:14 pm. Figures shown are from before the pause.');
    expect(html).toContain('title="Sales review required"');
  });
  it('shows the absence of any complete window and both years across a year boundary', () => {
    expect(renderToStaticMarkup(<SalesCoverageContents coverage={{ ...example, complete: false, coveredFrom: null, coveredTo: null, importedAt: null, sourceVersion: null }} />)).toContain('No complete sales window yet');
    expect(renderToStaticMarkup(<SalesCoverageContents coverage={{ ...example, window: { from: '2025-12-01', to: '2026-02-28' } }} />)).toContain('Dec 2025–Feb 2026');
  });
});

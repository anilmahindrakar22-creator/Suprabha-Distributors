import { describe, expect, it } from 'vitest';
import { affectedSpecs, harnessViews, importGraph, specViews } from '../affected-browser-specs.mjs';

const root = process.cwd();
const select = (...changed: string[]) => affectedSpecs({ root, changed });
const spec = (name: string) => `tests/pricing-browser/${name}.spec.ts`;

describe('affected browser specs', () => {
  it('selects staff and responsive checks for user management', () => {
    const result = select('components/user-management.tsx');
    expect(result.all).toBe(false);
    expect(result.specs).toContain(spec('staff-auth'));
    expect(result.specs).toContain(spec('responsive-usability'));
    expect(result.specs).not.toContain(spec('instrument-economics'));
  });
  it('selects price-book checks', () => {
    const result = select('components/customer-price-book.tsx');
    expect(result.all).toBe(false);
    expect(result.specs).toContain(spec('price-book'));
  });
  it('selects instrument economics checks', () => {
    const result = select('components/instrument-economics-workspace.tsx');
    expect(result.all).toBe(false);
    expect(result.specs).toContain(spec('instrument-economics'));
  });
  it.each(['app/globals.css', 'tests/ui/main.tsx', 'components/zzz-not-real.tsx',
    'playwright.pricing.config.ts', 'package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'public/icon.png'])('fails safe for %s', file => {
    const result = select(file);
    expect(result.all).toBe(true);
    expect(result.specs).toEqual([...specViews(root).keys()].sort());
  });
  it('includes a changed spec by itself', () => {
    expect(select(spec('instrument-economics')).specs).toEqual([spec('instrument-economics')]);
  });
  it('does not select browser checks for documentation', () => {
    expect(select('docs/x.md')).toMatchObject({ all: false, specs: [] });
  });
  it('maps the local order wrapper and final conditional pricing fallback', () => {
    const views = harnessViews(root);
    expect(views.get('order-recovery')).toContain('components/order-workspace.tsx');
    expect(views.get('')).toContain('components/customer-price-book.tsx');
    expect(views.get('')).toContain('components/pricing-options.tsx');
    expect(views.get('order')).toContain('components/pricing-options.tsx');
  });
  it('follows a transitive component import', () => {
    const graph = importGraph(root);
    const dependency = [...graph.get('components/instrument-economics-workspace.tsx')!]
      .find(file => file.startsWith('components/instrument-economics-'))!;
    expect(dependency).toBeTruthy();
    expect(select(dependency).specs).toContain(spec('instrument-economics'));
  });
  it('conservatively maps computed view URLs', () => {
    expect(specViews(root).get(spec('instrument-scroll'))).toContain('*');
    expect(select('components/instrument-economics-workspace.tsx').specs).toContain(spec('instrument-scroll'));
  });
  it('normalizes Windows paths and sorts/deduplicates results', () => {
    const result = select('components\\user-management.tsx', 'components/user-management.tsx');
    expect(result).toEqual(select('components/user-management.tsx'));
    expect(result.specs).toEqual([...new Set(result.specs)].sort());
  });
});

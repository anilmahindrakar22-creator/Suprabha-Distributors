import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workspace = readFileSync(
  fileURLToPath(new URL('../../components/order-workspace.tsx', import.meta.url)),
  'utf8',
);

describe('mobile order-list density', () => {
  it('keeps the search controls visible and collapses secondary filters on small screens', () => {
    expect(workspace).toContain('sticky top-0 z-20');
    expect(workspace).toContain('More filters');
    expect(workspace).toContain('aria-expanded={mobileFiltersOpen}');
    expect(workspace).toContain('aria-controls="mobile-order-filters"');
    expect(workspace).toContain('sm:hidden');
    expect(workspace).toContain('sm:contents');
  });

  it('uses a compact horizontal summary and defers off-screen order rendering', () => {
    expect(workspace).toContain('flex snap-x gap-2 overflow-x-auto');
    expect(workspace).toContain('min-w-36 shrink-0 snap-start');
    expect(workspace).toContain('[content-visibility:auto]');
    expect(workspace).toContain('[contain-intrinsic-size:auto_260px]');
  });
});

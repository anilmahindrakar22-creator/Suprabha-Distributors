import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { EconomicTarget } from '@/lib/instrument-economics-types';
import { filterEconomicTargets, InstrumentEconomicsPortfolioFilters, type InstrumentEconomicsPortfolioFilterValues } from '@/components/instrument-economics-portfolio-filters';

const target = (overrides: Partial<EconomicTarget> = {}): EconomicTarget => ({
  id: 'placement-1', kind: 'placement', name: 'Central Lab', companyId: 'company-1', customerId: 'customer-1', customerName: 'City Hospital',
  customerSourceId: 'customer-source-1', siteId: 'site-central', modelId: 'model-alpha', installationId: null, effectiveFrom: '2026-01-01', effectiveTo: null,
  approval: 'approved', version: 1, capitalPaise: '0', revenuePaise: '0', knownGpPaise: '0', missingCostLines: 0,
  attributedLines: 0, recoveryPaise: '0', outstandingPaise: '0', health: 'healthy', forecastMonths: null, expectation: null, ...overrides,
});
const targets = [target(), target({ id: 'placement-2', name: 'North Branch', customerName: 'North Clinic', siteId: 'site-north', modelId: 'model-beta', health: 'watch' }), target({ id: 'group-1', kind: 'group', name: 'Regional Group', customerName: 'City Hospital', siteId: 'site-region', health: 'critical' })];
const all: InstrumentEconomicsPortfolioFilterValues = { query: '', health: 'all', kind: 'all' };

describe('instrument economics portfolio filters', () => {
  it('searches target name, customer, site and model without case sensitivity', () => {
    expect(filterEconomicTargets(targets, { ...all, query: 'nOrTh cLiNiC' }).map(row => row.id)).toEqual(['placement-2']);
    expect(filterEconomicTargets(targets, { ...all, query: 'MODEL-BETA' }).map(row => row.id)).toEqual(['placement-2']);
    expect(filterEconomicTargets(targets, { ...all, query: 'site-central' }).map(row => row.id)).toEqual(['placement-1']);
  });

  it('intersects status and type filters', () => {
    expect(filterEconomicTargets(targets, { ...all, health: 'healthy', kind: 'placement' }).map(row => row.id)).toEqual(['placement-1']);
    expect(filterEconomicTargets(targets, { ...all, health: 'critical', kind: 'placement' })).toEqual([]);
    expect(filterEconomicTargets(targets, { ...all, health: 'critical', kind: 'group' }).map(row => row.id)).toEqual(['group-1']);
  });

  it('renders an empty result count and labelled controls accessibly', () => {
    const html = renderToStaticMarkup(<InstrumentEconomicsPortfolioFilters filters={{ ...all, query: 'missing' }} onChange={() => {}} total={3} matching={0} />);
    expect(html).toContain('0 of 3 instruments');
    expect(html).toContain('aria-label="Search instruments"');
    expect(html).toContain('aria-label="Status"');
    expect(html).toContain('aria-label="Type"');
    expect(html).toContain('aria-label="Reset filters"');
    expect(filterEconomicTargets(targets, { ...all, query: 'missing' })).toEqual([]);
  });

  it('shows reset only when at least one filter is active', () => {
    const html = renderToStaticMarkup(<InstrumentEconomicsPortfolioFilters filters={{ query: 'north', health: 'watch', kind: 'placement' }} onChange={() => {}} total={3} matching={1} />);
    expect(html).toContain('aria-label="Reset filters"');
    expect(html).toContain('1 of 3 instruments');
    const defaults = renderToStaticMarkup(<InstrumentEconomicsPortfolioFilters filters={all} onChange={() => {}} total={3} matching={3} />);
    expect(defaults).not.toContain('aria-label="Reset filters"');
  });

  it('reports controlled search and filter changes without changing its own state', () => {
    const onChange = vi.fn();
    const element = InstrumentEconomicsPortfolioFilters({ filters: all, onChange, total: 3, matching: 3 });
    type Control = ReactElement<{ 'aria-label'?: string; onChange?: (event: { currentTarget: { value: string } }) => void; onClick?: () => void; children?: ReactNode }>;
    const controls = (node: ReactNode): Control[] => {
      if (!node || typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return [];
      if (Array.isArray(node)) return node.flatMap(controls);
      if (!isValidElement<{ 'aria-label'?: string; onChange?: (event: { currentTarget: { value: string } }) => void; onClick?: () => void; children?: ReactNode }>(node)) return [];
      const current = node;
      return [current, ...controls(current.props.children)];
    };
    const byLabel = (label: string) => controls(element).find(node => node.props['aria-label'] === label)!;

    byLabel('Search instruments').props.onChange!({ currentTarget: { value: 'Central' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...all, query: 'Central' });
    byLabel('Status').props.onChange!({ currentTarget: { value: 'watch' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...all, health: 'watch' });
    byLabel('Type').props.onChange!({ currentTarget: { value: 'group' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...all, kind: 'group' });

    const active = { query: 'north', health: 'watch' as const, kind: 'group' as const };
    const activeElement = InstrumentEconomicsPortfolioFilters({ filters: active, onChange, total: 3, matching: 1 });
    const reset = controls(activeElement).find(node => node.props['aria-label'] === 'Reset filters')!;
    reset.props.onClick!();
    expect(onChange).toHaveBeenLastCalledWith(all);
  });
});

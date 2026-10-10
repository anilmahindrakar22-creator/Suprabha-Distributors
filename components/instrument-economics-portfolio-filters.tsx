import type { EconomicTarget } from '@/lib/instrument-economics-types';

export type EconomicTargetHealthFilter = 'all' | EconomicTarget['health'];
export type EconomicTargetKindFilter = 'all' | EconomicTarget['kind'];
export type InstrumentEconomicsPortfolioFilterValues = {
  query: string;
  health: EconomicTargetHealthFilter;
  kind: EconomicTargetKindFilter;
};

const healthOptions: { value: EconomicTargetHealthFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' }, { value: 'healthy', label: 'Healthy' }, { value: 'watch', label: 'Watch' },
  { value: 'critical', label: 'Critical' }, { value: 'data_incomplete', label: 'Data incomplete' },
  { value: 'inactive', label: 'Inactive' }, { value: 'proposed', label: 'Proposed' },
];
const kindOptions: { value: EconomicTargetKindFilter; label: string }[] = [
  { value: 'all', label: 'All types' }, { value: 'placement', label: 'Placement' }, { value: 'group', label: 'Group' },
];

export function filterEconomicTargets(
  targets: EconomicTarget[],
  filters: InstrumentEconomicsPortfolioFilterValues,
): EconomicTarget[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return targets.filter(target => {
    const matchesQuery = !query || [target.name, target.customerName, target.siteId, target.modelId]
      .some(value => value.toLocaleLowerCase().includes(query));
    return matchesQuery && (filters.health === 'all' || target.health === filters.health)
      && (filters.kind === 'all' || target.kind === filters.kind);
  });
}

export function InstrumentEconomicsPortfolioFilters({
  filters, onChange, total, matching,
}: {
  filters: InstrumentEconomicsPortfolioFilterValues;
  onChange: (filters: InstrumentEconomicsPortfolioFilterValues) => void;
  total: number;
  matching: number;
}) {
  const update = (change: Partial<InstrumentEconomicsPortfolioFilterValues>) => onChange({ ...filters, ...change });
  const hasActiveFilters = filters.query.trim() !== '' || filters.health !== 'all' || filters.kind !== 'all';
  return <section aria-label="Filter economic targets" className="mb-5 grid gap-3 rounded-2xl border border-[#d7e4e2] bg-white p-4 sm:grid-cols-2 lg:grid-cols-[minmax(16rem,1fr)_minmax(10rem,0.5fr)_minmax(10rem,0.5fr)_auto_auto] lg:items-end">
    <label className="grid gap-1 text-sm font-semibold text-[#30494c]">
      Search targets
      <input aria-label="Search targets" type="search" value={filters.query} onChange={event => update({ query: event.currentTarget.value })} placeholder="Name, customer, site or model" className="min-h-11 w-full min-w-0 rounded-xl border border-[#b8cdca] px-3 font-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145e62]" />
    </label>
    <label className="grid gap-1 text-sm font-semibold text-[#30494c]">
      Status
      <select aria-label="Status" value={filters.health} onChange={event => update({ health: event.currentTarget.value as EconomicTargetHealthFilter })} className="min-h-11 w-full min-w-0 rounded-xl border border-[#b8cdca] px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145e62]">
        {healthOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-sm font-semibold text-[#30494c]">
      Type
      <select aria-label="Type" value={filters.kind} onChange={event => update({ kind: event.currentTarget.value as EconomicTargetKindFilter })} className="min-h-11 w-full min-w-0 rounded-xl border border-[#b8cdca] px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145e62]">
        {kindOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
    {hasActiveFilters && <button type="button" aria-label="Reset filters" onClick={() => onChange({ query: '', health: 'all', kind: 'all' })} className="min-h-11 w-full min-w-0 rounded-xl border border-[#b8cdca] px-3 text-sm font-semibold text-[#30494c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145e62] lg:w-auto">Reset filters</button>}
    <p aria-live="polite" className="text-sm text-[#586e71]">{matching} of {total} targets</p>
  </section>;
}

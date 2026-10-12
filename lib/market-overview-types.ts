export const marketOverviewFilters = ['all','focus','no_pin','no_estimate','stale_estimate'] as const;
export type MarketOverviewFilter = typeof marketOverviewFilters[number];
export type MarketOverviewCustomer = {
  id: string; name: string; city: string | null; hasPin: boolean;
  latitude?: string; longitude?: string; locationVersion?: number; walletTotalPaise: string | null;
  divisionsEstimated: number; latestAsOf: string | null; oldestAsOf: string | null;
  staleEstimate: boolean; inFocus: boolean;
};
export type MarketPareto = {
  basis: 'estimated_wallet'; focusCustomers: number; focusWalletPaise: string;
  totalWalletPaise: string; estimatedCustomers: number; activeCustomers: number;
};
export type MarketOverview = {
  customers: MarketOverviewCustomer[]; page: { page: number; pageSize: 50; total: number };
  counts: { all: number; noPin: number; noEstimate: number; staleEstimate: number };
  pareto: MarketPareto; activeDivisions: number;
};

export function parseMarketOverviewQuery(params: URLSearchParams): { search: string; page: number; filter: MarketOverviewFilter } | null {
  const search = params.get('search') ?? '';
  const rawPage = params.get('page') ?? '1';
  const page = Number(rawPage);
  const filter = params.get('filter') ?? 'all';
  if (Array.from(search).length > 120 || !/^[0-9]+$/.test(rawPage) || !Number.isInteger(page)
    || page < 1 || page > 2_147_483_647 || !marketOverviewFilters.some(value => value === filter)) return null;
  return { search, page, filter: filter as MarketOverviewFilter };
}

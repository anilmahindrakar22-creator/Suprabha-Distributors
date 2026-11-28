import { hasAnyStockFlowRole } from './user-types';

export type Surface = 'today' | 'stock' | 'orders' | 'requests' | 'accounts' | 'pricing' | 'economics' | 'growth' | 'service' | 'users';

// Single source for which sections a role set can open; the app frame and the role guide both use it.
export function stockFlowSurfaces(roles: unknown): Surface[] {
  const surfaces: Surface[] = ['stock', 'orders', 'requests', ...(hasAnyStockFlowRole(roles, ['administrator', 'management', 'sales', 'operations']) ? ['accounts' as const] : []), ...(hasAnyStockFlowRole(roles, ['administrator', 'management', 'accounts']) ? ['pricing' as const, 'economics' as const] : []), ...(hasAnyStockFlowRole(roles, ['administrator', 'operations', 'sales', 'management']) ? ['service' as const] : []), ...(hasAnyStockFlowRole(roles, ['administrator']) ? ['users' as const] : [])];
  if (hasAnyStockFlowRole(roles, ['administrator', 'management'])) surfaces.unshift('today');
  if (hasAnyStockFlowRole(roles, ['administrator', 'management'])) surfaces.push('growth');
  return surfaces;
}

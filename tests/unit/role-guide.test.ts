import { describe, expect, it } from 'vitest';
import { roleGuide } from '@/lib/role-guide';
import { stockFlowSurfaces, type Surface } from '@/lib/stockflow-surfaces';
import { hasAnyStockFlowRole, stockFlowRoles } from '@/lib/user-types';

// Verbatim copy of the inline logic that lived in components/stockflow-frame.tsx before extraction.
function legacy(roles: unknown): Surface[] {
  const canSeeToday = hasAnyStockFlowRole(roles, ['administrator', 'management']);
  const surfaces: Surface[] = ['stock', 'orders', 'requests', ...(hasAnyStockFlowRole(roles, ['administrator', 'management', 'sales', 'operations']) ? ['accounts' as const] : []), ...(hasAnyStockFlowRole(roles, ['administrator', 'management', 'accounts']) ? ['pricing' as const, 'economics' as const] : []), ...(hasAnyStockFlowRole(roles, ['administrator', 'operations', 'sales', 'management']) ? ['service' as const] : []), ...(hasAnyStockFlowRole(roles, ['administrator']) ? ['users' as const] : [])];
  if (canSeeToday) surfaces.unshift('today');
  if (hasAnyStockFlowRole(roles, ['administrator', 'management'])) surfaces.push('growth');
  return surfaces;
}

describe('stockFlowSurfaces', () => {
  it('matches the original navigation logic for all 255 non-empty role subsets', () => {
    let checked = 0;
    for (let mask = 1; mask < 1 << stockFlowRoles.length; mask += 1) {
      const subset = stockFlowRoles.filter((_, index) => mask & (1 << index));
      expect(stockFlowSurfaces(subset), subset.join(',')).toEqual(legacy(subset));
      checked += 1;
    }
    expect(checked).toBe(255);
  });
});

describe('roleGuide', () => {
  it('billing only sees Stock, Orders and Purchase and can bill challans', () => {
    const guide = roleGuide(['billing']);
    expect(guide.roleNames).toEqual(['Billing']);
    expect(guide.sections).toEqual(['Stock', 'Orders', 'Purchase']);
    expect(guide.canDo).toContain('Bill challans and record Tally invoice numbers');
    expect(guide.canDo).not.toContain('Create orders');
  });
  it('administrator can manage users', () => {
    const guide = roleGuide(['administrator']);
    expect(guide.sections).toContain('Users');
    expect(guide.canDo).toContain('Add people and change their roles');
  });
  it('management has Today first and Growth last', () => {
    const { sections } = roleGuide(['management']);
    expect(sections[0]).toBe('Today');
    expect(sections[sections.length - 1]).toBe('Growth');
  });
  it('viewer has nothing to do beyond viewing', () => {
    expect(roleGuide(['viewer']).canDo).toEqual([]);
  });
  it('lists role names in the standard order', () => {
    expect(roleGuide(['operations', 'sales']).roleNames).toEqual(['Sales', 'Operations']);
  });
});

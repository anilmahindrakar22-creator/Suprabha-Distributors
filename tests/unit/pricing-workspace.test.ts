import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const frame = readFileSync('components/stockflow-frame.tsx', 'utf8');
const workspace = readFileSync('components/pricing-workspace.tsx', 'utf8');
const orders = readFileSync('components/order-workspace.tsx', 'utf8');

describe('dedicated pricing control centre', () => {
  it('is lazy-loaded and offered only to pricing roles', () => {
    expect(frame).toContain("const PricingWorkspace = lazy(");
    expect(frame).toContain("hasAnyStockFlowRole(roles, ['administrator', 'management', 'accounts'])");
    expect(frame).not.toContain("import { PricingWorkspace } from './pricing-workspace'");
  });

  it('keeps global price and policy administration outside order cards', () => {
    expect(orders).not.toContain('<CommercialPolicyPanel');
    expect(orders).not.toContain('<CustomerPriceContracts');
  });

  it('shows the governed margin and approval controls without Tally writes', () => {
    expect(workspace).toContain('Minimum gross margin');
    expect(workspace).toContain('Approval inbox');
    expect(workspace).toContain("action: 'create_price_contract'");
    expect(workspace).toContain("action: 'create_pricing_policy'");
    expect(workspace).toContain('Tally remains read-only and untouched.');
    expect(workspace).toContain('Pricing administration');
    expect(workspace).toContain('Customer agreements, proposals and commercial policy');
    expect(workspace).not.toContain('Four-eyes review');
    expect(workspace).not.toContain('independent approval');
    expect(workspace).not.toMatch(/create.*voucher|post.*tally/i);
  });

  it('shows order price review without a second disclosure click and keeps approval one-click', () => {
    expect(orders).toContain('aria-label="Price review"');
    const pricingHook = orders.slice(orders.indexOf('function useOrderPricing('), orders.indexOf('type DeliveryCommand'));
    expect(pricingHook).toContain("const autoLoad = enabled && order.pricingState !== 'approved' && !['delivered', 'cancelled'].includes(order.status)");
    expect(pricingHook).toContain("state: autoLoad ? 'loading' : 'idle'");
    expect(pricingHook).toContain("if (stale) {\n      if (order.pricingState !== 'approved') return;\n      if (automaticVersion.current === versionKey) return;");
    expect(pricingHook).toContain('} else if (!autoLoad || automaticReadKey.current === readKey) return;');
    expect(pricingHook).toContain('automaticReadKey.current = readKey;\n    void reload();');
    expect(orders).not.toContain('Commercial pricing · restricted');
    expect(orders.indexOf('{workspace.exceptions.map')).toBeLessThan(orders.indexOf('{workspace.lines.map'));
    expect(orders).toContain("reason.trim() || 'Price reviewed and approved'");
    expect(orders).toContain('placeholder="Optional approval note · required to reject"');
  });
});

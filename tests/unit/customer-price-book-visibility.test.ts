import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync('components/customer-price-book.tsx', 'utf8');
const migration = readFileSync('supabase/migrations/20260921123000_customer_price_book_visibility.sql', 'utf8');

describe('customer price-book visibility', () => {
  it('shows governed source and current economics without opening another disclosure', () => {
    expect(component).toContain('Price source:');
    expect(component).toContain('aria-label="Current economics"');
    expect(component).toContain('Current selling rate');
    expect(component).toContain('Current GP / unit');
    expect(component).not.toContain('<summary className="cursor-pointer text-sm font-bold">Choose a price</summary>');
  });

  it('allows one-click approval of safe suggestions but still requires a reason for custom prices', () => {
    expect(component).toContain("'Approved recommended price'");
    expect(component).toContain("'Approved continuity price'");
    expect(component).toContain("!(Number(custom)>0)||reason.trim().length<3");
  });

  it('includes calculated review rows and fixed agreements in the exception view', () => {
    expect(migration).toContain("price_row->>'status'='REVIEW_REQUIRED'");
    expect(migration).toContain("coalesce((price_row->>'fixed')::boolean,false)");
    expect(migration).toContain("selected_tab in ('purchased','exceptions')");
    expect(migration).toContain('perform private.stockflow_assert_pricing_role(role)');
    expect(migration).toContain('revoke all on function public.stockflow_pricing_gateway_v2');
  });
});

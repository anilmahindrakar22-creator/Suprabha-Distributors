import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const orders = readFileSync(fileURLToPath(new URL('../../components/order-workspace.tsx', import.meta.url)), 'utf8');
const users = readFileSync(fileURLToPath(new URL('../../components/user-management.tsx', import.meta.url)), 'utf8');

describe('browser input bounds', () => {
  it('mirrors the order capture boundary before submission', () => {
    expect(orders).toContain('maxLength={200}');
    expect(orders).toContain('maxLength={40}');
    expect(orders).toContain('maxLength={120}');
    expect(orders).toContain('max="1000000"');
    expect(orders).toContain('Maximum 50 products per order.');
    expect(orders).toContain('Tally invoice number(s)<input maxLength={160}');
    expect(orders).toContain('Delivery address<input maxLength={1000}');
    expect(orders).toContain('Courier / transporter<input maxLength={160}');
    expect(orders).toContain('Reason for change<textarea required maxLength={500}');
    expect(orders).toContain('<input type="email" maxLength={254} value={engineerEmail}');
  });

  it('uses the shared role list and email limit', () => {
    expect(users).toContain("import { stockFlowRoles } from '@/lib/user-types'");
    expect(users).toContain('maxLength={254}');
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260911114000_order_capture_delivery_address.sql', import.meta.url)), 'utf8').toLowerCase();

describe('delivery address during order capture', () => {
  it('adds the existing address field to the atomic create gateway without widening access', () => {
    expect(migration).toContain('delivery_address');
    expect(migration).toContain("p_payload->>'deliveryaddress'");
    expect(migration).toContain('stockflow_order_gateway');
    expect(migration).toContain('grant execute');
    expect(migration).toContain('revoke all');
    expect(migration).not.toMatch(/delete\s+from/);
  });
});

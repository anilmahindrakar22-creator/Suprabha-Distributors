import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260910053928_order_capture_promised_delivery.sql', import.meta.url)), 'utf8').toLowerCase();

describe('promised delivery during order capture', () => {
  it('adds the existing delivery date field to the atomic create gateway', () => {
    expect(migration).toContain('expected_delivery_date');
    expect(migration).toContain("p_payload->>'expecteddeliverydate'");
    expect(migration).toContain('stockflow_order_gateway');
    expect(migration).toContain('grant execute');
    expect(migration).not.toMatch(/delete\s+from/);
  });
});

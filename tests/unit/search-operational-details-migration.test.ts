import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260911121500_search_operational_order_details.sql', import.meta.url)), 'utf8').toLowerCase();

describe('operational order search migration', () => {
  it('extends the private search seam without exposing it to browser roles', () => {
    for (const field of ['source', 'priority', 'notes', 'delivery_address', 'courier_name', 'tracking_number', 'vehicle_number', 'received_by', 'pod_reference']) {
      expect(migration).toContain(`p_order.${field}`);
    }
    expect(migration).toContain("replace(p_order.source,'_',' ')");
    expect(migration).toContain('stockflow_order_matches_filter(p_order,p_status');
    expect(migration).toContain('revoke all');
    expect(migration).not.toContain('grant execute');
    expect(migration).not.toMatch(/delete\s+from/);
  });
});

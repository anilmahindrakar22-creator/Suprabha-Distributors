import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const frame = readFileSync(fileURLToPath(new URL('../../components/stockflow-frame.tsx', import.meta.url)), 'utf8');
const edge = readFileSync(fileURLToPath(new URL('../../supabase/functions/stockflow-orders/index.ts', import.meta.url)), 'utf8');

describe('Tally-only inventory boundary', () => {
  it('does not expose a second inventory workspace or inventory mutation actions', () => {
    expect(frame).not.toContain("surface: 'inventory'");
    expect(frame).not.toContain('InventoryWorkspace');
    for (const action of ['bootstrap_inventory', 'receive_stock', 'adjust_stock', 'allocate_order', 'release_order']) {
      expect(edge).not.toContain(`\"${action}\"`);
    }
  });
});

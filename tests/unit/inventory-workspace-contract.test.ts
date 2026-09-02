import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workspace = readFileSync(fileURLToPath(new URL('../../components/inventory-workspace.tsx', import.meta.url)), 'utf8');
const frame = readFileSync(fileURLToPath(new URL('../../components/stockflow-frame.tsx', import.meta.url)), 'utf8');

describe('lightweight inventory workspace contract', () => {
  it('keeps inventory separate from order entry and calls the protected inventory endpoint', () => {
    expect(frame).toContain('<InventoryWorkspace actorRole={actorRole} />');
    expect(workspace).toContain("fetch('/api/inventory'");
    expect(workspace).toContain('Tally stock remains unchanged');
  });

  it('limits receipt and adjustment controls by operational role', () => {
    expect(workspace).toContain("['administrator', 'operations', 'warehouse'].includes(actorRole)");
    expect(workspace).toContain("['administrator', 'warehouse'].includes(actorRole)");
    expect(frame).toContain("['administrator','operations','warehouse','management'].includes(actorRole)");
  });

  it('keeps FEFO allocation to one warehouse action and shows reconciliation without changing Tally', () => {
    const orders = readFileSync(fileURLToPath(new URL('../../components/order-workspace.tsx', import.meta.url)), 'utf8');
    expect(orders).toContain("'Allocate stock'");
    expect(orders).toContain("action: 'allocate_order'");
    expect(workspace).toContain('Tally reconciliation:');
    expect(workspace).toContain('This comparison does not alter Tally');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workspace = readFileSync(
  new URL('../../components/order-workspace.tsx', import.meta.url),
  'utf8',
);

describe('Tally reconciliation wording', () => {
  it('keeps identity and line reconciliation as separate evidence', () => {
    expect(workspace).toContain('Invoice matched');
    expect(workspace).toContain('Matched Tally voucher');
    expect(workspace).toContain('Invoice number, financial year, and customer ledger matched');
    expect(workspace).toContain('Product & quantity check');
    expect(workspace).toContain('Products and quantities matched');
    expect(workspace).toContain('Tally invoice differences');
    expect(workspace).toContain('Billing mismatch');
    expect(workspace).not.toContain('Invoice verified');
  });
});

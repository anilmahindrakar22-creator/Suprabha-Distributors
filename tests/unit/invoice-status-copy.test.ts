import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workspace = readFileSync(
  new URL('../../components/order-workspace.tsx', import.meta.url),
  'utf8',
);

describe('Tally reconciliation wording', () => {
  it('describes identity matching without implying product or quantity verification', () => {
    expect(workspace).toContain('Invoice matched');
    expect(workspace).toContain('Invoice number, financial year, and customer ledger matched');
    expect(workspace).toContain('Product & quantity check');
    expect(workspace).toContain('Not compared with Tally');
    expect(workspace).not.toContain('Invoice verified');
  });
});

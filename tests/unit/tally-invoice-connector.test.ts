import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const connector = readFileSync(fileURLToPath(new URL('../../desktop-connector/dashboard.ps1', import.meta.url)), 'utf8');

describe('Tally invoice reconciliation connector', () => {
  it('exports read-only sales voucher identity and excludes cancelled vouchers', () => {
    expect(connector).toContain('Date,VoucherNumber,Reference,MasterID');
    expect(connector).toContain('tallyInvoices = @($salesData.invoices)');
    expect(connector).toContain("SelectSingleNode('./VOUCHERNUMBER')");
    expect(connector).toContain("$cancelled.InnerText -eq 'Yes'");
    expect(connector).not.toMatch(/Invoke-Tally[^\n]*(Import|Create|Alter)/i);
  });
});

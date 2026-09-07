import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const connector = readFileSync(fileURLToPath(new URL('../../desktop-connector/dashboard.ps1', import.meta.url)), 'utf8');
const recovery = readFileSync(fileURLToPath(new URL('../../desktop-connector/recovery.ps1', import.meta.url)), 'utf8');

describe('Tally invoice reconciliation connector', () => {
  it('exports read-only sales voucher identity and excludes cancelled vouchers', () => {
    expect(connector).toContain('Date,VoucherNumber,VoucherTypeName,Reference,MasterID');
    expect(connector).toContain("sourceScope = 'sales_vouchers_v1'");
    expect(connector).toContain('tallyInvoices = @($salesData.invoices)');
    expect(recovery).toContain("SelectSingleNode('./VOUCHERNUMBER')");
    expect(connector).toContain("$today.AddDays(-180)");
    expect(connector).toContain('$dateKey -ge $invoiceFromDate');
    expect(recovery).toContain("$voucher.ISCANCELLED.InnerText -eq 'Yes'");
    expect(connector).not.toMatch(/Invoke-Tally[^\n]*(Import|Create|Alter)/i);
  });
});

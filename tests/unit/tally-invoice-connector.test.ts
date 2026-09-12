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
    expect(connector).toContain('lineItems = $safeInvoiceLines');
    expect(connector).toContain('itemName = $_.itemName; quantity = $_.quantity');
    expect(recovery).toContain("SelectSingleNode('./VOUCHERNUMBER')");
    expect(connector).toContain("$today.AddDays(-180)");
    expect(connector).toContain('$dateKey -ge $invoiceFromDate');
    expect(recovery).toContain("$voucher.ISCANCELLED.InnerText -eq 'Yes'");
    expect(connector).not.toMatch(/Invoke-Tally[^\n]*(Import|Create|Alter)/i);
  });

  it('separates large catalog reads from the operational refresh cadence', () => {
    expect(connector).toContain('[int]$CatalogSyncMinutes = 240');
    expect(connector).toContain("'catalog-master-v1.json'");
    expect(connector).toContain('function Get-TallyCatalogDocument');
    expect(connector).toContain("Read-CatalogSnapshot \"$catalogPath.bak\"");
    expect(connector).toContain('[xml]$companyDoc = Invoke-Tally $companyXml');
    expect(connector).toContain('[xml]$stockDoc = Get-TallyCatalogDocument');
    expect(recovery).toContain('function Read-CatalogSnapshot');
  });

  it('exports bounded read-only selling-price evidence without enabling Tally writes', () => {
    expect(connector).toContain('AllInventoryEntries.Rate,AllInventoryEntries.Amount');
    expect(connector).toContain('Get-PricingSalesEvidence $salesData.records $customers');
    expect(connector).toContain('pricingHistory = [ordered]@{ sales = $pricingSales; purchaseCosts = @() }');
    expect(connector).toContain('Commercial rates stay in pricingHistory and never enter normal order payloads.');
    expect(connector).toContain('lineItems = $safeInvoiceLines');
    expect(connector).not.toMatch(/CREATE\s+VOUCHER|ALTER\s+VOUCHER|DELETE\s+VOUCHER/i);
  });

  it('reuses the customer-master request for read-only ledger balances', () => {
    expect(connector).toContain('PinCode,ClosingBalance');
    expect(connector).toContain('tallyBalance = if ($balanceText) { Get-Number $balanceText }');
    expect(connector.match(/DashboardCustomerLedgers/g)?.length).toBeGreaterThan(1);
  });
});

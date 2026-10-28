import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const connector = readFileSync(fileURLToPath(new URL('../../desktop-connector/dashboard.ps1', import.meta.url)), 'utf8');
const recovery = readFileSync(fileURLToPath(new URL('../../desktop-connector/recovery.ps1', import.meta.url)), 'utf8');

describe('Tally invoice reconciliation connector', () => {
  it.skipIf(process.platform !== 'win32')('extracts Nos from RATE, Box from quantity, and null without either', () => {
    const path = fileURLToPath(new URL('../../desktop-connector/recovery.ps1', import.meta.url)).replace(/'/g, "''");
    const script = `
      $ErrorActionPreference = 'Stop'
      . '${path}'
      $cases = @(@{ rate='4450.00/Nos'; qty='2 Box' }, @{ rate='4450.00'; qty='2 Box' }, @{ rate='4450.00'; qty='2' })
      $results = @(foreach ($case in $cases) {
        $xml = '<ENVELOPE><VOUCHER><MASTERID>1</MASTERID><DATE>20261026</DATE><VOUCHERNUMBER>TEST</VOUCHERNUMBER><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>Customer</PARTYLEDGERNAME><ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Item</STOCKITEMNAME><RATE>' + $case.rate + '</RATE><BILLEDQTY>' + $case.qty + '</BILLEDQTY></ALLINVENTORYENTRIES.LIST></VOUCHER></ENVELOPE>'
        $records = @(Convert-LegacySalesRecords $xml)
        $evidence = @(Get-PricingSalesEvidence $records @(@{name='Customer';tallyKey='Customer'}))
        @{unit=$records[0].lineItems[0].unit; evidenceUnit=$evidence[0].unit; version=$evidence[0].sourceVersion}
      })
      ConvertTo-Json -InputObject $results -Compress
    `;
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    const rows = JSON.parse(result.stdout);
    expect(rows.map((row: { unit: string | null }) => row.unit)).toEqual(['Nos', 'Box', null]);
    expect(rows.map((row: { evidenceUnit: string | null }) => row.evidenceUnit)).toEqual(['Nos', 'Box', null]);
    expect(new Set(rows.map((row: { version: string }) => row.version)).size).toBe(1);
  });
  it('preserves invoice units without changing evidence identity', () => {
    expect(recovery).toContain("$unit = $null");
    expect(recovery).toContain("$rateNode.InnerText.Contains('/')");
    expect(recovery).toContain("$unit = ($rateNode.InnerText -split '/', 2)[1].Trim()");
    expect(recovery).toContain("$quantityNode.InnerText -match '\\s+([^\\s\\d]+)\\s*$'");
    expect(recovery).toContain('$unit = $matches[1].Trim()');
    expect(recovery).toContain('if (-not $unit) { $unit = $null }');
    expect(recovery).toContain('rate = $rate; unit = $unit');
    expect(recovery).toContain('unit = $line.unit');
    expect(recovery).toContain('$sourceVersion = Get-StableEvidenceVersion "$sourceId|$date|$rate|$([string]$voucher.voucherNumber)"');
  });
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
    expect(connector).toContain('$purchaseRecords = Get-TallyPurchaseData');
    expect(connector).toContain('Get-PricingPurchaseCostEvidence $purchaseRecords');
    expect(connector).toContain('pricingHistory = [ordered]@{ sales = $pricingSales; purchaseCosts = $pricingPurchaseCosts; supplierPrices = $supplierPrices }');
    expect(connector).toContain('Commercial rates stay in pricingHistory and never enter normal order payloads.');
    expect(recovery).toContain('A duplicate display name cannot prove an exact canonical Tally ledger.');
    expect(connector).toContain('lineItems = $safeInvoiceLines');
    expect(connector).not.toMatch(/CREATE\s+VOUCHER|ALTER\s+VOUCHER|DELETE\s+VOUCHER/i);
  });

  it('guards the only Tally transport and keeps all connector templates read-only', () => {
    const root = new URL('../../desktop-connector/', import.meta.url);
    const guard = connector.match(/function Invoke-Tally\([^]*?\n}\r?\n/)?.[0];
    expect(guard).toBeTruthy();
    expect(guard).toContain('Refused: StockFlow only reads from Tally');
    expect(guard).toContain('$requests.Count -ne 1');
    expect(guard).toContain("Value.Trim() -ine 'Export'");
    expect(guard).toContain('IMPORTDATA|\\bACTION\\s*=');
    expect(guard).toContain('status=refused');
    expect(guard!.indexOf('throw')).toBeLessThan(guard!.indexOf('Invoke-WebRequest'));
    let transports = 0;
    for (const name of readdirSync(root).filter(name => name.endsWith('.ps1'))) {
      const source = readFileSync(new URL(name, root), 'utf8');
      const requests = [...source.matchAll(/<TALLYREQUEST>([^<]*)<\/TALLYREQUEST>/gi)];
      expect(source.match(/<TALLYREQUEST>/gi)?.length ?? 0, name).toBe(requests.length);
      for (const request of requests) expect(request[1].trim().toLowerCase(), name).toBe('export');
      // The guard must name the forbidden token; exclude only its exact matcher.
      expect(source.replace("(?i)IMPORTDATA|\\bACTION\\s*=", ''), name).not.toMatch(/IMPORTDATA|<[A-Za-z][^>\r\n]*\sACTION\s*=/i);
      for (const line of source.split(/\r?\n/).filter(line => /:9000\b/.test(line))) {
        // No endpoint aliases: the sole literal is the central HTTP transport.
        expect(name).toBe('dashboard.ps1');
        expect(guard).toContain(line);
        expect(line).toMatch(/Invoke-WebRequest.*127\.0\.0\.1:9000/);
        transports++;
      }
      const outside = name === 'dashboard.ps1' ? source.replace(guard!, '') : source;
      expect(outside).not.toMatch(/(?:Invoke-WebRequest|Invoke-RestMethod|WebClient|HttpClient)[^\r\n]*9000/i);
    }
    expect(transports).toBe(1);
  });

  it('reads purchase costs on a slower bounded incremental schedule', () => {
    expect(connector).toContain("sourceScope = 'purchase_vouchers_v1'");
    expect(connector).toContain('<CHILDOF>Purchase</CHILDOF>');
    expect(connector).toContain("Get-SalesWindow $today ([string]$cached.reconciledAt) 14 90 24");
    expect(connector).toContain("$today.AddDays(-365).ToString('yyyyMMdd')");
    expect(connector).toContain('Tally ignored the purchase date window; refusing to merge an unbounded export.');
    expect(connector).toContain('domain=purchase_costs records=$($records.Count) status=accepted');
  });

  it('reuses the customer-master request for read-only ledger balances', () => {
    expect(connector).toContain('PinCode,ClosingBalance');
    expect(connector).toContain('tallyBalance = if ($balanceText) { Get-Number $balanceText }');
    expect(connector.match(/DashboardCustomerLedgers/g)?.length).toBeGreaterThan(1);
  });
});

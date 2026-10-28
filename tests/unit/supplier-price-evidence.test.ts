import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const recovery = readFileSync(fileURLToPath(new URL('../../desktop-connector/recovery.ps1', import.meta.url)), 'utf8');
const dashboard = readFileSync(fileURLToPath(new URL('../../desktop-connector/dashboard.ps1', import.meta.url)), 'utf8');
const start = recovery.indexOf('function Get-SupplierPurchasePriceEvidence(');
const next = recovery.indexOf('\nfunction ', start + 1);
const implementation = start >= 0 ? recovery.slice(start, next < 0 ? undefined : next).trim() : '';
const pwsh = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' });
const hasPwsh = pwsh.status === 0;

it.skipIf(!hasPwsh)('keeps latest eligible supplier/item/unit rates, applies deterministic ties, filters invalid evidence, and caps output', () => {
  expect(implementation).toContain('Get-SupplierPurchasePriceEvidence');
  const script = `$ErrorActionPreference = 'Stop'\n${implementation}\n$today = [datetimeoffset]::UtcNow.ToOffset([timespan]::FromMinutes(330)).Date\n$day = $today.ToString('yyyyMMdd')\n$old = $today.AddDays(-366).ToString('yyyyMMdd')\n$future = $today.AddDays(1).ToString('yyyyMMdd')\n$records = @(\n  @{sourceDomain='purchase';voucherType='Purchase';party='Alpha';date=$day;voucherNumber='P-1';masterId='1';lineItems=@(@{itemName='Kit';rate=10;unit='Box';lineNumber=1},@{itemName='Kit';rate=3;unit='Nos';lineNumber=2})},\n  @{sourceDomain='purchase';voucherType='Purchase';party='Alpha';date=$day;voucherNumber='P-2';masterId='2';lineItems=@(@{itemName='Kit';rate=12;unit='Box';lineNumber=1})},\n  @{sourceDomain='purchase';voucherType='Purchase';party='Beta';date=$day;voucherNumber='P-9';masterId='9';lineItems=@(@{itemName='Kit';rate=14;unit='Box';lineNumber=1})},\n  @{sourceDomain='purchase';voucherType='Debit Note';party='Alpha';date=$day;voucherNumber='P-99';lineItems=@(@{itemName='Kit';rate=99;unit='Box'})},\n  @{sourceDomain='purchase';voucherType='Purchase';party='Alpha';date=$day;voucherNumber='P-98';cancelled=$true;lineItems=@(@{itemName='Kit';rate=98;unit='Box'})},\n  @{sourceDomain='purchase';voucherType='Purchase';party='Alpha';date=$day;voucherNumber='P-97';optional=$true;lineItems=@(@{itemName='Kit';rate=97;unit='Box'})},\n  @{sourceDomain='other';voucherType='Purchase';party='Alpha';date=$day;voucherNumber='P-96';lineItems=@(@{itemName='Kit';rate=96;unit='Box'})},\n  @{sourceDomain='purchase';voucherType='Purchase';party=' ';date=$day;voucherNumber='P-95';lineItems=@(@{itemName='Kit';rate=95;unit='Box'})},\n  @{sourceDomain='purchase';voucherType='Purchase';party='Alpha';date=$old;voucherNumber='P-94';lineItems=@(@{itemName='Kit';rate=94;unit='Box'})},\n  @{sourceDomain='purchase';voucherType='Purchase';party='Alpha';date=$future;voucherNumber='P-93';lineItems=@(@{itemName='Kit';rate=93;unit='Box'})},\n  @{sourceDomain='purchase';voucherType='Purchase';party='Alpha';date='not-a-date';voucherNumber='P-92';lineItems=@(@{itemName='Kit';rate=92;unit='Box'})},\n  @{sourceDomain='purchase';voucherType='Purchase';party='Alpha';date=$day;voucherNumber='P-91';lineItems=@(@{itemName='Kit';rate=0;unit='Box';lineNumber=1},@{itemName=' ';rate=4;unit='Box';lineNumber=2})}\n)\n$rows = @(Get-SupplierPurchasePriceEvidence $records)\n$limited = @(Get-SupplierPurchasePriceEvidence $records 1)\n@{rows=$rows;limited=$limited} | ConvertTo-Json -Depth 6 -Compress`;
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  const output = JSON.parse(result.stdout);
  expect(output.rows).toHaveLength(3);
  expect(output.rows.map((row: { supplierName: string; unit: string; rate: number }) => [row.supplierName, row.unit, row.rate])).toEqual([['Alpha', 'Box', 12], ['Alpha', 'Nos', 3], ['Beta', 'Box', 14]]);
  expect(output.limited).toHaveLength(1);
  expect(output.limited[0].supplierName).toBe('Alpha');
  expect(output.limited[0].unit).toBe('Box');
});

it('uploads supplier prices from the same trusted purchase records', () => {
  expect(dashboard).toContain('$purchaseRecords = Get-TallyPurchaseData');
  expect(dashboard).toContain('supplierPrices = @(Get-SupplierPurchasePriceEvidence $purchaseRecords)');
});

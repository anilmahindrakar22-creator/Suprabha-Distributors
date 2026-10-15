import { describe, expect, it } from 'vitest';
import { isConfirmCustomerLinksResult, isCustomerLinksResponse, parseLinkCommand } from '@/lib/customer-link-types';

const id = '12345678-1234-4234-8234-123456789abc';
const valid = { action: 'confirm_customer_links', companyId: 'company', sourceVersion: 'export-1', rows: [{ customerId: id, ledgerGuid: 'guid' }], reason: 'Verified ledger', idempotencyKey: 'customer-links-key-001' };
describe('customer link commands', () => {
  it('accepts only a receipt for exactly the submitted customers', () => {
    expect(isConfirmCustomerLinksResult({ ok: true, confirmed: 1, customerIds: [id] }, [id])).toBe(true);
    for (const value of [null, {}, { ok: true }, { ok: true, confirmed: 2, customerIds: [id] }, { ok: true, confirmed: 1, customerIds: ['other'] }, { ok: true, confirmed: 2, customerIds: [id, id] }]) {
      expect(isConfirmCustomerLinksResult(value, [id])).toBe(false);
    }
  });
  it('rejects malformed source lists rather than displaying unverified matches', () => {
    const row = { customerId: id, customerName: 'Care Lab', city: null, ledgerName: 'Care Lab', guid: 'guid', state: 'suggested' };
    const list = { companyId: 'company', sourceVersion: 'v1', observedAt: '2026-10-15T01:00:00Z', rows: [row], page: { page: 1, pageSize: 25, total: 1 } };
    expect(isCustomerLinksResponse(list)).toBe(true);
    expect(isCustomerLinksResponse({ waiting: true, companyId: null, sourceVersion: null, rows: [] })).toBe(true);
    for (const value of [null, {}, { ...list, rows: null }, { ...list, observedAt: 'invalid' }, { ...list, rows: [{ ...row, guid: null }] }, { ...list, page: { page: 1, pageSize: 25, total: 0 } }]) expect(isCustomerLinksResponse(value)).toBe(false);
  });
  it('extracts the flat command and trims user text', () => {
    expect(parseLinkCommand({ ...valid, companyId: ' company ', sourceVersion: ' export-1 ', reason: ' Verified ledger ', rows: [{ customerId: id.toUpperCase(), ledgerGuid: ' guid ' }], idempotencyKey: ' customer-links-key-001 ' }))
      .toEqual({ action: valid.action, payload: { companyId: 'company', sourceVersion: 'export-1', rows: valid.rows, reason: valid.reason, idempotencyKey: valid.idempotencyKey } });
  });
  it.each([null, [], {}, { ...valid, extra: true }, { action: valid.action, payload: valid },
    { ...valid, action: 'other' }, { ...valid, companyId: '' }, { ...valid, companyId: 'x'.repeat(241) },
    { ...valid, sourceVersion: 1 }, { ...valid, sourceVersion: ' ' }, { ...valid, sourceVersion: 'x'.repeat(241) },
    { ...valid, reason: ' ab ' }, { ...valid, reason: 'x'.repeat(301) }, { ...valid, reason: null },
    { ...valid, idempotencyKey: 'short' }, { ...valid, idempotencyKey: ' '.repeat(190) + '1234567890123456' },
    { ...valid, rows: [] }, { ...valid, rows: [null] }, { ...valid, rows: [{ customerId: id, ledgerGuid: 'guid', extra: true }] },
    { ...valid, rows: [{ customerId: 'bad', ledgerGuid: 'guid' }] }, { ...valid, rows: [{ customerId: id, ledgerGuid: ' ' }] },
    { ...valid, rows: [{ customerId: id, ledgerGuid: 'x'.repeat(241) }] }, { ...valid, rows: [{ customerId: id, ledgerGuid: 1 }] },
  ])('rejects malformed or unbounded command %#', value => {
    expect(parseLinkCommand(value)).toBeNull();
  });
  it('rejects duplicate customers case insensitively and duplicate trimmed GUIDs', () => {
    expect(parseLinkCommand({ ...valid, rows: [...valid.rows, { customerId: id.toUpperCase(), ledgerGuid: 'other' }] })).toBeNull();
    expect(parseLinkCommand({ ...valid, rows: [...valid.rows, { customerId: '22345678-1234-4234-8234-123456789abc', ledgerGuid: ' guid ' }] })).toBeNull();
  });
  it('accepts fifty distinct rows and rejects fifty-one', () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({ customerId: `${String(index).padStart(8, '0')}-1234-4234-8234-123456789abc`, ledgerGuid: `guid-${index}` }));
    expect(parseLinkCommand({ ...valid, rows: rows.slice(0, 50) })).not.toBeNull();
    expect(parseLinkCommand({ ...valid, rows })).toBeNull();
  });
});

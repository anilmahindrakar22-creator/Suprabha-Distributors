import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const identity = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => identity.headers }));
import { GET, POST } from '../../app/api/pricing/route';
import { normalizePriceOutcomes, type PriceOutcomes } from '../../lib/price-outcome-types';

const network = vi.fn<typeof fetch>();
const key = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  identity.headers = new Headers({ 'oai-authenticated-user-id': 'test-account', 'oai-authenticated-user-email': 'accounts@example.test' });
  vi.stubEnv('SUPABASE_URL', 'https://gateway.example.test');
  vi.stubEnv('STOCKFLOW_ORDER_GATEWAY_KEY', 'test-only-key');
  vi.stubGlobal('fetch', network);
  network.mockReset();
  network.mockResolvedValue(Response.json({ status: 'accepted' }));
});

describe('price outcome response boundary', () => {
  const valid: PriceOutcomes = {
    view: 'price_outcomes', asOf: '2026-11-18', toleranceRupees: 1, page: 1, pageSize: 10, total: 1,
    counts: { different: 1, not_billed: 0, matches: 0, cannot_match: 0 }, salesThrough: '2026-11-14', matureCount: 0,
    rows: [{ priceId: key, customerId: key, customerName: 'Test Customer', itemKey: 'Reagent', approvedPaise: 10000,
      effectiveFrom: '2026-10-27', validTo: null, state: 'different', reason: null, lines: 1, packLines: 0,
      lastBilledOn: '2026-11-14', lastBilledPaise: 9500, worstDiffPaise: -500, differentLines: 1 }],
  };
  it('accepts the complete rates-only response and nullable dates', () => {
    expect(normalizePriceOutcomes(valid)).toEqual(valid);
    expect(normalizePriceOutcomes({ ...valid, salesThrough: null, total: 0, rows: [] })).not.toBeNull();
  });
  it.each([
    ['priceId', 'unknown'], ['customerId', null], ['customerName', ''], ['itemKey', 1],
    ['approvedPaise', 100.5], ['effectiveFrom', '2026-02-30'], ['validTo', 'unknown'],
    ['state', 'unknown'], ['reason', 'unknown'], ['lines', -1], ['packLines', 0.5],
    ['lastBilledOn', '2026-13-01'], ['lastBilledPaise', Number.NaN], ['worstDiffPaise', -0.5], ['differentLines', 2],
  ])('fails closed for invalid row %s', (field, value) => {
    expect(normalizePriceOutcomes({ ...valid, rows: [{ ...valid.rows[0], [field]: value }] })).toBeNull();
  });
  it.each([
    ['view', 'unknown'], ['asOf', '2026-02-30'], ['toleranceRupees', 2], ['page', 0], ['pageSize', 20],
    ['total', -1], ['counts', { different: 0.5, not_billed: 0, matches: 0, cannot_match: 0 }],
    ['salesThrough', 'yesterday'], ['matureCount', 0.5], ['rows', null],
  ])('fails closed for invalid response %s', (field, value) => {
    expect(normalizePriceOutcomes({ ...valid, [field]: value })).toBeNull();
  });
  it('requires an enumerated reason for cannot-match rows', () => {
    expect(normalizePriceOutcomes({ ...valid, rows: [{ ...valid.rows[0], state: 'cannot_match', reason: null }] })).toBeNull();
    expect(normalizePriceOutcomes({ ...valid, rows: [{ ...valid.rows[0], state: 'cannot_match', reason: 'item_not_in_tally' }] })).not.toBeNull();
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('authenticated pricing API boundary (gateway responses simulated)', () => {
  it.each(['', '&page=2&state=different'])('forwards the exact outcomes payload %s', async query => {
    const result = await GET(new Request(`http://local/api/pricing?outcomes=1${query}`));
    expect(result.status).toBe(200);
    expect(JSON.parse(network.mock.calls[0][1]?.body as string)).toEqual({ actorEmail: 'accounts@example.test', action: 'get_order_pricing', payload: { view: 'price_outcomes', page: query ? 2 : 1, ...(query ? { state: 'different' } : {}) } });
    expect(result.headers.get('cache-control')).toBe('private, no-store');
  });
  it.each(['&state=unknown', '&state=', '&contracts=1', '&page=0', '&page=100001', '&page=1.5', '&page=1&page=2'])('rejects invalid outcomes filters %s', async query => {
    expect((await GET(new Request(`http://local/api/pricing?outcomes=1${query}`))).status).toBe(400);
    expect(network).not.toHaveBeenCalled();
  });
  it('denies unauthenticated reads and writes without contacting the gateway', async () => {
    identity.headers = new Headers();
    expect((await GET(new Request('http://local/api/pricing?policies=1'))).status).toBe(401);
    expect((await POST(new Request('http://local/api/pricing', { method: 'POST', body: '{}' }))).status).toBe(401);
    expect(network).not.toHaveBeenCalled();
  });
  it.each(['accounts@example.test', 'admin@example.test', 'management@example.test'])('uses trusted identity for %s, not a query impersonation', async email => {
    identity.headers.set('oai-authenticated-user-email', email);
    const result = await GET(new Request('http://local/api/pricing?contracts=1&actorEmail=other@example.test'));
    expect(result.status).toBe(200);
    const body = JSON.parse(network.mock.calls[0][1]?.body as string);
    expect(body.actorEmail).toBe(email);
    expect(body.action).toBe('list_price_contracts');
    expect(result.headers.get('cache-control')).toBe('private, no-store');
  });
  it.each(['sales', 'warehouse', 'viewer'])('preserves server denial for %s without returning pricing', async role => {
    identity.headers.set('oai-authenticated-user-email', `${role}@example.test`);
    network.mockResolvedValue(Response.json({ code: '42501', message: 'Pricing access denied' }, { status: 403 }));
    const result = await GET(new Request('http://local/api/pricing?policies=1'));
    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({ error: 'Pricing access denied' });
    expect(result.headers.get('cache-control')).toBe('private, no-store');
  });
  it('rejects malformed recovery requests before contacting the gateway', async () => {
    expect((await GET(new Request('http://local/api/pricing?recoveryKey=bad&pricingAction=create_pricing_policy'))).status).toBe(400);
    expect(network).not.toHaveBeenCalled();
  });
  it('keeps recovery GET read-only even if a close flag is supplied', async () => {
    await GET(new Request(`http://local/api/pricing?recoveryKey=${key}&pricingAction=create_pricing_policy&closeUnresolved=true`));
    expect(JSON.parse(network.mock.calls[0][1]?.body as string).payload).toEqual({ idempotencyKey: key, pricingAction: 'create_pricing_policy' });
  });
  it('allows explicit close POST only for the signed-in actor and approved action', async () => {
    const result = await POST(new Request('http://local/api/pricing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'close_unresolved_pricing', payload: { idempotencyKey: key, pricingAction: 'create_price_contract', actorEmail: 'other@example.test' } }) }));
    expect(result.status).toBe(200);
    expect(JSON.parse(network.mock.calls[0][1]?.body as string)).toEqual({ actorEmail: 'accounts@example.test', action: 'recover_order_submission', payload: { idempotencyKey: key, pricingAction: 'create_price_contract', closeUnresolved: true } });
  });
  it('does not leak unexpected internal error details', async () => {
    network.mockRejectedValue(new Error('restricted rate 720 internal failure'));
    const result = await GET(new Request('http://local/api/pricing?policies=1'));
    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({ error: 'Pricing service is temporarily unavailable' });
  });
  it('forwards an exact catalog group margin preview and rejects unknown groups', async () => {
    const invalid = await POST(new Request('http://local/api/pricing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'preview_customer_group_margin', payload: { customerId: key, itemGroup: 'SYS 480', grossMarginPercent: 30 } }) }));
    expect(invalid.status).toBe(400);
    expect(network).not.toHaveBeenCalled();
    const zero = await POST(new Request('http://local/api/pricing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'preview_customer_group_margin', payload: { customerId: key, itemGroup: 'Sysmex', grossMarginPercent: 0 } }) }));
    expect(zero.status).toBe(400);
    expect(network).not.toHaveBeenCalled();
    const valid = await POST(new Request('http://local/api/pricing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'preview_customer_group_margin', payload: { customerId: key, itemGroup: 'Sysmex', grossMarginPercent: 30 } }) }));
    expect(valid.status).toBe(200);
    expect(JSON.parse(network.mock.calls[0][1]?.body as string)).toEqual({ actorEmail: 'accounts@example.test', action: 'preview_customer_group_margin', payload: { customerId: key, itemGroup: 'Sysmex', grossMarginPercent: 30 } });
    expect(valid.headers.get('cache-control')).toBe('private, no-store');
  });
});

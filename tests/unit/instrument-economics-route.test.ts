import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), gateway: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/lib/order-gateway', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/order-gateway')>(), callOrderGateway: mocks.gateway }));
import { GET, POST } from '@/app/api/instrument-economics/route';

const jsonRequest = (value: unknown) => new Request('http://localhost/api/instrument-economics', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ email: 'staff@example.com' });
  mocks.session.mockResolvedValue({ email: 'staff@example.com', roles: ['accounts'] });
  mocks.gateway.mockResolvedValue({ targets: [], leakage: [] });
});

describe('instrument economics API', () => {
  it('registers an invoice-backed existing instrument only for Management', async () => {
    const command = { action: 'register_historical_instrument', payload: { sourceLineId: 'invoice-line', expectedSourceRevision: '2', customerId: 'customer', installedOn: '2026-07-30', serialNumber: 'SERIAL-01', reason: 'Confirmed installation record', expectedActorEmail: 'staff@example.com', idempotencyKey: 'historical-instrument-0001' } };
    expect((await POST(jsonRequest(command))).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
    mocks.session.mockResolvedValue({ email: 'staff@example.com', roles: ['management'] });
    expect((await POST(jsonRequest(command))).status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('staff@example.com', command.action, command.payload);
  });
  const recovery = { action: 'recover_economic_command', payload: { commandAction: 'record_capital', commandKey: 'economic-reference-0001', expectedActorEmail: 'staff@example.com', closeUnresolved: false } };
  it('allows accounts to check only their own status without returning a stored command', async () => {
    mocks.gateway.mockResolvedValue({ status: 'accepted' });
    const response = await POST(jsonRequest(recovery));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ status: 'accepted' });
    expect(mocks.gateway).toHaveBeenCalledWith('staff@example.com', 'recover_economic_command', { commandAction: 'record_capital', commandKey: 'economic-reference-0001', closeUnresolved: false });
  });
  it('denies another account and denies Accounts closing an unresolved request', async () => {
    for (const payload of [{ ...recovery.payload, expectedActorEmail: 'other@example.com' }, { ...recovery.payload, closeUnresolved: true }]) expect((await POST(jsonRequest({ ...recovery, payload }))).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('rejects invalid recovery actions, keys and close flags', async () => {
    for (const payload of [{ ...recovery.payload, commandAction: 'submit_order' }, { ...recovery.payload, commandKey: 'short' }, { ...recovery.payload, closeUnresolved: 'true' }]) expect((await POST(jsonRequest({ ...recovery, payload }))).status).toBe(400);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('lets Management fence its own unresolved request', async () => {
    mocks.session.mockResolvedValue({ email: 'staff@example.com', roles: ['management'] });
    mocks.gateway.mockResolvedValue({ status: 'not_saved' });
    const response = await POST(jsonRequest({ ...recovery, payload: { ...recovery.payload, closeUnresolved: true } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'not_saved' });
  });
  it('allows accounts to read the workspace without caching it', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).toHaveBeenCalledWith('staff@example.com', 'get_instrument_economics');
    expect(await response.json()).toMatchObject({ actorEmail: 'staff@example.com' });
  });

  it('measures authorized reads without changing financial response bytes or gateway scope', async () => {
    const workspace = { targets: [], leakage: [], knownGpPaise: '2300000', customer: 'आरोग्य Lab' };
    mocks.gateway.mockResolvedValue(workspace);
    const response = await GET();
    const expected = new TextEncoder().encode(JSON.stringify({ ...workspace, actorEmail: 'staff@example.com' }));
    expect(response.headers.get('server-timing')).toMatch(/^stockflow;dur=\d+\.\d, auth;dur=\d+\.\d, member;dur=\d+\.\d, rpc;dur=\d+\.\d, json;dur=\d+\.\d$/);
    expect(response.headers.get('x-stockflow-response-bytes')).toBe(String(expected.byteLength));
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(expected);
    expect(mocks.gateway).toHaveBeenCalledExactlyOnceWith('staff@example.com', 'get_instrument_economics');
  });

  it('keeps unauthenticated reads private and never measures or executes the financial RPC', async () => {
    mocks.user.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('server-timing')).toBeNull();
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.gateway).not.toHaveBeenCalled();
  });

  it('denies sales read access before calling the gateway', async () => {
    mocks.session.mockResolvedValue({ email: 'staff@example.com', roles: ['sales'] });
    const response = await GET();
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).not.toHaveBeenCalled();
  });

  it('requests an explicit canonical summary without widening gateway access', async () => {
    mocks.gateway.mockResolvedValue({ readView: 'summary', targets: [{ knownGpPaise: '1234', missingCostLines: 1 }] });
    const response = await GET(new Request('https://test.local/api/instrument-economics', { headers: { 'x-stockflow-economics-view': 'summary' } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).toHaveBeenCalledExactlyOnceWith('staff@example.com', 'get_instrument_economics', { view: 'summary' });
    expect(await response.json()).toMatchObject({ readView: 'summary', actorEmail: 'staff@example.com', targets: [{ knownGpPaise: '1234', missingCostLines: 1 }] });
  });

  it('fails visibly if the summary read model has not been deployed', async () => {
    mocks.gateway.mockResolvedValue({ targets: [] });
    const response = await GET(new Request('https://test.local/api/instrument-economics', { headers: { 'x-stockflow-economics-view': 'summary' } }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('summary is not available') });
  });

  it('rejects unknown read views without executing the financial RPC', async () => {
    const response = await GET(new Request('https://test.local/api/instrument-economics', { headers: { 'x-stockflow-economics-view': 'other' } }));
    expect(response.status).toBe(400); expect(mocks.gateway).not.toHaveBeenCalled();
  });

  it('allows management to post a validated command and forwards actor, action, and idempotency key', async () => {
    mocks.session.mockResolvedValue({ email: 'manager@example.com', roles: ['management'] });
    const payload = { idempotencyKey: 'request-key-123456', targetId: 'target-1', expectedActorEmail: 'manager@example.com' };
    const response = await POST(jsonRequest({ action: 'record_capital', payload }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.com', 'record_capital', payload);
  });

  it('forwards an acquisition revision review with the signed-in manager and source/version preconditions', async () => {
    mocks.session.mockResolvedValue({ email: 'manager@example.com', roles: ['management'] });
    const payload = { idempotencyKey: 'acquisition-review-123456', expectedActorEmail: 'manager@example.com', targetId: 'target-1', expectedVersion: 3, expectedSourceRevision: '7', confirmCancellation: true, reason: 'Reviewed supplier cancellation' };
    const response = await POST(jsonRequest({ action: 'review_acquisition', payload }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).toHaveBeenCalledWith('manager@example.com', 'review_acquisition', payload);
  });

  it('rejects a missing or different loaded account before sending a financial mutation', async () => {
    mocks.session.mockResolvedValue({ email: 'manager@example.com', roles: ['management'] });
    for (const expectedActorEmail of [undefined, 'another-manager@example.com']) {
      const response = await POST(jsonRequest({ action: 'record_capital', payload: { idempotencyKey: 'request-key-123456', expectedActorEmail } }));
      expect(response.status).toBe(403);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(mocks.gateway).not.toHaveBeenCalled();
    }
  });

  it('denies accounts and sales from posting commands', async () => {
    for (const roles of [['accounts'], ['sales']]) {
      mocks.session.mockResolvedValue({ email: 'staff@example.com', roles });
      const response = await POST(jsonRequest({ action: 'rebuild', payload: { idempotencyKey: 'request-key-123456' } }));
      expect(response.status).toBe(403);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(mocks.gateway).not.toHaveBeenCalled();
  });

  it('rejects malformed commands without calling the gateway', async () => {
    mocks.session.mockResolvedValue({ email: 'manager@example.com', roles: ['management'] });
    const response = await POST(jsonRequest({ action: 'unknown', payload: { idempotencyKey: 'short' } }));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).not.toHaveBeenCalled();
  });

  it('rejects oversized commands without calling the gateway', async () => {
    mocks.session.mockResolvedValue({ email: 'manager@example.com', roles: ['management'] });
    const response = await POST(jsonRequest({ action: 'create_case', payload: { idempotencyKey: 'request-key-123456', details: 'x'.repeat(33_000) } }));
    expect(response.status).toBe(413);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.gateway).not.toHaveBeenCalled();
  });

  it('preserves gateway errors and returns unexpected failures as uncached 502 responses', async () => {
    const { OrderGatewayError } = await import('@/lib/order-gateway');
    mocks.gateway.mockRejectedValueOnce(new OrderGatewayError('Gateway unavailable', 503));
    const known = await GET();
    expect(known.status).toBe(503);
    expect(known.headers.get('cache-control')).toBe('private, no-store');

    mocks.gateway.mockRejectedValueOnce(new Error('unexpected'));
    const unknown = await GET();
    expect(unknown.status).toBe(502);
    expect(await unknown.json()).toEqual({ error: 'Instrument economics is temporarily unavailable' });
    expect(unknown.headers.get('cache-control')).toBe('private, no-store');
  });
});

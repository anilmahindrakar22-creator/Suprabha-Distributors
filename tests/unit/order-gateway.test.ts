import { afterEach, describe, expect, it, vi } from 'vitest';
import { callOrderGateway, OrderGatewayError } from '../../lib/order-gateway';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.restoreAllMocks();
});

function configureEnvironment() {
  process.env.SUPABASE_URL = 'https://database.example';
  process.env.STOCKFLOW_ORDER_GATEWAY_KEY = 'gateway-test-key';
}

describe('order gateway client', () => {
  it('keeps credentials in the server request and returns the result', async () => {
    configureEnvironment();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ orders: [] }),
    );

    await expect(callOrderGateway('user@example.com', 'bootstrap')).resolves.toEqual({
      orders: [],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://database.example/functions/v1/stockflow-orders',
    );
    expect(JSON.parse(String(request?.body))).toMatchObject({
      actorEmail: 'user@example.com',
      action: 'bootstrap',
    });
  });

  it('supports the lightweight session action used for dynamic membership', async () => {
    configureEnvironment();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ email: 'user@example.com', role: 'sales' }),
    );
    await expect(callOrderGateway('user@example.com', 'session')).resolves.toEqual({
      email: 'user@example.com', role: 'sales',
    });
  });

  it('fails safely when hosting configuration is absent', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.STOCKFLOW_ORDER_GATEWAY_KEY;
    await expect(callOrderGateway('user@example.com', 'bootstrap')).rejects.toMatchObject({
      status: 503,
    });
  });

  it.each([
    ['42501', 403],
    ['40001', 409],
    ['54000', 429],
    ['22023', 400],
  ])('maps database code %s to HTTP %s', async (code, status) => {
    configureEnvironment();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ message: 'Controlled failure', code }, { status: 400 }),
    );
    await expect(callOrderGateway('user@example.com', 'bootstrap')).rejects.toEqual(
      new OrderGatewayError('Controlled failure', status),
    );
  });
});

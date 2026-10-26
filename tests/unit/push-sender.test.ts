import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { runSweep, type DueRow, type SweepDependencies } from '../../supabase/functions/stockflow-push/sweep.ts';

const row = (id = 0): DueRow => ({
  claim_id: `12345678-1234-4234-8234-${String(id).padStart(12, '0')}`,
  event_id: `event-${id}`,
  recipient_email: `staff-${id}@example.test`,
  endpoint: `https://push.example.test/secret-endpoint-${id}`,
  p256dh: 'test-public-key',
  auth: 'test-auth-key',
  endpoint_hash: `hash-${id}`,
  title: 'Care Hospital · SF-26-1043',
  body: 'Packed · ready for Tally billing',
  order_id: '12345678-1234-1234-1234-123456789abc',
  order_number: 'SF-26-1043',
});

function dependencies(rows = [row()]) {
  return {
    due: vi.fn<SweepDependencies['due']>().mockResolvedValue({ rows }),
    record: vi.fn<SweepDependencies['record']>().mockResolvedValue(undefined),
    send: vi.fn<SweepDependencies['send']>().mockResolvedValue({ statusCode: 201 }),
  };
}

describe('push sender sweep', () => {
  it('maps statuses and throws, fetches 200, and records all results once', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(i));
    const deps = dependencies(rows);
    for (const statusCode of [201, 200, 204, 299, 404, 410, 500]) deps.send.mockResolvedValueOnce({ statusCode });
    deps.send.mockRejectedValueOnce(new Error(`Failed to send to ${rows[7].endpoint}`));

    await expect(runSweep(deps)).resolves.toEqual({ due: 8, sent: 4, gone: 2, failed: 2 });
    expect(deps.due).toHaveBeenCalledExactlyOnceWith(200);
    expect(deps.record).toHaveBeenCalledTimes(1);
    const results = deps.record.mock.calls[0][0];
    expect(results.map(({ outcome }) => outcome)).toEqual(['sent', 'sent', 'sent', 'sent', 'gone', 'gone', 'failed', 'failed']);
    for (let index = 0; index < rows.length; index++) {
      expect(results[index]).toEqual({
        claimId: rows[index].claim_id,
        eventId: rows[index].event_id,
        recipientEmail: rows[index].recipient_email,
        endpointHash: rows[index].endpoint_hash,
        outcome: results[index].outcome,
        ...(index === 6 ? { error: 'Push service HTTP 500' } : index === 7 ? { error: 'Push delivery failed' } : {}),
      });
    }
  });

  it('sends the exact service-worker payload, subscription keys and TTL', async () => {
    const deps = dependencies();
    await runSweep(deps);
    const [subscription, payloadJson, ttl] = deps.send.mock.calls[0];
    expect(subscription).toEqual({ endpoint: row().endpoint, keys: { p256dh: row().p256dh, auth: row().auth } });
    expect(ttl).toBe(3600);
    const payload = JSON.parse(payloadJson);
    expect(payload).toEqual({ title: row().title, body: row().body, orderId: row().order_id, orderNumber: row().order_number });

    // Exercise the real readPushPayload function without running SW event hooks.
    const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
    const readPushPayload = runInNewContext(`${source}\nreadPushPayload`, { self: { addEventListener() {} } });
    expect(readPushPayload({ data: { json: () => payload } })).toEqual(payload);
  });

  it('caps concurrency at ten and records only after every send settles', async () => {
    const deps = dependencies(Array.from({ length: 200 }, (_, i) => row(i)));
    const pending: Array<() => void> = [];
    let active = 0;
    let maximum = 0;
    deps.send.mockImplementation(() => new Promise((resolve) => {
      active++;
      maximum = Math.max(maximum, active);
      pending.push(() => { active--; resolve({ statusCode: 201 }); });
    }));
    const sweep = runSweep(deps);
    await Promise.resolve();
    expect(active).toBe(10);
    for (let batch = 0; batch < 20; batch++) {
      expect(deps.record).not.toHaveBeenCalled();
      expect(pending).toHaveLength(10);
      // Reverse completion also exercises stable row/result association.
      pending.splice(0).reverse().forEach((finish) => finish());
      await Promise.resolve();
    }
    await expect(sweep).resolves.toEqual({ due: 200, sent: 200, gone: 0, failed: 0 });
    expect(maximum).toBe(10);
    expect(active).toBe(0);
    expect(deps.send).toHaveBeenCalledTimes(200);
    expect(deps.record).toHaveBeenCalledTimes(1);
    expect(deps.record.mock.calls[0][0].map(({ eventId }) => eventId)).toEqual(Array.from({ length: 200 }, (_, i) => `event-${i}`));
  });

  it.each([
    new Error(`Provider failed: ${row().endpoint} ${'x'.repeat(200)}`),
    { statusCode: 410, endpoint: row().endpoint, body: row().endpoint },
    row().endpoint,
    null,
  ])('does not leak thrown values into recorded errors (%#)', async (error) => {
    const deps = dependencies();
    deps.send.mockRejectedValue(error);
    await expect(runSweep(deps)).resolves.toEqual({ due: 1, sent: 0, gone: 0, failed: 1 });
    const result = deps.record.mock.calls[0][0][0];
    expect(result.error).toBe('Push delivery failed');
    expect(result.error!.length).toBeLessThanOrEqual(120);
    expect(JSON.stringify(result)).not.toContain(row().endpoint);
    expect(JSON.stringify(result)).not.toContain(row().auth);
  });

  it.each([500, 429, 302, 199, NaN, Infinity, 200.5])('records a short safe failure for status %s', async (statusCode) => {
    const deps = dependencies();
    deps.send.mockResolvedValue({ statusCode });
    await runSweep(deps);
    const result = deps.record.mock.calls[0][0][0];
    expect(result.outcome).toBe('failed');
    expect(result.error!.length).toBeLessThanOrEqual(120);
    expect(result.error).not.toContain(row().endpoint);
  });

  it('records an empty sweep once without sending', async () => {
    const deps = dependencies([]);
    await expect(runSweep(deps)).resolves.toEqual({ due: 0, sent: 0, gone: 0, failed: 0 });
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.record).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('does not send or record if due fails', async () => {
    const deps = dependencies();
    deps.due.mockRejectedValue(new Error('RPC unavailable'));
    await expect(runSweep(deps)).rejects.toThrow('RPC unavailable');
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.record).not.toHaveBeenCalled();
  });

  it('does not report success if recording fails', async () => {
    const deps = dependencies();
    deps.record.mockRejectedValue(new Error('RPC unavailable'));
    await expect(runSweep(deps)).rejects.toThrow('RPC unavailable');
    expect(deps.record).toHaveBeenCalledTimes(1);
  });
});

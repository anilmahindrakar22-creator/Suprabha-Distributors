import { describe, expect, it, vi } from 'vitest';
import { readOfflineOrderDraft, writeOfflineOrderDraft, type OfflineOrderDraft } from '../../lib/offline-order-drafts';
import { retryPendingOfflineOrder } from '../../lib/offline-order-retry';

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
}

const pending: OfflineOrderDraft = {
  schemaVersion: 1,
  actorEmail: 'sales@example.com',
  state: 'pending',
  updatedAt: new Date().toISOString(),
  command: { action: 'create_order', payload: { idempotencyKey: '1234567890abcdef', customerName: 'City Lab', source: 'phone', lines: [{ tallyKey: 'KIT-1', quantity: 2 }] } },
};

describe('pending offline order recovery', () => {
  it('submits the saved command unchanged and removes it after acknowledgement', async () => {
    const storage = memoryStorage();
    writeOfflineOrderDraft(storage, pending);
    let sentBody = '';
    const fetchFn: typeof fetch = vi.fn(async (_input, init) => {
      sentBody = String(init?.body || '');
      return Response.json({ orderNumber: 'SF-100' });
    });

    await expect(retryPendingOfflineOrder(storage, pending.actorEmail, fetchFn)).resolves.toEqual({ status: 'sent', orderNumber: 'SF-100' });
    expect(JSON.parse(sentBody)).toEqual(pending.command);
    expect(readOfflineOrderDraft(storage, pending.actorEmail)).toBeNull();
  });

  it('keeps the same pending request through network and temporary server failures', async () => {
    const storage = memoryStorage();
    writeOfflineOrderDraft(storage, pending);
    await expect(retryPendingOfflineOrder(storage, pending.actorEmail, async () => { throw new TypeError('offline'); })).resolves.toEqual({ status: 'retry_later' });
    expect(readOfflineOrderDraft(storage, pending.actorEmail)?.command.payload.idempotencyKey).toBe('1234567890abcdef');
    await expect(retryPendingOfflineOrder(storage, pending.actorEmail, async () => Response.json({ error: 'busy' }, { status: 503 }))).resolves.toEqual({ status: 'retry_later' });
    expect(readOfflineOrderDraft(storage, pending.actorEmail)?.state).toBe('pending');
  });

  it('stops automatic retries when sign-in, access, or data needs attention', async () => {
    const storage = memoryStorage();
    writeOfflineOrderDraft(storage, pending);
    const result = await retryPendingOfflineOrder(storage, pending.actorEmail, async () => Response.json({ error: 'Product is inactive' }, { status: 400 }));
    expect(result).toEqual({ status: 'needs_attention', message: 'Product is inactive' });
    expect(readOfflineOrderDraft(storage, pending.actorEmail)).toMatchObject({ state: 'error', error: 'Product is inactive' });
  });

  it('resolves a conflict by confirming the original accepted order', async () => {
    const storage = memoryStorage();
    writeOfflineOrderDraft(storage, pending);
    const fetchFn: typeof fetch = vi.fn(async (input) => String(input).includes('/recovery')
      ? Response.json({ status: 'accepted', orderNumber: 'SF-200' })
      : Response.json({ error: 'Submission key conflict' }, { status: 409 }));
    await expect(retryPendingOfflineOrder(storage, pending.actorEmail, fetchFn)).resolves.toEqual({ status: 'sent', orderNumber: 'SF-200' });
    expect(readOfflineOrderDraft(storage, pending.actorEmail)).toBeNull();
  });

  it('retains a conflicting draft when the server cannot confirm an order', async () => {
    const storage = memoryStorage();
    writeOfflineOrderDraft(storage, pending);
    const fetchFn: typeof fetch = vi.fn(async (input) => String(input).includes('/recovery')
      ? Response.json({ status: 'not_found' })
      : Response.json({ error: 'Submission key conflict' }, { status: 409 }));
    await expect(retryPendingOfflineOrder(storage, pending.actorEmail, fetchFn)).resolves.toEqual({ status: 'needs_attention', message: 'Submission key conflict' });
    expect(readOfflineOrderDraft(storage, pending.actorEmail)).toMatchObject({ state: 'error', error: 'Submission key conflict' });
  });

  it('does nothing for a draft that was not submitted', async () => {
    const storage = memoryStorage();
    writeOfflineOrderDraft(storage, { ...pending, state: 'draft' });
    const fetchFn = vi.fn();
    await expect(retryPendingOfflineOrder(storage, pending.actorEmail, fetchFn)).resolves.toEqual({ status: 'none' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

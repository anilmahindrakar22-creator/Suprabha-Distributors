import { afterEach, expect, it, vi } from 'vitest';
import { startWorkNotifications, type WorkNotificationState } from '@/lib/work-notifications';

afterEach(() => vi.useRealTimers());

it('reconciles another user replacing a waiting order even when summary counts stay equal', async () => {
  vi.useFakeTimers();
  let revision = 'a'.repeat(32);
  let id = 'old';
  const states: WorkNotificationState[] = [];
  const service = startWorkNotifications({
    actorEmail: 'accounts@example.test', roles: ['accounts'], active: () => true, online: () => true,
    onState: (state) => states.push(state),
    fetchJson: async (url) => {
      if (url.includes('summary=1')) return Response.json({ operations: { packed: 1 }, orderRevision: revision });
      const params = new URL(url, 'https://example.test').searchParams;
      const rows = params.get('status') === 'packed' && !params.get('query') ? [{ id, orderNumber: `SF-${id}`, customerName: 'Lab', status: 'packed', updatedAt: '2026-10-11T09:00:00Z' }] : [];
      return Response.json({ orders: rows, pagination: { total: rows.length } });
    },
  });
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)?.work.map((item) => item.orderId)).toEqual(['old']);
    id = 'new'; revision = 'b'.repeat(32);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(states.at(-1)?.work.map((item) => item.orderId)).toEqual(['new']);
    expect(states.at(-1)?.fresh.map((item) => item.orderId)).toEqual(['new']);
  } finally { service.stop(); }
});

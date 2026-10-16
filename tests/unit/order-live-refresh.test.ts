import { afterEach, expect, it, vi } from 'vitest';
import { startOrderLiveRefresh } from '@/lib/order-live-refresh';

afterEach(() => vi.useRealTimers());
it('reloads on changed revision only, and pauses offline/hidden', async () => {
  vi.useFakeTimers();
  let revision = 'a'.repeat(32); let active = true; let online = true;
  const refresh = vi.fn(async () => undefined);
  const fetchSummary = vi.fn(async () => Response.json({ orderRevision: revision }));
  const service = startOrderLiveRefresh({ fetchSummary, refresh, onError: vi.fn(), active: () => active, online: () => online, canRefresh: () => true });
  try {
    await vi.advanceTimersByTimeAsync(1_000); expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000); expect(refresh).toHaveBeenCalledTimes(1);
    revision = 'b'.repeat(32);
    await vi.advanceTimersByTimeAsync(15_000); expect(refresh).toHaveBeenCalledTimes(2);
    active = false; service.wake();
    await vi.advanceTimersByTimeAsync(60_000); expect(refresh).toHaveBeenCalledTimes(2);
    active = true; online = false; service.wake();
    await vi.advanceTimersByTimeAsync(60_000); expect(refresh).toHaveBeenCalledTimes(2);
    online = true; revision = 'c'.repeat(32); service.wake();
    await vi.advanceTimersByTimeAsync(0); expect(refresh).toHaveBeenCalledTimes(3);
  } finally { service.stop(); }
});
it('retries a failed page read without accepting its revision and stops on denied access', async () => {
  vi.useFakeTimers();
  let status = 200;
  const refresh = vi.fn().mockRejectedValueOnce(new Error('page down')).mockResolvedValue(undefined);
  const error = vi.fn();
  const fetchSummary = vi.fn(async () => Response.json({ orderRevision: 'a'.repeat(32) }, { status }));
  const service = startOrderLiveRefresh({ fetchSummary, refresh, onError: error, active: () => true, online: () => true, canRefresh: () => true });
  try {
    await vi.advanceTimersByTimeAsync(1_000); expect(error).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000); expect(refresh).toHaveBeenCalledTimes(2);
    status = 403;
    await vi.advanceTimersByTimeAsync(15_000);
    const calls = fetchSummary.mock.calls.length;
    service.wake(); await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchSummary).toHaveBeenCalledTimes(calls);
  } finally { service.stop(); }
});
it('allows only one check and ignores a response after stop', async () => {
  vi.useFakeTimers();
  let resolve!: (response: Response) => void;
  const fetchSummary = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
  const refresh = vi.fn(async () => undefined);
  const service = startOrderLiveRefresh({ fetchSummary, refresh, onError: vi.fn(), active: () => true, online: () => true, canRefresh: () => true });
  await vi.advanceTimersByTimeAsync(1_000);
  service.wake(); expect(fetchSummary).toHaveBeenCalledTimes(1);
  service.stop(); resolve(Response.json({ orderRevision: 'a'.repeat(32) }));
  await vi.advanceTimersByTimeAsync(0); expect(refresh).not.toHaveBeenCalled();
});

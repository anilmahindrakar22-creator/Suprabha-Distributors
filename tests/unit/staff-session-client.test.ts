import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkStaffSession, resumeStaffSession, withStaffSessionLock } from '../../lib/staff-session-client';

afterEach(() => vi.unstubAllGlobals());
function browser() {
  let queue = Promise.resolve();
  vi.stubGlobal('navigator', { locks: { request: (_name: string, _options: unknown, operation: () => Promise<unknown>) => {
    const next = queue.then(operation);
    queue = next.then(() => undefined, () => undefined);
    return next;
  } } });
}
describe('staff session client', () => {
  it('does not rotate a valid session on foreground verification', async () => {
    browser();
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true, renewAfterSeconds: 900 }));
    vi.stubGlobal('fetch', fetch);
    expect(await checkStaffSession()).toBe(900);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/api/staff-auth');
  });
  it('renews before expiry when scheduled renewal is due', async () => {
    browser();
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(Response.json({ ok: true, renewAfterSeconds: 3000 }));
    vi.stubGlobal('fetch', fetch);
    expect(await checkStaffSession(true)).toBe(3000);
    expect(fetch.mock.calls[0][0]).toBe('/api/staff-auth/refresh');
  });
  it('does not retry uncertain verification failure', async () => {
    browser();
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    await expect(checkStaffSession()).rejects.toThrow('unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('renews once for simultaneous reopening and confirms the resulting cookie', async () => {
    browser();
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    expect(await Promise.all([resumeStaffSession(), resumeStaffSession()])).toEqual([true, true]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe('/api/staff-auth/refresh');
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' });
  });
  it.each([401, 403])('does not retry rejected renewal (%s)', async status => {
    browser();
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status }));
    vi.stubGlobal('fetch', fetch);
    expect(await resumeStaffSession()).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('reports provider outage without repeated requests', async () => {
    browser();
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    await expect(resumeStaffSession()).rejects.toThrow('unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('orders sign-out after an in-flight renewal', async () => {
    browser();
    const events: string[] = [];
    let finish!: () => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(async () => {
      events.push('renew');
      await new Promise<void>(resolve => { finish = resolve; });
      return new Response('{}');
    }).mockResolvedValueOnce(Response.json({ ok: true })));
    const renewing = resumeStaffSession();
    await Promise.resolve();
    const logout = withStaffSessionLock(async () => { events.push('logout'); });
    expect(events).toEqual(['renew']);
    finish();
    await Promise.all([renewing, logout]);
    expect(events).toEqual(['renew', 'logout']);
  });
  it('does not rotate credentials without browser locking support', async () => {
    vi.stubGlobal('navigator', {});
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await resumeStaffSession()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

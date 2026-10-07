import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOfflineVault, saveOfflineVault } from '../../lib/offline-vault-storage';
function storage() {
  let raw: string | null = null;
  return { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
}
beforeEach(() => {
  let queue = Promise.resolve();
  vi.stubGlobal('navigator', { locks: { request: (_name: string, callback: () => unknown) => {
    const result = queue.then(callback);
    queue = result.then(() => undefined, () => undefined);
    return result;
  } } });
});
afterEach(() => vi.unstubAllGlobals());
describe('encrypted offline persistence', () => {
  it('allows only one concurrent first save', async () => {
    const device = storage();
    const results = await Promise.allSettled([
      saveOfflineVault(device, { draft: 'one' }, '123456', null),
      saveOfflineVault(device, { draft: 'two' }, '123456', null),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
  it('fails safely when cross-tab locking is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    await expect(saveOfflineVault(storage(), {}, '123456', null)).rejects.toThrow('cannot safely save');
  });
  it('preserves the exact pending command and revision across reopening', async () => {
    const device = storage();
    const value = { actorEmail: 'a@example.com', state: 'pending', command: { idempotencyKey: 'original', quantity: 2 } };
    const revision = await saveOfflineVault(device, value, '123456', null);
    expect(await loadOfflineVault(device, '123456')).toEqual({ revision, value });
    expect(device.getItem()).not.toContain('a@example.com');
    expect(device.getItem()).not.toContain('original');
  });
  it('refuses stale updates and leaves the saved command unchanged', async () => {
    const device = storage();
    await saveOfflineVault(device, { command: 'first' }, '123456', null);
    const before = device.getItem();
    await expect(saveOfflineVault(device, { command: 'second' }, '123456', null)).rejects.toThrow('changed');
    expect(device.getItem()).toBe(before);
  });
  it('does not erase existing data after storage failure or wrong PIN', async () => {
    const device = storage();
    const revision = await saveOfflineVault(device, { draft: 'keep' }, '123456', null);
    const before = device.getItem();
    await expect(saveOfflineVault({ ...device, setItem: () => { throw new Error('Quota'); } }, {}, '123456', revision)).rejects.toThrow('Quota');
    await expect(loadOfflineVault(device, '654321')).rejects.toThrow('Unable to unlock');
    expect(device.getItem()).toBe(before);
  });
});

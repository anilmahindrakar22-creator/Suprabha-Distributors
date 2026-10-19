import { describe, expect, it } from 'vitest';
import { openOfflineVault, sealOfflineVault } from '../../lib/offline-pin-vault';

describe('offline PIN encryption boundary', () => {
  it('round trips drafts without storing customer details, PIN or key in the envelope', async () => {
    const draft = { actorEmail: 'staff@example.com', customer: 'Private customer', idempotencyKey: 'unchanged-key' };
    const envelope = await sealOfflineVault(draft, '123456');
    expect(await openOfflineVault(envelope, '123456')).toEqual(draft);
    expect(Object.keys(envelope).sort()).toEqual(['ciphertext', 'iv', 'salt', 'version']);
    expect(JSON.stringify(envelope)).not.toContain('Private customer');
    expect(JSON.stringify(envelope)).not.toContain('staff@example.com');
  });
  it('uses independent salts and nonces for repeated saves', async () => {
    const first = await sealOfflineVault({ draft: 1 }, '123456');
    const second = await sealOfflineVault({ draft: 1 }, '123456');
    expect(first.salt).not.toBe(second.salt);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });
  it('rejects wrong PIN, tampering and unsupported formats', async () => {
    const envelope = await sealOfflineVault({ draft: 1 }, '123456');
    await expect(openOfflineVault(envelope, '654321')).rejects.toThrow('Unable to unlock');
    await expect(openOfflineVault({ ...envelope, ciphertext: 'AAAA' }, '123456')).rejects.toThrow('Unable to unlock');
    await expect(openOfflineVault({ ...envelope, version: 2 } as never, '123456')).rejects.toThrow('Unable to unlock');
  });
  it.each(['12345', 'abcdef', '12 3456', '1'.repeat(65)])('rejects invalid PIN %s', async (pin) => {
    await expect(sealOfflineVault({}, pin)).rejects.toThrow('6 to 64 digits');
  });
});

import { describe, expect, it } from 'vitest';
import { calculateTestVolume } from '@/lib/wallet-test-volume';

describe('calculateTestVolume', () => {
  it('calculates routine and special monthly volume in paise', () => {
    expect(calculateTestVolume(80, 26, 2500)).toBe(5200000);
    expect(calculateTestVolume(80, 26, 2500, 100, 30000)).toBe(8200000);
  });

  it('rejects a partial special pair and values outside their ranges', () => {
    expect(calculateTestVolume(80, 26, 2500, 100)).toBeNull();
    expect(calculateTestVolume(80, 26, 2500, undefined, 30000)).toBeNull();
    expect(calculateTestVolume(80, 26, 2500, 0, 30000)).toBeNull();
    expect(calculateTestVolume(80, 26, 2500, 100, 100000001)).toBeNull();
  });
});

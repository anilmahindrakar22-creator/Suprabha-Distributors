import { describe, expect, it } from 'vitest';
import { niceTicks } from '../../lib/chart-ticks';

describe('niceTicks', () => {
  it('uses readable bounded intervals', () => {
    expect(niceTicks(0, 6.05).ticks).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(-23, 31).ticks).toEqual([-40, -20, 0, 20, 40]);
    expect(niceTicks(0, 0.9).ticks).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('handles an equal range without NaN', () => {
    const result = niceTicks(5, 5);
    expect(result.ticks.length).toBeGreaterThan(0);
    expect(result.ticks.every(Number.isFinite)).toBe(true);
  });
});

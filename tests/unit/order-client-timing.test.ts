import { afterEach, describe, expect, it } from 'vitest';
import { recordOrderClientTiming } from '@/lib/order-client-timing';

afterEach(() => {
  performance.clearMeasures('order_open_ms');
  performance.clearMeasures('order_list_ms');
  performance.clearMeasures('order_save_ms');
});

describe('browser order timings', () => {
  it('records elapsed time without any network or storage dependency', () => {
    const startedAt = performance.now() - 10;
    recordOrderClientTiming('order_open_ms', startedAt);
    const [entry] = performance.getEntriesByName('order_open_ms', 'measure');
    expect(entry.duration).toBeGreaterThanOrEqual(10);
  });

  it('bounds retained samples and ignores invalid starts', () => {
    for (let index = 0; index < 51; index += 1) recordOrderClientTiming('order_save_ms', performance.now());
    expect(performance.getEntriesByName('order_save_ms', 'measure')).toHaveLength(1);
    recordOrderClientTiming('order_save_ms', Number.NaN);
    expect(performance.getEntriesByName('order_save_ms', 'measure')).toHaveLength(1);
  });
});

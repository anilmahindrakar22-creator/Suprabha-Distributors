import { describe, expect, it } from 'vitest';
import { fitWithin } from '../../lib/logo-resize';

describe('fitWithin', () => {
  it.each([
    [1200, 400, 600, 200],
    [300, 100, 300, 100],
    [400, 1000, 80, 200],
    [5000, 10, 600, 1],
  ])('fits %i by %i without upscaling', (w, h, width, height) => {
    expect(fitWithin(w, h, 600, 200)).toEqual({ width, height });
  });
});

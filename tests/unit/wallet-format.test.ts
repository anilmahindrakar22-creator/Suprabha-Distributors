import { describe, expect, it } from 'vitest';
import { formatPaise, permilleLabel, rupeesToPaise } from '../../lib/wallet-format';

describe('wallet money', () => {
  it('parses decimal rupees exactly within the contract range', () => {
    for (const [text, value] of [['0', 0], ['0.29', 29], ['12.3', 1230], [' 100.01 ', 10001], ['90000000000000', 9000000000000000]] as const) expect(rupeesToPaise(text)).toBe(value);
    for (const text of ['', '-1', '1.001', '1e3', '1,000', '.5', '1.', 'Infinity', '90000000000000.01']) expect(rupeesToPaise(text)).toBeNull();
  });
  it('uses Indian grouping and header-only shorthand', () => {
    expect(formatPaise(42000000)).toBe('₹4,20,000');
    expect(formatPaise(42000000, true)).toBe('₹4.2 L');
    expect(formatPaise(1230000000, true)).toBe('₹1.2 Cr');
    expect(formatPaise(123456789)).toBe('₹12,34,567.89');
    expect(formatPaise(-101)).toBe('−₹1.01');
    expect(permilleLabel(805)).toBe('80.5%');
    expect(permilleLabel(0)).toBe('0%');
  });
});

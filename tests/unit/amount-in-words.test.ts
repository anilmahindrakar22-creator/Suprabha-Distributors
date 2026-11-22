import { describe, expect, it } from 'vitest';
import { rupeesInWords } from '../../lib/amount-in-words';

describe('rupeesInWords', () => {
  it.each([
    [0, 'Rupees Zero Only'], [100, 'Rupees One Only'],
    [9905, 'Rupees Ninety-Nine and Five Paise Only'],
    [10000000, 'Rupees One Lakh Only'],
    [123456789050, 'Rupees One Hundred Twenty-Three Crore Forty-Five Lakh Sixty-Seven Thousand Eight Hundred Ninety and Fifty Paise Only'],
    [1, 'Rupees Zero and One Paise Only'], [2000, 'Rupees Twenty Only'],
    [100000, 'Rupees One Thousand Only'], [10000, 'Rupees One Hundred Only'],
  ])('converts %s paise', (paise, expected) => {
    expect(rupeesInWords(paise)).toBe(expected);
  });
  it.each([-1, 1.5, NaN, Infinity, -Infinity])('rejects invalid paise %s', paise => {
    expect(() => rupeesInWords(paise)).toThrow();
  });
});

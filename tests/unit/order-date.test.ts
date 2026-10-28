import { describe, expect, it } from 'vitest';
import { orderDateLabel, orderDateTime } from '@/lib/order-date';

// 18 Oct 2026, 3:00 pm IST.
const now = new Date('2026-10-18T09:30:00Z');

describe('orderDateLabel', () => {
  it('shows the time for orders captured today in IST', () => {
    expect(orderDateLabel('2026-10-18T04:00:00Z', now)).toMatch(/^9:30\s?am$/i);
    // 17 Oct 7:00 pm UTC is already 18 Oct 12:30 am IST.
    expect(orderDateLabel('2026-10-17T19:00:00Z', now)).toMatch(/^12:30\s?am$/i);
  });
  it('shows Yesterday, then day and month, then the year for older orders', () => {
    expect(orderDateLabel('2026-10-17T06:00:00Z', now)).toBe('Yesterday');
    expect(orderDateLabel('2026-10-16T06:00:00Z', now)).toBe('16 Oct');
    expect(orderDateLabel('2025-12-30T06:00:00Z', now)).toBe('30 Dec 2025');
  });
  it('returns empty text for an invalid date', () => {
    expect(orderDateLabel('not a date', now)).toBe('');
    expect(orderDateTime('not a date')).toBe('');
  });
  it('gives the full IST date and time', () => {
    expect(orderDateTime('2026-10-16T09:00:00Z')).toMatch(/^16 Oct 2026, 2:30\s?pm$/i);
  });
});

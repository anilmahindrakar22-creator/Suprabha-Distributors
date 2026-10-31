import { describe, expect, it } from 'vitest';
import { checkinMessage, parseCheckinResult, parseSheetCheckin } from '@/lib/checkin';

const result = { checkinId: 'checkin-1', checkedInAt: '2026-10-30T05:12:00Z', verified: true, distanceM: 40, hasPin: true };
describe('check-in responses', () => {
  it('keeps server verification and drops coordinates from the display model', () => {
    expect(parseCheckinResult({ ...result, latitude: 17.3, longitude: 76.8 })).toEqual(result);
    expect(parseSheetCheckin({ tiles: { lastVisit: { checkin: result } } })).toEqual({ verified: true, distanceM: 40, checkedInAt: result.checkedInAt });
    expect(parseSheetCheckin({})).toBeNull();
  });
  it('rejects malformed or inconsistent responses', () => {
    for (const change of [{ verified: 'true' }, { distanceM: -1 }, { distanceM: Infinity }, { checkedInAt: 'bad' }, { hasPin: false }, { distanceM: null }, { checkinId: '' }]) expect(() => parseCheckinResult({ ...result, ...change })).toThrow();
  });
  it('formats verified, distant, weak and unpinned results', () => {
    expect(checkinMessage(result, 14)).toBe('Checked in · 40 m from lab ✓');
    expect(checkinMessage({ ...result, verified: false, distanceM: 1200 }, 14)).toBe('Checked in · 1.2 km from the lab pin');
    expect(checkinMessage({ ...result, verified: false }, 300)).toBe('Checked in · GPS too weak (±300 m)');
    expect(checkinMessage({ ...result, verified: false, hasPin: false, distanceM: null }, 300)).toBe('Checked in · lab not pinned yet');
  });
});

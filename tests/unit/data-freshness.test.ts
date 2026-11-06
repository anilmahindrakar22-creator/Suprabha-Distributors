import { describe, expect, it, vi } from 'vitest';
import { dataFreshness, economicsNotice, officeMinutesBetween } from '../../lib/data-freshness';

const freshness = (from: string, to: string) => dataFreshness(from, new Date(to));
const minutes = (from: string, to: string) => officeMinutesBetween(new Date(from), new Date(to));

describe('Economics update notice', () => {
  const now = new Date('2026-11-08T09:30:00Z'); // Sunday: use real minutes, not office minutes.

  it('reports a paused update', () => {
    expect(economicsNotice({ state: 'paused', pendingSince: null }, now)).toBe('Economics update is paused. Figures may be out of date.');
  });

  it('warns at 30 real minutes, but not at 29', () => {
    expect(economicsNotice({ state: 'ok', pendingSince: '2026-11-08T09:01:00Z' }, now)).toBeNull();
    expect(economicsNotice({ state: 'ok', pendingSince: '2026-11-08T09:00:00Z' }, now)).toBe('Economics update is waiting. Figures may be out of date.');
  });

  it('ignores an update without pending work and future pending times', () => {
    expect(economicsNotice({ state: 'ok', pendingSince: null }, now)).toBeNull();
    expect(economicsNotice({ state: 'ok', pendingSince: '2026-11-08T09:31:00Z' }, now)).toBeNull();
  });

  it('ignores absent and malformed statuses, including malformed paused statuses', () => {
    for (const status of [null, undefined, [], 'paused', {}, { state: 'wrong', pendingSince: null },
      { state: 'paused' }, { state: 'ok', pendingSince: 'junk' }, { state: 'paused', pendingSince: 'junk' },
      { state: 'ok', pendingSince: '2026-11-08T09:00:00' }, { state: 'ok', pendingSince: '2026-99-08T09:00:00Z' }]) {
      expect(economicsNotice(status, now)).toBeNull();
    }
  });
});

describe('Tally data freshness in office time', () => {
  it('starts warning at 45 whole office minutes', () => {
    expect(freshness('2026-11-07T07:30:00Z', '2026-11-07T08:14:00Z')).toBeNull();
    expect(freshness('2026-11-07T07:30:00Z', '2026-11-07T08:15:00Z')).toEqual({ level: 'amber', ageLabel: '45 minutes' });
  });

  it('counts Saturday closing and Monday opening, skipping Sunday', () => {
    const from = '2026-11-07T13:20:00Z';
    expect(freshness(from, '2026-11-09T04:30:00Z')).toBeNull();
    expect(minutes(from, '2026-11-09T05:45:00Z')).toBe(55);
    expect(freshness(from, '2026-11-09T05:45:00Z')?.level).toBe('amber');
  });

  it('uses real elapsed hours in the Sunday label', () => {
    expect(minutes('2026-11-07T09:30:00Z', '2026-11-08T12:30:00Z')).toBe(240);
    expect(freshness('2026-11-07T09:30:00Z', '2026-11-08T12:30:00Z')).toEqual({ level: 'amber', ageLabel: '27 hours' });
    expect(freshness('2026-11-07T13:29:00Z', '2026-11-08T17:30:00Z')).toBeNull();
  });

  it('turns red at one full office day', () => {
    const from = '2026-11-06T14:00:00Z';
    expect(minutes(from, '2026-11-07T13:29:00Z')).toBe(509);
    expect(freshness(from, '2026-11-07T13:29:00Z')?.level).toBe('amber');
    expect(minutes(from, '2026-11-07T13:30:00Z')).toBe(510);
    expect(freshness(from, '2026-11-07T13:30:00Z')?.level).toBe('red');
  });

  it('reports six real days and bounds very old office counts', () => {
    expect(freshness('2026-10-31T09:30:00Z', '2026-11-06T09:30:00Z')).toEqual({ level: 'red', ageLabel: '6 days' });
    expect(minutes('1900-01-01T00:00:00Z', '2026-11-06T09:30:00Z')).toBeGreaterThan(1000);
    expect(minutes('1900-01-01T00:00:00Z', '2026-11-06T09:30:00Z')).toBeLessThanOrEqual(1510);
  });

  it('does not add office time overnight', () => {
    expect(minutes('2026-11-06T13:00:00Z', '2026-11-06T17:30:00Z')).toBe(30);
    expect(freshness('2026-11-06T13:00:00Z', '2026-11-06T17:30:00Z')).toBeNull();
  });

  it('ignores absent, unparseable and future timestamps', () => {
    for (const from of [null, undefined, '06 Nov, 09:11 PM', '2026-11-07T09:31:00Z']) {
      expect(dataFreshness(from, new Date('2026-11-07T09:30:00Z'))).toBeNull();
    }
  });

  it('formats whole minutes and singular hours', () => {
    expect(freshness('2026-11-07T07:30:00Z', '2026-11-07T08:29:00Z')?.ageLabel).toBe('59 minutes');
    expect(freshness('2026-11-07T07:30:00Z', '2026-11-07T08:30:00Z')?.ageLabel).toBe('1 hour');
  });

  it('returns zero for reversed or equal instants and floors fractional minutes', () => {
    expect(minutes('2026-11-07T08:30:00Z', '2026-11-07T07:30:00Z')).toBe(0);
    expect(minutes('2026-11-07T08:30:00Z', '2026-11-07T08:30:00Z')).toBe(0);
    expect(minutes('2026-11-07T07:30:01Z', '2026-11-07T08:15:00Z')).toBe(44);
  });

  it('is independent of the machine time zone and local-time getters', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    const spies = (['getDay', 'getHours', 'getMinutes', 'getDate', 'getMonth', 'getFullYear', 'getTimezoneOffset'] as const)
      .map(method => vi.spyOn(Date.prototype, method).mockImplementation(() => { throw new Error('Local time getter used'); }));
    try {
      expect(minutes('2026-11-07T13:20:00Z', '2026-11-09T05:45:00Z')).toBe(55);
      expect(freshness('2026-11-07T07:30:00Z', '2026-11-07T08:15:00Z')?.level).toBe('amber');
    } finally {
      spies.forEach(spy => spy.mockRestore());
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});

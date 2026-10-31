import type { CheckinResult, VisitCheckin } from '@/lib/account-types';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid check-in');
  return value as Record<string, unknown>;
}
export function parseVisitCheckin(value: unknown): VisitCheckin | null {
  if (value == null) return null;
  const row = record(value);
  if (typeof row.verified !== 'boolean' || typeof row.checkedInAt !== 'string' || !Number.isFinite(Date.parse(row.checkedInAt))
    || !(row.distanceM === null || (typeof row.distanceM === 'number' && Number.isFinite(row.distanceM) && row.distanceM >= 0))) throw new Error('Invalid check-in');
  return { verified: row.verified, checkedInAt: row.checkedInAt, distanceM: row.distanceM };
}
export function parseCheckinResult(value: unknown): CheckinResult {
  const row = record(value), visit = parseVisitCheckin(row)!;
  if (typeof row.checkinId !== 'string' || !row.checkinId || typeof row.hasPin !== 'boolean'
    || (row.hasPin ? visit.distanceM === null : visit.distanceM !== null || visit.verified)) throw new Error('Invalid check-in');
  return { ...visit, checkinId: row.checkinId, hasPin: row.hasPin };
}
export function parseSheetCheckin(value: unknown): VisitCheckin | null {
  const tiles = record(value).tiles;
  if (tiles == null) return null;
  const visit = record(tiles).lastVisit;
  return visit == null ? null : parseVisitCheckin(record(visit).checkin);
}
export function checkinMessage(result: CheckinResult, accuracyM: number): string {
  const distance = result.distanceM === null ? '' : result.distanceM < 1000 ? `${Math.round(result.distanceM)} m` : `${(result.distanceM / 1000).toFixed(1)} km`;
  if (!result.hasPin) return 'Checked in · lab not pinned yet';
  if (result.verified) return `Checked in · ${distance} from lab ✓`;
  return accuracyM > 100 ? `Checked in · GPS too weak (±${Math.round(accuracyM)} m)` : `Checked in · ${distance} from the lab pin`;
}

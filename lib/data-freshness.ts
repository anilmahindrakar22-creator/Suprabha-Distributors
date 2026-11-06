export type DataFreshness = { level: 'amber' | 'red'; ageLabel: string };

const minute = 60_000;
const day = 24 * 60 * minute;
const istOffset = 330 * minute;

export function isIsoInstant(value: unknown): value is string {
  // Date.parse alone guesses dates for junk and accepts machine-local times.
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

export function isEconomicsStatus(status: unknown): status is { state: 'ok' | 'paused'; pendingSince: string | null } {
  return !!status && typeof status === 'object' && !Array.isArray(status) &&
    'state' in status && (status.state === 'ok' || status.state === 'paused') &&
    'pendingSince' in status && (status.pendingSince === null || isIsoInstant(status.pendingSince));
}

export function economicsNotice(status: unknown, now: Date): string | null {
  if (!isEconomicsStatus(status)) return null;
  if (status.state === 'paused') return 'Economics update is paused. Figures may be out of date.';
  if (status.pendingSince !== null && now.getTime() - Date.parse(status.pendingSince) >= 30 * minute) {
    return 'Economics update is waiting. Figures may be out of date.';
  }
  return null;
}

export function officeMinutesBetween(from: Date, to: Date): number {
  const start = from.getTime(), end = to.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  let elapsed = 0;
  // Shift to an IST calendar represented in UTC; never use local-time getters.
  for (let midnight = Math.floor((start + istOffset) / day) * day; midnight - istOffset < end; midnight += day) {
    if (new Date(midnight).getUTCDay() === 0) continue;
    const opens = midnight + 630 * minute - istOffset;
    const closes = midnight + 1140 * minute - istOffset;
    elapsed += Math.max(0, Math.min(end, closes) - Math.max(start, opens));
    if (elapsed / minute > 1_000) break;
  }
  return Math.floor(elapsed / minute);
}

export function dataFreshness(sourceUpdatedAt: string | null | undefined, now: Date): DataFreshness | null {
  if (!isIsoInstant(sourceUpdatedAt)) return null;
  const source = new Date(sourceUpdatedAt);
  const elapsed = now.getTime() - source.getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  const officeMinutes = officeMinutesBetween(source, now);
  if (officeMinutes < 45) return null;
  const minutes = Math.floor(elapsed / minute);
  const hours = Math.floor(minutes / 60);
  const ageLabel = minutes < 60 ? `${minutes} minutes`
    : hours < 48 ? `${hours} ${hours === 1 ? 'hour' : 'hours'}`
      : `${Math.floor(hours / 24)} days`;
  return { level: officeMinutes >= 510 ? 'red' : 'amber', ageLabel };
}

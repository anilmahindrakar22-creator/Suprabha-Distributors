export type DataFreshness = { level: 'amber' | 'red'; ageLabel: string };

const minute = 60_000;
const day = 24 * 60 * minute;
const istOffset = 330 * minute;

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
  // Require the ISO instant contract: Date.parse can guess a year for junk such
  // as "06 Nov, 09:11 PM", or interpret a zone-less value in the machine zone.
  if (!sourceUpdatedAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(sourceUpdatedAt)) return null;
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

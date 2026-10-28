const zone = 'Asia/Kolkata';
const dayKey = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: zone });

/** Short order date for list rows (IST): "2:30 pm" today, "Yesterday", "16 Oct", or "16 Oct 2025" in an earlier year. */
export function orderDateLabel(value: string, now = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  if (dayKey(date) === dayKey(now)) return date.toLocaleTimeString('en-IN', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
  if (dayKey(date) === dayKey(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
  const sameYear = date.toLocaleDateString('en-CA', { timeZone: zone, year: 'numeric' }) === now.toLocaleDateString('en-CA', { timeZone: zone, year: 'numeric' });
  return date.toLocaleDateString('en-IN', { timeZone: zone, day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** Full order date and time (IST): "16 Oct 2026, 2:30 pm". */
export function orderDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.toLocaleDateString('en-IN', { timeZone: zone, day: 'numeric', month: 'short', year: 'numeric' })}, ${date.toLocaleTimeString('en-IN', { timeZone: zone, hour: 'numeric', minute: '2-digit' })}`;
}

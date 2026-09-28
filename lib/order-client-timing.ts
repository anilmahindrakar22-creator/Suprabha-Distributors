export type OrderClientTiming = 'order_list_ms' | 'order_open_ms' | 'order_save_ms';

// Browser-only, bounded diagnostics. Nothing is sent to the server.
export function recordOrderClientTiming(name: OrderClientTiming, startedAt: number) {
  if (typeof performance === 'undefined' || !Number.isFinite(startedAt)) return;
  try {
    if (performance.getEntriesByName(name, 'measure').length >= 50) performance.clearMeasures(name);
    performance.measure(name, { start: startedAt, end: performance.now() });
  } catch {
    // Timing must never interrupt order work on browsers without User Timing support.
  }
}

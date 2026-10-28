export const ORDER_LIVE_INTERVAL = 15_000;

/** Foreground change check. Never treats equal queue counts as equal order state. */
export function startOrderLiveRefresh(options: {
  fetchSummary: (signal: AbortSignal) => Promise<Response>;
  canRefresh: () => boolean;
  online: () => boolean;
  active: () => boolean;
  refresh: () => Promise<void>;
  onError: (message: string) => void;
}) {
  let stopped = false;
  let denied = false;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let revision: string | undefined;
  let failures = 0;
  function clearTimer() { if (timer) clearTimeout(timer); timer = undefined; }
  async function check() {
    if (stopped || denied || controller) return;
    clearTimer();
    if (!options.online() || !options.active()) return;
    if (!options.canRefresh()) { timer = setTimeout(() => void check(), ORDER_LIVE_INTERVAL); return; }
    const request = new AbortController(); controller = request;
    const timeout = setTimeout(() => request.abort(), 15_000);
    try {
      const response = await options.fetchSummary(request.signal);
      if (stopped || controller !== request) return;
      if (response.status === 401 || response.status === 403) {
        denied = true; options.onError('Order updates stopped. Verify your sign-in and access.'); return;
      }
      if (!response.ok) throw new Error('summary unavailable');
      const body = await response.json() as { orderRevision?: unknown };
      const next = typeof body.orderRevision === 'string' && /^[a-f0-9]{32}$/.test(body.orderRevision) ? body.orderRevision : undefined;
      if (stopped || controller !== request) return;
      // First check closes the bootstrap/check race. Older servers fall back to a visible-page reload.
      if (options.canRefresh() && (next === undefined || next !== revision)) {
        await options.refresh();
        if (stopped || controller !== request) return;
        revision = next;
      }
      failures = 0;
    } catch {
      if (!stopped && controller === request) {
        failures += 1;
        options.onError('Live order updates are unavailable. The displayed orders may be out of date.');
      }
    } finally {
      clearTimeout(timeout);
      if (controller === request) controller = undefined;
      if (!stopped && !denied && options.active() && options.online()) timer = setTimeout(() => void check(), Math.min(60_000, ORDER_LIVE_INTERVAL * 2 ** failures));
    }
  }
  function wake() {
    if (!options.active() || !options.online()) {
      clearTimer(); const request = controller; controller = undefined; request?.abort(); return;
    }
    void check();
  }
  // Let the initial page render before verifying its revision.
  timer = setTimeout(() => void check(), 1_000);
  return { wake, stop: () => { stopped = true; clearTimer(); controller?.abort(); controller = undefined; } };
}

const encoder = new TextEncoder();

export function measuredJsonResponse(body: unknown, startedAtMs: number, nowMs = performance.now(), phases: Record<string, number> = {}, init: { status?: number } = {}) {
  const jsonStartedAt = performance.now();
  const json = JSON.stringify(body);
  const jsonDuration = Math.max(0, performance.now() - jsonStartedAt);
  const duration = Math.max(0, nowMs - startedAtMs);
  const timings = [`stockflow;dur=${duration.toFixed(1)}`];
  if (Object.keys(phases).length > 0) {
    for (const [name, value] of Object.entries(phases)) {
      if (/^[a-z]{1,16}$/.test(name) && Number.isFinite(value)) timings.push(`${name};dur=${Math.max(0, value).toFixed(1)}`);
    }
    timings.push(`json;dur=${jsonDuration.toFixed(1)}`);
  }
  return new Response(json, {
    status: init.status ?? 200,
    headers: {
      'cache-control': 'private, no-store',
      'content-type': 'application/json; charset=utf-8',
      'server-timing': timings.join(', '),
      'x-stockflow-response-bytes': String(encoder.encode(json).byteLength),
    },
  });
}

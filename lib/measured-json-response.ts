const encoder = new TextEncoder();

export function measuredJsonResponse(body: unknown, startedAtMs: number, nowMs = performance.now()) {
  const json = JSON.stringify(body);
  const duration = Math.max(0, nowMs - startedAtMs);
  return new Response(json, {
    headers: {
      'cache-control': 'private, no-store',
      'content-type': 'application/json; charset=utf-8',
      'server-timing': `stockflow;dur=${duration.toFixed(1)}`,
      'x-stockflow-response-bytes': String(encoder.encode(json).byteLength),
    },
  });
}

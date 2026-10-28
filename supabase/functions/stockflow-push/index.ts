import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
// @ts-types="npm:@types/web-push@3.6.3"
import webPush from 'web-push';
import { runSweep, type DueRow } from './sweep.ts';

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

class RpcError extends Error {
  constructor(readonly status: number) { super('Push RPC failed'); }
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const pushSecret = request.headers.get('x-stockflow-push-secret');
  if (!pushSecret?.trim()) return reply({ error: 'Unauthorized' }, 403);

  const subject = Deno.env.get('STOCKFLOW_PUSH_VAPID_SUBJECT');
  const publicKey = Deno.env.get('STOCKFLOW_PUSH_PUBLIC_KEY');
  const privateKey = Deno.env.get('STOCKFLOW_PUSH_PRIVATE_KEY');
  if (!subject?.startsWith('mailto:') || !subject.slice(7).trim() || !publicKey?.trim() || !privateKey?.trim()) {
    return reply({ error: 'push not configured' }, 503);
  }
  const url = Deno.env.get('SUPABASE_URL');
  let secretKey: string | undefined;
  try {
    const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
    const configuredKey = secretKeys ? (JSON.parse(secretKeys) as Record<string, unknown>)?.['stockflowedge'] : undefined;
    if (typeof configuredKey === 'string') secretKey = configuredKey;
  } catch { /* Fail closed without logging configuration. */ }
  if (!url || !secretKey) return reply({ error: 'push not configured' }, 503);

  const runAbort = new AbortController();
  const sendAbort = new AbortController();
  // Reserve five seconds to record outcomes after delivery stops. The hard
  // deadline also aborts RPC I/O; racing alone would leave background sends.
  const sendTimer = setTimeout(() => sendAbort.abort(), 45_000);
  let runTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    runTimer = setTimeout(() => {
      runAbort.abort();
      sendAbort.abort();
      reject(new Error('Push sweep timed out'));
    }, 50_000);
  });

  async function rpc(action: 'due' | 'record', payload: unknown): Promise<unknown> {
    // Match stockflow-orders: modern secret keys belong in apikey, not a JWT
    // Authorization header. The database verifies p_secret for BOTH actions.
    const response = await fetch(`${url}/rest/v1/rpc/stockflow_push_sweep`, {
      method: 'POST',
      headers: { apikey: secretKey!, 'content-type': 'application/json' },
      body: JSON.stringify({ p_secret: pushSecret, p_action: action, p_payload: payload }),
      signal: action === 'due' ? sendAbort.signal : runAbort.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new RpcError(response.status);
    }
    if (action === 'record') {
      // A void RPC may return an empty body or JSON null.
      await response.body?.cancel();
      return;
    }
    return await response.json();
  }

  try {
    const counts = await Promise.race([
      runSweep({
        due: async (limit) => await rpc('due', { limit }) as { rows: DueRow[] },
        record: async (results) => { await rpc('record', { results }); },
        send: async (subscription, payloadJson, ttlSeconds) => {
          sendAbort.signal.throwIfAborted();
          // web-push supplies VAPID signing and RFC 8291 aes128gcm encryption.
          // Use fetch for abortable transport, rather than its node:https sender.
          const details = webPush.generateRequestDetails(subscription, payloadJson, {
            TTL: ttlSeconds,
            contentEncoding: 'aes128gcm',
            vapidDetails: { subject, publicKey, privateKey },
          });
          const response = await fetch(details.endpoint, {
            method: details.method,
            headers: Object.fromEntries(Object.entries(details.headers).map(([name, value]) => [name, String(value)])),
            body: details.body ? new Uint8Array(details.body) : undefined,
            signal: AbortSignal.any([sendAbort.signal, AbortSignal.timeout(8_000)]),
            redirect: 'error',
          });
          const statusCode = response.status;
          await response.body?.cancel();
          return { statusCode };
        },
      }),
      deadline,
    ]);
    console.log(JSON.stringify(counts));
    return reply(counts);
  } catch (error) {
    if (runAbort.signal.aborted || sendAbort.signal.aborted) return reply({ error: 'push sweep timed out' }, 504);
    if (error instanceof RpcError && (error.status === 401 || error.status === 403)) {
      return reply({ error: 'Unauthorized' }, 403);
    }
    return reply({ error: 'push sweep failed' }, 502);
  } finally {
    clearTimeout(runTimer);
    clearTimeout(sendTimer);
    runAbort.abort();
    sendAbort.abort();
  }
});

export interface DueRow {
  claim_id: string;
  event_id: string;
  recipient_email: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  endpoint_hash: string;
  title: string;
  body: string;
  order_id: string;
  order_number: string;
}

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface DeliveryResult {
  claimId: string;
  eventId: string;
  recipientEmail: string;
  endpointHash: string;
  outcome: 'sent' | 'failed' | 'gone';
  error?: string;
}

export interface SweepDependencies {
  due(limit: number): Promise<{ rows: DueRow[] }>;
  record(results: DeliveryResult[]): Promise<void>;
  send(subscription: PushSubscription, payloadJson: string, ttlSeconds: number): Promise<{ statusCode: number }>;
}

// The database owns claiming, recipient authorization, retries and disabling push.
// Keep this module independent of Deno and of the transport/crypto implementation.
export async function runSweep(deps: SweepDependencies) {
  const { rows } = await deps.due(200);
  const results = new Array<DeliveryResult>(rows.length);
  let next = 0;

  async function worker() {
    while (next < rows.length) {
      const index = next++;
      const row = rows[index];
      const result: DeliveryResult = {
        claimId: row.claim_id,
        eventId: row.event_id,
        recipientEmail: row.recipient_email,
        endpointHash: row.endpoint_hash,
        outcome: 'failed',
      };
      try {
        const { statusCode } = await deps.send(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify({ title: row.title, body: row.body, orderId: row.order_id, orderNumber: row.order_number }),
          3600,
        );
        if (Number.isInteger(statusCode) && statusCode >= 200 && statusCode < 300) {
          result.outcome = 'sent';
        } else if (statusCode === 404 || statusCode === 410) {
          result.outcome = 'gone';
        } else {
          // Never persist provider bodies, exception messages, URLs or keys.
          result.error = Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
            ? `Push service HTTP ${statusCode}`
            : 'Invalid push service status';
        }
      } catch {
        result.error = 'Push delivery failed';
      }
      results[index] = result;
    }
  }

  await Promise.all(Array.from({ length: Math.min(10, rows.length) }, () => worker()));
  await deps.record(results);
  const counts = { due: rows.length, sent: 0, gone: 0, failed: 0 };
  for (const result of results) counts[result.outcome]++;
  return counts;
}

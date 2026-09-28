export type RequestAdmission =
  | { allowed: true; key: string; token: number }
  | { allowed: false; retryAfterSeconds: number };

// Enforce the limit on bytes actually received, including chunked requests.
export async function readBoundedJson(request: Request, maximumBytes = 65_536): Promise<unknown> {
  if (Number(request.headers.get('content-length') || 0) > maximumBytes) throw new RangeError('Request is too large');
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Invalid JSON');
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new RangeError('Request is too large');
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

// This is a verifier for a randomly generated 256-bit key, never the key.
// Reject stale/unknown clients before they can start a database transaction.
export const approvedGatewayHash = 'f34221ee674c8fa961b423c3791cdea423baacfd8a78312835b002fc792b72eb';

export async function isApprovedGatewayKey(value: string, expectedHash = approvedGatewayHash): Promise<boolean> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  let difference = 0;
  for (let index = 0; index < 64; index += 1) difference |= actual.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  return difference === 0;
}

// This is a per-isolate safety brake, not a substitute for gateway authentication.
// A fresh order version or pricing evidence produces a different fingerprint.
export class RequestGate {
  private readonly requests = new Map<string, { token: number; until: number; inFlight: boolean }>();
  private readonly actors = new Map<string, { since: number; count: number }>();
  private nextToken = 0;

  constructor(
    private readonly actorLimit = 60,
    private readonly actorWindowMs = 60_000,
    private readonly conflictCooldownMs = 60_000,
    private readonly maximumEntries = 2_048,
  ) {}

  async begin(gatewayKey: string, actorEmail: string, action: string, payload: Record<string, unknown>, now = Date.now()): Promise<RequestAdmission> {
    const actor = actorEmail.trim().toLowerCase();
    // Partition by the supplied gateway credential so a bad key cannot exhaust
    // a real employee's quota. Only hashes are retained in isolate memory.
    const actorKey = await this.hash(`${gatewayKey}\n${actor}`);
    const current = this.actors.get(actorKey);
    const counter = current && now - current.since < this.actorWindowMs ? current : { since: now, count: 0 };
    if (counter.count >= this.actorLimit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((counter.since + this.actorWindowMs - now) / 1_000)) };
    if (this.requests.size >= this.maximumEntries || this.actors.size >= this.maximumEntries) this.prune(now);
    // Fail closed at capacity: evicting live entries would reset protections.
    if (this.actors.size >= this.maximumEntries && !this.actors.has(actorKey)) return { allowed: false, retryAfterSeconds: 60 };
    // Reserve the actor quota before the second asynchronous hash, otherwise
    // concurrent requests could all observe the same pre-increment count.
    counter.count += 1;
    this.actors.set(actorKey, counter);

    // A fresh idempotency key alone cannot make an unchanged stale command safe.
    const commandPayload = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'idempotencyKey'));
    const command = JSON.stringify(commandPayload, (_key, value) =>
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]))
        : value);
    const key = await this.hash(`${actorKey}\n${action}\n${command}`);
    const previous = this.requests.get(key);
    if (previous && (previous.inFlight || previous.until > now)) return { allowed: false, retryAfterSeconds: previous.inFlight ? 60 : Math.max(1, Math.ceil((previous.until - now) / 1_000)) };

    // Recheck after the asynchronous hash: other admissions may have filled it.
    if (this.requests.size >= this.maximumEntries) this.prune(now);
    if (this.requests.size >= this.maximumEntries) return { allowed: false, retryAfterSeconds: 60 };
    const token = ++this.nextToken;
    this.requests.set(key, { token, until: now + this.conflictCooldownMs, inFlight: true });
    return { allowed: true, key, token };
  }

  finish(admission: Extract<RequestAdmission, { allowed: true }>, conflict: boolean, now = Date.now()): void {
    const current = this.requests.get(admission.key);
    if (!current || current.token !== admission.token) return;
    if (conflict) this.requests.set(admission.key, { token: admission.token, until: now + this.conflictCooldownMs, inFlight: false });
    else this.requests.delete(admission.key);
  }

  private prune(now: number): void {
    for (const [key, value] of this.requests) if (!value.inFlight && value.until <= now) this.requests.delete(key);
    for (const [key, value] of this.actors) if (value.since + this.actorWindowMs <= now) this.actors.delete(key);
  }

  private async hash(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
}

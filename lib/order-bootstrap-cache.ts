import type { OrderBootstrap } from './order-types';
import { readJsonBody } from '@/lib/http-json';

const requests = new Map<string, { request: Promise<OrderBootstrap>; expiresAt: number }>();
const BOOTSTRAP_FRESH_MS = 15_000;

export function loadOrderBootstrap(
  actorEmail: string,
  force = false,
  fetchFn: typeof fetch = fetch,
): Promise<OrderBootstrap> {
  const key = actorEmail.trim().toLocaleLowerCase('en-IN');
  const existing = requests.get(key);
  if (!force && existing && existing.expiresAt > Date.now()) return existing.request;

  const request = fetchFn('/api/orders?list=1', { cache: 'no-store' })
    .then(async (response) => {
      const body = await readJsonBody<OrderBootstrap & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || 'Unable to load orders');
      const entry = requests.get(key);
      if (entry?.request === request) entry.expiresAt = Date.now() + BOOTSTRAP_FRESH_MS;
      return body;
    })
    .catch((error) => {
      if (requests.get(key)?.request === request) requests.delete(key);
      throw error;
    });
  requests.set(key, { request, expiresAt: Infinity });
  return request;
}

export function clearOrderBootstrapCache() {
  requests.clear();
}

import type { OrderBootstrap } from './order-types';

const requests = new Map<string, Promise<OrderBootstrap>>();

export function loadOrderBootstrap(
  actorEmail: string,
  force = false,
  fetchFn: typeof fetch = fetch,
): Promise<OrderBootstrap> {
  const key = actorEmail.trim().toLocaleLowerCase('en-IN');
  const existing = requests.get(key);
  if (!force && existing) return existing;

  const request = fetchFn('/api/orders?list=1', { cache: 'no-store' })
    .then(async (response) => {
      const body = (await response.json()) as OrderBootstrap & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Unable to load orders');
      return body;
    })
    .catch((error) => {
      if (requests.get(key) === request) requests.delete(key);
      throw error;
    });
  requests.set(key, request);
  return request;
}

export function clearOrderBootstrapCache() {
  requests.clear();
}

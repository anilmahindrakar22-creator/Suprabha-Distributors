import type { CatalogItem, CustomerDirectoryEntry } from './order-types';

type CatalogResult = { catalogVersion: string; catalog: CatalogItem[] };
type CustomerResult = { customerVersion: string; customers: CustomerDirectoryEntry[] };

const catalogRequests = new Map<string, Promise<CatalogResult>>();
const customerRequests = new Map<string, Promise<CustomerResult>>();

function cacheKey(actorEmail: string, versionHint: string) {
  return `${actorEmail.trim().toLocaleLowerCase('en-IN')}:${versionHint}`;
}

async function readResponse<T>(response: Response, fallback: string) {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || fallback);
  return body;
}

export function loadOrderCatalog(actorEmail: string, versionHint = '', fetchFn: typeof fetch = fetch) {
  const key = cacheKey(actorEmail, versionHint);
  const existing = catalogRequests.get(key);
  if (existing) return existing;
  const request = fetchFn('/api/orders?catalog=1', { cache: 'no-store' })
    .then((response) => readResponse<CatalogResult>(response, 'Unable to load Tally products'))
    .catch((error) => { if (catalogRequests.get(key) === request) catalogRequests.delete(key); throw error; });
  catalogRequests.set(key, request);
  return request;
}

export function loadOrderCustomers(actorEmail: string, versionHint = '', fetchFn: typeof fetch = fetch) {
  const key = cacheKey(actorEmail, versionHint);
  const existing = customerRequests.get(key);
  if (existing) return existing;
  const request = fetchFn('/api/orders?customers=1', { cache: 'no-store' })
    .then((response) => readResponse<CustomerResult>(response, 'Unable to load Tally customers'))
    .catch((error) => { if (customerRequests.get(key) === request) customerRequests.delete(key); throw error; });
  customerRequests.set(key, request);
  return request;
}

export function clearOrderCaptureMasterCache() {
  catalogRequests.clear();
  customerRequests.clear();
}

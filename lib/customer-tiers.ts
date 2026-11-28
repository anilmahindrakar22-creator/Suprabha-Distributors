import { useEffect, useState } from 'react';

export type CustomerTier = 'diamond' | 'platinum' | 'gold' | 'silver';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function normalizeCustomerTiers(raw: unknown): { month: string | null; tiers: Record<string, CustomerTier> } | null {
  if (!object(raw) || Object.keys(raw).length !== 2 || !Object.hasOwn(raw, 'month') || !Object.hasOwn(raw, 'tiers') ||
    !(raw.month === null || typeof raw.month === 'string') || !object(raw.tiers)) return null;
  const tiers: Record<string, CustomerTier> = {};
  for (const [id, tier] of Object.entries(raw.tiers)) {
    if (tier !== 'diamond' && tier !== 'platinum' && tier !== 'gold' && tier !== 'silver') return null;
    Object.defineProperty(tiers, id, { value: tier, enumerable: true, configurable: true, writable: true });
  }
  return { month: raw.month, tiers };
}

export function chunkOrderIds(ids: string[]): string[][] {
  const distinct = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let i = 0; i < distinct.length; i += 100) chunks.push(distinct.slice(i, i + 100));
  return chunks;
}

const cache = new Map<string, CustomerTier | null>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();

export function useCustomerTiers(actorEmail: string | undefined, orderIds: string[]): Record<string, CustomerTier> {
  const [, refresh] = useState(0);
  const idsKey = JSON.stringify([...new Set(orderIds)]);
  useEffect(() => {
    const listener = () => refresh(value => value + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  useEffect(() => {
    if (!actorEmail) return;
    const key = (id: string) => `${actorEmail}|${id}`;
    const ids = (JSON.parse(idsKey) as string[]).filter(id => !cache.has(key(id)) && !inFlight.has(key(id)));
    for (const chunk of chunkOrderIds(ids)) {
      chunk.forEach(id => inFlight.add(key(id)));
      void (async () => {
        try {
          const response = await fetch('/api/customer-tiers', {
            method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ orderIds: chunk }),
          });
          if (!response.ok) { chunk.forEach(id => cache.set(key(id), null)); return; }
          const data = normalizeCustomerTiers(await response.json());
          if (!data) { chunk.forEach(id => cache.set(key(id), null)); return; }
          chunk.forEach(id => cache.set(key(id), data.tiers[id] ?? null));
          listeners.forEach(listener => listener());
        } catch {
          chunk.forEach(id => cache.set(key(id), null));
          // Optional decoration: a failed read shows no badge and is not retried until reload.
        } finally {
          chunk.forEach(id => inFlight.delete(key(id)));
        }
      })();
    }
  }, [actorEmail, idsKey]);
  const tiers: Record<string, CustomerTier> = {};
  if (actorEmail) for (const id of orderIds) {
    const tier = cache.get(`${actorEmail}|${id}`);
    if (tier) tiers[id] = tier;
  }
  return tiers;
}

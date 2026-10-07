'use client';
import { useEffect, useRef, useState } from 'react';
import { loadOfflineVault } from '@/lib/offline-vault-storage';
import { saveOfflineOrderDocument } from '@/lib/offline-order-device';
import { finishEncryptedDraftMigration, readOfflineOrderDraft } from '@/lib/offline-order-drafts';
import { removeCatalogCache } from '@/lib/catalog-cache';
import { removeCustomerCache } from '@/lib/customer-cache';
import { offlineOrderDocument } from '@/lib/offline-order-document';

export function OfflineOrderPreparation({ actorEmail }: { actorEmail: string }) {
  const [pin, setPin] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    const lock = () => {
      if (document.visibilityState === 'hidden') {
        generation.current += 1; setPin(''); setBusy(false); setMessage('Locked. Enter your PIN to continue.');
      }
    };
    document.addEventListener('visibilitychange', lock);
    return () => { generation.current += 1; document.removeEventListener('visibilitychange', lock); };
  }, []);
  async function prepare() {
    if (busy || !consent || !/^\d{6,64}$/.test(pin)) return;
    const current = ++generation.current;
    setBusy(true); setMessage('Preparing encrypted offline data…');
    try {
      const existing = await loadOfflineVault(localStorage, pin);
      if (current !== generation.current) return;
      const previous = existing ? offlineOrderDocument(existing.value, actorEmail) : null;
      async function directory(kind: string) {
        const response = await fetch(`/api/offline-catalog?kind=${kind}`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error('Could not verify this account and download its catalogue. Sign in and retry.');
        const result = await response.json() as { actorEmail?: string; rows?: unknown[] };
        if (result.actorEmail !== actorEmail || !Array.isArray(result.rows)) throw new Error('Account verification changed. Sign in and retry.');
        return result.rows;
      }
      const products = await directory('products');
      if (current !== generation.current) return;
      const customers = await directory('customers');
      if (current !== generation.current) return;
      const drafts = [...(previous?.drafts || [])];
      const legacy = readOfflineOrderDraft(localStorage, actorEmail);
      const copied = legacy && drafts.find((draft) => draft.command.payload.idempotencyKey === legacy.command.payload.idempotencyKey);
      if (legacy && copied && JSON.stringify(copied.command) !== JSON.stringify(offlineOrderDocument({ version: 1, actorEmail, preparedAt: new Date().toISOString(), products: [], customers: [], drafts: [legacy] }, actorEmail).drafts[0].command)) {
        throw new Error('The original draft differs from its encrypted copy. Resolve it in Orders before refreshing. Both copies were retained.');
      }
      if (legacy && !copied) drafts.push(legacy);
      const value = offlineOrderDocument({ version: 1, actorEmail, preparedAt: new Date().toISOString(), products, customers, drafts }, actorEmail);
      await saveOfflineOrderDocument(localStorage, value, pin, existing?.revision ?? null, true);
      const verified = await loadOfflineVault(localStorage, pin);
      if (!verified || JSON.stringify(verified.value) !== JSON.stringify(value)) throw new Error('Saved data could not be verified. Keep the original draft.');
      finishEncryptedDraftMigration(localStorage, actorEmail, legacy);
      if (![localStorage, sessionStorage].every((storage) => removeCatalogCache(storage, actorEmail) && removeCustomerCache(storage, actorEmail))) throw new Error('Encrypted data saved, but old directory cleanup failed. Do not share this device.');
      if (current !== generation.current) return;
      setPin('');
      setMessage(`Encrypted copy verified: ${value.customers.length} customers, ${value.products.length} products, ${value.drafts.length} drafts. Old unencrypted draft storage is now disabled on this device.`);
    } catch (error) {
      if (current === generation.current) setMessage(error instanceof Error ? error.message : 'Preparation failed. Existing drafts were retained.');
    } finally { if (current === generation.current) setBusy(false); }
  }
  return <section className="mx-auto max-w-lg space-y-4 p-5 text-[#173239]">
    <h1 className="text-xl font-bold">Prepare offline orders</h1>
    <p>Use only a trusted staff device. Customer and product names will be stored encrypted. Stock and pricing still require online verification.</p>
    <p>Your PIN protects local data, not your online account. Forgotten PINs cannot recover unsent encrypted drafts.</p>
    <label className="block">Offline PIN<input type="password" inputMode="numeric" autoComplete="off" minLength={6} maxLength={64} value={pin} onChange={(event) => setPin(event.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border px-3" /></label>
    <label className="flex gap-2"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />I approve encrypted offline storage on this device.</label>
    <button type="button" disabled={busy || !consent || !/^\d{6,64}$/.test(pin)} onClick={() => void prepare()} className="min-h-11 rounded-lg bg-[#092f36] px-4 font-bold text-white disabled:opacity-50">{busy ? 'Preparing…' : 'Prepare / refresh encrypted copy'}</button>
    <output className="block" aria-live="polite">{message}</output>
    {/* Public static document: requires full navigation, not the authenticated router. */}
    {/* oxlint-disable-next-line next/no-html-link-for-pages */}
    <a href="/offline.html" className="block min-h-11 underline">Open offline orders</a>
  </section>;
}

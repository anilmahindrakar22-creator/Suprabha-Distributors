'use client';

import { SyntheticEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { InventoryBalance, InventoryBootstrap } from '@/lib/inventory-types';

type EntryMode = 'receive' | 'adjust';

function requestId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `inventory-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function quantity(value: number, unit = '') {
  return `${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`;
}

function formText(values: FormData, name: string) {
  const value = values.get(name);
  return typeof value === 'string' ? value : '';
}

export function InventoryWorkspace({ actorRole }: { actorRole: string }) {
  const [data, setData] = useState<InventoryBootstrap | null>(null);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<EntryMode | null>(null);
  const [adjustment, setAdjustment] = useState<InventoryBalance | null>(null);
  const [renderedAt] = useState(() => Date.now());
  const canReceive = ['administrator', 'operations', 'warehouse'].includes(actorRole);
  const canAdjust = ['administrator', 'warehouse'].includes(actorRole);

  const load = useCallback(async () => {
    const response = await fetch('/api/inventory', { cache: 'no-store' });
    const body = await response.json() as InventoryBootstrap & { error?: string };
    if (!response.ok) throw new Error(body.error || 'Unable to load inventory');
    setData(body);
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/inventory', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json() as InventoryBootstrap & { error?: string };
        if (!response.ok) throw new Error(body.error || 'Unable to load inventory');
        if (active) setData(body);
      })
      .catch((error: Error) => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [load]);

  const balances = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data?.balances || [];
    return (data?.balances || []).filter((item) =>
      [item.name, item.tallyKey, item.batchNumber, item.locationCode].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [data, query]);
  const totals = useMemo(() => (data?.balances || []).reduce((sum, item) => ({
    onHand: sum.onHand + Number(item.onHand), available: sum.available + Number(item.available),
  }), { onHand: 0, available: 0 }), [data]);
  const expiring = (data?.balances || []).filter((item) => item.expiryDate && new Date(item.expiryDate).getTime() <= renderedAt + 90 * 86_400_000).length;
  const variances = (data?.reconciliation || []).filter((item) => Number(item.variance) !== 0);

  function closeEntry() { setMode(null); setAdjustment(null); }

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    const values = new FormData(event.currentTarget);
    const action = mode === 'receive' ? 'receive_stock' : 'adjust_stock';
    const payload = mode === 'receive' ? {
      idempotencyKey: requestId(), tallyKey: formText(values, 'tallyKey'),
      batchNumber: formText(values, 'batchNumber'), expiryDate: formText(values, 'expiryDate') || undefined,
      quantity: Number(formText(values, 'quantity')), locationCode: 'MAIN', sourceDocument: formText(values, 'sourceDocument') || undefined,
    } : {
      idempotencyKey: requestId(), tallyKey: adjustment?.tallyKey || '', batchNumber: adjustment?.batchNumber || '',
      quantityDelta: Number(formText(values, 'quantityDelta')), reason: formText(values, 'reason'), locationCode: adjustment?.locationCode || 'MAIN',
    };
    try {
      const response = await fetch('/api/inventory', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, payload }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Inventory update failed');
      await load(); closeEntry(); setMessage(mode === 'receive' ? 'Batch receipt recorded.' : 'Stock adjustment recorded.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Inventory update failed'); }
    finally { setBusy(false); }
  }

  return <div className="h-full overflow-y-auto px-4 py-6 sm:px-6">
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-extrabold uppercase tracking-[.13em] text-[#277b69]">Warehouse control</p><h1 className="mt-1 text-3xl font-black text-[#092f36]">Inventory</h1><p className="mt-2 text-sm text-[#64787b]">Batch receipts and adjustments. Tally stock remains unchanged.</p></div>
        {canReceive ? <button type="button" onClick={() => { setAdjustment(null); setMode('receive'); }} className="min-h-11 rounded-xl bg-[#092f36] px-5 font-bold text-white">Receive batch</button> : null}
      </header>
      {message ? <output className="mt-4 block rounded-xl border border-[#d8e5e2] bg-white px-4 py-3 text-sm text-[#31585d]">{message}</output> : null}
      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Products', data?.products.length || 0], ['Active batches', data?.balances.length || 0], ['On hand', quantity(totals.onHand)], ['Available', quantity(totals.available)]].map(([label, value]) => <article key={label} className="rounded-2xl border border-[#dce7e5] bg-white p-4"><span className="text-xs font-bold text-[#6b7e81]">{label}</span><strong className="mt-2 block text-2xl text-[#092f36]">{value}</strong></article>)}
      </section>
      {expiring ? <p className="mt-3 rounded-xl bg-[#fff4df] px-4 py-3 text-sm font-semibold text-[#805b20]">{expiring} batch{expiring === 1 ? '' : 'es'} expired or expiring within 90 days.</p> : null}
      {variances.length ? <details className="mt-3 rounded-xl border border-[#efd9ad] bg-[#fffaf0] px-4 py-3 text-sm text-[#6f521c]"><summary className="cursor-pointer font-bold">Tally reconciliation: {variances.length} item{variances.length === 1 ? '' : 's'} differ</summary><div className="mt-3 max-h-52 overflow-y-auto divide-y divide-[#efe1c5]">{variances.map((item) => <p key={item.tallyKey} className="flex justify-between gap-4 py-2"><span>{item.name}</span><span className="shrink-0 font-bold">Tally {quantity(item.tallyOnHand)} · Ledger {quantity(item.ledgerOnHand)} · Δ {quantity(item.variance)}</span></p>)}</div><p className="mt-2 text-xs">This comparison does not alter Tally. Record receipts or authorised adjustments only after checking the physical batch.</p></details> : null}
      <section className="mt-5 overflow-hidden rounded-2xl border border-[#dce7e5] bg-white">
        <div className="flex flex-col gap-3 border-b border-[#e3ecea] p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-extrabold text-[#173239]">Batch balances</h2><p className="text-xs text-[#718487]">Append-only StockFlow ledger</p></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product or batch" className="min-h-11 rounded-xl border border-[#cedfdd] px-3 sm:w-72" /></div>
        <div className="divide-y divide-[#e8efed]">
          {!data ? <p className="p-6 text-sm text-[#718487]">Loading inventory…</p> : balances.length === 0 ? <p className="p-6 text-sm text-[#718487]">No batch balances yet. Record the first goods receipt to begin.</p> : balances.map((item) => <article key={`${item.tallyKey}:${item.batchNumber}:${item.locationCode}`} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_repeat(3,110px)_auto] sm:items-center">
            <div className="min-w-0"><strong className="block truncate text-sm text-[#173239]">{item.name}</strong><span className="text-xs text-[#718487]">Batch {item.batchNumber} · {item.locationCode}{item.expiryDate ? ` · Exp ${item.expiryDate}` : ''}</span></div>
            <div><span className="block text-[10px] font-bold uppercase text-[#829294]">On hand</span><strong>{quantity(item.onHand)}</strong></div><div><span className="block text-[10px] font-bold uppercase text-[#829294]">Reserved</span><strong>{quantity(item.reserved)}</strong></div><div><span className="block text-[10px] font-bold uppercase text-[#829294]">Available</span><strong className="text-[#16705b]">{quantity(item.available)}</strong></div>
            {canAdjust ? <button type="button" onClick={() => { setAdjustment(item); setMode('adjust'); }} className="min-h-10 rounded-lg border border-[#cedfdd] px-3 text-sm font-bold text-[#31585d]">Adjust</button> : null}
          </article>)}
        </div>
      </section>
    </div>
    {mode ? <div className="fixed inset-0 z-50 grid place-items-end bg-[#092f3666] sm:place-items-center"><form onSubmit={submit} className="w-full max-w-lg rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
      <div className="flex items-center justify-between"><div><p className="text-xs font-extrabold uppercase tracking-[.12em] text-[#277b69]">Inventory command</p><h2 className="mt-1 text-xl font-black">{mode === 'receive' ? 'Receive batch' : 'Adjust stock'}</h2></div><button type="button" onClick={closeEntry} className="size-11 rounded-xl border border-[#d4e1df]">×</button></div>
      <div className="mt-5 grid gap-4">
        {mode === 'receive' ? <><label className="text-sm font-bold">Product<select name="tallyKey" required className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] px-3"><option value="">Select Tally product</option>{data?.products.map((product) => <option key={product.tallyKey} value={product.tallyKey}>{product.name}</option>)}</select></label><label className="text-sm font-bold">Batch number<input name="batchNumber" required className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] px-3" /></label><div className="grid grid-cols-2 gap-3"><label className="text-sm font-bold">Expiry date<input name="expiryDate" type="date" className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] px-3" /></label><label className="text-sm font-bold">Quantity<input name="quantity" type="number" min="0.001" step="0.001" required className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] px-3" /></label></div><label className="text-sm font-bold">Source document <span className="font-normal text-[#718487]">(optional)</span><input name="sourceDocument" className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] px-3" placeholder="Supplier invoice or GRN" /></label></> : <><p className="rounded-xl bg-[#f2f7f5] p-3 text-sm"><strong>{adjustment?.name}</strong><br /><span className="text-[#718487]">Batch {adjustment?.batchNumber} · On hand {quantity(adjustment?.onHand || 0)}</span></p><label className="text-sm font-bold">Quantity change<input name="quantityDelta" type="number" step="0.001" required className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] px-3" placeholder="Use a negative number to reduce" /></label><label className="text-sm font-bold">Reason<input name="reason" minLength={3} required className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] px-3" /></label></>}
      </div><button disabled={busy} className="mt-6 min-h-12 w-full rounded-xl bg-[#092f36] px-5 font-bold text-white disabled:opacity-60">{busy ? 'Saving…' : mode === 'receive' ? 'Record receipt' : 'Record adjustment'}</button>
    </form></div> : null}
  </div>;
}

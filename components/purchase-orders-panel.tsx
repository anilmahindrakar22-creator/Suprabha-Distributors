'use client';

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetTitle } from './ui/sheet';
import { readJsonBody } from '@/lib/http-json';
import { purchaseOrderShareText, type PurchaseOrder, type SupplierOption } from '@/lib/purchase-orders';
import type { ToOrderItem } from '@/lib/to-order';

const button = 'min-h-11 rounded-lg border border-sf-line bg-sf-soft-0 px-3 text-sm font-semibold text-sf-body disabled:opacity-50';
const primary = 'min-h-12 rounded-lg bg-sf-ink px-3 text-sm font-semibold text-sf-soft-0 disabled:opacity-50';
const input = 'min-h-11 w-full min-w-0 rounded-lg border border-sf-line bg-sf-soft-0 p-2 text-sf-body';
const date = (value: string) => new Date(value).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' });

// Keep the exact command as well as its key until the server gives a definite result.
function usePurchaseOrderWrite(onConflict: () => void) {
  const pending = useRef<{ action: string; payload: Record<string, unknown> } | null>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState('');
  async function write<T>(action: string, payload: Record<string, unknown>): Promise<T | null> {
    if (busyRef.current) return null;
    busyRef.current = true;
    pending.current ??= { action, payload: { ...payload, idempotencyKey: crypto.randomUUID() } };
    setBusy(true); setLocked(true); setError('');
    try {
      const response = await fetch('/api/purchase-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.current) });
      const definite = response.ok || (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status));
      if (definite) { pending.current = null; setLocked(false); }
      if (response.status === 409) { onConflict(); throw new Error('This purchase order changed. Reload.'); }
      const body = await readJsonBody<T & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || 'Purchase order could not be saved. Retry.');
      return body;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Purchase order could not be saved. Retry.');
      return null;
    } finally { busyRef.current = false; setBusy(false); }
  }
  return { write, busy, locked, error };
}

function PurchaseOrderSheet({ title, locked, onClose, children }: { title: string; locked: boolean; onClose: () => void; children: ReactNode }) {
  return <Sheet open onOpenChange={(open) => { if (!open && !locked) onClose(); }}>
    <SheetContent side="bottom" showCloseButton={false} className="max-h-[90dvh] overflow-y-auto border-sf-line bg-sf-page p-4 text-sf-body sm:mx-auto sm:max-w-2xl" aria-describedby={undefined}>
      <div className="flex items-center justify-between gap-2"><SheetTitle render={<h2>{title}</h2>} className={title === 'Review purchase orders' ? 'text-sm font-bold text-sf-body' : 'text-sf-body'}>{title}</SheetTitle><button className={button} disabled={locked} onClick={onClose}>Close</button></div>
      {children}
    </SheetContent>
  </Sheet>;
}

type ReviewLine = { item: ToOrderItem; quantity: string; supplierName: string; options: SupplierOption[] | null; error: string };
export function PurchaseOrderReview({ items, onClose, onCreated, onConflict }: { items: ToOrderItem[]; onClose: () => void; onCreated: (orders: PurchaseOrder[]) => void; onConflict: () => void }) {
  const [lines, setLines] = useState<ReviewLine[]>(() => items.map((item) => ({ item, quantity: String(item.suggestedQty ?? 1), supplierName: item.lowestSupplier?.supplierName ?? '', options: null, error: '' })));
  const command = usePurchaseOrderWrite(onConflict);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all(items.map(async (item) => {
      try {
        const response = await fetch(`/api/purchase-orders?supplierOptions=${encodeURIComponent(item.itemKey)}`, { cache: 'no-store', signal: controller.signal });
        const body = await readJsonBody<{ suppliers: SupplierOption[]; error?: string }>(response);
        if (!response.ok || !Array.isArray(body.suppliers)) throw new Error(body.error || 'Suppliers could not be loaded.');
        const options = [...body.suppliers].sort((a, b) => Number(b.lowest) - Number(a.lowest));
        if (!controller.signal.aborted) setLines((previous) => previous.map((line) => line.item.itemKey === item.itemKey ? { ...line, options, error: '', supplierName: options.some((option) => option.supplierName === line.supplierName) ? line.supplierName : item.lowestSupplier ? options[0]?.supplierName ?? '' : '' } : line));
      } catch (cause) {
        if (!controller.signal.aborted) setLines((previous) => previous.map((line) => line.item.itemKey === item.itemKey ? { ...line, error: cause instanceof Error ? cause.message : 'Suppliers could not be loaded.' } : line));
      }
    }));
    return () => controller.abort();
  }, [items, attempt]);
  function update(key: string, change: Partial<ReviewLine>) { setLines((previous) => previous.map((line) => line.item.itemKey === key ? { ...line, ...change } : line)); }
  const eligible = lines.filter((line) => line.options?.length && line.supplierName);
  const count = new Set(eligible.map((line) => line.supplierName)).size;
  const groups = [...new Set(lines.map((line) => line.supplierName || 'Choose a supplier'))];
  return <PurchaseOrderSheet title="Review purchase orders" locked={command.locked} onClose={onClose}>
    <form className="min-w-0 space-y-4" onSubmit={async (event) => {
      event.preventDefault();
      const body = await command.write<{ purchaseOrders: PurchaseOrder[] }>('create_purchase_orders', { lines: eligible.map((line) => ({ itemKey: line.item.itemKey, quantity: Number(line.quantity), supplierName: line.supplierName })) });
      if (body) onCreated(body.purchaseOrders);
    }}>
      {groups.map((group) => <div key={group} className="min-w-0 space-y-3"><h3 className="break-words font-bold">{group}</h3>
        {lines.filter((line) => (line.supplierName || 'Choose a supplier') === group).map((line) => {
          const id = `po-${encodeURIComponent(line.item.itemKey)}`;
          return <fieldset key={line.item.itemKey} disabled={command.locked || line.options?.length === 0} className="min-w-0 space-y-2 rounded-lg border border-sf-line p-3">
            <legend className="max-w-full break-words font-semibold">{line.item.itemName}</legend>
            <div className="grid min-w-0 grid-cols-1 gap-3 min-[340px]:grid-cols-[6rem_minmax(0,1fr)]">
            <div className="min-w-0 space-y-2">
            <label htmlFor={`${id}-quantity`} className="block text-sm">Quantity</label>
            <input id={`${id}-quantity`} aria-label={`Quantity for ${line.item.itemName}`} type="number" min={1} max={1000000} step={1} required value={line.quantity} onChange={(e) => update(line.item.itemKey, { quantity: e.target.value })} className={input} />
            </div>
            <div className="min-w-0 space-y-2">
            <label htmlFor={`${id}-supplier`} className="block text-sm">Supplier</label>
            <select id={`${id}-supplier`} aria-label={`Supplier for ${line.item.itemName}`} className={input} required disabled={!line.options?.length} value={line.supplierName} onChange={(e) => update(line.item.itemKey, { supplierName: e.target.value })}>
              {!line.supplierName || !line.options?.length ? <option value="">{line.options ? 'Choose a supplier' : 'Loading suppliers…'}</option> : null}
              {line.options?.map((option) => <option key={option.supplierName} value={option.supplierName}>{option.supplierName}{option.lowest ? ' (lowest)' : ''}{Object.hasOwn(option, 'rate') ? ` · ₹${option.rate}` : ''}</option>)}
            </select>
            </div>
            </div>
            {line.options?.length === 0 ? <p className="text-sm text-sf-muted">No purchase price in Tally for {line.item.itemName}. This line will be left out of the purchase orders.</p> : null}
            {line.error ? <p role="alert">{line.error}</p> : null}
          </fieldset>;
        })}
      </div>)}
      {lines.some((line) => line.error) ? <button type="button" className={button} disabled={command.locked} onClick={() => setAttempt((value) => value + 1)}>Retry suppliers</button> : null}
      {command.error ? <p role="alert" className="text-sm text-sf-danger">{command.error}</p> : null}
      {command.locked && !command.busy ? <p className="text-sm text-sf-muted">Inputs are locked. Retry to confirm this purchase order request.</p> : null}
      <button type="submit" className={primary} disabled={command.busy || count === 0 || lines.some((line) => line.options === null || (line.options.length > 0 && !line.supplierName))}>{command.busy ? 'Creating…' : command.locked ? 'Retry creation' : `Create ${count} purchase order${count === 1 ? '' : 's'}`}</button>
    </form>
  </PurchaseOrderSheet>;
}

function PurchaseOrderCard({ po, onRefresh, onConflict }: { po: PurchaseOrder; onRefresh: () => void; onConflict: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<'receive' | 'cancel' | null>(null);
  const [received, setReceived] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const command = usePurchaseOrderWrite(onConflict);
  const sharing = usePurchaseOrderWrite(onConflict);
  return <article className="min-w-0 space-y-2 rounded-lg border border-sf-line bg-sf-soft-0 p-3" aria-label={po.poNumber}>
    <button className="min-h-11 w-full min-w-0 text-left" aria-label={`Details for ${po.poNumber}`} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><strong className="break-words">{po.poNumber}</strong><span className="mt-1 block break-words">{po.supplierName}</span></button>
    <div className="flex flex-wrap items-center gap-2 text-xs text-sf-muted"><span className="rounded-full bg-sf-soft-2 px-2 py-1">{po.status[0].toUpperCase() + po.status.slice(1)}</span><span>Created {date(po.createdAt)}</span><span>{po.lines.length} {po.lines.length === 1 ? 'item' : 'items'}</span></div>
    {po.sharedAt ? <p className="text-xs text-sf-muted">Shared {date(po.sharedAt)}</p> : null}
    {expanded ? <ul className="space-y-2 text-sm">{po.lines.map((line) => <li key={line.itemKey} className="break-words">{line.itemName} — {line.quantity} {line.unit}{line.receivedQuantity > 0 ? ` · received ${line.receivedQuantity}` : ''}{Object.hasOwn(line, 'rate') ? ` · ₹${line.rate ?? '—'}` : ''}</li>)}</ul> : null}
    {Object.hasOwn(po, 'total') ? <p className="text-sm font-semibold">Total ₹{po.total ?? '—'}</p> : null}
    {po.status === 'open' ? <div className="flex flex-wrap gap-2">
      <button className={button} aria-label={`Share ${po.poNumber}`} disabled={sharing.busy || command.locked} onClick={async () => {
        try {
          if (!sharing.locked) {
            const text = purchaseOrderShareText(po);
            if (navigator.share) await navigator.share({ title: po.poNumber, text });
            else { await navigator.clipboard.writeText(text); setNote('Copied'); }
          }
          const body = await sharing.write('mark_purchase_order_shared', { id: po.id, expectedVersion: po.version });
          if (body) onRefresh();
        } catch (cause) { setNote(cause instanceof Error ? cause.message : 'Sharing failed.'); }
      }}>{sharing.locked ? 'Retry share record' : 'Share'}</button>
      <button className={button} aria-label={`Mark received ${po.poNumber}`} disabled={sharing.locked || command.locked} onClick={() => { setReceived(Object.fromEntries(po.lines.map((line) => [line.itemKey, String(line.quantity)]))); setMode('receive'); }}>Mark received</button>
      <button className="min-h-11 px-3 text-sm font-semibold text-sf-danger disabled:opacity-50" aria-label={`Cancel PO ${po.poNumber}`} disabled={sharing.locked || command.locked} onClick={() => { setReason(''); setMode('cancel'); }}>Cancel PO</button>
    </div> : null}
    {note ? <output className="block text-xs text-sf-muted">{note}</output> : null}
    {sharing.error ? <output className="block text-xs text-sf-muted">Share record: {sharing.error}</output> : null}
    {mode ? <PurchaseOrderSheet title={`${mode === 'receive' ? 'Mark received' : 'Cancel PO'} ${po.poNumber}`} locked={command.locked} onClose={() => setMode(null)}>
      <form className="space-y-3" onSubmit={async (event) => {
        event.preventDefault();
        const body = await command.write(mode === 'receive' ? 'receive_purchase_order' : 'cancel_purchase_order', { id: po.id, expectedVersion: po.version,
          ...(mode === 'receive' ? { lines: po.lines.map((line) => ({ itemKey: line.itemKey, receivedQuantity: Number(received[line.itemKey]) })) } : { reason: reason.trim() }) });
        if (body) { setMode(null); onRefresh(); }
      }}>
        <fieldset disabled={command.locked} className="min-w-0 space-y-3">
          {mode === 'receive' ? po.lines.map((line, index) => <div key={line.itemKey}><label className="block text-sm" htmlFor={`receive-${po.id}-${index}`}>Received quantity for {line.itemName}</label><input className={input} id={`receive-${po.id}-${index}`} type="number" min={0} max={line.quantity} step="any" required value={received[line.itemKey] ?? ''} onChange={(e) => setReceived({ ...received, [line.itemKey]: e.target.value })} /></div>) : <div><label htmlFor={`reason-${po.id}`}>Reason</label><textarea id={`reason-${po.id}`} className={input} minLength={3} maxLength={300} required value={reason} onChange={(e) => setReason(e.target.value)} /></div>}
        </fieldset>
        {command.error ? <p role="alert" className="text-sm text-sf-danger">{command.error}</p> : null}
        {command.locked && !command.busy ? <p className="text-sm text-sf-muted">Inputs are locked. Retry to confirm this request.</p> : null}
        <button type="submit" className={primary} disabled={command.busy || (mode === 'cancel' && reason.trim().length < 3)}>{command.busy ? 'Saving…' : command.locked ? 'Retry' : mode === 'receive' ? 'Confirm received' : 'Confirm cancellation'}</button>
      </form>
    </PurchaseOrderSheet> : null}
  </article>;
}

export function PurchaseOrdersPanel({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [status, setStatus] = useState<PurchaseOrder['status']>('open');
  const [items, setItems] = useState<PurchaseOrder[]>([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [conflict, setConflict] = useState('');
  const request = useRef<AbortController | null>(null);
  async function load(nextPage: number, filter: PurchaseOrder['status']) {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/purchase-orders?page=${nextPage}&status=${filter}`, { cache: 'no-store', signal: controller.signal });
      const body = await readJsonBody<{ items: PurchaseOrder[]; total?: number; error?: string }>(response);
      if (!response.ok || !Array.isArray(body.items)) throw new Error(body.error || 'Purchase orders could not be loaded.');
      if (controller.signal.aborted) return;
      const combined = nextPage === 1 ? body.items : [...items, ...body.items];
      setItems(combined);
      setMore(body.total === undefined ? body.items.length === 20 : combined.length < body.total);
      setPage(nextPage);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Purchase orders could not be loaded.'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  const loadInitial = useEffectEvent((filter: PurchaseOrder['status']) => void load(1, filter));
  useEffect(() => {
    const timer = setTimeout(() => loadInitial(status), 0);
    return () => { clearTimeout(timer); request.current?.abort(); };
  }, [status, refreshKey, reload]);
  function refresh() { setReload((value) => value + 1); onChanged(); }
  return <section aria-label="Purchase orders" className="mt-3 min-w-0 space-y-3 rounded-xl border border-sf-line-soft bg-sf-soft p-3 text-sf-body">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold">Purchase orders</h2><button className={button} aria-label={'Refresh\u0020purchase orders'} disabled={loading} onClick={() => setReload((value) => value + 1)}>Refresh</button></div>
    <div className="flex flex-wrap gap-2">{(['open', 'received', 'cancelled'] as const).map((value) => <button key={value} className={status === value ? 'min-h-11 rounded-lg border border-sf-ink bg-sf-ink px-3 text-sm font-semibold text-sf-soft-0' : button} aria-pressed={status === value} onClick={() => { if (status !== value) { request.current?.abort(); setLoading(true); setPage(1); setItems([]); setMore(false); setConflict(''); setStatus(value); } }}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
    {error ? <p role="alert" className="text-sm text-sf-danger">{error}</p> : null}
    {conflict ? <p role="alert" className="text-sm text-sf-danger">{conflict}</p> : null}
    {items.map((po) => <PurchaseOrderCard key={po.id} po={po} onRefresh={refresh} onConflict={() => { setConflict('This purchase order changed. Reload.'); refresh(); }} />)}
    {loading ? <p className="text-sm text-sf-muted">Loading purchase orders…</p> : !items.length && !error ? <p className="text-sm text-sf-muted">No {status} purchase orders.</p> : null}
    {more ? <button className={button} disabled={loading} onClick={() => void load(page + 1, status)}>Load more</button> : null}
  </section>;
}

'use client';

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetTitle } from './ui/sheet';
import { readJsonBody } from '@/lib/http-json';
import { batchReceiptTotals, purchaseOrderShareText, stillDue, type PurchaseOrder, type SupplierOption } from '@/lib/purchase-orders';
import type { ToOrderItem } from '@/lib/to-order';
import { defaultSelection, parseTallyReceiptCounts, parseTallyReceipts, type TallyReceipts, type TallyReceiptLink } from '@/lib/po-tally-receipts';
import { UnlinkedReceipts } from './po-unlinked-receipts';
import { buildPoPdfContent } from '@/lib/po-pdf-content';
import { parseLetterhead } from '@/lib/letterhead';
import { logoBytes, parseLetterheadExtras } from '@/lib/letterhead-extras';
import type { StockFlowRole } from '@/lib/user-types';
import { parsePoCorrectionsWeek, type PoCorrectionsWeek, type PurchaseOrderLine, type PendingCorrection } from '@/lib/purchase-orders';
import { CorrectionSheet, ReviewSheet, ConfirmSupplierSheet, CorrectionHistory } from './po-correction';

let pdfFont: Promise<ArrayBuffer> | undefined;
let pdfBoldFont: Promise<ArrayBuffer | null> | undefined;
function loadPdfBoldFont() {
  return pdfBoldFont ??= fetch('/fonts/noto-sans-po-bold-subset.ttf').then((response) => {
    return response.ok ? response.arrayBuffer() : null;
  }).catch(() => null);
}
function loadPdfFont() {
  return pdfFont ??= fetch('/fonts/noto-sans-po-subset.ttf').then((response) => {
    if (!response.ok) throw new Error('Font could not be loaded');
    return response.arrayBuffer();
  }).catch((cause) => { pdfFont = undefined; throw cause; });
}
function loadPdfLetterhead() {
  return fetch('/api/letterhead', { cache: 'no-store' }).then(async (response) => {
    if (!response.ok) throw new Error('Letterhead could not be loaded');
    return parseLetterhead(await response.json());
  }).catch(() => null);
}
function loadPdfExtras() {
  return fetch('/api/letterhead/extras', { cache: 'no-store', signal: AbortSignal.timeout(15000) }).then(async response => {
    if (!response.ok) throw new Error('Logo and terms could not be loaded');
    const extras = parseLetterheadExtras(await response.json());
    const bytes = logoBytes(extras);
    return { logo: extras.logo && bytes ? { type: extras.logo.type, bytes } : null, terms: extras.terms };
  }).catch(() => null);
}
function downloadPdf(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const button = 'min-h-11 rounded-lg border border-sf-line bg-sf-soft-0 px-3 text-sm font-semibold text-sf-body disabled:opacity-50';
const primary = 'min-h-12 rounded-lg bg-sf-ink px-3 text-sm font-semibold text-sf-soft-0 disabled:opacity-50';
const input = 'min-h-11 w-full min-w-0 rounded-lg border border-sf-line bg-sf-soft-0 p-2 text-sf-body';
const date = (value: string) => new Date(value).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' });

type LatePo = { poNumber: string; supplierName: string; createdAt: string; lateDays: number; dueLines: number };
type LatePos = { view: 'late_pos'; leadTimeDays: number | null; total: number; items: LatePo[] };
function parseLatePos(value: unknown): LatePos {
  if (!value || typeof value !== 'object') throw new Error('Invalid late purchase orders');
  const body = value as Record<string, unknown>;
  if (body.view !== 'late_pos' || !Number.isInteger(body.total) || (body.total as number) < 0
    || !(body.leadTimeDays === null || (Number.isInteger(body.leadTimeDays) && (body.leadTimeDays as number) >= 1))
    || ((body.total as number) > 0 && body.leadTimeDays === null)
    || !Array.isArray(body.items) || body.items.length > 100 || !body.items.every((item: unknown) => {
      if (!item || typeof item !== 'object') return false;
      const row = item as Record<string, unknown>;
      return typeof row.poNumber === 'string' && row.poNumber.trim().length > 0 && row.poNumber.length <= 40
        && typeof row.supplierName === 'string' && typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt))
        && Number.isInteger(row.lateDays) && (row.lateDays as number) >= 1
        && Number.isInteger(row.dueLines) && (row.dueLines as number) >= 1;
    })) throw new Error('Invalid late purchase orders');
  return body as LatePos;
}

async function copyLatePo(po: LatePo): Promise<boolean> {
  const text = `${po.supplierName} – ${po.poNumber}, ${po.lateDays} ${po.lateDays === 1 ? 'day' : 'days'} late`;
  try { await navigator.clipboard.writeText(text); return true; } catch { /* Try the older clipboard API. */ }
  const field = document.createElement('textarea');
  try {
    field.value = text;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    // oxlint-disable-next-line typescript/no-deprecated -- Fallback when the clipboard API is unavailable.
    if (document.execCommand('copy')) return true;
  } catch { /* Copying is optional. */ }
  finally { field.remove(); }
  return false;
}

// Keep the exact command as well as its key until the server gives a definite result.
export function usePurchaseOrderWrite(onConflict: () => void, conflictMessage = 'This purchase order changed. Reload.') {
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
      if (response.status === 409) {
        onConflict();
        if (action === 'receive_from_tally') {
          const body = await readJsonBody<{ error?: string }>(response);
          throw new Error(body.error?.includes('Already recorded on another PO') ? 'Already recorded on another PO. Check and try again.' : conflictMessage);
        }
        throw new Error(conflictMessage);
      }
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

export function PurchaseOrderSheet({ title, locked, onClose, children }: { title: string; locked: boolean; onClose: () => void; children: ReactNode }) {
  return <Sheet open onOpenChange={(open) => { if (!open && !locked) onClose(); }}>
    <SheetContent side="bottom" showCloseButton={false} className="max-h-[90dvh] overflow-y-auto border-sf-line bg-sf-page p-4 text-sf-body sm:mx-auto sm:max-w-2xl" aria-describedby={undefined}>
      <div className="flex items-center justify-between gap-2"><SheetTitle render={<h2>{title}</h2>} className={title === 'Review purchase orders' ? 'text-sm font-bold text-sf-body' : 'text-sf-body'}>{title}</SheetTitle><button className={button} disabled={locked} onClick={onClose}>Close</button></div>
      {children}
    </SheetContent>
  </Sheet>;
}

type ReviewLine = { item: ToOrderItem; quantity: string; supplierName: string; options: SupplierOption[] | null; error: string };
export function PurchaseOrderReview({ items, onClose, onCreated, onConflict, preferLowest }: { items: ToOrderItem[]; onClose: () => void; onCreated: (orders: PurchaseOrder[]) => void; onConflict: () => void; preferLowest?: boolean }) {
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
        if (!controller.signal.aborted) setLines((previous) => previous.map((line) => line.item.itemKey === item.itemKey ? { ...line, options, error: '', supplierName: preferLowest ? line.supplierName || options.find((option) => option.lowest === true)?.supplierName || '' : options.some((option) => option.supplierName === line.supplierName) ? line.supplierName : item.lowestSupplier ? options[0]?.supplierName ?? '' : '' } : line));
      } catch (cause) {
        if (!controller.signal.aborted) setLines((previous) => previous.map((line) => line.item.itemKey === item.itemKey ? { ...line, error: cause instanceof Error ? cause.message : 'Suppliers could not be loaded.' } : line));
      }
    }));
    return () => controller.abort();
  }, [items, attempt, preferLowest]);
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

function TallyReceiveSheet({ po, onClose, onRefresh, onConflict }: { po: PurchaseOrder; onClose: () => void; onRefresh: () => void; onConflict: () => void }) {
  const [receipts, setReceipts] = useState<TallyReceipts | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [manual, setManual] = useState(false);
  const [selected, setSelected] = useState<TallyReceiptLink[]>([]);
  const [now, setNow] = useState<Record<string, string>>(() => Object.fromEntries(po.lines.map((line) => [line.itemKey, ''])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const hasCandidates = receipts?.lines.some((line) => line.candidates.length > 0) ?? false;
  const fromTally = hasCandidates && !manual;
  const command = usePurchaseOrderWrite(() => {
    if (fromTally) { setLoading(true); setAttempt((value) => value + 1); onRefresh(); }
    else onConflict();
  }, fromTally ? 'This PO changed; check and try again' : 'This purchase order changed. Reload.');
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/purchase-orders?tallyReceipts=${encodeURIComponent(po.id)}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Tally read failed');
        const body = parseTallyReceipts(await readJsonBody<unknown>(response));
        if (body.poId !== po.id) throw new Error('Wrong purchase order');
        if (!controller.signal.aborted) { setReceipts(body); setSelected(defaultSelection(body.lines)); setFailed(false); }
      } catch {
        if (!controller.signal.aborted) { setReceipts(null); setSelected([]); setFailed(true); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [po.id, attempt]);
  const sameLink = (a: TallyReceiptLink, b: TallyReceiptLink) => a.itemKey === b.itemKey && a.sourceId === b.sourceId && a.lineKey === b.lineKey;
  return <PurchaseOrderSheet title={`Mark received ${po.poNumber}`} locked={command.locked} onClose={onClose}>
    <form className="min-w-0 space-y-3" noValidate={!fromTally} onSubmit={async (event) => {
      event.preventDefault();
      if (loading || (fromTally && !selected.length)) return;
      const result = fromTally ? null : batchReceiptTotals(po.lines, now);
      if (result && !result.ok) { setErrors(result.errors); return; }
      setErrors({});
      const body = await command.write(fromTally ? 'receive_from_tally' : 'receive_purchase_order', {
        id: po.id, expectedVersion: fromTally ? receipts!.version : po.version,
        ...(fromTally ? { links: selected } : { lines: result?.ok ? result.lines : [] }),
      });
      if (body) { onClose(); onRefresh(); }
    }}>
      {loading ? <p className="text-sm text-sf-muted">Loading Tally receipts…</p> : <>
        {hasCandidates ? <>
          <fieldset disabled={command.locked} className="min-w-0 space-y-3">
            <legend className="font-semibold">From Tally</legend>
            {receipts!.lines.map((line) => <div key={line.itemKey} className="min-w-0 space-y-2">
              <p className="break-words text-sm font-semibold">{line.itemName}</p>
              {line.candidates.map((candidate) => {
                const link = { itemKey: line.itemKey, sourceId: candidate.sourceId, lineKey: candidate.lineKey };
                const label = `${new Date(`${candidate.date}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })} · ${candidate.reference} · ${candidate.quantity} ${candidate.unit}`;
                return candidate.selectable ? <label key={JSON.stringify(link)} className="flex min-h-11 min-w-0 items-center gap-2 text-sm">
                  <input type="checkbox" className="shrink-0" checked={selected.some((entry) => sameLink(entry, link))} onChange={(event) => setSelected((previous) => event.target.checked ? [...previous, link] : previous.filter((entry) => !sameLink(entry, link)))} />
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">{label}</span>
                </label> : <p key={JSON.stringify(link)} className="break-words text-sm text-sf-muted [overflow-wrap:anywhere]">{label} — {candidate.reason === 'unit_mismatch' ? 'different unit, enter by hand' : `more than still due (${line.remaining})`}</p>;
              })}
            </div>)}
          </fieldset>
          <button type="button" className={button} aria-expanded={manual} disabled={command.locked} onClick={() => setManual(!manual)}>{manual ? 'Use Tally receipts' : 'Enter quantities by hand'}</button>
        </> : null}
        {failed ? <p className="text-sm text-sf-muted">Tally receipts could not load</p> : null}
        {!fromTally ? <fieldset disabled={command.locked} className="min-w-0 space-y-3">
          {po.lines.map((line, index) => {
            const still = stillDue(line);
            return <div key={line.itemKey} className="space-y-2">
              <p className="break-words text-sm font-semibold">{line.itemName}</p>
              <p className="text-sm text-sf-muted">Ordered {line.quantity}{line.unit ? ` ${line.unit}` : ''} · received {line.receivedQuantity} · still due {still}</p>
              {still > 0 ? <>
                <label className="block text-sm" htmlFor={`receive-${po.id}-${index}`}>Received now for {line.itemName}</label>
                <input className={input} id={`receive-${po.id}-${index}`} type="number" min={0} max={still} step="any" value={now[line.itemKey] ?? ''} onChange={(event) => setNow({ ...now, [line.itemKey]: event.target.value })} />
                {errors[line.itemKey] ? <p role="alert" className="text-sm text-sf-danger">{errors[line.itemKey]}</p> : null}
              </> : <p className="text-sm text-sf-muted">Fully received</p>}
            </div>;
          })}
        </fieldset> : null}
      </>}
      {command.error ? <p role="alert" className="text-sm text-sf-danger">{command.error}</p> : null}
      {command.locked && !command.busy ? <p className="text-sm text-sf-muted">Inputs are locked. Retry to confirm this request.</p> : null}
      {!fromTally && errors._ ? <p role="alert" className="text-sm text-sf-danger">{errors._}</p> : null}
      <div className="sticky bottom-0 bg-sf-page py-2"><button type="submit" className={`${primary} w-full`} disabled={loading || command.busy || (fromTally && selected.length === 0)}>{command.busy ? 'Saving…' : fromTally ? 'Record Tally receipt' : command.locked ? 'Retry' : 'Confirm received'}</button></div>
    </form>
  </PurchaseOrderSheet>;
}

function PurchaseOrderCard({ po, roles, actorEmail, tallyCount, lateDays, onRefresh, onConflict, autoReceive, onAutoReceiveDone }: { po: PurchaseOrder; roles: readonly StockFlowRole[]; actorEmail: string; tallyCount: number; lateDays?: number; onRefresh: () => void; onConflict: () => void; autoReceive?: boolean; onAutoReceiveDone: () => void }) {
  const canReview = roles.includes('management') || roles.includes('administrator');
  const [history, setHistory] = useState(false);
  const [correctLine, setCorrectLine] = useState<PurchaseOrderLine | null>(null);
  const [reviewRequest, setReviewRequest] = useState<PendingCorrection | null>(null);
  const [confirmSupplier, setConfirmSupplier] = useState(false);
  const [shareChannel, setShareChannel] = useState<'text' | 'pdf' | null>(null);
  function correctionDone(message: string) { setCorrectLine(null); setReviewRequest(null); setConfirmSupplier(false); setNote(message); onRefresh(); }
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<'receive' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const command = usePurchaseOrderWrite(onConflict);
  const sharing = usePurchaseOrderWrite(onConflict);
  async function preparePdf() {
    if (sharing.locked) {
      const body = await sharing.write('mark_purchase_order_shared', { id: po.id, expectedVersion: po.version, channel: 'pdf' });
      if (body) onRefresh();
      return;
    }
    setPdfBusy(true);
    setNote('');
    try {
      const [{ renderPoPdf }, font, letterhead, boldFont, extras] = await Promise.all([
        import('@/lib/po-pdf-render'), loadPdfFont(), loadPdfLetterhead(), loadPdfBoldFont(), loadPdfExtras(),
      ]);
      const content = buildPoPdfContent(po, letterhead, extras);
      const bytes = await renderPoPdf(content, font, boldFont);
      const file = new File([new Uint8Array(bytes)], content.fileName, { type: 'application/pdf' });
      let delivered = false;
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: po.poNumber }); delivered = true; }
        catch (cause) { if (cause instanceof Error && cause.name === 'AbortError') return; }
      }
      if (!delivered) downloadPdf(file);
      if (po.status === 'open') {
        setShareChannel('pdf');
        const body = await sharing.write('mark_purchase_order_shared', { id: po.id, expectedVersion: po.version, channel: 'pdf' });
        if (body) onRefresh();
      }
    } catch (cause) { if (!(cause instanceof Error && cause.name === 'AbortError')) setNote('PDF could not be prepared. Try again.'); }
    finally { setPdfBusy(false); }
  }
  const pdfButton = <button className={button} aria-label={`PDF ${po.poNumber}`} disabled={pdfBusy || sharing.busy || command.locked || (sharing.locked && shareChannel !== 'pdf')} onClick={preparePdf}>{pdfBusy ? 'Preparing…' : sharing.locked && shareChannel === 'pdf' ? 'Retry share record' : 'PDF'}</button>;
  const autoReceiveDone = useEffectEvent(onAutoReceiveDone);
  useEffect(() => {
    if (!autoReceive) return;
    const timer = setTimeout(() => { setMode('receive'); autoReceiveDone(); }, 0);
    return () => clearTimeout(timer);
  }, [autoReceive]);
  return <article className="min-w-0 space-y-2 rounded-lg border border-sf-line bg-sf-soft-0 p-3" aria-label={po.poNumber}>
    <button className="min-h-11 w-full min-w-0 text-left" aria-label={`Details for ${po.poNumber}`} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><strong className="break-words">{po.poNumber}</strong><span className="mt-1 block break-words">{po.supplierName}</span></button>
    <div className="flex flex-wrap items-center gap-2 text-xs text-sf-muted"><span className="rounded-full bg-sf-soft-2 px-2 py-1">{po.status[0].toUpperCase() + po.status.slice(1)}</span>{po.status === 'open' && lateDays ? <span className="rounded-full border border-sf-danger px-2 py-1 text-sf-danger">{lateDays} {lateDays === 1 ? 'day' : 'days'} late</span> : null}<span>Created {date(po.createdAt)}</span><span>{po.lines.length} {po.lines.length === 1 ? 'item' : 'items'}</span>
      {(po.revisionCount ?? 0) > 0 ? <button className="min-h-11 rounded-full bg-sf-soft-2 px-2 py-1" aria-expanded={history} onClick={() => setHistory(!history)}>Revised ({po.revisionCount})</button> : null}
      {po.status === 'open' && !!po.pendingCorrections?.length ? <span className="rounded-full border border-sf-warning px-2 py-1 text-sf-warning">Correction waiting</span> : null}
      {po.status === 'open' && po.resendNeeded ? <span className="rounded-full border border-sf-danger px-2 py-1 text-sf-danger">Re-send needed</span> : null}
    </div>
    {po.status === 'open' && tallyCount > 0 ? <span className="inline-block rounded-full bg-sf-soft-2 px-2 py-1 text-xs text-sf-muted">Tally shows a receipt</span> : null}
    {history ? <CorrectionHistory po={po} /> : null}
    {po.sharedAt ? <p className="text-xs text-sf-muted">Shared {date(po.sharedAt)}</p> : null}
    {po.supplierConfirmedAt ? <p className="text-xs text-sf-muted">Supplier confirmed {date(po.supplierConfirmedAt)}</p> : null}
    {expanded ? <ul className="min-w-0 space-y-2 text-sm">{po.lines.map((line) => {
      const pending = po.pendingCorrections?.find(request => request.itemKey === line.itemKey);
      return <li key={line.itemKey} className="min-w-0 break-words [overflow-wrap:anywhere]"><span>{line.itemName} — {line.quantity} {line.unit}{line.receivedQuantity > 0 ? ` · received ${line.receivedQuantity}` : ''}{Object.hasOwn(line, 'rate') ? ` · ₹${line.rate ?? '—'}` : ''}{line.originalQuantity !== undefined && line.originalQuantity !== line.quantity ? ` (first ${line.originalQuantity})` : ''}</span>
        {po.status === 'open' ? <div className="mt-1">{line.locked ? <span className="text-xs text-sf-muted">Locked: Tally receipt</span> : pending ? <span className="text-xs text-sf-muted">Waiting: {pending.fromQuantity} → {pending.toQuantity}</span> : <button className={button} aria-label={`Correct quantity for ${line.itemName}`} disabled={sharing.locked || command.locked || pdfBusy} onClick={() => setCorrectLine(line)}>Correct</button>}</div> : null}
      </li>;
    })}</ul> : null}
    {po.status === 'open' && !!po.pendingCorrections?.length ? <ul className="min-w-0 space-y-2 text-sm">{po.pendingCorrections.map(request => <li key={request.requestId} className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
      <p>{po.lines.find(line => line.itemKey === request.itemKey)?.itemName ?? request.itemKey}: {request.fromQuantity} → {request.toQuantity} · by {request.requestedByEmail}</p>
      {canReview && request.requestedByEmail.toLowerCase() !== actorEmail.toLowerCase() ? <button className={button} aria-label={`Review correction for ${po.lines.find(line => line.itemKey === request.itemKey)?.itemName ?? request.itemKey}`} disabled={sharing.locked || command.locked || pdfBusy} onClick={() => setReviewRequest(request)}>Review</button> : null}
    </li>)}</ul> : null}
    {Object.hasOwn(po, 'totalValue') ? <p className="text-sm font-semibold">Total ₹{po.totalValue ?? '—'}</p> : null}
    {po.status === 'open' ? <div className="flex flex-wrap gap-2">
      <button className={button} aria-label={`Share ${po.poNumber}`} disabled={sharing.busy || command.locked || pdfBusy || (sharing.locked && shareChannel !== 'text')} onClick={async () => {
        try {
          if (!sharing.locked) {
            const text = purchaseOrderShareText(po);
            if (navigator.share) await navigator.share({ title: po.poNumber, text });
            else { await navigator.clipboard.writeText(text); setNote('Copied'); }
          }
          setShareChannel('text');
          const body = await sharing.write('mark_purchase_order_shared', { id: po.id, expectedVersion: po.version, channel: 'text' });
          if (body) onRefresh();
        } catch (cause) { setNote(cause instanceof Error ? cause.message : 'Sharing failed.'); }
      }}>{sharing.locked ? 'Retry share record' : po.resendNeeded ? 'Re-send' : 'Share'}</button>
      {pdfButton}
      {po.sharedAt && !po.resendNeeded && !po.supplierConfirmedAt ? <button className={button} disabled={sharing.locked || command.locked || pdfBusy} onClick={() => setConfirmSupplier(true)}>Supplier confirmed</button> : null}
      <button className={button} aria-label={`Mark received ${po.poNumber}`} disabled={sharing.locked || command.locked || pdfBusy} onClick={() => setMode('receive')}>Mark received</button>
      <button className="min-h-11 px-3 text-sm font-semibold text-sf-danger disabled:opacity-50" aria-label={`Cancel PO ${po.poNumber}`} disabled={sharing.locked || command.locked || pdfBusy} onClick={() => { setReason(''); setMode('cancel'); }}>Cancel PO</button>
    </div> : null}
    {po.status === 'received' ? <div className="flex flex-wrap gap-2">{pdfButton}</div> : null}
    {note ? <output className="block text-xs text-sf-muted">{note}</output> : null}
    {correctLine ? <CorrectionSheet po={po} line={correctLine} onClose={() => setCorrectLine(null)} onDone={correctionDone} onConflict={onConflict} /> : null}
    {reviewRequest ? <ReviewSheet po={po} request={reviewRequest} onClose={() => setReviewRequest(null)} onDone={correctionDone} onConflict={onConflict} /> : null}
    {confirmSupplier ? <ConfirmSupplierSheet po={po} onClose={() => setConfirmSupplier(false)} onDone={correctionDone} onConflict={onConflict} /> : null}
    {sharing.error ? <output className="block text-xs text-sf-muted">Share record: {sharing.error}</output> : null}
    {mode === 'receive' ? <TallyReceiveSheet po={po} onClose={() => setMode(null)} onRefresh={onRefresh} onConflict={onConflict} /> : null}
    {mode && mode !== 'receive' ? <PurchaseOrderSheet title={`Cancel PO ${po.poNumber}`} locked={command.locked} onClose={() => setMode(null)}>
      <form className="space-y-3" onSubmit={async (event) => {
        event.preventDefault();
        const body = await command.write('cancel_purchase_order', { id: po.id, expectedVersion: po.version, reason: reason.trim() });
        if (body) { setMode(null); onRefresh(); }
      }}>
        <fieldset disabled={command.locked} className="min-w-0 space-y-3">
          <div><label htmlFor={`reason-${po.id}`}>Reason</label><textarea id={`reason-${po.id}`} className={input} minLength={3} maxLength={300} required value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        </fieldset>
        {command.error ? <p role="alert" className="text-sm text-sf-danger">{command.error}</p> : null}
        {command.locked && !command.busy ? <p className="text-sm text-sf-muted">Inputs are locked. Retry to confirm this request.</p> : null}
        <button type="submit" className={primary} disabled={command.busy || reason.trim().length < 3}>{command.busy ? 'Saving…' : command.locked ? 'Retry' : 'Confirm cancellation'}</button>
      </form>
    </PurchaseOrderSheet> : null}
  </article>;
}

export function PurchaseOrdersPanel({ refreshKey, onChanged, roles, actorEmail }: { refreshKey: number; onChanged: () => void; roles: readonly StockFlowRole[]; actorEmail: string }) {
  const canReview = roles.includes('management') || roles.includes('administrator');
  const [week, setWeek] = useState<PoCorrectionsWeek | null>(null);
  const [showWeek, setShowWeek] = useState(false);
  const [status, setStatus] = useState<PurchaseOrder['status']>('open');
  const [items, setItems] = useState<PurchaseOrder[]>([]);
  const [tallyCounts, setTallyCounts] = useState<Record<string, number>>({});
  const [latePos, setLatePos] = useState<LatePos | null>(null);
  const [showLate, setShowLate] = useState(false);
  const [copiedPo, setCopiedPo] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [conflict, setConflict] = useState('');
  const [focusPo, setFocusPo] = useState<{ id: string; poNumber: string } | null>(null);
  const [poNotice, setPoNotice] = useState('');
  const request = useRef<AbortController | null>(null);
  async function load(nextPage: number, filter: PurchaseOrder['status']) {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError('');
    if (nextPage === 1) {
      setWeek(null);
      if (canReview) void (async () => {
        try {
          const response = await fetch('/api/purchase-orders?corrections=week', { cache: 'no-store', signal: controller.signal });
          if (!response.ok) throw new Error('Corrections unavailable');
          const body = parsePoCorrectionsWeek(await readJsonBody<unknown>(response));
          if (!controller.signal.aborted) setWeek(body);
        } catch { if (!controller.signal.aborted) setWeek(null); }
      })();
      setLatePos(null);
      void (async () => {
      try {
        const response = await fetch('/api/requirements?view=late_pos', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Late purchase orders unavailable');
        const body = parseLatePos(await readJsonBody<unknown>(response));
        if (!controller.signal.aborted) setLatePos(body);
      } catch {
        if (!controller.signal.aborted) setLatePos(null);
      }
      })();
    }
    try {
      const response = await fetch(`/api/purchase-orders?page=${nextPage}&status=${filter}`, { cache: 'no-store', signal: controller.signal });
      const body = await readJsonBody<{ items: PurchaseOrder[]; total?: number; error?: string }>(response);
      if (!response.ok || !Array.isArray(body.items)) throw new Error(body.error || 'Purchase orders could not be loaded.');
      if (controller.signal.aborted) return;
      const combined = nextPage === 1 ? body.items : [...items, ...body.items];
      setItems(combined);
      setMore(body.total === undefined ? body.items.length === 20 : combined.length < body.total);
      setPage(nextPage);
      if (nextPage === 1) setTallyCounts({});
      const ids = [...new Set(body.items.filter((po) => po.status === 'open').map((po) => po.id))].slice(0, 20);
      if (ids.length) void (async () => {
        try {
          const countsResponse = await fetch(`/api/purchase-orders?tallyReceiptCounts=${encodeURIComponent(ids.join(','))}`, { cache: 'no-store', signal: controller.signal });
          if (!countsResponse.ok) return;
          const result = parseTallyReceiptCounts(await readJsonBody<unknown>(countsResponse));
          if (!controller.signal.aborted) setTallyCounts((previous) => ({ ...previous, ...Object.fromEntries(ids.map((id) => [id, result.counts[id] ?? 0])) }));
        } catch { /* Advisory counts never interrupt the list. */ }
      })();
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Purchase orders could not be loaded.'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  const loadInitial = useEffectEvent((filter: PurchaseOrder['status']) => void load(1, filter));
  useEffect(() => {
    const timer = setTimeout(() => loadInitial(status), 0);
    return () => { clearTimeout(timer); request.current?.abort(); };
  }, [status, refreshKey, reload, canReview]);
  function openPo(id: string, poNumber: string) {
    setPoNotice('');
    if (items.some((po) => po.id === id && po.status === 'open')) setFocusPo({ id, poNumber });
    else if (status !== 'open') {
      request.current?.abort(); setLoading(true); setPage(1); setItems([]); setMore(false); setConflict(''); setStatus('open');
      setFocusPo({ id, poNumber });
    } else setPoNotice(`Find ${poNumber} in Open and use Mark received.`);
  }
  useEffect(() => {
    if (!loading && focusPo && !items.some((po) => po.id === focusPo.id)) {
      const timer = setTimeout(() => {
        setPoNotice(`Find ${focusPo.poNumber} in Open and use Mark received.`);
        setFocusPo(null);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [loading, focusPo, items]);
  function refresh() { setReload((value) => value + 1); onChanged(); }
  return <section aria-label="Purchase orders" className="mt-3 min-w-0 space-y-3 rounded-xl border border-sf-line-soft bg-sf-soft p-3 text-sf-body">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold">Purchase orders</h2><button className={button} aria-label={'Refresh\u0020purchase orders'} disabled={loading} onClick={() => setReload((value) => value + 1)}>Refresh</button></div>
    <div className="flex flex-wrap gap-2">{(['open', 'received', 'cancelled'] as const).map((value) => <button key={value} className={status === value ? 'min-h-11 rounded-lg border border-sf-ink bg-sf-ink px-3 text-sm font-semibold text-sf-soft-0' : button} aria-pressed={status === value} onClick={() => { if (status !== value) { request.current?.abort(); setLoading(true); setPage(1); setItems([]); setMore(false); setConflict(''); setStatus(value); } }}>{value[0].toUpperCase() + value.slice(1)}</button>)}{latePos && latePos.total > 0 ? <button className={button.replace('text-sf-body', 'text-sf-danger').replace('border-sf-line', showLate ? 'border-sf-danger' : 'border-sf-line')} aria-pressed={showLate} onClick={() => setShowLate(!showLate)}>{latePos.total} late</button> : null}{canReview && week && week.items.length > 0 ? <button className={button} aria-pressed={showWeek} onClick={() => setShowWeek(!showWeek)}>{week.items.length} corrections this week</button> : null}</div>
    {latePos && latePos.total > 0 && showLate ? <section aria-label="Late purchase orders" className="min-w-0 space-y-3 rounded-lg border border-sf-line p-3">
      <div><h3 className="text-sm font-bold">Late purchase orders</h3><p className="text-sm text-sf-muted">Open longer than the {latePos.leadTimeDays}-day delivery time.</p></div>
      <ul className="min-w-0 space-y-3">{latePos.items.map((po) => <li key={po.poNumber} className="min-w-0 space-y-1">
        <p className="break-words text-sm [overflow-wrap:anywhere]">{po.poNumber} · {po.supplierName}</p>
        <p className="text-sm text-sf-muted">{po.lateDays} {po.lateDays === 1 ? 'day' : 'days'} late · {po.dueLines} {po.dueLines === 1 ? 'line' : 'lines'} due</p>
        <button className={button} onClick={async () => {
          const copied = await copyLatePo(po);
          if (!copied) return;
          setCopiedPo(po.poNumber);
          if (copiedTimer.current) clearTimeout(copiedTimer.current);
          copiedTimer.current = setTimeout(() => setCopiedPo((current) => current === po.poNumber ? null : current), 2000);
        }}>{copiedPo === po.poNumber ? 'Copied' : 'Copy supplier and PO'}</button>
        {copiedPo === po.poNumber ? <span className="sr-only" aria-live="polite">Copied supplier and purchase order.</span> : null}
      </li>)}</ul>
      {latePos.total > latePos.items.length ? <p className="text-sm text-sf-muted">Showing the 100 most late</p> : null}
    </section> : null}
    {canReview && week && week.items.length > 0 && showWeek ? <section aria-label="Corrections this week" className="min-w-0 space-y-3 rounded-lg border border-sf-line p-3">
      <div><h3 className="text-sm font-bold">Corrections this week</h3><p className="text-sm text-sf-muted">Corrected or requested in the last 7 days.</p></div>
      <ul className="min-w-0 space-y-3">{week.items.map(item => <li key={item.poId} className="min-w-0 space-y-1 text-sm [overflow-wrap:anywhere]">
        <p>{item.poNumber} · {item.supplierName}</p><p className="text-sf-muted">{item.corrections} corrections · {item.pending} waiting</p>
        <div className="flex flex-wrap gap-2 text-xs text-sf-muted">{([
          ['byCreator', 'Raised by PO creator'], ['moreThanTwo', 'More than 2 corrections'], ['beforeReceipt', 'Corrected within 24 h before receipt'], ['notResent', 'Not re-sent'],
        ] as const).map(([flag, label]) => item.flags[flag] ? <span key={flag} className="rounded-full border border-sf-line px-2 py-1">{label}</span> : null)}</div>
      </li>)}</ul>
    </section> : null}
    <UnlinkedReceipts refreshKey={refreshKey + reload} onOpenPo={openPo} />
    {poNotice ? <p className="text-sm text-sf-muted">{poNotice}</p> : null}
    {error ? <p role="alert" className="text-sm text-sf-danger">{error}</p> : null}
    {conflict ? <p role="alert" className="text-sm text-sf-danger">{conflict}</p> : null}
    {items.map((po) => <PurchaseOrderCard key={po.id} po={po} roles={roles} actorEmail={actorEmail} tallyCount={tallyCounts[po.id] ?? 0} lateDays={latePos?.items.find((late) => late.poNumber === po.poNumber)?.lateDays} autoReceive={focusPo?.id === po.id} onAutoReceiveDone={() => setFocusPo(null)} onRefresh={refresh} onConflict={() => { setConflict('This purchase order changed. Reload.'); refresh(); }} />)}
    {loading ? <p className="text-sm text-sf-muted">Loading purchase orders…</p> : !items.length && !error ? <p className="text-sm text-sf-muted">No {status} purchase orders.</p> : null}
    {more ? <button className={button} disabled={loading} onClick={() => void load(page + 1, status)}>Load more</button> : null}
  </section>;
}

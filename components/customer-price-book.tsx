'use client';

import { useEffect, useRef, useState } from 'react';
import { loadOrderCatalog, loadOrderCustomers } from '@/lib/order-capture-masters';
import type { CatalogItem, CustomerDirectoryEntry } from '@/lib/order-types';
import type { PricingCommand } from '@/lib/pricing-types';

type Row = {
  currentDecisionId: string | null; customerId: string; customerName: string; tallyKey: string; itemName: string; evidenceHash: string;
  recommendationReason?: string; pricingDate: string; fixed: boolean; lastRate: number | null; lastInvoiceDate: string | null; lastInvoiceReference: string | null;
  historicCost: number | null; currentCost: number | null; costChange: number | null;
  continuity: number | null; target: number | null; recommended: number | null;
  continuityGP: number | null; continuityMargin: number | null; recommendedGP: number | null; recommendedMargin: number | null;
  differenceToCustomer: number | null; additionalGP: number | null; status: string; warnings: string[];
};
type Page = { rows: Row[]; hasMore: boolean; offset: number; previewHash?: string; customerCount?: number; protectedCount?: number; reviewCount?: number; targetAboveContinuityCount?: number; materialIncreaseCount?: number; continuityCount?: number; belowMinimumCount?: number; baseEvidence?: Row };
const money = (value: number | null) => value == null ? 'Unavailable' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);
const field = 'mt-1 min-h-11 w-full rounded-lg border border-[#cedfdd] bg-white px-3 text-sm';
const button = 'min-h-11 rounded-xl border border-[#b9d5cd] bg-white px-4 text-sm font-bold text-[#174a43] disabled:opacity-40';

async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || 'Pricing could not load');
  return data;
}
async function send(command: PricingCommand) {
  const response = await fetch('/api/pricing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command) });
  const data = await response.json() as { error?: string; applied?: number; skipped?: number };
  if (!response.ok) throw new Error(data.error || 'Decision could not be saved');
  return data as { applied?: number; skipped?: number };
}

export function CustomerPriceBook({ actorEmail, actorRole }: { actorEmail: string; actorRole: string }) {
  // Memory only: never persist restricted commercial payloads in browser storage.
  const pendingCommands = useRef(new Map<string, PricingCommand>());
  async function mutate(command: PricingCommand) {
    const fingerprint = JSON.stringify([actorEmail, actorRole, command.action, { ...command.payload, idempotencyKey: undefined }]);
    const pending = pendingCommands.current.get(fingerprint) ?? command;
    pendingCommands.current.set(fingerprint, pending);
    const result = await send(pending);
    pendingCommands.current.delete(fingerprint);
    return result;
  }
  const [mode, setMode] = useState<'customer' | 'impact' | 'base'>('customer');
  const [customers, setCustomers] = useState<CustomerDirectoryEntry[]>([]);
  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [query, setQuery] = useState(''); const [selected, setSelected] = useState('');
  const [tab, setTab] = useState('purchased'); const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null); const [loading, setLoading] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [revision, setRevision] = useState(0);
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const [basePrice, setBasePrice] = useState(''); const [validFrom, setValidFrom] = useState('');
  const canApprove = ['administrator', 'management'].includes(actorRole);

  useEffect(() => {
    let active = true;
    (mode === 'customer' ? loadOrderCustomers(actorEmail).then((result) => { if (active) setCustomers(result.customers); }) : loadOrderCatalog(actorEmail).then((result) => { if (active) setProducts(result.catalog); })).catch(() => { if (active) setError('Customer or product list could not load. Reopen Pricing to retry.'); });
    return () => { active = false; };
  }, [actorEmail, mode]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => { setLoading(true); setError(''); setPage(null); }, 0);
    const params = new URLSearchParams(mode === 'customer' ? { book: '1', customerId: selected, tab, offset: String(offset) } : { impact: '1', tallyKey: selected, offset: String(offset) });
    read<Page>(`/api/pricing?${params}`, controller.signal).then(setPage).catch((failure) => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { window.clearTimeout(loadingTimer); if (!controller.signal.aborted) setLoading(false); });
    return () => { window.clearTimeout(loadingTimer); controller.abort(); };
  }, [selected, mode, tab, offset, revision]);

  async function apply(choice: 'continuity' | 'recommended') {
    if (!page?.previewHash || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await mutate({ action: 'apply_product_price_impact', payload: { tallyKey: selected, choice, previewHash: page.previewHash, reason, idempotencyKey: crypto.randomUUID() } });
      setNotice(`${result.applied} customer prices accepted. ${result.skipped} protected or missing-evidence rows skipped.`); setRevision((value) => value + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Decision failed'); }
    finally { setBusy(false); }
  }
  async function saveBase() {
    setBusy(true); setError(''); setNotice('');
    try { await mutate({ action: 'set_standard_item_price', payload: { previewHash: page?.previewHash || '', tallyKey: selected, price: Number(basePrice), validFrom, reason, idempotencyKey: crypto.randomUUID() } }); setNotice('Base price saved. It applies where no genuine customer history or fixed agreement exists.'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Base price failed'); }
    finally { setBusy(false); }
  }
  const options = mode === 'customer' ? customers.map((c) => ({ id: c.id, name: c.name })) : products.filter((p) => p.active).map((p) => ({ id: p.tallyKey, name: p.item }));
  const matches = query.trim().length >= 2 && !selected ? options.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())).slice(0, 10) : [];

  return <section className="rounded-2xl border border-[#dce7e5] bg-white p-4 sm:p-5">
    <h2 className="text-xl font-extrabold">Price book</h2>
    <nav aria-label="Pricing workbench" className="mt-3 flex flex-wrap gap-2">{([['customer','Customer prices'],['impact','Purchase-cost review'],['base','Base / default prices']] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={mode === value} className={`${button} ${mode === value ? 'bg-[#e8f5ef]' : ''}`} onClick={() => { setMode(value); setSelected(''); setQuery(''); setPage(null); setOffset(0); setError(''); setNotice(''); }}>{label}</button>)}</nav>
    <div className="relative mt-4 max-w-xl"><label className="text-sm font-bold">{mode === 'customer' ? 'Select customer' : 'Select product'}<input className={field} value={query} placeholder="Type at least two letters" onChange={(event) => { setQuery(event.target.value); setSelected(''); setPage(null); }}/></label>{matches.length > 0 ? <div className="absolute z-20 w-full rounded-lg border bg-white p-1 shadow-lg">{matches.map((item) => <button key={item.id} type="button" className="block min-h-11 w-full rounded px-3 text-left text-sm hover:bg-[#e8f5ef]" onClick={() => { setSelected(item.id); setQuery(item.name); setOffset(0); }}>{item.name}</button>)}</div> : null}</div>
    {mode === 'customer' && selected ? <nav aria-label="Customer price categories" className="mt-4 flex flex-wrap gap-2">{[['purchased','Purchased'],['exceptions','Exceptions / special prices'],['all','All products']].map(([value,label]) => <button key={value} type="button" className={button} aria-pressed={tab === value} onClick={() => { setTab(value); setOffset(0); }}>{label}</button>)}</nav> : null}
    {error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    {notice ? <output className="mt-3 block rounded-lg bg-green-50 p-3 text-sm text-green-900">{notice}</output> : null}
    {loading ? <output className="mt-4 block text-sm">Calculating from current pricing evidence…</output> : null}
    {mode === 'base' ? <div className="mt-4 max-w-2xl space-y-3"><p className="text-xs text-[#61777a]">Current cost {money(page?.baseEvidence?.currentCost ?? null)} · Target-margin price {money(page?.baseEvidence?.target ?? null)}</p><p className="text-sm text-[#61777a]">For new customer/product combinations. Existing customer history and fixed agreements take priority.</p><label className="block text-sm font-bold">Base selling price ₹<input type="number" min="0.01" max="100000000" step="0.01" className={field} value={basePrice} onChange={(event) => setBasePrice(event.target.value)}/></label><label className="block text-sm font-bold">Effective from<input type="date" className={field} value={validFrom} onChange={(event) => setValidFrom(event.target.value)}/></label><label className="block text-sm font-bold">Reason<input className={field} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)}/></label><button type="button" className={button} disabled={!canApprove || busy || !page?.previewHash || !selected || Number(basePrice)<=0 || !basePrice || !validFrom || reason.trim().length<3} onClick={() => void saveBase()}>Approve base price</button><p className="text-xs text-[#61777a]">Management approval required. Margin is checked again when the price is used.</p></div> : null}
    {mode === 'impact' && page ? <div className="mt-4 space-y-3 rounded-xl bg-[#f4f8f6] p-4"><p className="text-sm"><b>{page.customerCount}</b> customers · <b>{page.protectedCount}</b> fixed agreements · <b>{page.continuityCount}</b> continuity · <b>{page.belowMinimumCount}</b> below minimum · <b>{page.reviewCount}</b> require review · <b>{page.targetAboveContinuityCount}</b> target above continuity · <b>{page.materialIncreaseCount}</b> material increases</p><p className="text-xs text-[#61777a]">Ranked by absolute per-unit customer impact. Monthly GP: current, continuity, recommended and incremental estimates are unavailable until reliable buying volume is supplied. Approval applies to all eligible customers for this product, including later pages; fixed and missing-evidence rows are skipped.</p><label className="block text-sm font-bold">Management reason<input className={field} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)}/></label><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!canApprove || busy || reason.trim().length<3} onClick={() => void apply('continuity')}>Pass through cost increase</button><button type="button" className={button} disabled={!canApprove || busy || reason.trim().length<3} onClick={() => void apply('recommended')}>Apply recommended prices</button></div></div> : null}
    {page && mode !== 'base' ? <><div className="mt-4 space-y-3">{page.rows.map((row) => <PriceRow key={`${row.customerId}:${row.tallyKey}:${row.evidenceHash}`} row={row} customerMode={mode === 'customer'} canApprove={canApprove} mutate={mutate} onChanged={() => setRevision((value) => value+1)}/>)}{!page.rows.length ? <p className="py-4 text-sm text-[#61777a]">No eligible items in this view. Tally history may still need a read-only sync.</p> : null}</div><div className="mt-4 flex items-center justify-between"><button type="button" className={button} disabled={!offset || loading} onClick={() => setOffset((value) => Math.max(0,value-50))}>Previous</button><span className="text-xs">Page {offset/50+1}</span><button type="button" className={button} disabled={!page.hasMore || loading} onClick={() => setOffset((value) => value+50)}>Next</button></div></> : null}
  </section>;
}

function PriceRow({ row, customerMode, canApprove, onChanged, mutate }: { row: Row; customerMode: boolean; canApprove: boolean; onChanged: () => void; mutate: typeof send }) {
  const [reason,setReason] = useState(''); const [custom,setCustom] = useState(''); const [busy,setBusy] = useState(false); const [message,setMessage] = useState('');
  async function accept(choice: 'continuity'|'recommended'|'custom') {
    setBusy(true); setMessage('');
    try { await mutate({ action:'apply_price_book',payload:{customerId:row.customerId,expectedDecisionId:row.currentDecisionId,tallyKey:row.tallyKey,evidenceHash:row.evidenceHash,choice,...(choice==='custom'?{price:Number(custom)}:{}),reason,idempotencyKey:crypto.randomUUID()} }); onChanged(); }
    catch(failure){setMessage(failure instanceof Error?failure.message:'Decision failed');} finally{setBusy(false);}
  }
  return <article className="rounded-xl border border-[#dce7e5] p-3"><div className="flex flex-wrap justify-between gap-2"><strong>{customerMode?row.itemName:row.customerName}</strong><span className={`text-xs font-bold ${row.status==='REVIEW_REQUIRED'?'text-red-800':row.status==='CONTINUITY'?'text-amber-800':'text-green-800'}`}>{row.status.replaceAll('_',' ')}</span></div><dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4 lg:grid-cols-7">{[['Last customer rate',row.lastRate],['Cost then',row.historicCost],['Cost now',row.currentCost],['Cost change',row.costChange],['Continuity',row.continuity],['Target',row.target],['Recommended',row.recommended]].map(([label,value])=><div key={String(label)}><dt className="text-[#61777a]">{label}</dt><dd className="mt-1 font-bold">{money(value as number|null)}</dd></div>)}</dl><p className="mt-3 text-xs text-[#61777a]">Invoice {row.lastInvoiceReference||'unavailable'} · {row.lastInvoiceDate||'date unavailable'}. Continuity GP {money(row.continuityGP)} ({row.continuityMargin??'—'}%) · Recommended GP {money(row.recommendedGP)} ({row.recommendedMargin??'—'}%). Customer change {money(row.differenceToCustomer)} · Additional GP/unit {money(row.additionalGP)}.</p>{row.recommendationReason ? <p className="mt-2 text-xs">{row.recommendationReason}</p> : null}{row.warnings.length?<p className="mt-2 text-xs text-amber-800">{row.warnings.join(' · ').replaceAll('_',' ')}</p>:null}{customerMode && !row.fixed?<details className="mt-3"><summary className="cursor-pointer text-sm font-bold">Choose a price</summary><label className="mt-2 block text-xs">Decision reason<input className={field} value={reason} maxLength={1000} onChange={event=>setReason(event.target.value)}/></label><div className="mt-2 flex flex-wrap gap-2"><button className={button} type="button" disabled={!canApprove||busy||!row.continuity||reason.trim().length<3} onClick={()=>void accept('continuity')}>Maintain {money(row.continuity)}</button><button className={button} type="button" disabled={!canApprove||busy||!row.recommended||reason.trim().length<3} onClick={()=>void accept('recommended')}>Recommended {money(row.recommended)}</button><label className="text-xs">Custom rate<input className={field} type="number" min="0.01" step="0.01" value={custom} onChange={event=>setCustom(event.target.value)}/></label><button className={button} type="button" disabled={!canApprove||busy||!(Number(custom)>0)||reason.trim().length<3} onClick={()=>void accept('custom')}>Approve custom</button></div>{!canApprove?<p className="mt-2 text-xs">Management approval required. Accounts can review these options.</p>:null}{message?<p role="alert" className="mt-2 text-xs text-red-800">{message}</p>:null}</details>:null}</article>;
}

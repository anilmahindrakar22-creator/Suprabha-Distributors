'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { loadOrderCatalog, loadOrderCustomers } from '@/lib/order-capture-masters';
import type { CatalogItem, CustomerDirectoryEntry } from '@/lib/order-types';
import type { PricingCommand } from '@/lib/pricing-types';

type Row = {
  currentDecisionId: string | null; customerId: string; customerName: string; tallyKey: string; itemName: string; evidenceHash: string;
  currentDecisionChoice?: 'continuity' | 'recommended' | 'custom' | null; currentPrice: number | null; currentPriceSource: string; riskStatus: 'GREEN' | 'AMBER' | 'RED';
  recommendationReason?: string; pricingDate: string; fixed: boolean; lastRate: number | null; lastInvoiceDate: string | null; lastInvoiceReference: string | null;
  historicCost: number | null; currentCost: number | null; costChange: number | null;
  continuity: number | null; target: number | null; recommended: number | null;
  continuityGP: number | null; continuityMargin: number | null; recommendedGP: number | null; recommendedMargin: number | null;
  differenceToCustomer: number | null; additionalGP: number | null; status: string; warnings: string[];
  source?: { type: string; reference: string | null; date: string | null; version: string | null };
  cost?: { amount: number; kind: string; effectiveAt: string; sourceReference: string; changeAmount: number | null; changePercent: number | null } | null;
};
type Page = { rows: Row[]; hasMore: boolean; offset: number; previewHash?: string; approvalPreviewHash?: string; bulkTotalCount?: number; bulkEligibleCount?: number; bulkExcludedCount?: number; bulkEligibleKeys?: string[]; customerCount?: number; protectedCount?: number; reviewCount?: number; targetAboveContinuityCount?: number; materialIncreaseCount?: number; continuityCount?: number; belowMinimumCount?: number; baseEvidence?: Row };
const money = (value: number | null) => value == null ? 'Unavailable' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);
const percent = (value: number | null) => value == null ? 'Unavailable' : `${value.toFixed(2)}%`;
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
  const data = await response.json() as { error?: string; applied?: number; skipped?: number; excluded?: number };
  if (!response.ok) throw new Error(data.error || 'Decision could not be saved');
  return data as { applied?: number; skipped?: number; excluded?: number };
}

export function savePricingReference(actorEmail: string, command: PricingCommand, remove = false) {
  const key = `stockflow:pricing-recovery:${actorEmail.trim().toLowerCase()}`;
  const saved = JSON.parse(sessionStorage.getItem(key) || '[]') as Array<{ action: string; idempotencyKey: string }>;
  const remaining = saved.filter(value => value.idempotencyKey !== command.payload.idempotencyKey);
  if (!remove) remaining.push({ action: command.action, idempotencyKey: command.payload.idempotencyKey });
  sessionStorage.setItem(key, JSON.stringify(remaining));
}

export function CustomerPriceBook({ actorEmail, actorRole, onRecoveryBlocked }: { actorEmail: string; actorRole: string; onRecoveryBlocked?: (blocked: boolean) => void }) {
  const recoveryStorageKey = `stockflow:pricing-recovery:${actorEmail.trim().toLowerCase()}`;
  const [recovery, setRecovery] = useState<Array<{ action: string; idempotencyKey: string }>>([]);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [recoveryOwner, setRecoveryOwner] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(recoveryStorageKey) || '[]');
      if (!Array.isArray(saved) || saved.some(value => !value || !['apply_price_book','approve_customer_price_book','apply_product_price_impact','set_standard_item_price','create_price_contract','approve_price_contract','reject_price_contract','create_pricing_policy'].includes(value.action) || !/^[0-9a-f-]{36}$/i.test(value.idempotencyKey))) throw new Error('Invalid recovery data');
      setRecovery(saved);
      setRecoveryOwner(recoveryStorageKey);
    } catch { setRecoveryMessage('Pricing recovery references could not be read. Check recent pricing activity before saving again.'); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [recoveryStorageKey]);
  useEffect(() => {
    onRecoveryBlocked?.(recovery.length > 0 || recoveryOwner !== recoveryStorageKey);
  }, [onRecoveryBlocked, recovery.length, recoveryOwner, recoveryStorageKey]);
  function saveReference(command: PricingCommand, remove = false) {
    savePricingReference(actorEmail, command, remove);
  }
  async function checkRecovery(reference: { action: string; idempotencyKey: string }, closeUnresolved = false) {
    try {
      const response = closeUnresolved ? await fetch('/api/pricing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'close_unresolved_pricing', payload: { idempotencyKey: reference.idempotencyKey, pricingAction: reference.action } }) }) : null;
      if (response && !response.ok) throw new Error('Recovery failed');
      const result = response ? await response.json() as { status: string } : await read<{ status: string }>(`/api/pricing?${new URLSearchParams({ recoveryKey: reference.idempotencyKey, pricingAction: reference.action })}`);
      if (!['accepted','not_saved'].includes(result.status)) { setRecoveryMessage('This save is still unresolved. Check again later; do not assume it failed or enter a replacement.'); return; }
      const saved = JSON.parse(sessionStorage.getItem(recoveryStorageKey) || '[]') as typeof recovery;
      sessionStorage.setItem(recoveryStorageKey, JSON.stringify(saved.filter(value => value.idempotencyKey !== reference.idempotencyKey)));
      setRecovery(values => values.filter(value => value.idempotencyKey !== reference.idempotencyKey));
      setRecoveryMessage(result.status === 'not_saved' ? 'The server confirmed this request did not save and blocked late delivery. You may review current prices and enter a new decision.' : 'The server confirmed the earlier pricing save. Reload the price book to view current prices.');
    } catch { setRecoveryMessage('Unable to check this save. The recovery reference has been kept; try again when connected.'); }
  }
  // Memory only: never persist restricted commercial payloads in browser storage.
  const pendingCommands = useRef(new Map<string, PricingCommand>());
  async function mutate(command: PricingCommand) {
    const fingerprint = JSON.stringify([actorEmail, actorRole, command.action, { ...command.payload, idempotencyKey: undefined }]);
    const pending = pendingCommands.current.get(fingerprint) ?? command;
    pendingCommands.current.set(fingerprint, pending);
    // Persist only an opaque receipt before sending; no rates, reasons or customer data.
    saveReference(pending);
    const result = await send(pending);
    saveReference(pending, true);
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
  const [acceptRecommended, setAcceptRecommended] = useState(true);
  const [basePrice, setBasePrice] = useState(''); const [validFrom, setValidFrom] = useState('');
  const canApprove = ['administrator', 'management'].includes(actorRole) && recovery.length === 0 && recoveryOwner === recoveryStorageKey;

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
      const decisionReason = choice === 'continuity' ? 'Approved safe bulk continuity prices' : 'Approved safe bulk recommended prices';
      const result = await mutate({ action: 'apply_product_price_impact', payload: { tallyKey: selected, choice, previewHash: page.previewHash, reason: decisionReason, idempotencyKey: crypto.randomUUID() } });
      setNotice(`${result.applied} customer prices accepted. ${result.skipped} protected or missing-evidence rows skipped.`); setRevision((value) => value + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Decision failed'); }
    finally { setBusy(false); }
  }
  async function approveCustomerBook() {
    if (!selected || !page?.approvalPreviewHash || !page.bulkEligibleCount || busy || !acceptRecommended) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await mutate({ action: 'approve_customer_price_book', payload: { customerId: selected, approvalPreviewHash: page.approvalPreviewHash, idempotencyKey: crypto.randomUUID() } });
      setNotice(`${result.applied} recommended ${result.applied === 1 ? 'price' : 'prices'} approved. ${result.excluded} fixed, already-approved, or review-needed items were left unchanged.`);
      setRevision((value) => value + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Price book approval failed'); }
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
    {recovery.length > 0 ? <aside className="mt-3 rounded-lg bg-amber-50 p-3 text-sm"><p>An earlier pricing save needs checking before another approval. No prices were stored on this device.</p><p>Close only if unsaved checks the server first. A completed save is preserved; an unsaved request is blocked from arriving later.</p>{recovery.map(reference => <div key={reference.idempotencyKey} className="mt-2 flex flex-wrap gap-2"><button type="button" className={button} onClick={() => void checkRecovery(reference)}>Check earlier save {reference.idempotencyKey.slice(-6)}</button><button type="button" className={button} onClick={() => void checkRecovery(reference, true)}>Close only if unsaved {reference.idempotencyKey.slice(-6)}</button></div>)}</aside> : null}
    {recoveryMessage ? <output className="mt-2 block text-sm">{recoveryMessage}</output> : null}
    <nav aria-label="Pricing workbench" className="mt-3 flex flex-wrap gap-2">{([['customer','Customer prices'],['impact','Purchase-cost review'],['base','Base / default prices']] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={mode === value} className={`${button} ${mode === value ? 'bg-[#e8f5ef]' : ''}`} onClick={() => { setMode(value); setSelected(''); setQuery(''); setPage(null); setOffset(0); setError(''); setNotice(''); }}>{label}</button>)}</nav>
    <div className="relative mt-4 max-w-xl"><label className="text-sm font-bold">{mode === 'customer' ? 'Select customer' : 'Select product'}<input className={field} value={query} placeholder="Type at least two letters" onChange={(event) => { setQuery(event.target.value); setSelected(''); setPage(null); }}/></label>{matches.length > 0 ? <div className="absolute z-20 w-full rounded-lg border bg-white p-1 shadow-lg">{matches.map((item) => <button key={item.id} type="button" className="block min-h-11 w-full rounded px-3 text-left text-sm hover:bg-[#e8f5ef]" onClick={() => { setSelected(item.id); setQuery(item.name); setOffset(0); }}>{item.name}</button>)}</div> : null}</div>
    {mode === 'customer' && selected ? <div className="mt-4 flex flex-wrap items-center gap-3"><label className="flex min-h-10 items-center gap-2 text-sm font-bold"><input type="checkbox" checked={tab === 'exceptions'} onChange={(event) => { setTab(event.target.checked ? 'exceptions' : 'purchased'); setOffset(0); }} />Review exceptions only</label><button type="button" className={button} aria-pressed={tab === 'all'} onClick={() => { setTab(tab === 'all' ? 'purchased' : 'all'); setOffset(0); }}>{tab === 'all' ? 'Purchased items' : 'Browse all products'}</button></div> : null}
    {error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    {notice ? <output className="mt-3 block rounded-lg bg-green-50 p-3 text-sm text-green-900">{notice}</output> : null}
    {loading ? <output className="mt-4 block text-sm">Calculating from current pricing evidence…</output> : null}
    {mode === 'base' ? <div className="mt-4 max-w-2xl space-y-3"><p className="text-xs text-[#61777a]">Current cost {money(page?.baseEvidence?.currentCost ?? null)} · Target-margin price {money(page?.baseEvidence?.target ?? null)}</p><p className="text-sm text-[#61777a]">For new customer/product combinations. Existing customer history and fixed agreements take priority.</p><label className="block text-sm font-bold">Base selling price ₹<input type="number" min="0.01" max="100000000" step="0.01" className={field} value={basePrice} onChange={(event) => setBasePrice(event.target.value)}/></label><label className="block text-sm font-bold">Effective from<input type="date" className={field} value={validFrom} onChange={(event) => setValidFrom(event.target.value)}/></label><label className="block text-sm font-bold">Reason<input className={field} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)}/></label><button type="button" className={button} disabled={!canApprove || busy || !page?.previewHash || !selected || Number(basePrice)<=0 || !basePrice || !validFrom || reason.trim().length<3} onClick={() => void saveBase()}>Approve base price</button><p className="text-xs text-[#61777a]">Management approval required. Margin is checked again when the price is used.</p></div> : null}
    {mode === 'impact' && page ? <div className="mt-4 space-y-3 rounded-xl bg-[#f4f8f6] p-4"><p className="text-sm"><b>{page.customerCount}</b> customers · <b>{page.protectedCount}</b> fixed agreements · <b>{page.continuityCount}</b> continuity · <b>{page.belowMinimumCount}</b> below minimum · <b>{page.reviewCount}</b> require review · <b>{page.targetAboveContinuityCount}</b> target above continuity · <b>{page.materialIncreaseCount}</b> material increases</p><p className="text-xs text-[#61777a]">Ranked by absolute per-unit customer impact. Monthly GP: current, continuity, recommended and incremental estimates are unavailable until reliable buying volume is supplied. One click approves all safe rows, including later pages; fixed and missing-evidence rows are skipped and remain visible for review.</p><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!canApprove || busy} onClick={() => void apply('continuity')}>Pass through cost increase</button><button type="button" className={button} disabled={!canApprove || busy} onClick={() => void apply('recommended')}>Apply recommended prices</button></div></div> : null}
    {mode === 'customer' && selected && tab === 'purchased' && page ? <section className="mt-4 rounded-xl border border-[#dce7e5] p-3" aria-label="Customer price-book approval"><p className="text-sm font-bold">{page.bulkTotalCount ?? 0} purchased items · {page.bulkEligibleCount ?? 0} ready · {page.bulkExcludedCount ?? 0} protected or need review</p><p className="mt-1 text-xs text-[#61777a]">Approval covers all eligible purchased items, including later pages. Fixed, already-approved, inactive and review-needed prices stay unchanged.</p><div className="mt-3 flex flex-wrap items-center gap-3"><label className="flex min-h-10 items-center gap-2 text-sm font-bold"><input type="checkbox" checked={acceptRecommended} onChange={(event) => setAcceptRecommended(event.target.checked)} />Accept recommended prices</label><button type="button" className={button} disabled={!canApprove || busy || !acceptRecommended || !page.approvalPreviewHash || !page.bulkEligibleCount} onClick={() => void approveCustomerBook()}>{busy ? 'Approving price book…' : 'Approve price book'}</button></div>{!canApprove ? <p className="mt-2 text-xs">Administrator or Management approval required.</p> : null}</section> : null}
    {page && mode !== 'base' ? <><div className="mt-4 space-y-3">{mode === 'customer' && tab === 'purchased' ? <CustomerPriceTable rows={page.rows} eligibleKeys={page.bulkEligibleKeys || []} canApprove={canApprove} mutate={mutate} onChanged={() => setRevision((value) => value+1)} /> : page.rows.map((row) => <PriceRow key={`${row.customerId}:${row.tallyKey}:${row.evidenceHash}`} row={row} customerMode={mode === 'customer'} canApprove={canApprove} mutate={mutate} onChanged={() => setRevision((value) => value+1)}/>)}{!page.rows.length ? <p className="py-4 text-sm text-[#61777a]">No eligible items in this view. Tally history may still need a read-only sync.</p> : null}</div><div className="mt-4 flex items-center justify-between"><button type="button" className={button} disabled={!offset || loading} onClick={() => setOffset((value) => Math.max(0,value-50))}>Previous</button><span className="text-xs">Page {offset/50+1}</span><button type="button" className={button} disabled={!page.hasMore || loading} onClick={() => setOffset((value) => value+50)}>Next</button></div></> : null}
  </section>;
}

function CustomerPriceTable({ rows, eligibleKeys, canApprove, mutate, onChanged }: { rows: Row[]; eligibleKeys: string[]; canApprove: boolean; mutate: typeof send; onChanged: () => void }) {
  const [expanded, setExpanded] = useState('');
  const eligible = new Set(eligibleKeys);
  return <div className="overflow-x-auto rounded-xl border border-[#dce7e5]"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-[#f4f8f6] text-xs text-[#456367]"><tr>{['Product','Last price','Old cost','Cost now','GP%','Recommended','Status'].map((heading) => <th key={heading} className="px-3 py-2">{heading}</th>)}</tr></thead><tbody className="divide-y divide-[#e3ecea]">{rows.map((row) => {
    const currentRate = row.currentPrice;
    const gp = currentRate != null && row.currentCost != null && currentRate > 0 ? (currentRate-row.currentCost)/currentRate*100 : null;
    const status = row.costChange != null && row.costChange > 0 && !row.currentDecisionId
      ? 'Cost increase · review'
      : row.fixed ? 'Fixed price' : row.currentDecisionId ? 'Approved' : eligible.has(row.tallyKey) ? 'Ready' : 'Review required';
    return <Fragment key={`${row.customerId}:${row.tallyKey}`}><tr><td className="px-3 py-2"><strong>{row.itemName}</strong><button type="button" className="ml-2 text-xs font-bold text-[#176246] underline" aria-expanded={expanded === row.tallyKey} onClick={() => setExpanded((value) => value === row.tallyKey ? '' : row.tallyKey)}>{expanded === row.tallyKey ? 'Hide details' : 'Review item'}</button></td><td className="px-3 py-2">{money(row.lastRate)}</td><td className="px-3 py-2">{money(row.historicCost)}</td><td className="px-3 py-2">{money(row.currentCost)}</td><td className="px-3 py-2">{percent(gp)}</td><td className="px-3 py-2 font-bold">{money(row.recommended)}</td><td className="px-3 py-2">{status}</td></tr>{expanded === row.tallyKey ? <tr><td colSpan={7} className="p-3"><PriceRow row={row} customerMode canApprove={canApprove} mutate={mutate} onChanged={onChanged} /></td></tr> : null}</Fragment>;
  })}</tbody></table></div>;
}

function PriceRow({ row, customerMode, canApprove, onChanged, mutate }: { row: Row; customerMode: boolean; canApprove: boolean; onChanged: () => void; mutate: typeof send }) {
  const [reason,setReason] = useState(''); const [custom,setCustom] = useState(''); const [busy,setBusy] = useState(false); const [message,setMessage] = useState('');
  async function accept(choice: 'continuity'|'recommended'|'custom') {
    setBusy(true); setMessage('');
    const decisionReason = reason.trim() || (choice === 'continuity' ? 'Approved continuity price' : 'Approved recommended price');
    try { await mutate({ action:'apply_price_book',payload:{customerId:row.customerId,expectedDecisionId:row.currentDecisionId,tallyKey:row.tallyKey,evidenceHash:row.evidenceHash,choice,...(choice==='custom'?{price:Number(custom)}:{}),reason:decisionReason,idempotencyKey:crypto.randomUUID()} }); onChanged(); }
    catch(failure){setMessage(failure instanceof Error?failure.message:'Decision failed');} finally{setBusy(false);}
  }
  const sourceLabel = row.source?.type === 'APPROVED_CONTRACT' ? 'Fixed customer agreement' : row.source?.type === 'STANDARD_ITEM_PRICE' ? 'Base price' : row.source?.type === 'LAST_TALLY_INVOICE' ? 'Last Tally sales invoice' : 'No eligible price source';
  const currentRate = row.currentPrice;
  const currentGP = currentRate != null && row.currentCost != null ? currentRate-row.currentCost : null;
  const currentMargin = currentRate != null && row.currentCost != null ? (currentRate-row.currentCost)/currentRate*100 : null;
  return <article className="rounded-xl border border-[#dce7e5] p-3 sm:p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><strong>{customerMode?row.itemName:row.customerName}</strong><p className="mt-1 text-xs text-[#4f696d]">Price source: <b>{row.currentPriceSource === 'PRICE_BOOK_DECISION' ? 'Approved customer price book' : sourceLabel}</b>{row.source?.reference ? ` · ${row.source.reference}` : ''}{row.source?.date ? ` · ${row.source.date}` : ''}</p></div><span className={`rounded-full px-2 py-1 text-xs font-black ${row.riskStatus==='RED'?'bg-red-50 text-red-800':row.riskStatus==='AMBER'?'bg-amber-50 text-amber-800':'bg-green-50 text-green-800'}`}>{row.riskStatus}</span></div><dl aria-label="Current economics" className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">{[['Current selling rate',currentRate],['Current cost',row.currentCost],['Current GP / unit',currentGP]].map(([label,value])=><div className="rounded-lg bg-[#f4f8f6] p-2" key={String(label)}><dt className="text-[#61777a]">{label}</dt><dd className="mt-1 font-extrabold">{money(value as number|null)}</dd></div>)}<div className="rounded-lg bg-[#f4f8f6] p-2"><dt className="text-[#61777a]">Current margin</dt><dd className="mt-1 font-extrabold">{percent(currentMargin)}</dd></div></dl><dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-6">{[['Previous cost',row.historicCost],['Cost change',row.costChange],['Continuity',row.continuity],['Target',row.target],['Recommended',row.recommended],['Additional GP / unit',row.additionalGP]].map(([label,value])=><div key={String(label)}><dt className="text-[#61777a]">{label}</dt><dd className="mt-1 font-bold">{money(value as number|null)}</dd></div>)}</dl><p className="mt-3 text-xs text-[#61777a]">Cost evidence: {row.cost?.sourceReference||'unavailable'}{row.cost?.effectiveAt?` · ${row.cost.effectiveAt}`:''}{row.cost?.changePercent!=null?` · ${percent(row.cost.changePercent)} change`:''}. Recommended GP {money(row.recommendedGP)} ({row.recommendedMargin??'—'}%). Customer change {money(row.differenceToCustomer)}.</p>{row.recommendationReason ? <p className="mt-2 text-xs font-medium">{row.recommendationReason}</p> : null}{row.warnings.length?<p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs font-bold text-amber-900">Review: {row.warnings.join(' · ').replaceAll('_',' ')}</p>:null}{customerMode && !row.fixed?<div className="mt-3 rounded-lg border border-[#dce7e5] bg-[#fbfcfc] p-3"><p className="text-sm font-bold">Approve price</p><div className="mt-2 flex flex-wrap gap-2"><button className={button} type="button" disabled={!canApprove||busy||!row.continuity} onClick={()=>void accept('continuity')}>Maintain {money(row.continuity)}</button><button className={button} type="button" disabled={!canApprove||busy||!row.recommended} onClick={()=>void accept('recommended')}>Recommended {money(row.recommended)}</button></div><div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><label className="text-xs">Custom rate<input aria-label="Custom rate" className={field} type="number" min="0.01" step="0.01" value={custom} onChange={event=>setCustom(event.target.value)}/></label><button className={`${button} self-end`} type="button" disabled={!canApprove||busy||!(Number(custom)>0)||reason.trim().length<3} onClick={()=>void accept('custom')}>Approve custom</button></div><label className="mt-2 block text-xs">Decision note <span className="font-normal text-[#61777a]">(optional for suggested prices; required for custom)</span><input className={field} value={reason} maxLength={1000} onChange={event=>setReason(event.target.value)}/></label>{!canApprove?<p className="mt-2 text-xs">Management approval required. Accounts can review these options.</p>:null}{message?<p role="alert" className="mt-2 text-xs text-red-800">{message}</p>:null}</div>:null}</article>;
}

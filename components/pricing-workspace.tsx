'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CustomerPriceBook, savePricingReference } from './customer-price-book';
import { loadOrderCatalog, loadOrderCustomers } from '@/lib/order-capture-masters';
import type { CatalogItem, CustomerDirectoryEntry } from '@/lib/order-types';
import type { CustomerPriceContract, PricingCommand, PricingPolicy } from '@/lib/pricing-types';

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Pricing could not be loaded');
  return body;
}

async function sendRequest(command: PricingCommand) {
  return readResponse(await fetch('/api/pricing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command) }));
}

function Metric({ label, value, note, attention = false }: { label: string; value: string | number; note: string; attention?: boolean }) {
  return <article className={`rounded-2xl border p-4 ${attention ? 'border-[#efcf9c] bg-[#fff9ec]' : 'border-[#dce7e5] bg-white'}`}><p className="text-xs font-bold text-[#61777a]">{label}</p><p className="mt-2 text-3xl font-black text-[#092f36]">{value}</p><p className="mt-1 text-xs text-[#718487]">{note}</p></article>;
}

export function PricingWorkspace({ actorEmail, actorRole }: { actorEmail: string; actorRole: string }) {
  const [recoveryBlocked, setRecoveryBlocked] = useState(true);
  const pendingCommands = useRef(new Map<string, PricingCommand>());
  async function send(command: PricingCommand) {
    if (recoveryBlocked) throw new Error('Check the earlier pricing save before submitting another decision.');
    const fingerprint = JSON.stringify([actorEmail, actorRole, command.action, { ...command.payload, idempotencyKey: undefined }]);
    const pending = pendingCommands.current.get(fingerprint) ?? command;
    pendingCommands.current.set(fingerprint, pending);
    savePricingReference(actorEmail, pending);
    const result = await sendRequest(pending);
    savePricingReference(actorEmail, pending, true);
    pendingCommands.current.delete(fingerprint);
    return result;
  }
  const [contracts, setContracts] = useState<CustomerPriceContract[]>([]);
  const [policies, setPolicies] = useState<PricingPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  async function refresh() {
    setLoading(true); setMessage('');
    try {
      const [contractResult, policyResult] = await Promise.all([
        readResponse<{ contracts: CustomerPriceContract[] }>(await fetch('/api/pricing?contracts=1', { cache: 'no-store' })),
        readResponse<{ policies: PricingPolicy[] }>(await fetch('/api/pricing?policies=1', { cache: 'no-store' })),
      ]);
      setContracts(contractResult.contracts); setPolicies(policyResult.policies);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Pricing control centre could not load'); }
    finally { setLoading(false); }
  }

  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, []);
  const pending = contracts.filter((item) => item.status === 'pending_approval');
  const current = policies.find((item) => item.active && (!item.effectiveTo || item.effectiveTo >= today())) || policies[0];
  const expiryCutoff = new Date(); expiryCutoff.setDate(expiryCutoff.getDate() + 30);
  const expiring = contracts.filter((item) => item.status === 'approved' && item.validTo && item.validTo >= today() && item.validTo <= expiryCutoff.toISOString().slice(0, 10)).length;

  return <div className="h-full overflow-y-auto">
    <div className="mx-auto max-w-7xl space-y-5 p-4 pb-24 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[#277b69]">Restricted commercial workspace</p><h1 className="mt-1 text-3xl font-black text-[#092f36]">Pricing</h1><p className="mt-1 max-w-2xl text-sm text-[#61777a]">Govern customer rates and margins. Tally remains read-only and untouched.</p></div><button type="button" disabled={loading} onClick={() => void refresh()} className="min-h-11 rounded-xl border border-[#cbdedb] bg-white px-4 text-sm font-bold text-[#31585d] disabled:opacity-50">{loading ? 'Loading…' : 'Refresh'}</button></header>
      {message ? <p role="alert" className="rounded-xl border border-[#edc7c1] bg-[#fff0ef] p-3 text-sm font-bold text-[#8d3a34]">{message}</p> : null}
      <section aria-label="Pricing overview" className="grid gap-3 sm:grid-cols-3">
        <Metric label="Awaiting approval" value={pending.length} note="Customer price proposals" attention={pending.length > 0} />
        <Metric label="Expiring in 30 days" value={expiring} note="Renew before the end date" attention={expiring > 0} />
        <Metric label="Minimum gross margin" value={current ? `${current.minimumMarginPercent}%` : 'Not set'} note={current ? `Policy ${current.policyVersion}` : 'Management policy required'} attention={!current} />
      </section>
      <CustomerPriceBook actorEmail={actorEmail} actorRole={actorRole} onRecoveryBlocked={setRecoveryBlocked} />
      <fieldset disabled={recoveryBlocked} className="space-y-5">
      <ApprovalInbox items={pending} actorRole={actorRole} onChanged={refresh} send={send} />
      <details className="rounded-2xl border border-[#dce7e5] bg-[#f7faf9] p-4"><summary className="cursor-pointer list-none"><span className="block text-lg font-extrabold text-[#173239]">Pricing administration</span><span className="mt-1 block text-xs font-normal text-[#718487]">Customer agreements, proposals and commercial policy</span></summary><div className="mt-4 space-y-5">
        <ContractWorkbench items={contracts} actorEmail={actorEmail} actorRole={actorRole} onChanged={refresh} send={send} />
        <PolicyWorkbench policies={policies} actorRole={actorRole} onChanged={refresh} send={send} />
      </div></details>
      </fieldset>
    </div>
  </div>;
}

function ApprovalInbox({ items, actorRole, onChanged, send }: { items: CustomerPriceContract[]; actorRole: string; onChanged: () => Promise<void>; send: typeof sendRequest }) {
  const [reasons, setReasons] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(''); const [message, setMessage] = useState('');
  const canApprove = ['administrator', 'management'].includes(actorRole);
  async function decide(item: CustomerPriceContract, action: 'approve_price_contract' | 'reject_price_contract') {
    setBusy(item.id); setMessage('');
    const decisionReason = action === 'approve_price_contract'
      ? reasons[item.id]?.trim() || 'Approved customer price proposal'
      : reasons[item.id]?.trim() || '';
    try { await send({ action, payload: { contractId: item.id, expectedVersion: item.version, reason: decisionReason, idempotencyKey: crypto.randomUUID() } }); await onChanged(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Decision could not be saved'); }
    finally { setBusy(''); }
  }
  return <section className="rounded-2xl border border-[#dce7e5] bg-white"><div className="flex items-center justify-between border-b border-[#e3ecea] p-4"><div><h2 className="text-lg font-extrabold text-[#173239]">Approval inbox</h2><p className="text-xs text-[#718487]">Customer-specific price decisions</p></div><span className="rounded-full bg-[#fff1d6] px-3 py-1 text-xs font-extrabold text-[#8a5a0a]">{items.length}</span></div>
    {message ? <p role="alert" className="m-4 rounded-lg bg-[#fff0ef] p-3 text-xs font-bold text-[#8d3a34]">{message}</p> : null}
    {!items.length ? <p className="p-5 text-sm text-[#61777a]">No customer prices are waiting for approval.</p> : <div className="divide-y divide-[#e3ecea]">{items.map((item) => <article key={item.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto]"><div><strong className="text-sm text-[#173239]">{item.customerName}</strong><p className="mt-1 text-sm text-[#456367]">{item.tallyKey} · <b>{money.format(item.price)}</b></p><p className="mt-1 text-xs text-[#718487]">From {item.validFrom}{item.validTo ? ` to ${item.validTo}` : ' onward'} · {item.source.replaceAll('_', ' ')} · requested by {item.createdBy}</p><p className="mt-1 text-xs text-[#80524d]">Reason: {item.reason}</p></div>{canApprove ? <div className="flex flex-col gap-2 sm:min-w-72"><input value={reasons[item.id] || ''} onChange={(event) => setReasons((value) => ({ ...value, [item.id]: event.target.value }))} maxLength={1000} placeholder="Optional approval note · required to reject" className="min-h-10 rounded-lg border border-[#cedfdd] px-3 text-xs"/><div className="flex gap-2"><button type="button" disabled={busy === item.id} onClick={() => void decide(item, 'approve_price_contract')} className="min-h-9 flex-1 rounded-lg bg-[#176246] px-3 text-xs font-bold text-white disabled:opacity-50">Approve</button><button type="button" disabled={busy === item.id || (reasons[item.id] || '').trim().length < 3} onClick={() => void decide(item, 'reject_price_contract')} className="min-h-9 flex-1 rounded-lg border border-[#d59c91] px-3 text-xs font-bold text-[#8d3a34] disabled:opacity-50">Reject</button></div></div> : <p className="text-xs font-bold text-[#8a5a0a]">Management decision required</p>}</article>)}</div>}
  </section>;
}

function ContractWorkbench({ items, actorEmail, onChanged, send }: { items: CustomerPriceContract[]; actorEmail: string; actorRole: string; onChanged: () => Promise<void>; send: typeof sendRequest }) {
  const [open, setOpen] = useState(false); const [mastersLoaded, setMastersLoaded] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [customers, setCustomers] = useState<CustomerDirectoryEntry[]>([]); const [catalog, setCatalog] = useState<CatalogItem[]>([]); const [customerQuery, setCustomerQuery] = useState(''); const [productQuery, setProductQuery] = useState(''); const [customer, setCustomer] = useState<CustomerDirectoryEntry | null>(null); const [product, setProduct] = useState<CatalogItem | null>(null);
  const [price, setPrice] = useState(''); const [validFrom, setValidFrom] = useState(today); const [validTo, setValidTo] = useState(''); const [source, setSource] = useState<'customer_contract' | 'quotation' | 'scheme' | 'tender' | 'manual_governed'>('customer_contract'); const [reference, setReference] = useState(''); const [reason, setReason] = useState(''); const [search, setSearch] = useState('');
  async function loadMasters() { if (mastersLoaded) return; setBusy(true); try { const [c, p] = await Promise.all([loadOrderCustomers(actorEmail), loadOrderCatalog(actorEmail)]); setCustomers(c.customers); setCatalog(p.catalog); setMastersLoaded(true); } catch (error) { setMessage(error instanceof Error ? error.message : 'Customer and product lists could not load'); } finally { setBusy(false); } }
  const customerMatches = useMemo(() => customerQuery.trim().length < 2 ? [] : customers.filter((item) => item.name.toLowerCase().includes(customerQuery.trim().toLowerCase())).slice(0, 8), [customers, customerQuery]);
  const productMatches = useMemo(() => productQuery.trim().length < 2 ? [] : catalog.filter((item) => item.active && `${item.item} ${item.group}`.toLowerCase().includes(productQuery.trim().toLowerCase())).slice(0, 8), [catalog, productQuery]);
  const shown = items.filter((item) => `${item.customerName} ${item.tallyKey} ${item.status}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 100);
  async function create() { if (!customer || !product) return; setBusy(true); setMessage(''); try { const previous = items.find((item) => item.customerId === customer.id && item.tallyKey === product.tallyKey && item.status === 'approved' && item.validFrom < validFrom); await send({ action: 'create_price_contract', payload: { customerId: customer.id, tallyKey: product.tallyKey, price: Number(price), validFrom, ...(validTo ? { validTo } : {}), source, ...(reference.trim() ? { sourceReference: reference.trim() } : {}), reason: reason.trim(), ...(previous ? { supersedesPriceId: previous.id } : {}), idempotencyKey: crypto.randomUUID() } }); setMessage('Price proposal saved. Administrator or Management can approve it.'); setPrice(''); setReason(''); await onChanged(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Customer price could not be proposed'); } finally { setBusy(false); } }
  return <section className="rounded-2xl border border-[#dce7e5] bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-extrabold text-[#173239]">Customer prices</h2><p className="text-xs text-[#718487]">Effective-dated Customer × Product contracts</p></div><button type="button" onClick={() => { const next = !open; setOpen(next); if (next) void loadMasters(); }} className="min-h-10 rounded-xl bg-[#073e46] px-4 text-sm font-bold text-white">{open ? 'Close form' : '+ Propose price'}</button></div>
    {message ? <output className="mt-3 block rounded-lg bg-[#edf7f3] p-3 text-xs font-bold text-[#31585d]">{message}</output> : null}
    {open ? <div className="mt-4 rounded-xl border border-[#dce7e5] bg-[#f7faf9] p-4"><h3 className="font-extrabold text-[#173239]">New price proposal</h3><p className="mt-1 text-xs text-[#718487]">Accounts may propose. Administrator or Management must approve.</p><div className="mt-4 grid gap-3 md:grid-cols-2"><SearchPicker label="Customer" value={customer ? customer.name : customerQuery} onChange={(value) => { setCustomer(null); setCustomerQuery(value); }} options={customerMatches.map((item) => ({ id: item.id, label: item.name, note: item.city || '' }))} onPick={(id) => { const selected = customers.find((item) => item.id === id) || null; setCustomer(selected); setCustomerQuery(selected?.name || ''); }} /><SearchPicker label="Product" value={product ? product.item : productQuery} onChange={(value) => { setProduct(null); setProductQuery(value); }} options={productMatches.map((item) => ({ id: item.tallyKey, label: item.item, note: item.group }))} onPick={(id) => { const selected = catalog.find((item) => item.tallyKey === id) || null; setProduct(selected); setProductQuery(selected?.item || ''); }} /><label className="text-xs font-bold">Selling price (₹)<input type="number" min="0.01" max="100000000" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[#cedfdd] px-3 font-normal"/></label><label className="text-xs font-bold">Source<select value={source} onChange={(event) => setSource(event.target.value as typeof source)} className="mt-1 min-h-11 w-full rounded-lg border border-[#cedfdd] bg-white px-3 font-normal"><option value="customer_contract">Customer contract</option><option value="quotation">Quotation</option><option value="scheme">Scheme</option><option value="tender">Tender</option><option value="manual_governed">Governed manual price</option></select></label><label className="text-xs font-bold">Valid from<input type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[#cedfdd] px-3 font-normal"/></label><label className="text-xs font-bold">Valid to <span className="font-normal text-[#718487]">(optional)</span><input type="date" min={validFrom} value={validTo} onChange={(event) => setValidTo(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[#cedfdd] px-3 font-normal"/></label><label className="text-xs font-bold">Source reference<input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={240} placeholder="Quotation or tender reference" className="mt-1 min-h-11 w-full rounded-lg border border-[#cedfdd] px-3 font-normal"/></label><label className="text-xs font-bold">Business reason<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} placeholder="Why should this price apply?" className="mt-1 min-h-11 w-full rounded-lg border border-[#cedfdd] px-3 font-normal"/></label></div><div className="mt-4 flex justify-end"><button type="button" disabled={busy || !customer || !product || !Number(price) || reason.trim().length < 3 || (validTo !== '' && validTo < validFrom)} onClick={() => void create()} className="min-h-11 rounded-xl bg-[#176246] px-5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Send for approval'}</button></div></div> : null}
    <div className="mt-4"><input aria-label="Search customer prices" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, product, or status" className="min-h-11 w-full rounded-xl border border-[#cedfdd] px-4 text-sm"/><div className="mt-3 divide-y divide-[#e3ecea]">{shown.map((item) => <div key={item.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[1fr_auto]"><div><strong className="text-[#173239]">{item.customerName}</strong><p className="text-[#456367]">{item.tallyKey} · {money.format(item.price)}</p></div><div className="sm:text-right"><span className="text-xs font-extrabold uppercase text-[#587275]">{item.status.replaceAll('_', ' ')}</span><p className="text-xs text-[#718487]">{item.validFrom}{item.validTo ? ` → ${item.validTo}` : ' onward'}</p></div></div>)}{!shown.length ? <p className="py-5 text-sm text-[#718487]">No customer prices match this search.</p> : null}</div></div>
  </section>;
}

function SearchPicker({ label, value, onChange, options, onPick }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ id: string; label: string; note: string }>; onPick: (id: string) => void }) {
  return <label className="relative text-xs font-bold">{label}<input value={value} onChange={(event) => onChange(event.target.value)} placeholder={`Type at least 2 letters`} className="mt-1 min-h-11 w-full rounded-lg border border-[#cedfdd] px-3 font-normal"/>{options.length ? <span className="absolute z-10 mt-1 block max-h-60 w-full overflow-y-auto rounded-lg border border-[#cbdedb] bg-white p-1 shadow-lg">{options.map((item) => <button key={item.id} type="button" onClick={() => onPick(item.id)} className="block min-h-11 w-full rounded-md px-3 py-2 text-left hover:bg-[#edf7f3]"><strong className="block text-xs text-[#173239]">{item.label}</strong>{item.note ? <small className="text-[#718487]">{item.note}</small> : null}</button>)}</span> : null}</label>;
}

function PolicyWorkbench({ policies, actorRole, onChanged, send }: { policies: PricingPolicy[]; actorRole: string; onChanged: () => Promise<void>; send: typeof sendRequest }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [policyVersion, setPolicyVersion] = useState(''); const [minimumMargin, setMinimumMargin] = useState(''); const [targetMargin, setTargetMargin] = useState(''); const [overrideThreshold, setOverrideThreshold] = useState(''); const [roundingIncrement, setRoundingIncrement] = useState('1'); const [roundingVersion, setRoundingVersion] = useState('ceil-rupee-v1'); const [effectiveFrom, setEffectiveFrom] = useState(today); const [reason, setReason] = useState('');
  const current = policies[0]; const canManage = ['administrator', 'management'].includes(actorRole); const valid = policyVersion.trim().length >= 3 && minimumMargin !== '' && overrideThreshold !== '' && Number(roundingIncrement) > 0 && (!targetMargin || Number(targetMargin) >= Math.max(0, Number(minimumMargin))) && reason.trim().length >= 3;
  async function save() { setBusy(true); setMessage(''); try { await send({ action: 'create_pricing_policy', payload: { policyVersion: policyVersion.trim(), minimumMarginPercent: Number(minimumMargin), ...(targetMargin ? { targetMarginPercent: Number(targetMargin) } : {}), overrideApprovalPercent: Number(overrideThreshold), roundingIncrement: Number(roundingIncrement), roundingRuleVersion: roundingVersion.trim(), effectiveFrom, reason: reason.trim(), idempotencyKey: crypto.randomUUID() } }); setMessage('New policy activated; the previous policy remains in history.'); setOpen(false); await onChanged(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Policy could not be saved'); } finally { setBusy(false); } }
  return <section className="rounded-2xl border border-[#dce7e5] bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-extrabold text-[#173239]">Commercial policy</h2>{current ? <p className="mt-1 text-sm text-[#456367]"><b>{current.policyVersion}</b> · minimum GP {current.minimumMarginPercent}% · target {current.targetMarginPercent == null ? 'not set' : `${current.targetMarginPercent}%`} · approval beyond {current.overrideApprovalPercent}% · round up by {money.format(current.roundingIncrement)}</p> : <p className="mt-1 text-sm text-[#8a5a0a]">No active commercial policy.</p>}</div>{canManage ? <button type="button" onClick={() => setOpen((value) => !value)} className="min-h-10 rounded-xl border border-[#cbdedb] px-4 text-sm font-bold text-[#31585d]">{open ? 'Close' : 'New policy'}</button> : null}</div>{message ? <output className="mt-3 block rounded-lg bg-[#edf7f3] p-3 text-xs font-bold text-[#31585d]">{message}</output> : null}
    {open ? <div className="mt-4 rounded-xl bg-[#f7faf9] p-4"><div className="rounded-lg border border-[#dce7e5] bg-white p-3 text-xs text-[#456367]"><strong className="text-[#173239]">How the guardrail works</strong><p className="mt-1">A gross margin below the minimum requires review. The target drives the cost-aware suggestion. A change beyond the override threshold requires an Administrator or Management decision. No price is invented when evidence is missing.</p></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Field label="Policy version" value={policyVersion} onChange={setPolicyVersion}/><Field label="Minimum gross margin %" value={minimumMargin} onChange={setMinimumMargin} number/><Field label="Target gross margin % (optional)" value={targetMargin} onChange={setTargetMargin} number/><Field label="Override approval threshold %" value={overrideThreshold} onChange={setOverrideThreshold} number/><Field label="Round-up increment ₹" value={roundingIncrement} onChange={setRoundingIncrement} number/><Field label="Rounding rule version" value={roundingVersion} onChange={setRoundingVersion}/><label className="text-xs font-bold">Effective from<input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[#cedfdd] px-3 font-normal"/></label><label className="text-xs font-bold sm:col-span-2">Management reason<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} className="mt-1 min-h-11 w-full rounded-lg border border-[#cedfdd] px-3 font-normal"/></label></div><div className="mt-4 flex justify-end"><button type="button" disabled={busy || !valid} onClick={() => void save()} className="min-h-11 rounded-xl bg-[#073e46] px-5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Activating…' : 'Activate policy'}</button></div></div> : null}
    <details className="mt-4 border-t border-[#e3ecea] pt-3"><summary className="cursor-pointer text-xs font-extrabold text-[#31585d]">Policy history ({policies.length})</summary><div className="mt-3 space-y-2">{policies.map((item) => <div key={item.id} className="rounded-lg bg-[#f7faf9] p-3 text-xs text-[#587275]"><strong className="text-[#173239]">{item.policyVersion}</strong> · minimum {item.minimumMarginPercent}% · target {item.targetMarginPercent ?? 'off'}% · {item.effectiveFrom}{item.effectiveTo ? ` → ${item.effectiveTo}` : ' onward'}</div>)}</div></details>
  </section>;
}

function Field({ label, value, onChange, number = false }: { label: string; value: string; onChange: (value: string) => void; number?: boolean }) {
  return <label className="text-xs font-bold">{label}<input type={number ? 'number' : 'text'} step={number ? '0.01' : undefined} value={value} onChange={(event) => onChange(event.target.value)} maxLength={number ? undefined : 80} className="mt-1 min-h-11 w-full rounded-lg border border-[#cedfdd] px-3 font-normal"/></label>;
}

'use client';

import { PageHeader, pageActionClass, SummaryStrip } from './page-header';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CustomerPriceBook, savePricingReference } from './customer-price-book';
import { OrderPriceInbox } from './order-price-inbox';
import { BillingRateExceptions } from './billing-rate-exceptions';
import { clearOrderCaptureMasterCache, loadOrderCatalog, loadOrderCustomers } from '@/lib/order-capture-masters';
import type { CatalogItem, CustomerDirectoryEntry } from '@/lib/order-types';
import type { CustomerPriceContract, PricingCommand, PricingPolicy } from '@/lib/pricing-types';
import { hasAnyStockFlowRole, type StockFlowRole } from '@/lib/user-types';
import { readJsonBody } from '@/lib/http-json';

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

async function readResponse<T>(response: Response, onAccessDenied?: () => void): Promise<T> {
  if (response.status === 401 || response.status === 403) onAccessDenied?.();
  const body = await readJsonBody<T & { error?: string }>(response);
  if (!response.ok) throw new Error(body.error || 'Pricing could not be loaded');
  return body;
}

async function sendRequest(command: PricingCommand, onAccessDenied?: () => void) {
  return readResponse(await fetch('/api/pricing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command) }), onAccessDenied);
}

export function PricingWorkspace({ actorEmail, actorRole, actorRoles }: { actorEmail: string; actorRole: string; actorRoles?: StockFlowRole[] }) {
  const roles = actorRoles ?? [actorRole as StockFlowRole];
  const [contracts, setContracts] = useState<CustomerPriceContract[]>([]);
  const [policies, setPolicies] = useState<PricingPolicy[]>([]);
  const [recoveryBlocked, setRecoveryBlocked] = useState(true);
  const pendingCommands = useRef(new Map<string, PricingCommand>());
  const [accessDenied, setAccessDenied] = useState(false);
  const [orderPriceCount, setOrderPriceCount] = useState(0);
  const accessRevoked = useRef(false);
  const denyAccess = useCallback(() => {
    accessRevoked.current = true;
    pendingCommands.current.clear();
    setContracts([]); setPolicies([]); setAccessDenied(true);
  }, []);
  async function send(command: PricingCommand) {
    if (accessRevoked.current) throw new Error('Pricing access is restricted');
    if (recoveryBlocked) throw new Error('Check the earlier pricing save before submitting another decision.');
    const fingerprint = JSON.stringify([actorEmail, [...roles].sort(), command.action, { ...command.payload, idempotencyKey: undefined }]);
    const pending = pendingCommands.current.get(fingerprint) ?? command;
    pendingCommands.current.set(fingerprint, pending);
    savePricingReference(actorEmail, pending);
    const result = await sendRequest(pending, denyAccess);
    savePricingReference(actorEmail, pending, true);
    pendingCommands.current.delete(fingerprint);
    return result;
  }
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true); setMessage('');
    try {
      const [contractResult, policyResult] = await Promise.all([
        fetch('/api/pricing?contracts=1', { cache: 'no-store' }).then(response => readResponse<{ contracts: CustomerPriceContract[] }>(response, denyAccess)),
        fetch('/api/pricing?policies=1', { cache: 'no-store' }).then(response => readResponse<{ policies: PricingPolicy[] }>(response, denyAccess)),
      ]);
      if (!accessRevoked.current) { setContracts(contractResult.contracts); setPolicies(policyResult.policies); }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Pricing control centre could not load'); }
    finally { setLoading(false); }
  }, [denyAccess]);

  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, [refresh]);
  const pending = contracts.filter((item) => item.status === 'pending_approval');
  const current = policies.find((item) => item.active && (!item.effectiveTo || item.effectiveTo >= today())) || policies[0];
  const expiryCutoff = new Date(); expiryCutoff.setDate(expiryCutoff.getDate() + 30);
  const expiring = contracts.filter((item) => item.status === 'approved' && item.validTo && item.validTo >= today() && item.validTo <= expiryCutoff.toISOString().slice(0, 10)).length;

  if (accessDenied) return <div role="alert" className="p-6 text-sm font-bold">Pricing access is restricted. Reopen the app after your access is restored.</div>;

  return <div className="h-full overflow-y-auto">
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 pb-24 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Restricted commercial workspace" title="Pricing" description="Govern customer rates and margins. Tally remains read-only and untouched." actions={<button type="button" disabled={loading} onClick={() => { clearOrderCaptureMasterCache(); setRefreshVersion(value => value + 1); void refresh(); }} className={pageActionClass}>{loading ? 'Loading…' : 'Refresh'}</button>} />
      {message ? <p role="alert" className="rounded-xl border border-sf-danger-line bg-sf-danger-soft p-3 text-sm font-bold text-sf-danger">{message}</p> : null}
      <SummaryStrip label="Pricing overview" items={[
        { label: 'Awaiting approval', value: pending.length + orderPriceCount, note: 'Customer and order prices', tone: pending.length + orderPriceCount > 0 ? 'attention' : 'normal' },
        { label: 'Expiring in 30 days', value: expiring, note: 'Renew before the end date', tone: expiring > 0 ? 'attention' : 'normal' },
        { label: 'Minimum gross margin', value: current ? `${current.minimumMarginPercent}%` : 'Not set', note: current ? `Policy ${current.policyVersion}` : 'Management policy required', tone: current ? 'normal' : 'attention' },
      ]} />
      {/* While prices wait for a decision the approval inbox comes first; CSS order keeps the price book mounted. */}
      <div className={pending.length + orderPriceCount > 0 ? 'order-1' : undefined}><CustomerPriceBook actorEmail={actorEmail} actorRole={actorRole} actorRoles={roles} refreshVersion={refreshVersion} onRecoveryBlocked={setRecoveryBlocked} onAccessDenied={denyAccess} /></div>
      <fieldset disabled={recoveryBlocked} className="space-y-5">
      <ApprovalInbox items={pending} orderPriceCount={orderPriceCount} onOrderPriceCount={setOrderPriceCount} actorRole={actorRole} actorRoles={roles} onChanged={refresh} send={send} />
      <details className="rounded-2xl border border-sf-line-soft bg-sf-soft-0 p-4"><summary className="cursor-pointer list-none"><span className="block text-lg font-extrabold text-sf-strong">Pricing administration</span><span className="mt-1 block text-xs font-normal text-sf-subtle">Customer agreements, proposals and commercial policy</span></summary><div className="mt-4 space-y-5">
        <ContractWorkbench items={contracts} actorEmail={actorEmail} actorRole={actorRole} actorRoles={roles} onChanged={refresh} send={send} />
        <PolicyWorkbench policies={policies} actorRole={actorRole} actorRoles={roles} onChanged={refresh} send={send} />
      </div></details>
      </fieldset>
    </div>
  </div>;
}

function ApprovalInbox({ items, orderPriceCount, onOrderPriceCount, actorRole, actorRoles, onChanged, send }: { items: CustomerPriceContract[]; orderPriceCount: number; onOrderPriceCount: (count: number) => void; actorRole: string; actorRoles?: readonly StockFlowRole[]; onChanged: () => Promise<void>; send: typeof sendRequest }) {
  const [reasons, setReasons] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(''); const [message, setMessage] = useState('');
  const canApprove = hasAnyStockFlowRole(actorRoles ?? [actorRole as StockFlowRole], ['administrator', 'management']);
  async function decide(item: CustomerPriceContract, action: 'approve_price_contract' | 'reject_price_contract') {
    setBusy(item.id); setMessage('');
    const decisionReason = action === 'approve_price_contract'
      ? reasons[item.id]?.trim() || 'Approved customer price proposal'
      : reasons[item.id]?.trim() || '';
    try { await send({ action, payload: { contractId: item.id, expectedVersion: item.version, reason: decisionReason, idempotencyKey: crypto.randomUUID() } }); await onChanged(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Decision could not be saved'); }
    finally { setBusy(''); }
  }
  return <section className="rounded-2xl border border-sf-line-soft bg-white"><div className="flex items-center justify-between border-b border-sf-line-soft p-4"><div><h2 className="text-lg font-extrabold text-sf-strong">Approval inbox</h2><p className="text-xs text-sf-subtle">Order prices and customer price proposals</p></div><span className="rounded-full bg-sf-warning-soft px-3 py-1 text-xs font-extrabold text-sf-warning">{items.length + orderPriceCount}</span></div>
    <OrderPriceInbox canApprove={canApprove} canChange={canApprove} onCount={onOrderPriceCount} />
    {canApprove ? <BillingRateExceptions /> : null}
    <h3 className="px-4 pt-4 text-sm font-extrabold text-sf-strong">Customer price proposals</h3>
    {message ? <p role="alert" className="m-4 rounded-lg bg-sf-danger-soft p-3 text-xs font-bold text-sf-danger">{message}</p> : null}
    {!items.length ? <p className="p-5 text-sm text-sf-muted">No customer prices are waiting for approval.</p> : <div className="divide-y divide-sf-line-soft">{items.map((item) => <article key={item.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0 [overflow-wrap:anywhere]"><strong className="text-sm text-sf-strong">{item.customerName}</strong><p className="mt-1 text-sm text-sf-label">{item.tallyKey} · <b>{money.format(item.price)}</b></p><p className="mt-1 text-xs text-sf-subtle">From {item.validFrom}{item.validTo ? ` to ${item.validTo}` : ' onward'} · {item.source.replaceAll('_', ' ')} · requested by {item.createdBy}</p><p className="mt-1 text-xs text-sf-danger">Reason: {item.reason}</p></div>{canApprove ? <div className="flex flex-col gap-2 sm:min-w-72"><input aria-label={`Decision note for ${item.customerName} — ${item.tallyKey}`} value={reasons[item.id] || ''} onChange={(event) => setReasons((value) => ({ ...value, [item.id]: event.target.value }))} maxLength={1000} placeholder="Optional approval note · required to reject" className="min-h-11 rounded-lg border border-sf-line px-3 text-xs"/><div className="flex gap-2"><button type="button" disabled={busy === item.id} onClick={() => void decide(item, 'approve_price_contract')} className="min-h-11 flex-1 rounded-lg bg-sf-success px-3 text-xs font-bold text-white disabled:opacity-50">Approve</button><button type="button" disabled={busy === item.id || (reasons[item.id] || '').trim().length < 3} onClick={() => void decide(item, 'reject_price_contract')} className="min-h-9 flex-1 rounded-lg border border-sf-danger-line px-3 text-xs font-bold text-sf-danger disabled:opacity-50">Reject</button></div></div> : <p className="text-xs font-bold text-sf-warning">Management decision required</p>}</article>)}</div>}
  </section>;
}

function ContractWorkbench({ items, actorEmail, onChanged, send }: { items: CustomerPriceContract[]; actorEmail: string; actorRole: string; actorRoles?: readonly StockFlowRole[]; onChanged: () => Promise<void>; send: typeof sendRequest }) {
  const [open, setOpen] = useState(false); const [mastersLoaded, setMastersLoaded] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [customers, setCustomers] = useState<CustomerDirectoryEntry[]>([]); const [catalog, setCatalog] = useState<CatalogItem[]>([]); const [customerQuery, setCustomerQuery] = useState(''); const [productQuery, setProductQuery] = useState(''); const [customer, setCustomer] = useState<CustomerDirectoryEntry | null>(null); const [product, setProduct] = useState<CatalogItem | null>(null);
  const [price, setPrice] = useState(''); const [validFrom, setValidFrom] = useState(today); const [validTo, setValidTo] = useState(''); const [source, setSource] = useState<'customer_contract' | 'quotation' | 'scheme' | 'tender' | 'manual_governed'>('customer_contract'); const [reference, setReference] = useState(''); const [reason, setReason] = useState(''); const [search, setSearch] = useState('');
  async function loadMasters() { if (mastersLoaded) return; setBusy(true); try { const [c, p] = await Promise.all([loadOrderCustomers(actorEmail), loadOrderCatalog(actorEmail)]); setCustomers(c.customers); setCatalog(p.catalog); setMastersLoaded(true); } catch (error) { setMessage(error instanceof Error ? error.message : 'Customer and product lists could not load'); } finally { setBusy(false); } }
  const customerMatches = useMemo(() => customerQuery.trim().length < 2 ? [] : customers.filter((item) => item.name.toLowerCase().includes(customerQuery.trim().toLowerCase())).slice(0, 8), [customers, customerQuery]);
  const productMatches = useMemo(() => productQuery.trim().length < 2 ? [] : catalog.filter((item) => item.active && `${item.item} ${item.group}`.toLowerCase().includes(productQuery.trim().toLowerCase())).slice(0, 8), [catalog, productQuery]);
  const shown = items.filter((item) => `${item.customerName} ${item.tallyKey} ${item.status}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 100);
  async function create() { if (!customer || !product) return; setBusy(true); setMessage(''); try { const previous = items.find((item) => item.customerId === customer.id && item.tallyKey === product.tallyKey && item.status === 'approved' && item.validFrom < validFrom); await send({ action: 'create_price_contract', payload: { customerId: customer.id, tallyKey: product.tallyKey, price: Number(price), validFrom, ...(validTo ? { validTo } : {}), source, ...(reference.trim() ? { sourceReference: reference.trim() } : {}), reason: reason.trim(), ...(previous ? { supersedesPriceId: previous.id } : {}), idempotencyKey: crypto.randomUUID() } }); setMessage('Price proposal saved. Administrator or Management can approve it.'); setPrice(''); setReason(''); await onChanged(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Customer price could not be proposed'); } finally { setBusy(false); } }
  return <section className="rounded-2xl border border-sf-line-soft bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-extrabold text-sf-strong">Customer prices</h2><p className="text-xs text-sf-subtle">Effective-dated Customer × Product contracts</p></div><button type="button" onClick={() => { const next = !open; setOpen(next); if (next) void loadMasters(); }} className="min-h-10 rounded-xl bg-sf-ink-hover px-4 text-sm font-bold text-white">{open ? 'Close form' : '+ Propose price'}</button></div>
    {message ? <output className="mt-3 block rounded-lg bg-sf-accent-soft p-3 text-xs font-bold text-sf-body">{message}</output> : null}
    {open ? <div className="mt-4 rounded-xl border border-sf-line-soft bg-sf-soft-0 p-4"><h3 className="font-extrabold text-sf-strong">New price proposal</h3><p className="mt-1 text-xs text-sf-subtle">Accounts may propose. Administrator or Management must approve.</p><div className="mt-4 grid gap-3 md:grid-cols-2"><SearchPicker label="Customer" value={customer ? customer.name : customerQuery} onChange={(value) => { setCustomer(null); setCustomerQuery(value); }} options={customerMatches.map((item) => ({ id: item.id, label: item.name, note: item.city || '' }))} onPick={(id) => { const selected = customers.find((item) => item.id === id) || null; setCustomer(selected); setCustomerQuery(selected?.name || ''); }} /><SearchPicker label="Product" value={product ? product.item : productQuery} onChange={(value) => { setProduct(null); setProductQuery(value); }} options={productMatches.map((item) => ({ id: item.tallyKey, label: item.item, note: item.group }))} onPick={(id) => { const selected = catalog.find((item) => item.tallyKey === id) || null; setProduct(selected); setProductQuery(selected?.item || ''); }} /><label className="text-xs font-bold">Selling price (₹)<input type="number" min="0.01" max="100000000" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-sf-line px-3 font-normal"/></label><label className="text-xs font-bold">Source<select value={source} onChange={(event) => setSource(event.target.value as typeof source)} className="mt-1 min-h-11 w-full rounded-lg border border-sf-line bg-white px-3 font-normal"><option value="customer_contract">Customer contract</option><option value="quotation">Quotation</option><option value="scheme">Scheme</option><option value="tender">Tender</option><option value="manual_governed">Governed manual price</option></select></label><label className="text-xs font-bold">Valid from<input type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-sf-line px-3 font-normal"/></label><label className="text-xs font-bold">Valid to <span className="font-normal text-sf-subtle">(optional)</span><input type="date" min={validFrom} value={validTo} onChange={(event) => setValidTo(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-sf-line px-3 font-normal"/></label><label className="text-xs font-bold">Source reference<input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={240} placeholder="Quotation or tender reference" className="mt-1 min-h-11 w-full rounded-lg border border-sf-line px-3 font-normal"/></label><label className="text-xs font-bold">Business reason<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} placeholder="Why should this price apply?" className="mt-1 min-h-11 w-full rounded-lg border border-sf-line px-3 font-normal"/></label></div><div className="mt-4 flex justify-end"><button type="button" disabled={busy || !customer || !product || !Number(price) || reason.trim().length < 3 || (validTo !== '' && validTo < validFrom)} onClick={() => void create()} className="min-h-11 rounded-xl bg-sf-success px-5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Send for approval'}</button></div></div> : null}
    <div className="mt-4"><input aria-label="Search customer prices" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, product, or status" className="min-h-11 w-full rounded-xl border border-sf-line px-4 text-sm"/><div className="mt-3 divide-y divide-sf-line-soft">{shown.map((item) => <div key={item.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0 [overflow-wrap:anywhere]"><strong className="text-sf-strong">{item.customerName}</strong><p className="text-sf-label">{item.tallyKey} · {money.format(item.price)}</p></div><div className="sm:text-right"><span className="text-xs font-extrabold uppercase text-sf-muted">{item.status.replaceAll('_', ' ')}</span><p className="text-xs text-sf-subtle">{item.validFrom}{item.validTo ? ` → ${item.validTo}` : ' onward'}</p></div></div>)}{!shown.length ? <p className="py-5 text-sm text-sf-subtle">No customer prices match this search.</p> : null}</div></div>
  </section>;
}

function SearchPicker({ label, value, onChange, options, onPick }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ id: string; label: string; note: string }>; onPick: (id: string) => void }) {
  return <label className="relative text-xs font-bold">{label}<input value={value} onChange={(event) => onChange(event.target.value)} placeholder={`Type at least 2 letters`} className="mt-1 min-h-11 w-full rounded-lg border border-sf-line px-3 font-normal"/>{options.length ? <span className="absolute z-10 mt-1 block max-h-60 w-full overflow-y-auto rounded-lg border border-sf-line bg-white p-1 shadow-lg">{options.map((item) => <button key={item.id} type="button" onClick={() => onPick(item.id)} className="block min-h-11 w-full rounded-md px-3 py-2 text-left hover:bg-sf-accent-soft"><strong className="block text-xs text-sf-strong">{item.label}</strong>{item.note ? <small className="text-sf-subtle">{item.note}</small> : null}</button>)}</span> : null}</label>;
}

function PolicyWorkbench({ policies, actorRole, actorRoles, onChanged, send }: { policies: PricingPolicy[]; actorRole: string; actorRoles?: readonly StockFlowRole[]; onChanged: () => Promise<void>; send: typeof sendRequest }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [policyVersion, setPolicyVersion] = useState(''); const [minimumMargin, setMinimumMargin] = useState(''); const [targetMargin, setTargetMargin] = useState(''); const [overrideThreshold, setOverrideThreshold] = useState(''); const [roundingIncrement, setRoundingIncrement] = useState('1'); const [roundingVersion, setRoundingVersion] = useState('ceil-rupee-v1'); const [effectiveFrom, setEffectiveFrom] = useState(today); const [reason, setReason] = useState('');
  const current = policies[0]; const canManage = hasAnyStockFlowRole(actorRoles ?? [actorRole as StockFlowRole], ['administrator', 'management']); const valid = policyVersion.trim().length >= 3 && minimumMargin !== '' && overrideThreshold !== '' && Number(roundingIncrement) > 0 && (!targetMargin || Number(targetMargin) >= Math.max(0, Number(minimumMargin))) && reason.trim().length >= 3;
  async function save() { setBusy(true); setMessage(''); try { await send({ action: 'create_pricing_policy', payload: { policyVersion: policyVersion.trim(), minimumMarginPercent: Number(minimumMargin), ...(targetMargin ? { targetMarginPercent: Number(targetMargin) } : {}), overrideApprovalPercent: Number(overrideThreshold), roundingIncrement: Number(roundingIncrement), roundingRuleVersion: roundingVersion.trim(), effectiveFrom, reason: reason.trim(), idempotencyKey: crypto.randomUUID() } }); setMessage('New policy activated; the previous policy remains in history.'); setOpen(false); await onChanged(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Policy could not be saved'); } finally { setBusy(false); } }
  return <section className="rounded-2xl border border-sf-line-soft bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-extrabold text-sf-strong">Commercial policy</h2>{current ? <p className="mt-1 text-sm text-sf-label"><b>{current.policyVersion}</b> · minimum GP {current.minimumMarginPercent}% · target {current.targetMarginPercent == null ? 'not set' : `${current.targetMarginPercent}%`} · approval beyond {current.overrideApprovalPercent}% · round up by {money.format(current.roundingIncrement)}</p> : <p className="mt-1 text-sm text-sf-warning">No active commercial policy.</p>}</div>{canManage ? <button type="button" onClick={() => setOpen((value) => !value)} className="min-h-10 rounded-xl border border-sf-line px-4 text-sm font-bold text-sf-body">{open ? 'Close' : 'New policy'}</button> : null}</div>{message ? <output className="mt-3 block rounded-lg bg-sf-accent-soft p-3 text-xs font-bold text-sf-body">{message}</output> : null}
    {open ? <div className="mt-4 rounded-xl bg-sf-soft-0 p-4"><div className="rounded-lg border border-sf-line-soft bg-white p-3 text-xs text-sf-label"><strong className="text-sf-strong">How the guardrail works</strong><p className="mt-1">A gross margin below the minimum requires review. The target drives the cost-aware suggestion. A change beyond the override threshold requires an Administrator or Management decision. No price is invented when evidence is missing.</p></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Field label="Policy version" value={policyVersion} onChange={setPolicyVersion}/><Field label="Minimum gross margin %" value={minimumMargin} onChange={setMinimumMargin} number/><Field label="Target gross margin % (optional)" value={targetMargin} onChange={setTargetMargin} number/><Field label="Override approval threshold %" value={overrideThreshold} onChange={setOverrideThreshold} number/><Field label="Round-up increment ₹" value={roundingIncrement} onChange={setRoundingIncrement} number/><Field label="Rounding rule version" value={roundingVersion} onChange={setRoundingVersion}/><label className="text-xs font-bold">Effective from<input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-sf-line px-3 font-normal"/></label><label className="text-xs font-bold sm:col-span-2">Management reason<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} className="mt-1 min-h-11 w-full rounded-lg border border-sf-line px-3 font-normal"/></label></div><div className="mt-4 flex justify-end"><button type="button" disabled={busy || !valid} onClick={() => void save()} className="min-h-11 rounded-xl bg-sf-ink-hover px-5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Activating…' : 'Activate policy'}</button></div></div> : null}
    <details className="mt-4 border-t border-sf-line-soft pt-3"><summary className="cursor-pointer text-xs font-extrabold text-sf-body">Policy history ({policies.length})</summary><div className="mt-3 space-y-2">{policies.map((item) => <div key={item.id} className="rounded-lg bg-sf-soft-0 p-3 text-xs text-sf-muted"><strong className="text-sf-strong">{item.policyVersion}</strong> · minimum {item.minimumMarginPercent}% · target {item.targetMarginPercent ?? 'off'}% · {item.effectiveFrom}{item.effectiveTo ? ` → ${item.effectiveTo}` : ' onward'}</div>)}</div></details>
  </section>;
}

function Field({ label, value, onChange, number = false }: { label: string; value: string; onChange: (value: string) => void; number?: boolean }) {
  return <label className="text-xs font-bold">{label}<input type={number ? 'number' : 'text'} step={number ? '0.01' : undefined} value={value} onChange={(event) => onChange(event.target.value)} maxLength={number ? undefined : 80} className="mt-1 min-h-11 w-full rounded-lg border border-sf-line px-3 font-normal"/></label>;
}

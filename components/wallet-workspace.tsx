'use client';

import Link from 'next/link';
import { CountdownBar, MeterBar, StatusChip, ToneIcon } from '@/components/ui/glance';
import { commercialIcons, constraintIcons } from '@/lib/glance-icons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { WalletAccount, WalletCommand, WalletPolicy, WalletRow, WalletSnapshot, WalletView, WalletWorkspace as Workspace } from '@/lib/wallet-types';
import { parseWalletAccount } from '@/lib/wallet-types';
import { formatPaise, permilleLabel, rupeesToPaise } from '@/lib/wallet-format';
import { calculateTestVolume } from '@/lib/wallet-test-volume';
import { formatCustomerDate } from '@/lib/customer-map';
import { WalletDiagnosis } from '@/components/wallet-diagnosis';
import type { ConstraintCategory, WalletDiagnoses, WalletDiagnosisRow } from '@/lib/wallet-diagnosis-types';
import type { ActionsDue } from '@/lib/wallet-action-types';
import { WalletActionDueRows, counted } from '@/components/wallet-actions';
import { WalletQuickEntry } from '@/components/wallet-quick-entry';
import { parseContractWindows, windowLabel, type ContractWindows } from '@/lib/contract-windows';

const button = 'min-h-11 rounded-xl border border-sf-line px-3 text-sm font-bold text-sf-body disabled:opacity-50';
const primary = 'min-h-11 rounded-xl bg-sf-brand px-4 text-sm font-bold text-white disabled:opacity-50';
const input = 'min-h-11 w-full min-w-0 rounded-xl border border-sf-line bg-sf-soft-0 px-3 text-sm text-sf-body';
const bigint = BigInt;
const field = (data: FormData, key: string) => data.get(key) as string;
const card = 'min-w-0 rounded-xl border border-sf-line-soft bg-white p-4';
const constraintLabels: Record<ConstraintCategory, string> = { price: 'Price', portfolio: 'Portfolio gap', instrument: 'Instrument', service: 'Service', relationship: 'Relationship', credit: 'Credit', availability: 'Availability', clinical: 'Clinical', contract_tender: 'Contract / tender', competitor_lock_in: 'Competitor lock-in', unknown: 'Unknown' };
const views: [WalletView | 'actions_due', string][] = [['focus', 'Focus'], ['actions_due', 'Actions due'], ['all', 'All'], ['no_estimate', 'No estimate'], ['stale', 'Stale'], ['below_sales', 'Below sales']];
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(`${date}T00:00:00Z`));
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const rupees = (paise: number) => `${Math.trunc(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;

class WalletError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const body = await response.json() as T & { error?: string; code?: string };
  if (!response.ok) throw new WalletError(response.status === 403 ? 'Wallet is for management' : body.error || 'Wallet is temporarily unavailable', response.status, body.code);
  return body as T;
}
function message(error: unknown) { return error instanceof Error ? error.message : 'Wallet is temporarily unavailable'; }

function ContractWindowRows({ onOpen }: { onOpen: (customerId: string) => void }) {
  const [windows, setWindows] = useState<ContractWindows | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void request<unknown>(`/api/wallet/actions?${new URLSearchParams({ action: 'get_contract_windows', page: String(page) })}`, { signal: controller.signal }).then(value => {
      const data = parseContractWindows(value);
      if (data.page !== page) throw new Error('Unexpected contract windows page');
      if (!controller.signal.aborted) {
        setWindows(previous => ({ ...data, rows: page === 1 ? data.rows : [...(previous?.rows ?? []), ...data.rows] }));
        setLoading(false);
      }
    }).catch(() => { if (!controller.signal.aborted) { setWindows(null); setFailed(true); setLoading(false); } });
    return () => controller.abort();
  }, [page]);
  if (failed) return <p className="text-sm text-sf-muted">Contract dates could not load</p>;
  return <>
    {windows && windows.total > 0 ? <section aria-label="Deadlines without a plan" className="min-w-0 space-y-3">
      <h3 className="font-bold">Deadlines without a plan ({windows.total})</h3>
      <ul className="space-y-3">{windows.rows.map(row => <li key={row.opportunityId}><button className="min-h-11 w-full min-w-0 space-y-1 rounded-xl border border-sf-line-soft bg-white p-4 text-left" onClick={() => onOpen(row.customerId)}>
        <span className="flex items-center gap-2"><ToneIcon icon={row.category === 'unknown' ? commercialIcons.open_question : row.category === 'competitor_lock_in' ? commercialIcons.lock_in : commercialIcons.tender} tone={row.daysLeft < 0 ? 'danger' : 'info'} /><span className="min-w-0 font-bold">{row.customerName}{row.town ? ` · ${row.town}` : ''}</span></span>
        <span className="block text-sm">{row.category === 'unknown' ? 'Open question' : row.category === 'competitor_lock_in' ? 'Competitor lock-in' : 'Tender'}: {row.party}</span>
        <CountdownBar daysLeft={row.daysLeft} horizonDays={row.category === 'unknown' ? 14 : 120} label={windowLabel(row)} />
        <span className="block text-xs text-sf-muted">No action planned</span>
      </button></li>)}</ul>
      {windows.rows.length < windows.total ? <button className={button} disabled={loading} onClick={() => { setLoading(true); setPage(n => n + 1); }}>Load more</button> : null}
    </section> : null}
    {windows && windows.plannedCount > 0 ? <p className="text-sm text-sf-muted">{windows.plannedCount} more already {windows.plannedCount === 1 ? 'has' : 'have'} an action planned</p> : null}
  </>;
}

function Sheet({ title, children, onClose, locked = false }: { title: string; children: ReactNode; onClose: () => void; locked?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); if (!locked) onClose(); }} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-xl border border-sf-line bg-white p-4 text-sf-body backdrop:bg-black/30 [overflow-wrap:anywhere]">
    <div className="mb-4 flex items-center justify-between gap-2"><h3 className="min-w-0 text-lg font-bold">{title}</h3><button className={`${button} shrink-0 whitespace-nowrap`} disabled={locked} onClick={onClose}>Close</button></div>{children}
  </dialog>;
}

function Figures({ row, certified, walletShareTargetBps }: { row: WalletRow; certified: boolean; walletShareTargetBps: number }) {
  const share = certified && row.sharePermille !== null ? row.sharePermille / 1000 : null;
  const target = 0.8;
  return <div className="space-y-2 text-sm">
    {row.walletPaise === null ? <p className="text-sm text-sf-muted">No estimate</p> : <p>Wallet {formatPaise(row.walletPaise)}/mo{certified ? <> · Sales {row.salesPaise === null ? '…' : formatPaise(row.salesPaise)}/mo{row.sharePermille !== null ? <> · {permilleLabel(row.sharePermille)} share</> : null}</> : null}</p>}
    <MeterBar value={share} target={target} tone={share !== null && share >= target ? 'success' : share !== null && share >= target / 2 ? 'warning' : 'danger'} label="Wallet share" ariaLabel={share !== null ? `Wallet share ${permilleLabel(row.sharePermille!)}` : undefined} />
    <span className="text-xs text-sf-muted">Target {permilleLabel(walletShareTargetBps / 10)}</span>
    {certified && row.walletPaise !== null ? <p className={(row.captureGapPaise ?? 0) > 0 ? 'text-sf-danger' : ''}>Gap {row.captureGapPaise === null ? '…' : formatPaise(row.captureGapPaise)}/mo to target</p> : null}
  </div>;
}

function SnapshotDetails({ snapshot }: { snapshot: WalletSnapshot }) {
  const methods = { customer_stated: 'Customer stated', test_volume: 'Test volume', manager_estimate: 'Manager estimate' };
  const verifiedDate = snapshot.verifiedAt ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(snapshot.verifiedAt)) : null;
  return <div className="space-y-2 text-sm"><p>{formatPaise(snapshot.monthlyWalletPaise)}/month · {dateLabel(snapshot.asOf)} · {snapshot.confidence[0].toUpperCase() + snapshot.confidence.slice(1)}</p><p>{methods[snapshot.method]} · {snapshot.source}</p>{snapshot.testVolume ? <p className="text-sf-muted">{snapshot.testVolume.testsPerDay} tests/day × {snapshot.testVolume.workingDaysPerMonth} days × {formatPaise(snapshot.testVolume.paisePerTest)}{snapshot.testVolume.specialTestsPerMonth ? ` + ${snapshot.testVolume.specialTestsPerMonth} special/month × ${formatPaise(snapshot.testVolume.paisePerSpecialTest!)}` : ''}</p> : null}<p>{snapshot.note}</p>{snapshot.loweredReason ? <p>Lowered: {snapshot.loweredReason}</p> : null}<p className="text-sf-muted">Entered by {snapshot.enteredBy} · {snapshot.verifiedBy ? `Verified by ${snapshot.verifiedBy}${verifiedDate ? ` · ${verifiedDate}` : ''}` : 'Not verified'}</p>{snapshot.verifiedBy && snapshot.verificationNote ? <p className="text-sf-muted">{snapshot.verificationNote}</p> : null}</div>;
}

// An uncertain write keeps both its payload and requestId; edits stay locked until resolved.
function useWrite(onSaved: () => Promise<void>, onConflict: () => Promise<void>, onForbidden: () => void, onRejected?: (error: WalletError) => Promise<void>) {
  const pending = useRef<WalletCommand | null>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  async function save(command: WalletCommand) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    pending.current ??= command;
    let succeeded = false;
    try {
      const result = await request<{ ok: boolean }>('/api/wallet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pending.current) });
      if (result.ok !== true) throw new Error('Save could not be confirmed. Retry the same save.');
      pending.current = null; setUncertain(false); succeeded = true;
    } catch (failure) {
      if (failure instanceof WalletError && failure.status >= 400 && failure.status < 500) {
        pending.current = null; setUncertain(false);
        if (failure.status === 403) onForbidden();
        else if (onRejected && (failure.status === 409 || failure.status === 422 || failure.code === '22023')) await onRejected(failure);
        else if (failure.status === 409) await onConflict();
        else setError(message(failure));
      } else { setUncertain(true); setError('Save could not be confirmed. Check the connection and retry the same save.'); }
    } finally { inFlight.current = false; setBusy(false); }
    if (succeeded) await onSaved();
  }
  return { busy, uncertain, error, save, retry: () => { if (pending.current) void save(pending.current); } };
}

function VerificationForm({ snapshotId, onSaved, onRejected, onForbidden, onLock }: { snapshotId: string; onSaved: () => Promise<void>; onRejected: (error: WalletError) => Promise<void>; onForbidden: () => void; onLock: (locked: boolean) => void }) {
  const [opened, setOpened] = useState(false);
  const write = useWrite(onSaved, async () => {}, onForbidden, onRejected);
  const locked = write.busy || write.uncertain;
  useEffect(() => { onLock(locked); return () => onLock(false); }, [locked, onLock]);
  if (!opened) return <button className={button} onClick={() => setOpened(true)}>Verify estimate</button>;
  return <form aria-label="Verify estimate" className="space-y-3 text-sm" onSubmit={event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const note = field(data, 'verificationNote').trim();
    if (note.length < 3 || note.length > 500) {
      const control = event.currentTarget.elements.namedItem('verificationNote') as HTMLInputElement;
      control.setCustomValidity('Enter 3–500 characters describing how you checked.');
      control.reportValidity();
      return;
    }
    void write.save({ action: 'verify_wallet_snapshot', payload: { requestId: crypto.randomUUID(), snapshotId, note } });
  }}>
    <fieldset disabled={locked} className="min-w-0">
      <label className="block">How did you check?<input className={input} name="verificationNote" required minLength={3} maxLength={500} onChange={event => event.currentTarget.setCustomValidity('')} /></label>
    </fieldset>
    {write.error ? <p role="alert" className="text-sm text-sf-danger">{write.error}</p> : null}
    {write.uncertain ? <button type="button" className={primary} disabled={write.busy} onClick={write.retry}>Retry same save</button> : <button className={primary} disabled={write.busy}>Mark verified</button>}
  </form>;
}

function EstimateForm({ account, onSaved, onConflict, onForbidden, onLock }: { account: WalletAccount; onSaved: () => Promise<void>; onConflict: () => Promise<void>; onForbidden: () => void; onLock: (locked: boolean) => void }) {
  const [total, setTotal] = useState(account.current ? rupees(account.current.monthlyWalletPaise) : '');
  const [method, setMethod] = useState<WalletSnapshot['method']>(account.current?.method ?? 'manager_estimate');
  const [tests, setTests] = useState(account.current?.testVolume ? String(account.current.testVolume.testsPerDay) : account.labSize ? String(account.labSize.testsPerDay) : '');
  const [days, setDays] = useState(String(account.current?.testVolume?.workingDaysPerMonth ?? 26));
  const [price, setPrice] = useState(account.current?.testVolume ? rupees(account.current.testVolume.paisePerTest) : '');
  const [specialTests, setSpecialTests] = useState(account.current?.testVolume?.specialTestsPerMonth ? String(account.current.testVolume.specialTestsPerMonth) : '');
  const [specialPrice, setSpecialPrice] = useState(account.current?.testVolume?.paisePerSpecialTest ? rupees(account.current.testVolume.paisePerSpecialTest) : '');
  const [showSpecial, setShowSpecial] = useState(Boolean(account.current?.testVolume?.specialTestsPerMonth));
  const [submitted, setSubmitted] = useState(false);
  const [split, setSplit] = useState(false);
  const [parts, setParts] = useState<Record<string, string>>({});
  const write = useWrite(onSaved, onConflict, onForbidden);
  const paisePerTest = rupeesToPaise(price);
  const paisePerSpecialTest = rupeesToPaise(specialPrice);
  const amount = method === 'test_volume' ? calculateTestVolume(Number(tests), Number(days), paisePerTest ?? NaN,
    showSpecial ? Number(specialTests) : undefined, showSpecial ? paisePerSpecialTest ?? NaN : undefined) : rupeesToPaise(total);
  const lower = amount !== null && account.current !== null && amount < account.current.monthlyWalletPaise;
  const allocations = account.divisions.filter(d => parts[d.code]?.trim()).map(d => ({ code: d.code, monthlyWalletPaise: rupeesToPaise(parts[d.code]) }));
  const allocated = allocations.reduce((sum, d) => sum + bigint(d.monthlyWalletPaise ?? 0), bigint(0));
  const invalidSplit = split && (allocations.some(d => d.monthlyWalletPaise === null) || allocated > bigint(amount ?? 0));
  const locked = write.busy || write.uncertain;
  useEffect(() => { onLock(locked); return () => onLock(false); }, [locked, onLock]);
  return <form aria-label="Update estimate" className="space-y-3" onSubmit={event => {
    event.preventDefault(); setSubmitted(true); if (amount === null || invalidSplit) return;
    const data = new FormData(event.currentTarget);
    void write.save({ action: 'record_wallet_snapshot', payload: { requestId: crypto.randomUUID(), customerId: account.row.customerId, monthlyWalletPaise: amount, method, ...(method === 'test_volume' ? { testVolume: { testsPerDay: Number(tests), workingDaysPerMonth: Number(days), paisePerTest: paisePerTest!, ...(showSpecial ? { specialTestsPerMonth: Number(specialTests), paisePerSpecialTest: paisePerSpecialTest! } : {}) } } : {}), source: field(data, 'source').trim(), confidence: data.get('confidence') as WalletSnapshot['confidence'], asOf: field(data, 'asOf'), note: field(data, 'note').trim(), loweredReason: lower ? field(data, 'reason').trim() : null, divisions: split ? allocations as { code: string; monthlyWalletPaise: number }[] : [], expectedCurrentSnapshotId: account.current?.id ?? null } });
  }}>
    <fieldset disabled={locked} className="min-w-0 space-y-3">
      {account.labSize ? <p className="text-sm text-sf-muted">From visit: about {account.labSize.testsPerDay} tests/day{account.labSize.specialTestsPerMonth != null ? ` + ${account.labSize.specialTestsPerMonth} special/month` : ''} · {account.labSize.reportedBy} · {formatCustomerDate(account.labSize.reportedOn)}</p> : null}
      {account.labSize?.statedMonthlySpendPaise != null ? <p className="text-sm text-sf-muted">Lab said {formatPaise(account.labSize.statedMonthlySpendPaise)}/month · {formatCustomerDate(account.labSize.spendReportedOn!)} · <button type="button" className="min-h-11 underline" onClick={() => { setMethod('customer_stated'); setTotal(rupees(account.labSize!.statedMonthlySpendPaise!)); }}>Use</button></p> : null}
      <label className="block">Method<select className={input} name="method" value={method} onChange={event => setMethod(event.target.value as WalletSnapshot['method'])}><option value="customer_stated">Customer stated</option><option value="test_volume">Test volume</option><option value="manager_estimate">Manager estimate</option></select></label>
      {method === 'test_volume' ? <>
        <label className="block">Tests per day (approx)<input className={input} type="number" min="1" max="100000" step="1" required value={tests} onChange={event => setTests(event.target.value)} /></label>
        <label className="block">Working days a month<input className={input} type="number" min="1" max="31" step="1" required value={days} onChange={event => setDays(event.target.value)} /></label>
        <label className="block">Average ₹ per test<input className={input} type="number" min="0.01" max="1000000" step="0.01" inputMode="decimal" required value={price} onChange={event => setPrice(event.target.value)} /></label>
        {!showSpecial ? <button type="button" className="min-h-11 text-sm text-sf-muted underline" onClick={() => { setSpecialTests(value => value || (account.labSize?.specialTestsPerMonth != null ? String(account.labSize.specialTestsPerMonth) : '')); setShowSpecial(true); }}>+ Special tests</button> : <>
          <label className="block">Special tests a month (approx)<input className={input} type="number" min="1" max="1000000" step="1" required value={specialTests} onChange={event => setSpecialTests(event.target.value)} /></label>
          <label className="block">Average ₹ per special test<input className={input} type="number" min="0.01" max="1000000" step="0.01" inputMode="decimal" required value={specialPrice} onChange={event => setSpecialPrice(event.target.value)} /></label>
          <button type="button" className="min-h-11 text-sm text-sf-muted underline" onClick={() => { setShowSpecial(false); setSpecialTests(''); setSpecialPrice(''); }}>Remove</button>
        </>}
      </> : null}
      <label className="block">Total (₹/month)<input className={input} required inputMode="decimal" readOnly={method === 'test_volume'} value={method === 'test_volume' ? amount === null ? '' : rupees(amount) : total} onChange={event => setTotal(event.target.value)} /></label>
      {method === 'test_volume' && amount !== null ? <p className="text-sm text-sf-muted">≈ {formatPaise(amount)} / month ({Number(tests)} × {Number(days)} × {formatPaise(paisePerTest!)}{showSpecial ? ` + ${Number(specialTests)} × ${formatPaise(paisePerSpecialTest!)}` : ''})</p> : null}
      {amount === null && (method === 'test_volume' ? Boolean(price) || (showSpecial && (Boolean(specialTests) || Boolean(specialPrice))) || submitted : Boolean(total)) ? <p className="text-sm text-sf-danger">{method === 'test_volume' ? 'Enter valid routine and special test counts and prices.' : 'Enter rupees with up to 2 decimals.'}</p> : null}
      <details className="text-sm text-sf-muted"><summary>How to estimate</summary><ol className="space-y-2">
        <li>Ask the lab what it spends a month on reagents (Customer stated).</li>
        <li>Ask how many tests a day it runs, or judge from samples, staff and the analyser, then use Test volume.</li>
        <li>Your own judgement of its size (Manager estimate). Improve it at the next visit.</li>
        <li>Count specials (hormones, serology panels, culture) per month at their own price.</li>
      </ol><p>If our sales are above the estimate, the estimate is too low.</p></details>
      <label className="block">Source<input className={input} name="source" required minLength={3} maxLength={500} /></label>
      <label className="block">Confidence<select className={input} name="confidence" defaultValue={account.current?.confidence ?? 'medium'}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
      <label className="block">As-of<input className={input} name="asOf" type="date" required defaultValue={todayIST()} max={todayIST()} /></label>
      <label className="block">Note<textarea className={input} name="note" required minLength={3} maxLength={500} /></label>
      {lower ? <label className="block">Why is the estimate lower?<textarea className={input} name="reason" required minLength={3} maxLength={500} /></label> : null}
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={split} onChange={event => setSplit(event.target.checked)} />Add division split</label>
      {split ? <div className="space-y-2">{account.divisions.map(d => <label key={d.code} className="block">{d.name} (₹/month)<input className={input} inputMode="decimal" value={parts[d.code] ?? ''} onChange={event => setParts({ ...parts, [d.code]: event.target.value })} /></label>)}<p>Unallocated: {formatPaise(Number(bigint(amount ?? 0) - allocated))}/month</p>{invalidSplit ? <p className="text-sf-danger">Enter valid division amounts whose sum does not exceed the total.</p> : null}</div> : null}
    </fieldset>
    {write.error ? <p role="alert" className="text-sm text-sf-danger">{write.error}</p> : null}
    {write.uncertain ? <button type="button" className={primary} disabled={write.busy} onClick={write.retry}>Retry same save</button> : <button className={primary} disabled={write.busy || amount === null || invalidSplit}>Save estimate</button>}
  </form>;
}

function PolicyForm({ policy, onSaved, onConflict, onForbidden, onLock }: { policy: WalletPolicy; onSaved: () => Promise<void>; onConflict: () => Promise<void>; onForbidden: () => void; onLock: (locked: boolean) => void }) {
  const write = useWrite(onSaved, onConflict, onForbidden);
  const locked = write.busy || write.uncertain;
  useEffect(() => { onLock(locked); return () => onLock(false); }, [locked, onLock]);
  return <form aria-label="Wallet targets" className="space-y-3" onSubmit={event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void write.save({ action: 'set_wallet_policy', payload: { requestId: crypto.randomUUID(), walletShareTargetBps: rupeesToPaise(field(data, 'target'))!, focusBandBps: rupeesToPaise(field(data, 'focus'))!, staleAfterMonths: Number(data.get('stale')), note: field(data, 'note').trim(), expectedVersion: policy.version } });
  }}><fieldset disabled={write.busy || write.uncertain} className="min-w-0 space-y-3">
    <label className="block">Wallet-share target (%)<input className={input} name="target" type="number" min="10" max="100" step="0.01" required defaultValue={policy.walletShareTargetBps / 100} /></label>
    <label className="block">Focus band (%)<input className={input} name="focus" type="number" min="10" max="100" step="0.01" required defaultValue={policy.focusBandBps / 100} /></label>
    <label className="block">Stale after (months)<input className={input} name="stale" type="number" min="1" max="24" step="1" required defaultValue={policy.staleAfterMonths} /></label>
    <label className="block">Note<textarea className={input} name="note" required minLength={3} maxLength={500} /></label>
  </fieldset>{write.error ? <p role="alert" className="text-sm text-sf-danger">{write.error}</p> : null}{write.uncertain ? <button type="button" className={primary} disabled={write.busy} onClick={write.retry}>Retry same save</button> : <button className={primary} disabled={write.busy}>Save targets</button>}</form>;
}

export function WalletWorkspace({ onBack, onReviewLinks, initialCustomerId, initialView }: { onBack: () => void; onReviewLinks: () => void; initialCustomerId?: string; initialView?: 'actions_due' }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [view, setView] = useState<WalletView | 'actions_due' | null>(null);
  const initialViewOpened = useRef(false);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(initialCustomerId ?? null);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [accountError, setAccountError] = useState('');
  const [accountRevision, setAccountRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [targets, setTargets] = useState(false);
  const [notice, setNotice] = useState('');
  const [writeLocked, setWriteLocked] = useState(false);
  const [diagnoses, setDiagnoses] = useState<WalletDiagnosisRow[] | null>(null);
  const [undiagnosedFocusCount, setUndiagnosedFocusCount] = useState<number | null>(null);
  const [focusCount, setFocusCount] = useState<number | null>(null);
  const [focusWithoutDecisionMaker, setFocusWithoutDecisionMaker] = useState<number | null>(null);
  const [actionsDue, setActionsDue] = useState<ActionsDue | null>(null);
  const [walletGapStart, setWalletGapStart] = useState(false);
  const [quickEntry, setQuickEntry] = useState(false);
  useEffect(() => { const timer = setTimeout(() => { setSearch(query); setPage(1); }, 300); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    if (forbidden) return;
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) { setLoading(true); setError(''); } });
    if (view === 'actions_due') {
      void request<ActionsDue>(`/api/wallet/actions?${new URLSearchParams({ action: 'get_actions_due', page: String(page) })}`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) { setActionsDue(data); setLoading(false); } }).catch(failure => { if (!controller.signal.aborted) { setError(message(failure)); setLoading(false); if (failure instanceof WalletError && failure.status === 403) setForbidden(true); } });
      return () => controller.abort();
    }
    const params = new URLSearchParams({ action: 'get_wallet_workspace', view: view ?? 'all', page: String(page), search });
    void request<Workspace>(`/api/wallet?${params}`, { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      if (view === null) { setView(data.coverage.certified ? 'focus' : 'all'); if (data.coverage.certified) return; }
      if (!data.coverage.certified && (view === 'focus' || view === 'below_sales')) { setView('all'); setPage(1); return; }
      if (data.rows.length === 0) { setDiagnoses(null); setUndiagnosedFocusCount(null); setFocusCount(null); }
      setWorkspace(data); setLoading(false);
      if (!initialViewOpened.current && initialView) {
        initialViewOpened.current = true;
        setView(initialView);
      }
    }).catch(failure => { if (!controller.signal.aborted) { setError(message(failure)); setLoading(false); if (failure instanceof WalletError && failure.status === 403) setForbidden(true); } });
    return () => controller.abort();
  }, [view, page, search, revision, forbidden, initialCustomerId, initialView]);
  useEffect(() => {
    if (!workspace || forbidden) return;
    if (workspace.rows.length === 0) return;
    let active = true;
    const ids = workspace.rows.map(row => row.customerId);
    void request<unknown>(`/api/wallet/diagnosis?${new URLSearchParams({ action: 'get_wallet_diagnoses', customerIds: ids.join(',') })}`).then(data => {
      const result = data as WalletDiagnoses;
      const valid = !!data && typeof data === 'object' && Array.isArray(result.rows)
        && result.rows.every(row => !!row && typeof row.customerId === 'string' && ids.includes(row.customerId) && ['capture', 'defend', 'recover'].includes(row.kind) && (row.category === null || ['price', 'portfolio', 'instrument', 'service', 'relationship', 'credit', 'availability', 'clinical', 'contract_tender', 'competitor_lock_in', 'unknown'].includes(row.category)) && (row.confidence === null || ['high', 'medium', 'low'].includes(row.confidence)) && typeof row.priceUnproven === 'boolean' && (row.divisionCode === undefined || row.divisionCode === null || (typeof row.divisionCode === 'string' && row.divisionCode.length >= 1 && row.divisionCode.length <= 100)) && (row.divisionName === undefined || row.divisionName === null || typeof row.divisionName === 'string'))
        && (result.undiagnosedFocusCount === null || Number.isInteger(result.undiagnosedFocusCount)) && (result.focusCount === null || Number.isInteger(result.focusCount)) && (result.focusWithoutDecisionMaker === undefined || result.focusWithoutDecisionMaker === null || Number.isInteger(result.focusWithoutDecisionMaker));
      if (active) { setDiagnoses(valid ? result.rows : null); setUndiagnosedFocusCount(valid ? result.undiagnosedFocusCount : null); setFocusCount(valid ? result.focusCount : null); setFocusWithoutDecisionMaker(valid ? result.focusWithoutDecisionMaker ?? null : null); }
    }).catch(() => { if (active) { setDiagnoses(null); setUndiagnosedFocusCount(null); setFocusCount(null); setFocusWithoutDecisionMaker(null); } });
    return () => { active = false; };
  }, [workspace, forbidden]);
  useEffect(() => {
    if (!customerId || forbidden) return;
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) { setAccount(null); setAccountError(''); } });
    void request<unknown>(`/api/wallet?${new URLSearchParams({ action: 'get_wallet_account', customerId })}`, { signal: controller.signal }).then(parseWalletAccount).then(data => { if (!controller.signal.aborted) setAccount(data); }).catch(failure => { if (!controller.signal.aborted) { setAccountError(message(failure)); if (failure instanceof WalletError && failure.status === 403) setForbidden(true); } });
    return () => controller.abort();
  }, [customerId, accountRevision, forbidden]);
  const refresh = async () => { setRevision(n => n + 1); };
  const reloadAccount = async () => { setEditing(false); setAccountRevision(n => n + 1); setRevision(n => n + 1); };
  const conflict = async () => { setNotice('Someone else updated this estimate. Reloaded.'); await reloadAccount(); };
  const deny = () => setForbidden(true);
  const openActionAccount = (id: string) => { setNotice(''); setEditing(false); setCustomerId(id); };
  if (quickEntry && !forbidden) return <WalletQuickEntry onBack={() => setQuickEntry(false)} onForbidden={deny} />;
  return <section aria-label="Wallet" className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
    <header className="flex flex-wrap items-center gap-3"><button className={button} onClick={onBack}>Back to Accounts</button><h2 className="text-xl font-bold text-sf-strong">Wallet</h2>{!forbidden && workspace ? <><button className={button} onClick={() => { setNotice(''); setTargets(true); }}>Targets</button><button className="min-h-11 text-sm text-sf-muted underline" onClick={() => setQuickEntry(true)}>Quick entry</button></> : null}</header>
    {forbidden ? <p>Wallet is for management</p> : <>
      {notice && !customerId && !targets ? <p className="text-sm text-sf-body">{notice}</p> : null}
      {workspace ? <>
        <div className={`${card} space-y-2`}>
          {workspace.coverage.certified ? <><p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-3xl font-bold tabular-nums"><span>{counted(workspace.summary.focusCount, 'account', 'accounts')}</span><span className="text-sf-danger">{formatPaise(workspace.summary.focusGapPaise ?? 0, true)}/month</span></p><p className="font-bold">Focus band: {counted(workspace.summary.focusCount, 'account', 'accounts', 'holds', 'hold')} {permilleLabel(workspace.policy.focusBandBps / 10)} of the capture gap · {formatPaise(workspace.summary.focusGapPaise ?? 0, true)}/month</p><MeterBar value={workspace.policy.focusBandBps / 10000} tone="info" label="Capture gap in Focus band" />{undiagnosedFocusCount !== null && undiagnosedFocusCount > 0 ? <p className="text-sm text-sf-muted">{undiagnosedFocusCount} of {focusCount} Focus accounts not diagnosed</p> : null}{focusWithoutDecisionMaker !== null && focusWithoutDecisionMaker > 0 ? <p className="text-sm text-sf-muted">{focusWithoutDecisionMaker} of {focusCount} Focus accounts have no known decision maker</p> : null}<p className="text-sm text-sf-muted">Ranked by gap to the {permilleLabel(workspace.policy.walletShareTargetBps / 10)} Wallet-share target · based on {workspace.summary.estimatedAccounts} of {workspace.summary.accountsWithSales} accounts with an estimate · From Tally, {workspace.coverage.windowLabel}</p></> : <><p>Sales figures appear once Tally coverage is certified ({workspace.coverage.windowLabel})</p><Link className="inline-flex min-h-11 items-center text-sm text-sf-muted underline" href="/?view=instrument-economics">See Sales coverage</Link></>}
        </div>
        {workspace.coverage.certified && (workspace.summary.unlinkedLedgers ?? 0) > 0 ? <p className="text-sm text-sf-muted">Not linked to a customer: {formatPaise(workspace.summary.unlinkedSalesPaise ?? 0)}/month across {workspace.summary.unlinkedLedgers} Tally ledgers · <button className="min-h-11 underline" onClick={onReviewLinks}>Review links</button></p> : null}
        <div className="flex flex-wrap gap-2" aria-label="Wallet views">{views.map(([key, label]) => <button key={key} className={`${button} ${view === key ? 'bg-sf-brand text-white' : 'bg-white'}`} aria-pressed={view === key} disabled={key !== 'actions_due' && !workspace.coverage.certified && (key === 'focus' || key === 'below_sales')} onClick={() => { setView(key); setPage(1); }}>{label}</button>)}</div>
        {view === 'actions_due' ? <><ContractWindowRows key={revision} onOpen={openActionAccount} /><h3 className="font-bold">{actionsDue ? `${counted(actionsDue.total, 'action', 'actions')} due this week · ${actionsDue.overdueCount} overdue` : 'Actions due this week'}</h3>{actionsDue ? <WalletActionDueRows rows={actionsDue.rows} constraintLabels={constraintLabels} onOpen={openActionAccount} /> : null}{actionsDue && actionsDue.rows.length === 0 ? <p className="text-sm text-sf-muted">No actions due.</p> : null}</> : <>
        <label className="block text-sm">Search accounts<input className={input} placeholder="Name or town" maxLength={80} value={query} onChange={event => setQuery(event.target.value)} /></label>
        <ul aria-label="Wallet accounts" className="space-y-3" aria-busy={loading}>{workspace.rows.map(row => {
          const diagnosis = diagnoses?.find(item => item.customerId === row.customerId);
          const walletGapSuggestion = workspace.coverage.certified && row.inFocusBand === true && diagnoses !== null && !diagnosis;
          return <li key={row.customerId}><div className={`${card} space-y-2`}>
            <button className="min-h-11 w-full space-y-2 text-left disabled:opacity-50" disabled={loading || query !== search} onClick={() => { setNotice(''); setEditing(false); setWalletGapStart(false); setCustomerId(row.customerId); }}><p className="font-bold">{row.name} <span className="font-normal text-sf-muted">{row.city}</span></p><Figures row={row} certified={workspace.coverage.certified} walletShareTargetBps={workspace.policy.walletShareTargetBps} />{diagnosis ? <StatusChip icon={constraintIcons[diagnosis.category ?? 'unknown']} tone={diagnosis.priceUnproven ? 'danger' : 'info'}>{diagnosis.category && diagnosis.category !== 'unknown' ? `Why: ${constraintLabels[diagnosis.category]}${diagnosis.priceUnproven ? ' (not proven)' : ''}` : 'Not diagnosed'}</StatusChip> : row.walletPaise !== null && diagnoses && !walletGapSuggestion ? <span className="inline-flex rounded-full bg-sf-soft-0 px-2 py-1 text-xs">Not diagnosed</span> : null}<div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-sf-muted">{row.confidence ? <span className="inline-flex items-center gap-1"><span aria-hidden="true" className={`size-2 rounded-full ${row.confidence === 'high' ? 'bg-sf-success' : row.confidence === 'medium' ? 'bg-sf-warning' : 'bg-sf-muted'}`} />{row.confidence[0].toUpperCase() + row.confidence.slice(1)}</span> : null}{row.asOf ? <span>As of {dateLabel(row.asOf)}</span> : null}{row.walletPaise !== null && !row.verified ? <span>Not verified</span> : null}{row.stale ? <span>Stale</span> : null}{workspace.coverage.certified && row.belowSales ? <span>Below sales</span> : null}</div></button>
            {walletGapSuggestion ? <button className={`${button} min-h-11`} disabled={loading || query !== search} onClick={event => { event.stopPropagation(); setNotice(''); setEditing(false); setWalletGapStart(true); setCustomerId(row.customerId); }}>Start diagnosis</button> : null}
          </div></li>;
        })}</ul>
        {!workspace.rows.length && !loading ? <p className="text-sm text-sf-muted">No accounts match.</p> : null}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>Page {workspace.page} · {workspace.total} accounts</span><div className="flex gap-2"><button className={button} disabled={loading || page <= 1} onClick={() => setPage(n => n - 1)}>Previous</button><button className={button} disabled={loading || page * 50 >= workspace.total} onClick={() => setPage(n => n + 1)}>Next</button></div></div>
        </>}
      </> : null}
      {loading ? <p className="text-sm text-sf-muted">Loading wallet…</p> : null}{error ? <p className="text-sm text-sf-danger">{error} <button className={button} onClick={() => void refresh()}>Retry</button></p> : null}
      {customerId ? <Sheet title={account?.row.name ?? 'Account wallet'} locked={writeLocked} onClose={() => { setCustomerId(null); setAccount(null); setWalletGapStart(false); }}>
        {notice ? <p className="mb-3 text-sm text-sf-body">{notice}</p> : null}
        {account ? <div className="space-y-4"><Figures row={account.row} certified={account.coverage.certified} walletShareTargetBps={account.policy.walletShareTargetBps} />{account.current ? <><SnapshotDetails snapshot={account.current} />{!account.current.verifiedBy && !editing ? <VerificationForm key={account.current.id} snapshotId={account.current.id} onLock={setWriteLocked} onForbidden={deny} onSaved={async () => { setNotice('Estimate verified'); await reloadAccount(); }} onRejected={async failure => { setNotice(message(failure)); await reloadAccount(); }} /> : null}<table className="w-full table-fixed text-sm"><caption className="mb-2 text-left font-bold">Division wallet / month</caption><tbody>{account.divisions.map(d => <tr key={d.code}><th className="py-2 text-left font-normal">{d.name}</th><td className="py-2 text-right">{formatPaise(account.current!.divisions.find(part => part.code === d.code)?.monthlyWalletPaise ?? 0)}</td></tr>)}<tr><th className="py-2 text-left">Unallocated</th><td className="py-2 text-right">{formatPaise(account.current.unallocatedPaise)}</td></tr></tbody></table></> : <p>No estimate</p>}
          <details><summary className="flex min-h-11 cursor-pointer items-center">History ({account.history.length})</summary><ul className="space-y-3">{account.history.map(snapshot => <li key={snapshot.id} className={card}><SnapshotDetails snapshot={snapshot} /></li>)}</ul></details>
          <WalletDiagnosis key={customerId!} customerId={customerId!} customerName={account.row.name} divisions={account.divisions} initialStart={walletGapStart ? { origin: 'wallet_gap' } : undefined} onForbidden={deny} onConflict={async () => { setRevision(n => n + 1); }} />
          {editing ? <EstimateForm key={account.current?.id ?? 'new'} account={account} onLock={setWriteLocked} onSaved={reloadAccount} onConflict={conflict} onForbidden={deny} /> : <button className={primary} disabled={writeLocked} onClick={() => setEditing(true)}>Update estimate</button>}
        </div> : <p>{accountError || 'Loading account…'}</p>}
      </Sheet> : null}
      {targets && workspace ? <Sheet title="Targets" locked={writeLocked} onClose={() => setTargets(false)}>{notice ? <p className="mb-3 text-sm text-sf-body">{notice}</p> : null}<PolicyForm key={workspace.policy.version} policy={workspace.policy} onLock={setWriteLocked} onForbidden={deny} onSaved={async () => { setTargets(false); await refresh(); }} onConflict={async () => { setNotice('Someone else updated the targets. Reloaded.'); await refresh(); }} /></Sheet> : null}
    </>}
  </section>;
}

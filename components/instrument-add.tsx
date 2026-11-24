'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import type { EconomicAction, EconomicsWorkspaceData } from '@/lib/instrument-economics-types';
import { derivedInstrumentFields, instrumentLabIdentities, instrumentLineLabel, instrumentPurchaseFilter, investmentLine, matchingSalesFilter, rentalLabs } from '@/lib/instrument-add';
import { useEconomicLines } from './economic-line-picker';
import type { SourceLine as Line } from '@/lib/instrument-economics-lines';
import { CustomerLinks } from './customer-links';

type Lab = { id: string; name: string; city?: string | null; customerSourceId: string };
/** `refresh` false skips the workspace reload when the next step does not need the new records. */
export type InstrumentAddCommand = (action: EconomicAction, payload: Record<string, unknown>, key: string, refresh?: boolean) => Promise<{ entityId?: string } | null>;
const inputClass = 'min-h-11 min-w-0 rounded-lg border border-sf-line bg-white px-3 text-sm';
const buttonClass = 'min-h-11 rounded-lg border border-sf-line px-3 py-2 text-left text-sm break-words disabled:opacity-50';
const choiceBaseClass = 'min-h-11 rounded-lg border px-3 py-2 text-left text-sm break-words disabled:opacity-50';
const choiceClass = (selected: boolean) => `${choiceBaseClass} ${selected ? 'border-sf-brand bg-sf-soft font-semibold' : 'border-sf-line'}`;

export function InstrumentAdd({ data, disabled, runCommand, onRefresh }: {
  data: EconomicsWorkspaceData; disabled: boolean; runCommand: InstrumentAddCommand;
  onRefresh: () => Promise<unknown>;
}) {
  const [search, setSearch] = useState(''); const [cheaper, setCheaper] = useState(false);
  // Keep selected evidence even when the successful first step marks it used.
  const [purchase, setPurchase] = useState<Line | null>(null); const [sale, setSale] = useState<Line | null>(null);
  const [basis, setBasis] = useState<'sold' | 'rental'>('sold'); const [labQuery, setLabQuery] = useState(''); const [rentalLab, setRentalLab] = useState<Lab | null>(null);
  const [serial, setSerial] = useState(''); const [date, setDate] = useState('');
  const [keys, setKeys] = useState(() => [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]);
  const [step, setStep] = useState(1); const [started, setStarted] = useState(false); const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false); const inFlight = useRef(false);
  const [installationId, setInstallationId] = useState(''); const [targetId, setTargetId] = useState('');
  const [linking, setLinking] = useState(false);
  const [savedPayloads, setSavedPayloads] = useState<Record<number, Record<string, unknown>>>({});
  const identities = instrumentLabIdentities(data);
  const invoiceIdentity = sale && identities.find(i => i.companyId === sale.companyId && i.customerSourceId === sale.customerSourceId);
  const invoiceCustomer = data.customers.find(c => c.id === invoiceIdentity?.customerId);
  const lab: Lab | null = basis === 'rental' ? rentalLab : invoiceCustomer && sale?.customerSourceId ? { ...invoiceCustomer, customerSourceId: sale.customerSourceId } : null;
  const selectedTarget = data.targets.find(t => t.id === targetId);
  const lock = disabled || started || saving;
  const purchases = useEconomicLines(instrumentPurchaseFilter(cheaper, search), { enabled: !linking && step !== 4 });
  const matching = useEconomicLines(purchase ? matchingSalesFilter(purchase) : {}, { enabled: !!purchase && basis === 'sold' && !linking && step !== 4 });
  const sales = matching.rows;
  const autoSelectedPurchase = useRef<Line | null>(null);
  useEffect(() => {
    if (!purchase || matching.loading || matching.error || basis !== 'sold' || autoSelectedPurchase.current === purchase) return;
    autoSelectedPurchase.current = purchase;
    if (matching.total === 1 && matching.rows.length === 1) {
      const invoice = matching.rows[0];
      const timer = setTimeout(() => { setSale(invoice); setSerial(invoice.batchId || purchase.batchId || ''); setDate(invoice.date); }, 0);
      return () => { clearTimeout(timer); autoSelectedPurchase.current = null; };
    }
  }, [purchase, matching.loading, matching.error, matching.total, matching.rows, basis]);
  function choosePurchase(line: Line) {
    setPurchase(line); autoSelectedPurchase.current = null;
    setSale(null); setRentalLab(null); setLabQuery('');
    setSerial(line.batchId || ''); setDate(line.date);
  }
  function chooseBasis(value: 'sold' | 'rental') {
    setBasis(value); setSerial((value === 'sold' ? sale?.batchId : null) || purchase?.batchId || ''); setDate((value === 'sold' ? sale?.date : null) || purchase?.date || '');
  }
  function addAnother() {
    setSearch(''); setCheaper(false); setPurchase(null); setSale(null); setBasis('sold'); setLabQuery(''); setRentalLab(null);
    setSerial(''); setDate(''); setKeys([crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]); setStep(1);
    setStarted(false); setFailed(false); setInstallationId(''); setTargetId(''); setSavedPayloads({});
  }
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current || !purchase || !lab || !serial.trim() || !date || (disabled && !failed)) return;
    inFlight.current = true; setSaving(true); setStarted(true); setFailed(false);
    let current = step; let installed = installationId; let target = targetId;
    const send: InstrumentAddCommand = (action, payload, key, refresh) => {
      const commandStep = current;
      const frozen = savedPayloads[commandStep] ?? payload;
      setSavedPayloads(previous => ({ ...previous, [commandStep]: frozen }));
      return runCommand(action, frozen, key, refresh);
    };
    try {
      if (current === 1) {
        const source = basis === 'sold' ? sale! : purchase;
        const result = await send('register_historical_instrument', { basis, sourceLineId: source.id, expectedSourceRevision: source.revision, customerId: lab.id, installedOn: date, serialNumber: serial.trim(), reason: `Confirmed ${basis} installation from Tally ${source.voucherNumber || 'invoice'}` }, keys[0]);
        if (!result?.entityId) throw new Error(); installed = result.entityId; setInstallationId(installed); current = 2; setStep(2);
      }
      if (current === 2) {
        const serialKey = (value: string) => value.trim().toUpperCase().replace(/[\s\-/.]/g, '');
        const installation = data.installations.find(i => i.id === installed) ?? data.installations.find(i => serialKey(i.serialNumber) === serialKey(serial));
        const { lab: hiddenLab, ...fields } = derivedInstrumentFields(purchase, lab, installation, date);
        // Linking the billing needs only the new target id, so reload once at the end instead of here.
        const result = await send('create_target', { ...fields, customerId: hiddenLab.id, installationId: installed, acquisitionPurchaseLineId: purchase.id }, keys[1], basis !== 'sold');
        if (!result?.entityId) throw new Error(); target = result.entityId; setTargetId(target); current = 3; setStep(3);
      }
      if (current === 3 && basis === 'sold') {
        const result = await send('link_instrument_billing', { targetId: target, expectedVersion: 1, sourceLineId: sale!.id, reason: `Tally instrument invoice ${sale!.voucherNumber || 'verified'}` }, keys[2]);
        if (!result) throw new Error();
      }
      setStep(4);
    } catch { setFailed(true); }
    finally { inFlight.current = false; setSaving(false); }
  }
  if (linking) return <CustomerLinks onBack={() => { setLinking(false); void onRefresh(); }} />;
  if (step === 4) return <section aria-label="Add an instrument" className="min-w-0 rounded-2xl border border-sf-line-soft bg-white p-4">
    <output className="font-bold">Added: {selectedTarget?.name ?? `${purchase?.productName || 'Instrument'} · ${lab?.name ?? ''}`}</output>
    <p className="mt-1 text-sm text-sf-muted">Serial {serial.trim()} · installed {date}. It is waiting for approval: review its investment and approve it in “Waiting for approval” above.</p>
    <div className="mt-3 flex flex-wrap gap-3"><button type="button" className="min-h-11 rounded-lg bg-sf-brand px-4 font-bold text-white disabled:opacity-50" onClick={() => document.getElementById('economics-approvals')?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>Review and approve</button>
    <button type="button" className="min-h-11 text-sm font-semibold text-sf-brand" onClick={addAnother}>Add another instrument</button></div>
  </section>;
  const totalSteps = basis === 'sold' ? 3 : 2;
  return <section aria-label="Add an instrument" className="min-w-0 rounded-2xl border border-sf-line-soft bg-white p-4 sm:p-6">
    <h2 className="text-lg font-extrabold">Add an instrument</h2>
    <form onSubmit={event => void save(event)} className="mt-4 grid min-w-0 gap-4">
      <fieldset disabled={lock} className="grid min-w-0 gap-3">
        <legend className="font-bold">Which machine?</legend>
        <label className="grid min-w-0 gap-1">Search machines<input className={inputClass} value={search} onChange={e => setSearch(e.target.value)} /></label>
        <div aria-label="Equipment purchases" className="grid max-h-72 min-w-0 gap-2 overflow-y-auto">{purchases.rows.map(line => <button type="button" key={line.id} aria-pressed={purchase?.id === line.id} className={choiceClass(purchase?.id === line.id)} onClick={() => choosePurchase(line)}>{instrumentLineLabel(line)}</button>)}</div>
        {purchases.loading ? <output>Loading invoices…</output> : null}
        {purchases.error ? <p role="alert">Could not load invoices.<button type="button" className={buttonClass} onClick={purchases.retry}>Retry</button></p> : null}
        {!purchases.loading && !purchases.error && !purchases.rows.length ? <p>No matching invoices.</p> : null}
        {purchases.rows.length < purchases.total ? <button type="button" disabled={purchases.loading} className={buttonClass} onClick={purchases.loadMore}>Show more ({purchases.total - purchases.rows.length} left)</button> : null}
        <button type="button" className="min-h-11 justify-self-start text-sm font-bold text-sf-brand" onClick={() => setCheaper(!cheaper)}>{cheaper ? 'Show equipment only' : 'Show cheaper items'}</button>
        {purchase ? <p>{instrumentLineLabel(purchase)}</p> : null}
        <div className="grid grid-cols-2 gap-3">{(['sold','rental'] as const).map(value => <button type="button" key={value} aria-pressed={basis === value} className={choiceClass(basis === value)} onClick={() => chooseBasis(value)}>{value === 'sold' ? 'Sold' : 'Rental'}</button>)}</div>
        {purchase && basis === 'sold' ? <div className="grid min-w-0 gap-2" aria-label="Matching sale invoices">{matching.loading ? <output>Loading invoices…</output> : null}{matching.error ? <p role="alert">Could not load invoices.<button type="button" className={buttonClass} onClick={matching.retry}>Retry</button></p> : null}{sales.map(line => <button type="button" key={line.id} aria-pressed={sale?.id === line.id} className={choiceClass(sale?.id === line.id)} onClick={() => { setSale(line); setSerial(line.batchId || purchase.batchId || ''); setDate(line.date); }}>{instrumentLineLabel(line)}</button>)}{sales.length < matching.total ? <button type="button" disabled={matching.loading} className={buttonClass} onClick={matching.loadMore}>Show more ({matching.total - sales.length} left)</button> : null}{sale ? <p>Lab: {sale.partyName || invoiceCustomer?.name || 'Link to Tally first'}</p> : <p>Select a matching sale invoice.</p>}{sale && !lab ? <Link href="/?view=accounts" onClick={event => { event.preventDefault(); setLinking(true); }}>Link to Tally first</Link> : null}</div> : null}
        {purchase && basis === 'rental' ? <div className="grid min-w-0 gap-2">
          <label className="grid gap-1">Search labs<input className={inputClass} value={labQuery} onChange={e => { setLabQuery(e.target.value); setRentalLab(null); }} /></label>
          {labQuery.trim().length < 2 ? <p>Type at least 2 letters.</p> : <><div aria-label="Rental labs" className="grid max-h-72 gap-2 overflow-y-auto">{rentalLabs(data, labQuery, purchase.companyId).map(row => <button key={row.id} type="button" aria-pressed={rentalLab?.id === row.id} className={choiceClass(rentalLab?.id === row.id)} onClick={() => setRentalLab(row)}>{row.name} · {row.city || 'City unknown'}</button>)}</div>
            {data.customers.some(c => `${c.name} ${c.city || ''}`.toLowerCase().includes(labQuery.trim().toLowerCase()) && !identities.some(i => i.companyId === purchase.companyId && i.customerId === c.id)) ? <Link href="/?view=accounts" onClick={event => { event.preventDefault(); setLinking(true); }}>Link to Tally first</Link> : null}</>}
          {rentalLab ? <p>Lab: {rentalLab.name} · {rentalLab.city || 'City unknown'}</p> : null}
        </div> : null}
        {purchase ? <><label className="grid min-w-0 gap-1">Serial number<input required minLength={2} maxLength={100} className={inputClass} value={serial} onChange={e => setSerial(e.target.value)} /></label><label className="grid min-w-0 gap-1">Installation date<input required type="date" min={(basis === 'sold' ? sale?.date : null) || purchase.date} max={data.businessDate} className={inputClass} value={date} onChange={e => setDate(e.target.value)} /></label><p className="break-words">{investmentLine(purchase, basis === 'sold' ? sale : null)}</p></> : null}
      </fieldset>
      {failed ? <p role="alert">Step {step} didn&apos;t save. Retry</p> : null}
      <button disabled={saving || (!failed && disabled) || !purchase || !lab || (basis === 'sold' && !sale)} className="min-h-11 rounded-lg bg-sf-brand px-4 font-bold text-white disabled:opacity-50">{saving ? `Saving step ${Math.min(step, totalSteps)} of ${totalSteps}…` : failed ? 'Retry' : 'Save'}</button>
      {saving ? <output className="text-sm text-sf-muted">Saving the installation, its investment and the billing link. This takes a few seconds per step.</output> : null}
    </form>
  </section>;
}

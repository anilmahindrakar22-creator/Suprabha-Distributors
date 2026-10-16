'use client';

import { useEffect, useId, useState } from 'react';
import { compatiblePurchaseLines, costVerificationSaleLines, maxEconomicEvidenceRows, purchaseMatchKind, type PurchaseMatchKind } from '@/lib/instrument-economics-forms';
import type { EconomicTarget, EconomicsWorkspaceData } from '@/lib/instrument-economics-types';
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty } from '@/components/ui/combobox';

type InvoiceOption = { value: string; label: string };
function SearchableInstrumentInvoice({ lines, value, onChange }: { lines: NonNullable<EconomicsWorkspaceData['sourceLines']>; value: string; onChange: (id: string) => void }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const options: InvoiceOption[] = lines.map(line => ({ value: line.id, label: `${line.productName || line.productId} · ${line.voucherNumber?.trim() || line.voucherId} / ${line.lineKey} · ${line.date}${line.batchId ? ` · ${line.batchId}` : ''}` }));
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = options.filter(option => words.every(word => option.label.toLowerCase().includes(word)));
  return <div className="grid min-w-0 gap-1 text-xs font-semibold">
    <label htmlFor={id}>Instrument selling line</label>
    <Combobox items={options} filteredItems={matches} filter={null} value={options.find(option => option.value === value) ?? null} inputValue={query} name="sourceLineId" required
      itemToStringLabel={option => option.label} itemToStringValue={option => option.value} isItemEqualToValue={(a, b) => a.value === b.value}
      onInputValueChange={(text, details) => { setQuery(text); if (details.reason === 'input-change' || details.reason === 'input-clear') onChange(''); }}
      onValueChange={option => { onChange(option?.value ?? ''); setQuery(option?.label ?? ''); }}>
      <ComboboxInput id={id} placeholder="Search item, invoice, date or serial…" showClear className="min-h-11 w-full rounded-lg border-sf-line bg-white" />
      <ComboboxContent className="max-w-[calc(100vw-2rem)] bg-white text-sf-strong">
        <ComboboxEmpty>No matching instrument invoices.</ComboboxEmpty>
        <ComboboxList>{(option: InvoiceOption) => <ComboboxItem key={option.value} value={option} className="min-h-11 whitespace-normal break-words py-3">{option.label}</ComboboxItem>}</ComboboxList>
      </ComboboxContent>
    </Combobox>
  </div>;
}

export function HistoricalInstrumentFields({ lines }: { lines: NonNullable<EconomicsWorkspaceData['sourceLines']> }) {
  const [sourceId, setSourceId] = useState('');
  const selected = lines.find(line => line.id === sourceId);
  const eligible = lines.filter(line => line.kind === 'sale' && /^1(?:\.0{1,6})?$/.test(line.quantity) && BigInt(line.netSalesPaise) > BigInt(0));
  return <section aria-label="Existing instrument invoice" className="grid min-w-0 gap-3 rounded-xl border border-sf-line-soft p-3 sm:col-span-2">
    <h3 className="text-sm font-bold">Existing instrument invoice</h3>
    <p className="text-xs leading-5 text-sf-muted">Register equipment already installed before Orders was used. Select its verified Tally billing line and enter the confirmed installation date separately. This creates an equipment record; capital and billing links are reviewed in target setup.</p>
    <SearchableInstrumentInvoice lines={eligible} value={sourceId} onChange={setSourceId} />
    <input type="hidden" name="expectedSourceRevision" value={selected?.revision ?? ''} />
    <label className="grid gap-1 text-xs font-semibold">Confirmed serial number<input key={sourceId} name="serialNumber" defaultValue={selected?.batchId ?? ''} required minLength={2} maxLength={100} className="min-h-10 min-w-0 rounded-lg border border-sf-line px-3 text-sm" /></label>
    {selected ? <p className="text-xs text-sf-muted">Invoice date: {selected.date}. Confirm that the selected customer and serial belong to this instrument.</p> : null}
  </section>;
}

export function EconomicMappingIdentityFields({ data, simpleOnly = false, onTargetChange }: { data: EconomicsWorkspaceData; simpleOnly?: boolean; onTargetChange?: (id: string) => void }) {
  const [advanced, setAdvanced] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [productId, setProductId] = useState('');
  const placements = data.targets.filter(row => row.kind === 'placement');
  const target = placements.find(row => row.id === targetId);
  const products = new Map<string, string>();
  (data.sourceLines ?? []).filter(row => row.companyId === target?.companyId).forEach(row => products.set(row.productId, row.productName || row.productId));
  data.mappings.filter(row => row.companyId === target?.companyId).forEach(row => { if (!products.has(row.productId)) products.set(row.productId, row.productId); });
  (data.itemGroupCatalogs ?? []).filter(row => row.companyId === target?.companyId && row.current)
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt)).forEach(catalog => catalog.products.forEach(row => products.set(row.id, row.name)));
  return <div className="grid gap-3 sm:col-span-2">
    {simpleOnly ? null : <button type="button" onClick={() => { setAdvanced(!advanced); onTargetChange?.(advanced ? targetId : ''); }} className="min-h-10 justify-self-start text-xs font-bold text-sf-brand">{advanced ? 'Use simple item selection' : 'Advanced: model-wide mapping or verified IDs'}</button>}
    {advanced ? <AdvancedMappingIdentityFields data={data} /> : <section aria-label="Product mapping identity" className="grid gap-3 rounded-xl border border-sf-line-soft p-3 sm:grid-cols-2">
      <label className="grid gap-1 text-xs font-semibold">Instrument placement<select aria-label="Instrument placement" name="targetId" required value={targetId} onChange={event => { setTargetId(event.target.value); setProductId(''); onTargetChange?.(event.target.value); }} className={inputStyle}><option value="">Select an instrument…</option>{placements.map(row => <option key={row.id} value={row.id}>{row.name} · {row.customerName}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-semibold">Individual reagent item<select aria-label="Individual reagent item" name="productId" required value={productId} disabled={!target} onChange={event => setProductId(event.target.value)} className={inputStyle}><option value="">Select a Tally item…</option>{[...products].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      {target ? <><input type="hidden" name="companyId" value={target.companyId} /><input type="hidden" name="modelId" value={target.modelId} /></> : null}
      <p className="text-xs text-sf-muted sm:col-span-2">Add individual items alongside groups. The same item is counted once.</p>
    </section>}
  </div>;
}

export function MappingOptions({ data, defaultFrom }: { data: EconomicsWorkspaceData; defaultFrom?: string | null }) {
  const [advanced, setAdvanced] = useState(false);
  const [from, setFrom] = useState(defaultFrom === undefined ? data.businessDate ?? '' : defaultFrom ?? '');
  const [to, setTo] = useState('');
  const [effect, setEffect] = useState('include');
  const [reason, setReason] = useState('Selected reagent mapping for this instrument');
  return <section className="grid gap-3 sm:col-span-2">
    <p className="text-xs text-sf-muted">{effect === 'include' ? 'Include in instrument sales and GP' : 'Exclude from instrument sales and GP'} · from {from || 'select a date'}{to ? ` until ${to} (exclusive)` : ''}</p>
    <button type="button" onClick={() => setAdvanced(!advanced)} className="min-h-10 justify-self-start text-xs font-bold text-sf-brand">{advanced ? 'Hide mapping options' : 'Change dates, exclusion or note'}</button>
    {advanced ? <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-xs font-semibold">Effect<select aria-label="Effect" name="effect" value={effect} onChange={event => setEffect(event.target.value)} className={inputStyle}><option value="include">Include</option><option value="exclude">Exclude</option></select></label>
      <label className="grid gap-1 text-xs font-semibold">Effective from<input type="date" name="effectiveFrom" required value={from} onChange={event => setFrom(event.target.value)} className={inputStyle} /></label>
      <label className="grid gap-1 text-xs font-semibold">Effective to<input type="date" name="effectiveTo" value={to} onChange={event => setTo(event.target.value)} className={inputStyle} /></label>
      <label className="grid gap-1 text-xs font-semibold">Reason<input name="reason" required value={reason} onChange={event => setReason(event.target.value)} className={inputStyle} /></label>
    </div> : <><input type="hidden" name="effect" value={effect} /><input type="hidden" name="effectiveFrom" value={from} /><input type="hidden" name="effectiveTo" value={to} /><input type="hidden" name="reason" value={reason} /></>}
  </section>;
}

function AdvancedMappingIdentityFields({ data }: { data: EconomicsWorkspaceData }) {
  const id = useId();
  const [companyId, setCompanyId] = useState('');
  const [modelId, setModelId] = useState('');
  const [productId, setProductId] = useState('');
  const [targetId, setTargetId] = useState('');
  const companies = [...new Set([...data.targets, ...data.mappings, ...(data.sourceLines ?? [])].map(row => row.companyId))].sort();
  const models = [...new Set([...data.targets, ...data.mappings].filter(row => row.companyId === companyId).map(row => row.modelId))].sort();
  const products = new Map<string, string>();
  data.mappings.filter(row => row.companyId === companyId).forEach(row => products.set(row.productId, row.productId));
  // Names are display hints only. The submitted value always remains the canonical ID.
  [...(data.sourceLines ?? [])].sort((a, b) => a.date.localeCompare(b.date) || (BigInt(a.revision) < BigInt(b.revision) ? -1 : BigInt(a.revision) > BigInt(b.revision) ? 1 : a.id.localeCompare(b.id)))
    .filter(row => row.companyId === companyId).forEach(row => products.set(row.productId, row.productName || row.productId));
  const placements = data.targets.filter(row => row.kind === 'placement' && row.companyId === companyId && row.modelId === modelId.trim());
  return <section aria-label="Product mapping identity" className="grid min-w-0 gap-3 rounded-xl border border-sf-line-soft p-3 sm:col-span-2 sm:grid-cols-2">
    <p className="text-xs leading-5 text-sf-muted sm:col-span-2">Choose a suggested Tally record, or enter its verified ID if it is outside the imported history. Product names help identify records; mappings use exact IDs.</p>
    <label className="grid min-w-0 gap-1 text-xs font-semibold">Tally company GUID<input aria-label="Tally company GUID" name="companyId" required list={`${id}-companies`} value={companyId} onChange={event => { setCompanyId(event.target.value.trim()); setModelId(''); setProductId(''); setTargetId(''); }} className={inputStyle} /></label>
    <datalist id={`${id}-companies`}>{companies.map(company => <option key={company} value={company}>{company}</option>)}</datalist>
    <label className="grid min-w-0 gap-1 text-xs font-semibold">Model ID<input aria-label="Model ID" name="modelId" required list={`${id}-models`} value={modelId} onChange={event => { setModelId(event.target.value); setTargetId(''); }} className={inputStyle} /></label>
    <datalist id={`${id}-models`}>{models.map(model => <option key={model} value={model}>{model}</option>)}</datalist>
    <label className="grid min-w-0 gap-1 text-xs font-semibold">Tally product GUID<input aria-label="Tally product GUID" name="productId" required list={`${id}-products`} value={productId} onChange={event => setProductId(event.target.value.trim())} className={inputStyle} />{products.has(productId) ? <span className="break-words font-normal text-sf-muted">Selected product: {products.get(productId)}</span> : null}</label>
    <datalist id={`${id}-products`}>{[...products].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0])).map(([product, name]) => <option key={product} value={product} label={name}>{name}</option>)}</datalist>
    <label className="grid min-w-0 gap-1 text-xs font-semibold">Mapping applies to<select aria-label="Mapping applies to" name="targetId" value={targetId} onChange={event => setTargetId(event.target.value)} className={inputStyle}><option value="">All placements of this model</option>{placements.map(row => <option key={row.id} value={row.id}>{row.name} · {row.customerName}</option>)}</select></label>
  </section>;
}

export function ItemGroupMappingFields({ data, onTargetChange }: { data: EconomicsWorkspaceData; onTargetChange?: (id: string) => void }) {
  const [targetId, setTargetId] = useState('');
  const [groupId, setGroupId] = useState('');
  const placements = data.targets.filter(target => target.kind === 'placement');
  const target = placements.find(row => row.id === targetId);
  const catalog = target ? (data.itemGroupCatalogs ?? [])
    .filter(row => row.companyId === target.companyId && row.current)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0] : undefined;
  const group = catalog?.groups.find(row => row.id === groupId);
  const groups = catalog?.groups ?? [];
  return <section aria-label="Item group mapping identity" className="grid min-w-0 gap-3 rounded-xl border border-sf-line-soft p-3 sm:col-span-2 sm:grid-cols-2">
    <p className="text-xs leading-5 text-sf-muted sm:col-span-2">All items in the selected group, including subgroups, contribute reagent sales and GP. New group items follow after a verified Tally sync. Direct product exclusions at the same scope take precedence.</p>
    <label className="grid min-w-0 gap-1 text-xs font-semibold">Instrument placement<select aria-label="Instrument placement" name="targetId" required value={targetId} onChange={event => { setTargetId(event.target.value); setGroupId(''); onTargetChange?.(event.target.value); }} className={inputStyle}><option value="">Select an instrument placement…</option>{placements.map(row => <option key={row.id} value={row.id}>{row.name} · {row.customerName}</option>)}</select></label>
    {target ? <><input type="hidden" name="companyId" value={target.companyId} /><input type="hidden" name="modelId" value={target.modelId} /></> : null}
    {catalog ? <input type="hidden" name="expectedCatalogId" value={catalog.id} /> : null}
    <label className="grid min-w-0 gap-1 text-xs font-semibold">Tally item group<select aria-label="Tally item group" name="groupId" required value={groupId} onChange={event => setGroupId(event.target.value)} className={inputStyle} disabled={!catalog || groups.length === 0}><option value="">{catalog ? 'Select an item group…' : 'No current item group catalog'}</option>{groups.map(row => <option key={row.id} value={row.id}>{row.name} · {row.itemCount} items</option>)}</select></label>
    {group ? <p className="text-sm text-sf-body sm:col-span-2">Selected group: {group.name} · {group.itemCount} items</p> : null}
    {target && !catalog ? <output className="text-xs text-amber-900 sm:col-span-2">No current item group catalog is available for this company. Sync Tally and refresh before mapping a group.</output> : null}
    {catalog && groups.length === 0 ? <output className="text-xs text-amber-900 sm:col-span-2">The current Tally catalog has no item groups to map.</output> : null}
  </section>;
}

function formatAcquisitionCost(paise: string) {
  const value = BigInt(paise); const absolute = value < BigInt(0) ? -value : value;
  return `${value < BigInt(0) ? '−' : ''}₹${(absolute / BigInt(100)).toLocaleString('en-IN')}.${(absolute % BigInt(100)).toString().padStart(2, '0')}`;
}
export function capitalPreviewPaise(input: string): bigint {
  const parts = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  return parts ? (BigInt(parts[2]) * BigInt(100) + BigInt((parts[3] ?? '').padEnd(2, '0'))) * (parts[1] === '-' ? BigInt(-1) : BigInt(1)) : BigInt(0);
}
export function capitalBeyondManagementReview(target: EconomicTarget | undefined, deltaPaise: bigint, reviewMonths: number) {
  const gp = target?.investmentReview?.expectedMonthlyGpPaise;
  if (target?.approval !== 'approved' || deltaPaise <= BigInt(0) || gp == null || BigInt(gp) <= BigInt(0)) return false;
  // Add the increase before clamping exposure, so surplus instrument billing is retained.
  const exposure = BigInt(target.capitalPaise) + deltaPaise - BigInt(target.instrumentBillingPaise ?? '0');
  return exposure > BigInt(gp) * BigInt(reviewMonths);
}
export function AcquisitionReviewFields({ items, targets = [], groupMemberships = [], canAdministrator = false, reviewMonths = 36, onBlockedChange }: { items: NonNullable<EconomicsWorkspaceData['acquisitionReviewItems']>; targets?: EconomicTarget[]; groupMemberships?: EconomicsWorkspaceData['groupMemberships']; canAdministrator?: boolean; reviewMonths?: number; onBlockedChange?: (blocked: boolean) => void }) {
  const [targetId, setTargetId] = useState('');
  const changed = items.filter(item => item.changed);
  const selected = changed.find(item => item.targetId === targetId);
  const affectedIds = new Set([targetId, ...groupMemberships.filter(member => member.placementId === targetId).map(member => member.groupId)]);
  const beyondReview = selected?.capitalDeltaPaise != null && targets.some(target => affectedIds.has(target.id) && capitalBeyondManagementReview(target, BigInt(selected.capitalDeltaPaise!), reviewMonths));
  useEffect(() => { onBlockedChange?.(beyondReview && !canAdministrator); }, [beyondReview, canAdministrator, onBlockedChange]);
  return <section aria-label="Acquisition revision review" className="grid min-w-0 gap-3 rounded-xl border border-sf-line-soft p-3 sm:col-span-2">
    <p className="text-xs text-sf-muted">Verify the latest Tally purchase revision. Saving appends a capital adjustment and review; original values remain in the ledger.</p>
    <label className="grid min-w-0 gap-1 text-xs font-semibold">Acquisition to review<select aria-label="Acquisition to review" name="targetId" required value={targetId} onChange={event => setTargetId(event.target.value)} className={inputStyle}><option value="">Select changed acquisition…</option>{changed.map(item => <option key={item.targetId} value={item.targetId}>{item.targetName} · {item.voucherId} rev {item.expectedSourceRevision}</option>)}</select></label>
    {!changed.length ? <p className="text-sm text-sf-muted">No acquisition revisions need review.</p> : null}
    {selected ? <div key={`${selected.targetId}:${selected.expectedSourceRevision}`} className="grid gap-3">
      <input type="hidden" name="expectedVersion" value={selected.expectedVersion} /><input type="hidden" name="expectedSourceRevision" value={selected.expectedSourceRevision} />
      <p className="text-sm">Previously verified acquisition: {formatAcquisitionCost(selected.previousAmountPaise)}</p>
      {selected.proposedAmountPaise == null ? <><p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">The latest invoice has missing or incompatible instrument evidence. Investigate the source before reviewing capital.</p></> : <>
        <p className="text-sm font-bold">Proposed acquisition: {formatAcquisitionCost(selected.proposedAmountPaise)} · capital adjustment: {formatAcquisitionCost(selected.capitalDeltaPaise ?? '0')}</p>
        {selected.cancelled ? <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><input type="checkbox" name="confirmCancellation" required className="mt-1" /> I verified this cancellation and approve reducing this acquisition cost to zero.</label> : null}
      </>}
      <label className="grid gap-1 text-xs font-semibold">Acquisition review evidence<input name="reason" required minLength={3} className={inputStyle} /></label>
      {canAdministrator ? <label className="flex items-start gap-2 text-xs"><input type="checkbox" name="directorException" required={beyondReview} /> Administrator approval: I confirm this payback beyond the review band</label> : beyondReview ? <p className="text-xs text-sf-muted">Needs an Administrator to approve (payback over {reviewMonths} months).</p> : null}
    </div> : null}
  </section>;
}
function placementInvestment(capital: string, billing: string) {
  const remaining = BigInt(capital) - BigInt(billing); return (remaining > BigInt(0) ? remaining : BigInt(0)).toString();
}
export function InstrumentBillingFields({ data }: { data: EconomicsWorkspaceData }) {
  const [targetId, setTargetId] = useState(''); const [sourceId, setSourceId] = useState('');
  const targets = data.targets.filter(target => target.kind === 'placement' && target.acquisitionProductId && target.capitalEvidenceCurrent !== false && !(data.instrumentBillings ?? []).some(billing => billing.target_id === target.id));
  const target = targets.find(row => row.id === targetId);
  const sales = (data.sourceLines ?? []).filter(line => target && line.kind === 'sale' && line.companyId === target.companyId && line.customerSourceId === target.customerSourceId && line.productId === target.acquisitionProductId && line.unit === target.acquisitionUnit && Number(line.quantity) === 1 && BigInt(line.netSalesPaise) > BigInt(0));
  const selected = sales.find(line => line.id === sourceId);
  const investment = target && selected ? placementInvestment(target.capitalPaise, selected.netSalesPaise) : null;
  return <section aria-label="Instrument billing and placement investment" className="grid min-w-0 gap-3 rounded-xl border border-sf-line-soft p-3 sm:col-span-2">
    <p className="text-xs text-sf-muted">Customer instrument billing reduces the investment recovered through reagent GP. Values exclude GST. Billing is invoiced recovery, not proof of cash collection.</p>
    <label className="grid min-w-0 gap-1 text-xs font-semibold">Instrument placement<select aria-label="Instrument placement" name="targetId" required value={targetId} onChange={event => { setTargetId(event.target.value); setSourceId(''); }} className={inputStyle}><option value="">Select instrument with verified acquisition…</option>{targets.map(row => <option key={row.id} value={row.id}>{row.name} · {row.customerName}</option>)}</select></label>
    {target ? <><input type="hidden" name="expectedVersion" value={target.version} /><label className="grid min-w-0 gap-1 text-xs font-semibold">Instrument selling invoice<select aria-label="Instrument selling invoice" name="sourceLineId" required value={sourceId} onChange={event => setSourceId(event.target.value)} className={inputStyle}><option value="">Select matching customer instrument invoice…</option>{sales.map(line => <option key={line.id} value={line.id}>{line.date} · {line.voucherId} / {line.lineKey} · {formatAcquisitionCost(line.netSalesPaise)}</option>)}</select></label></> : null}
    {target && selected && investment != null ? <div className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900"><p>Purchase/capital cost: {formatAcquisitionCost(target.capitalPaise)}</p><p>Net instrument billing: {formatAcquisitionCost(selected.netSalesPaise)}</p><p className="font-bold">Placement investment: {formatAcquisitionCost(investment)}</p></div> : null}
    <label className="grid gap-1 text-xs font-semibold">Instrument billing verification evidence<input name="reason" required minLength={3} placeholder="Confirm invoice, customer and instrument serial" className={inputStyle} /></label>
  </section>;
}
export function InstrumentAcquisitionFields({ lines }: { lines: NonNullable<EconomicsWorkspaceData['sourceLines']> }) {
  const [mode, setMode] = useState('manual');
  const [lineId, setLineId] = useState('');
  const purchases = lines.filter(line => line.kind === 'purchase' && Number(line.quantity) === 1 && BigInt(line.netSalesPaise) > BigInt(0));
  const selected = purchases.find(line => line.id === lineId);
  const cost = selected ? formatAcquisitionCost(selected.netSalesPaise) : null;
  const inputClass = 'min-h-10 min-w-0 w-full rounded-lg border border-sf-line bg-white px-3 text-sm';
  return <section aria-label="Instrument acquisition value" className="grid min-w-0 gap-3 rounded-xl border border-sf-line-soft p-3 sm:col-span-2">
    <label className="grid gap-1 text-xs font-semibold">Capital source<select aria-label="Capital source" value={mode} onChange={event => setMode(event.target.value)} className={inputClass}><option value="manual">Manual historical value with evidence</option><option value="tally">Verified Tally instrument purchase</option></select></label>
    {mode === 'tally' ? <><input type="hidden" name="capitalPaise" value="0" /><label className="grid gap-1 text-xs font-semibold">Tally acquisition purchase<select aria-label="Tally acquisition purchase" name="acquisitionPurchaseLineId" required value={lineId} onChange={event => setLineId(event.target.value)} className={inputClass}><option value="">Select individually billed instrument…</option>{purchases.map(line => <option key={line.id} value={line.id}>{line.companyId} · {line.date} · {line.voucherId} / {line.lineKey} · {line.productName ?? line.productId}</option>)}</select></label><p className="text-sm font-semibold">{selected ? `Tally net acquisition cost: ${cost}` : 'Select a purchase to see its net cost.'}</p><p className="text-xs text-sf-muted">Management must match the instrument and serial number. The server uses Tally net cost excluding GST and checks company, date and duplicate use. Bulk invoice lines need an evidenced manual allocation.</p></> : <label className="grid gap-1 text-xs font-semibold">Capital (₹)<input name="capitalPaise" required inputMode="decimal" placeholder="0.00" className={inputClass} /></label>}
    <label className="grid gap-1 text-xs font-semibold">Capital purchase or approval evidence<input name="capitalEvidence" required={mode === 'tally'} placeholder={mode === 'tally' ? 'Instrument serial number and purchase verification reference' : 'Historical acquisition evidence or approved allocation'} className={inputClass} /></label>
  </section>;
}



const inputStyle = 'min-h-10 min-w-0 w-full rounded-lg border border-sf-line bg-white px-3 text-sm';
const buttonStyle = 'min-h-10 rounded-lg border border-sf-line px-3 text-sm font-bold text-sf-brand';
type SourceLine = NonNullable<EconomicsWorkspaceData['sourceLines']>[number];

export function PurchaseCostVerificationFields({ lines, attributionLines = [] }: { lines: SourceLine[]; attributionLines?: NonNullable<EconomicsWorkspaceData['attributionLines']> }) {
  const [saleId, setSaleId] = useState('');
  const sale = lines.find(line => line.id === saleId);
  const sales = costVerificationSaleLines(lines, attributionLines);
  const candidateCounts = new Map(sales.map(line => [line.id, compatiblePurchaseLines(line, lines).length]));
  const matchKinds = new Map(sales.map(line => [line.id, purchaseMatchKind(line, lines)]));
  const countOf = (kind: PurchaseMatchKind) => sales.filter(line => matchKinds.get(line.id) === kind).length;
  const shortQuantity = countOf('short_quantity');
  const summary = ([['single', 'ready to check against one purchase'], ['multiple', 'with several possible purchases'], ['zero_value_only', 'with only ₹0 entries'], ['short_quantity', 'short of purchase quantity'], ['none', 'with no purchase match']] as const)
    .map(([kind, label]) => [countOf(kind), label] as const).filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`).join(' · ');
  const matchLabel = (line: SourceLine) => {
    const count = candidateCounts.get(line.id) ?? 0;
    switch (matchKinds.get(line.id)) {
      case 'zero_value_only': return '₹0 entry only';
      case 'short_quantity': return 'Not enough purchase qty';
      case 'none': return 'No purchase match';
      case 'multiple': return `${count} possible purchases`;
      default: return '1 purchase match';
    }
  };
  return <section aria-label="Historical purchase cost evidence" className="grid min-w-0 gap-3 rounded-xl border border-sf-line-soft p-3 sm:col-span-2">
    <div><h3 className="text-sm font-bold text-sf-strong">Sales waiting for purchase cost</h3><p className="mt-1 text-xs leading-5 text-sf-muted">Only mapped reagent sales with unavailable cost are listed. Select the reviewed Tally purchase evidence; the system calculates cost and GP.</p></div>
    <p className="rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-900">{sales.length} sale {sales.length === 1 ? 'line needs' : 'lines need'} cost evidence.</p>
    {summary ? <p className="text-xs font-semibold text-sf-body">{summary}</p> : null}
    {shortQuantity ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{shortQuantity} {shortQuantity === 1 ? 'sale has' : 'sales have'} less compatible purchase quantity than was sold. Cost stays unavailable until the missing purchase is imported.</p> : null}
    <label className="grid gap-1 text-xs font-semibold">Sale needing cost<select aria-label="Sale needing cost" name="sourceLineId" value={saleId} required disabled={!sales.length} onChange={event => setSaleId(event.target.value)} className={inputStyle}>
      <option value="" disabled>{sales.length ? 'Select a mapped sale…' : 'No mapped sales need cost evidence'}</option>{sales.map(line => <option key={line.id} value={line.id}>{line.productName || line.productId} · {matchLabel(line)} · {displayQuantity(line.quantity)} {line.unit} · {line.date} · {voucherLabel(line)}</option>)}
    </select></label>
    {sale ? <div className="rounded-lg border border-sf-line-soft p-3 text-sm text-sf-body"><p className="font-semibold">Tally sale {voucherLabel(sale)} line {sale.lineKey} · {sale.date}</p><p className="mt-1 break-words">{sale.productName || sale.productId} · {displayQuantity(sale.quantity)} {sale.unit} · {formatAcquisitionCost(sale.netSalesPaise)}{sale.batchId ? ` · batch ${sale.batchId}` : ' · no batch'}</p><p className="mt-1 font-semibold">Cover the complete sale quantity: {displayQuantity(sale.quantity)} {sale.unit}.</p></div> : sales.length ? <p className="text-xs text-sf-muted">Choose a sale to see purchases with matching company, product, base unit, date and batch evidence.</p> : <p className="text-xs text-sf-muted">There is no purchase-cost review to complete in the current rebuild.</p>}
    <PurchaseRows key={saleId} sale={sale} lines={lines} />
    <label className="grid gap-1 text-xs font-semibold">Evidence reference<input name="evidenceReference" required disabled={!sales.length} placeholder="Tally purchase voucher checked and who checked it" className={inputStyle} /></label>
    <p className="text-xs leading-5 text-sf-muted">Up to {maxEconomicEvidenceRows} sources. The server checks remaining purchase availability, current revisions and the complete quantity again when saving.</p>
  </section>;
}

const voucherLabel = (line: SourceLine) => line.voucherNumber?.trim() || line.voucherId;
const displayQuantity = (quantity: string) => quantity.includes('.') ? quantity.replace(/\.?0+$/, '') : quantity;
const purchaseValue = (line: SourceLine) => BigInt(line.netSalesPaise) === BigInt(0) ? '₹0 entry' : formatAcquisitionCost(line.netSalesPaise);

function PurchaseRows({ sale, lines }: { sale: SourceLine | undefined; lines: SourceLine[] }) {
  const [count, setCount] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const purchases = compatiblePurchaseLines(sale, lines);
  return <>
    {Array.from({ length: count }, (_, index) => { const chosen = purchases.find(line => line.id === selectedIds[index]); return <fieldset key={index} className="grid min-w-0 gap-2 rounded-lg bg-sf-soft p-3 sm:grid-cols-2">
      <legend className="px-1 text-xs font-bold text-sf-body">Purchase {index + 1}</legend>
      <label className="grid min-w-0 gap-1 text-xs font-semibold">Purchase source {index + 1}<select aria-label={`Purchase source ${index + 1}`} name={`purchaseLineId${index}`} defaultValue="" required disabled={!sale} onChange={event => { const id = event.target.value; setSelectedIds(current => { const next = [...current]; next[index] = id; return next; }); }} className={inputStyle}>
        <option value="" disabled>Select a compatible purchase…</option>{purchases.map(line => <option key={line.id} value={line.id}>{purchaseValue(line)} · {displayQuantity(line.quantity)} {line.unit} · {line.date} · {voucherLabel(line)} line {line.lineKey}</option>)}
      </select></label>
      <label className="grid gap-1 text-xs font-semibold">Purchase quantity {index + 1}<input name={`purchaseQuantity${index}`} inputMode="decimal" required disabled={!sale} defaultValue={index === 0 && sale && purchases.length === 1 && Number(purchases[0].quantity) >= Number(sale.quantity) ? sale.quantity : ''} className={inputStyle} /></label>
      {chosen ? <p className="break-words text-xs text-sf-body sm:col-span-2">Tally purchase {voucherLabel(chosen)} line {chosen.lineKey} · {chosen.date} · {displayQuantity(chosen.quantity)} {chosen.unit} · {purchaseValue(chosen)}{chosen.batchId ? ` · batch ${chosen.batchId}` : ''}</p> : null}
    </fieldset>; })}
    {sale && !purchases.length ? <output className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">No compatible purchase evidence is available. Import or review historical Tally purchases; cost remains unavailable.</output> : null}
    <div className="flex flex-wrap gap-2">{count < maxEconomicEvidenceRows ? <button type="button" disabled={!sale} onClick={() => setCount(current => current + 1)} className={`${buttonStyle} disabled:opacity-50`}>Add purchase source</button> : null}{count > 1 ? <button type="button" onClick={() => setCount(current => current - 1)} className={buttonStyle}>Remove last purchase source</button> : null}</div>
  </>;
}

export function EconomicAllocationRows({ targets }: { targets: EconomicTarget[] }) {
  const [count, setCount] = useState(2);
  const placements = targets.filter(target => target.kind === 'placement' && target.approval !== 'rejected');
  return <section aria-label="Complete placement allocation" className="grid min-w-0 gap-3 rounded-xl border border-sf-line-soft p-3 sm:col-span-2">
    <div><h3 className="text-sm font-bold text-sf-strong">Complete placement allocation</h3><p className="mt-1 text-xs leading-5 text-sf-muted">Include every eligible placement in the selected customer, company, site and product scope. Shares must total exactly 100%; up to two decimal places per percentage.</p></div>
    {Array.from({ length: count }, (_, index) => <fieldset key={index} className="grid min-w-0 gap-2 rounded-lg bg-sf-soft p-3 sm:grid-cols-2">
      <legend className="px-1 text-xs font-bold text-sf-body">Allocation {index + 1}</legend>
      <label className="grid min-w-0 gap-1 text-xs font-semibold">Allocation placement {index + 1}<select aria-label={`Allocation placement ${index + 1}`} name={`allocationTargetId${index}`} defaultValue="" required className={inputStyle}>
        <option value="" disabled>Select a placement…</option>{placements.map(target => <option key={target.id} value={target.id}>{target.name} · {target.customerName} · {target.siteId} · {target.effectiveFrom}{target.effectiveTo ? ` to ${target.effectiveTo}` : ''}</option>)}
      </select></label>
      <label className="grid gap-1 text-xs font-semibold">Allocation share {index + 1} (%)<input name={`allocationPercent${index}`} inputMode="decimal" required className={inputStyle} /></label>
    </fieldset>)}
    <div className="flex flex-wrap gap-2">{count < maxEconomicEvidenceRows ? <button type="button" onClick={() => setCount(current => current + 1)} className={buttonStyle}>Add allocation placement</button> : null}{count > 2 ? <button type="button" onClick={() => setCount(current => current - 1)} className={buttonStyle}>Remove last allocation placement</button> : null}</div>
    <p className="text-xs text-sf-muted">Up to {maxEconomicEvidenceRows} placements. Incomplete or conflicting eligibility stays unattributed; saving shares never forces a guess.</p>
  </section>;
}

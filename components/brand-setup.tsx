'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { parseBrandMappingCommand, parseBrandMappingResponse, type BrandAreaCode, type BrandMappingResponse } from '@/lib/brand-mapping';
import { formatPaise } from '@/lib/wallet-format';

const areaNames: Record<BrandAreaCode, string> = {
  HAEM: 'Haematology', BIOCHEM: 'Biochemistry', IMMUNO: 'Hormones / immunoassay', HBA1C: 'HbA1c',
  URINE: 'Urine', COAG: 'Coagulation', RAPID: 'Rapid tests / serology', CULTURE: 'Culture',
};
const control = 'min-h-11 w-full min-w-0 max-w-full rounded-lg border border-sf-line bg-white px-3 text-sm disabled:opacity-50';
const button = 'min-h-11 rounded-lg border border-sf-line px-3 text-sm disabled:opacity-50';
type Draft = { action: string; [key: string]: unknown };

export function BrandSetup({ onBack }: { onBack: () => void }) {
  const prefix = useId();
  const [data, setData] = useState<BrandMappingResponse | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [retry, setRetry] = useState<Draft | null>(null);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const flight = useRef(false);
  useEffect(() => {
    if (search === query) return;
    const timer = setTimeout(() => { setQuery(search); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search, query]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setError('');
      void fetch(`/api/brand-mapping?${new URLSearchParams({ q: query, page: String(page) })}`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
        if (!response.ok) throw new Error('Read failed');
        const result = parseBrandMappingResponse(await response.json());
        if (!result || result.page !== page) throw new Error('Invalid mapping');
        if (!controller.signal.aborted) { setData(result); setLoading(false); }
      }).catch(() => { if (!controller.signal.aborted) { setError('Brands setup could not load. Try again.'); setLoading(false); } });
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, page, revision]);
  async function save(draft: Draft) {
    if (flight.current) return;
    const fingerprint = JSON.stringify(draft);
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, key: crypto.randomUUID() };
    const body = { ...draft, idempotencyKey: pending.current.key };
    if (!parseBrandMappingCommand(body)) { setNotice('Mapping could not be saved. Check the selection and try again.'); return; }
    flight.current = true; setBusy(true); setNotice(''); setRetry(null);
    try {
      const response = await fetch('/api/brand-mapping', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) pending.current = null;
      if (response.status === 409) { setNotice('Changed by someone else. Reloaded.'); setLoading(true); setRevision(n => n + 1); return; }
      if (!response.ok) throw new Error('Save failed');
      pending.current = null;
      if (draft.action === 'add_brand') setName('');
      setLoading(true); setRevision(n => n + 1);
    } catch {
      setNotice('Mapping save could not be confirmed. Retry the same save.'); setRetry(draft);
    } finally { flight.current = false; setBusy(false); }
  }
  function options(linkId: string | null, item = false) {
    return <>{!linkId ? <option value="">Not set</option> : null}{item && linkId ? <option value="inherit">Use group</option> : null}{data?.brands.map(brand => <option key={brand.code} value={brand.code}>{brand.name}</option>)}<option value="none">Not a brand we target</option></>;
  }
  const disabled = busy || loading || !!error;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 20));
  return <section aria-label="Brands setup" className="min-w-0 space-y-4 text-sm text-sf-ink">
    <header className="space-y-3"><div className="flex flex-wrap items-center gap-3"><button type="button" className="min-h-11 rounded-xl border border-sf-line px-3 text-xs font-bold text-sf-ink disabled:opacity-50" disabled={busy} onClick={onBack}>Back to prospects</button><h2 className="text-xl font-bold">Brands setup</h2></div>{data ? <p className="text-xs text-sf-muted">Unmapped sales: {formatPaise(data.unmappedSalesPaise)} of {formatPaise(data.totalSalesPaise)} (last 180 days)</p> : null}</header>
    {notice ? <output className="block text-xs text-sf-muted">{notice} {retry ? <button type="button" className={button} disabled={disabled} onClick={() => void save(retry)}>Retry save</button> : null}</output> : null}
    {loading ? <p className="text-sm text-sf-muted">Loading brands setup…</p> : null}
    {error ? <p className="text-sm text-sf-muted">{error} <button type="button" className={button} onClick={() => setRevision(n => n + 1)}>Retry</button></p> : null}
    {data ? <>
      <section aria-label="Stock groups" className="space-y-2"><h3 className="font-semibold">Stock groups</h3>{data.groups.map((group, index) => <div key={group.group} className="min-w-0 space-y-1 rounded-xl border border-sf-line-soft p-3 break-words"><p className="font-semibold">{group.label}</p><p className="text-xs text-sf-muted">{group.items} items · {formatPaise(group.salesPaise)}</p><label className="block text-xs" htmlFor={`${prefix}-group-${index}`}>Brand<span className="sr-only"> for {group.label}</span></label><select id={`${prefix}-group-${index}`} className={control} disabled={disabled} value={group.kind === 'none' ? 'none' : group.brandCode ?? ''} onChange={event => { if (event.target.value) void save({ action: 'set_group_brand', group: group.group, expectedLinkId: group.linkId ?? null, brandCode: event.target.value === 'none' ? null : event.target.value }); }}>{options(group.linkId)}</select></div>)}</section>
      <section aria-label="Items without a brand" className="space-y-2"><h3 className="font-semibold">Items without a brand</h3><label className="block text-xs" htmlFor={`${prefix}-search`}>Search items</label><input type="search" placeholder="Item name" id={`${prefix}-search`} className={control} maxLength={120} value={search} disabled={busy} onChange={event => setSearch(event.target.value)} />{data.items.map((item, index) => <div key={item.itemKey} className="min-w-0 space-y-1 rounded-xl border border-sf-line-soft p-3 break-words"><p className="font-semibold">{item.name}</p><p className="text-xs text-sf-muted">{item.group} · {formatPaise(item.salesPaise)}</p><label className="block text-xs" htmlFor={`${prefix}-item-${index}`}>Brand<span className="sr-only"> for {item.name}</span></label><select id={`${prefix}-item-${index}`} className={control} disabled={disabled} value={item.kind === 'none' ? 'none' : item.kind === 'inherit' ? 'inherit' : item.brandCode ?? ''} onChange={event => { const value = event.target.value; if (value) void save({ action: 'set_item_brand', itemKey: item.itemKey, expectedLinkId: item.linkId ?? null, ...(value === 'inherit' ? { clear: true } : { brandCode: value === 'none' ? null : value }) }); }}>{options(item.linkId, true)}</select></div>)}
        <div className="flex flex-wrap items-center gap-3 text-xs"><button type="button" className={button} disabled={disabled || page <= 1} onClick={() => setPage(n => n - 1)}>Previous</button><span>Page {page} of {pages}</span><button type="button" className={button} disabled={disabled || page >= pages} onClick={() => setPage(n => n + 1)}>Next</button></div>
      </section>
      <section aria-label="Installed machines" className="space-y-2"><h3 className="font-semibold">Installed machines</h3>{data.equipment.map((item, index) => <div key={item.itemKey} className="min-w-0 space-y-1 rounded-xl border border-sf-line-soft p-3 break-words"><p className="font-semibold">{item.name}</p><p className="text-xs text-sf-muted">{item.installs} installs</p><label className="block text-xs" htmlFor={`${prefix}-equipment-${index}`}>Area<span className="sr-only"> for {item.name}</span></label><select id={`${prefix}-equipment-${index}`} className={control} disabled={disabled} value={item.areaCode ?? ''} onChange={event => void save({ action: 'set_equipment_area', itemKey: item.itemKey, expectedLinkId: item.linkId ?? null, areaCode: event.target.value || null })}><option value="">Not set</option>{Object.entries(areaNames).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></div>)}</section>
      <form aria-label="Add brand" className="flex min-w-0 flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void save({ action: 'add_brand', name: name.trim() }); }}><div className="min-w-0 flex-1"><label className="block text-xs" htmlFor={`${prefix}-name`}>Add brand</label><input id={`${prefix}-name`} className={control} required minLength={2} maxLength={60} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></div><button type="submit" className={button} disabled={disabled || Array.from(name.trim()).length < 2 || Array.from(name.trim()).length > 60}>Save</button></form>
    </> : null}
  </section>;
}

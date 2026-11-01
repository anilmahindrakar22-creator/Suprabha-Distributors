'use client';

import { useEffect, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { StatusChip } from '@/components/ui/glance';
import { readCustomerMap } from '@/lib/customer-map';
import { parseProspects, prospectAreaLine, unmappedWarningPercent, type Prospects } from '@/lib/prospects';
import { formatPaise } from '@/lib/wallet-format';
import { BrandSetup } from './brand-setup';
import { CustomerSheet, type CustomerSheetProps } from './customer-sheet';

const button = 'min-h-11 rounded-xl border border-sf-line px-3 text-xs font-bold text-sf-ink disabled:opacity-50';
const choiceBaseClass = 'min-h-11 rounded-lg border px-2.5 py-1 text-left text-xs break-words disabled:opacity-50';
const choiceClass = (selected: boolean) => `${choiceBaseClass} ${selected ? 'border-sf-brand bg-sf-soft font-semibold' : 'border-sf-line'}`;
const fits = { vidas: 'VIDAS fit', clia: 'CLIA fit', check: 'Check volume', none: 'No immunoassay' };
type Fit = '' | keyof typeof fits;

export function ProspectsView({ financial, onBack, onPlan, onOrder, onOpenOrder, onContacts }: {
  financial: boolean; onBack: () => void;
} & Pick<CustomerSheetProps, 'onPlan' | 'onOrder' | 'onOpenOrder' | 'onContacts'>) {
  const [response, setResponse] = useState<Prospects | null>(null);
  const [brand, setBrand] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try { return localStorage.getItem('sf-prospects-brand'); } catch { return null; }
  });
  const [fit, setFit] = useState<Fit>('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [setup, setSetup] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const hasAcceptedResponse = useRef(false);
  const requestedBrand = brand ?? 'BIOMERIEUX';
  useEffect(() => {
    if (setup) return;
    const controller = new AbortController();
    // The read contract requires a brand. Discover the catalogue through the seeded brand.
    const params = new URLSearchParams({ prospects: requestedBrand, page: String(page) });
    if (fit) params.set('fit', fit);
    const timer = setTimeout(() => {
      setLoading(true); setError('');
      void readCustomerMap(`/api/customer-map?${params}`, parseProspects, controller.signal).then(result => {
        if (controller.signal.aborted) return;
        if (result.page !== page || result.brands.some(item => item.code === requestedBrand) && result.brand.code !== requestedBrand) throw new Error('Unexpected prospects');
        hasAcceptedResponse.current = true;
        setResponse(result); setLoading(false);
        const choice = result.brands.find(item => item.code === result.brand.code) ?? result.brands[0];
        setBrand(choice.code);
        try { localStorage.setItem('sf-prospects-brand', choice.code); } catch { /* Storage is optional. */ }
      }).catch(() => {
        if (controller.signal.aborted) return;
        if (!hasAcceptedResponse.current && brand !== null) {
          try { localStorage.removeItem('sf-prospects-brand'); } catch { /* Storage is optional. */ }
          setBrand(null);
          return;
        }
        setError('Customers could not load. Try again.'); setLoading(false);
      });
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [requestedBrand, fit, page, revision, setup, brand]);
  if (setup && financial) return <BrandSetup onBack={() => { setSetup(false); setRevision(n => n + 1); }} />;
  const percent = financial ? unmappedWarningPercent(response?.mappedShare ?? null) : null;
  const pages = Math.max(1, Math.ceil((response?.total ?? 0) / 20));
  return <section aria-label="Prospects" className="min-w-0 space-y-3 text-sf-ink">
    <header className="flex flex-wrap items-center gap-3"><button type="button" className={button} onClick={onBack}>Back to accounts</button><h2 className="text-xl font-bold">Prospects</h2>{financial ? <button type="button" className="min-h-11 text-sm underline" onClick={() => setSetup(true)}>Brands setup</button> : null}</header>
    {response ? <>
      <div aria-label="Brands" className="flex flex-wrap gap-1.5">{response.brands.map(item => <button type="button" key={item.code} aria-pressed={brand === item.code} className={choiceClass(brand === item.code)} onClick={() => { setBrand(item.code); setFit(''); setPage(1); }}>{item.name}</button>)}</div>
      {response.brands.find(item => item.code === brand)?.areas.includes('IMMUNO') ? <div aria-label="Equipment fit" className="flex flex-wrap gap-1.5">{(['', 'vidas', 'clia', 'check', 'none'] as const).map(value => <button type="button" key={value} aria-pressed={fit === value} className={choiceClass(fit === value)} onClick={() => { setFit(value); setPage(1); }}>{value ? fits[value] : 'All'}</button>)}</div> : null}
      {percent !== null ? <p className="text-xs text-sf-muted">{percent}% of sales (last 180 days) not yet mapped to a brand. <button type="button" className="min-h-11 underline" onClick={() => setSetup(true)}>Brands setup</button></p> : null}
    </> : null}
    {loading ? <p className="text-sm text-sf-muted">Loading customers…</p> : error ? <p className="text-sm text-sf-muted">{error} <button type="button" className={button} onClick={() => setRevision(n => n + 1)}>Retry</button></p> : response ? <>
      {response.rows.length ? <ul aria-label="Prospect labs" className="space-y-2">{response.rows.map(row => <li key={row.customerId} className="min-w-0"><button type="button" className="min-h-11 w-full min-w-0 space-y-2 rounded-xl border border-sf-line-soft bg-white p-3 text-left break-words" onClick={() => setSelected(row.customerId)}>
        <span className="block text-sm"><span className="font-semibold">{row.name}</span>{row.city ? <span className="text-sf-muted"> · {row.city}</span> : null}</span>
        <span className="block text-xs">{prospectAreaLine(row.areas)}</span>
        <span className="block text-xs text-sf-muted">{[
          row.fit && row.fit !== 'unknown' ? fits[row.fit] : null,
          row.hasOurMachine ? 'Has our machine' : null,
          financial ? typeof row.brandSalesPaise === 'number' && row.brandSalesPaise > 0 ? `Buys ${formatPaise(row.brandSalesPaise)}` : 'Not buying' : row.buysBrand ? 'Buys' : 'Not buying',
        ].filter(Boolean).join(' · ')}</span>
        {row.packWasteRisk || row.stale ? <span className="flex flex-wrap gap-1.5">{row.packWasteRisk ? <StatusChip icon={TriangleAlert} tone="warning">CLIA pack-waste risk</StatusChip> : null}{row.stale ? <StatusChip icon={TriangleAlert} tone="warning">Re-check</StatusChip> : null}</span> : null}
      </button></li>)}</ul> : <p className="text-sm text-sf-muted">No labs with a test mix for {response.brand.name} yet. Fill Test mix on visits.</p>}
      <div className="flex flex-wrap items-center gap-3 text-xs"><button type="button" className={button} disabled={page <= 1} onClick={() => setPage(n => n - 1)}>Previous</button><span>Page {page} of {pages}</span><button type="button" className={button} disabled={page >= pages} onClick={() => setPage(n => n + 1)}>Next</button></div>
    </> : null}
    {selected ? <CustomerSheet key={selected} customerId={selected} financial={financial} onClose={() => setSelected(null)} onPlan={onPlan} onOrder={onOrder ? id => { setSelected(null); onOrder(id); } : undefined} onOpenOrder={onOpenOrder} onContacts={onContacts} onLocationSaved={() => setRevision(n => n + 1)} /> : null}
  </section>;
}

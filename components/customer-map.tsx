'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MARKET_AREA } from '@/lib/account-types';
import { formatBoundingBox, mapColours, toneMeanings, parseMapPins, parseNotOnMap, readCustomerMap, type MapPins, type MapPin, type MapTone, type UnplacedCustomers } from '@/lib/customer-map';
import { CustomerSheet, type CustomerSheetProps } from './customer-sheet';

const button = 'min-h-11 rounded-xl border border-white/20 px-3 text-xs font-semibold disabled:opacity-50';
type Filter = 'Wallet' | 'Actions' | 'Orders' | 'No data';
const visible = (pin: MapPin, filter: Filter | null) => filter === 'Wallet' ? pin.focus || pin.tone === 'green' : filter === 'Actions' ? pin.tone === 'red' || pin.tone === 'amber' : filter === 'Orders' ? pin.openOrders > 0 : filter === 'No data' ? pin.tone === 'grey' : true;
function pinIcon(pin: MapPin) {
  const size = pin.focus ? 44 : 34;
  // Names are assigned through DOM attributes by Leaflet, never interpolated as HTML.
  return L.divIcon({ className: 'customer-map-marker', iconSize: [size, size + 10], iconAnchor: [size / 2, size + 5], html: `<span style="display:block;position:relative;width:${size}px;height:${size}px"><span style="position:absolute;inset:0;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${mapColours[pin.tone]};border:2px solid #fff;box-shadow:0 2px 6px #0008"></span><svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" style="position:absolute;top:${(size - 22) / 2}px;left:${(size - 22) / 2}px;fill:none;stroke:white;stroke-width:2"><path d="M9 3h6M10 3v7L4 20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1l-6-10V3M8 15h8"/></svg>${pin.openOrders > 0 ? `<span style="position:absolute;right:-8px;top:-8px;min-width:22px;height:22px;border-radius:12px;background:white;color:#1b2124;text-align:center;font:600 15px/22px sans-serif">${pin.openOrders}</span>` : ''}</span>` });
}

export function CustomerMap({ financial, onBack, initialCustomerId, onPlan, onOrder, onOpenOrder, onContacts }: {
  financial: boolean; onBack: () => void; initialCustomerId?: string;
} & Pick<CustomerSheetProps, 'onPlan' | 'onOrder' | 'onOpenOrder' | 'onContacts'>) {
  const container = useRef<HTMLDivElement>(null); const map = useRef<L.Map | null>(null);
  const [pins, setPins] = useState<MapPins | null>(null); const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter | null>(financial ? 'Wallet' : null);
  const [selected, setSelected] = useState<string | null>(initialCustomerId ?? null);
  const [listOpen, setListOpen] = useState(false); const [list, setList] = useState<UnplacedCustomers | null>(null);
  const [query, setQuery] = useState(''); const [page, setPage] = useState(1); const [listError, setListError] = useState('');
  const [revision, setRevision] = useState(0); const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, { zoomControl: true, minZoom: 8, maxBounds: [[MARKET_AREA.minLatitude, MARKET_AREA.minLongitude], [MARKET_AREA.maxLatitude, MARKET_AREA.maxLongitude]], maxBoundsViscosity: 0.8 });
    map.current = instance;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>', maxZoom: 19 }).addTo(instance);
    instance.getPane('tilePane')!.style.filter = 'invert(0.9) hue-rotate(180deg) brightness(0.85) saturate(0.6)';
    instance.fitBounds([[MARKET_AREA.minLatitude, MARKET_AREA.minLongitude], [MARKET_AREA.maxLatitude, MARKET_AREA.maxLongitude]]);
    let timer: ReturnType<typeof setTimeout>; let controller: AbortController | null = null;
    function schedule() {
      clearTimeout(timer); controller?.abort();
      timer = setTimeout(() => {
        const request = new AbortController(); controller = request;
        const b = instance.getBounds();
        const south = Math.max(MARKET_AREA.minLatitude, b.getSouth()), north = Math.min(MARKET_AREA.maxLatitude, b.getNorth());
        const west = Math.max(MARKET_AREA.minLongitude, b.getWest()), east = Math.min(MARKET_AREA.maxLongitude, b.getEast());
        if (south >= north || west >= east) { setPins(previous => previous ? { ...previous, pins: [] } : null); return; }
        const requests: Promise<MapPins>[] = [];
        // The market is 3.2° tall; the gateway accepts boxes at most 3° across.
        for (let s = south; s < north; s += 3) for (let w = west; w < east; w += 3) {
          const bbox = formatBoundingBox({ south: s, west: w, north: Math.min(s + 3, north), east: Math.min(w + 3, east) });
          requests.push(readCustomerMap(`/api/customer-map?bbox=${bbox}`, parseMapPins, request.signal));
        }
        void Promise.all(requests).then(results => {
          if (request.signal.aborted) return;
          const unique = new Map(results.flatMap(result => result.pins).map(pin => [pin.customerId, pin]));
          setPins({ ...results[0], pins: [...unique.values()].slice(0, 500) }); setError('');
        }).catch(() => { if (!request.signal.aborted) { setPins(null); setError('Customer map could not load. Try again.'); } });
      }, 300);
    }
    refresh.current = schedule; instance.on('moveend', schedule); schedule();
    const resize = new ResizeObserver(() => instance.invalidateSize()); resize.observe(container.current);
    return () => { clearTimeout(timer); controller?.abort(); resize.disconnect(); instance.off('moveend', schedule); instance.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    if (!map.current) return;
    const group = L.layerGroup().addTo(map.current);
    for (const pin of pins?.pins ?? []) {
      if (!visible(pin, filter)) continue;
      const label = `${pin.name}, ${toneMeanings[pin.tone]}`;
      const marker = L.marker([pin.lat, pin.lng], { icon: pinIcon(pin), title: label, alt: label, keyboard: true }).addTo(group).on('click', () => setSelected(pin.customerId));
      const element = marker.getElement();
      element?.setAttribute('aria-label', label);
      element?.setAttribute('role', 'button');
      if (element) { element.style.minWidth = '44px'; element.style.minHeight = '44px'; }
    }
    return () => { group.remove(); };
  }, [pins, filter]);
  useEffect(() => {
    if (!listOpen) return;
    const controller = new AbortController();
    const timer = setTimeout(() => { setList(null); setListError(''); void readCustomerMap(`/api/customer-map?${new URLSearchParams({ notOnMap: '1', page: String(page), q: query })}`, parseNotOnMap, controller.signal).then(result => { if (result.page !== page) throw new Error('Unexpected page'); if (!controller.signal.aborted) setList(result); }).catch(() => { if (!controller.signal.aborted) setListError('Unplaced customers could not load. Try again.'); }); }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [listOpen, page, query, revision]);
  return <section aria-label="Customer map" className="flex min-h-[calc(100dvh-12rem)] min-w-0 flex-col gap-3 text-white">
    <header className="flex flex-wrap items-center gap-2 rounded-xl bg-[#1b2124] p-3"><button className={button} onClick={onBack}>Back to accounts</button><h3 className="text-base font-semibold">Map</h3><span className="text-base tabular-nums">{pins ? `${pins.coverage.placed} of ${pins.coverage.total} placed` : 'Loading coverage…'}</span><button className={button} aria-expanded={listOpen} onClick={() => setListOpen(n => !n)}>Not on map ({pins?.notOnMapCount ?? '…'})</button>
      <div aria-label="Map filters" className="flex w-full flex-wrap gap-2">{(['Wallet', 'Actions', 'Orders', 'No data'] as const).filter(name => financial || name !== 'Wallet').map(name => <button key={name} className={`${button} ${filter === name ? 'bg-white/20' : ''}`} aria-pressed={filter === name} onClick={() => setFilter(current => current === name ? null : name)}>{name}</button>)}</div>
    </header>
    {error ? <p role="alert" className="text-sm text-sf-danger">{error} <button className="min-h-11 px-3 underline" onClick={() => refresh.current()}>Retry</button></p> : null}
    {listOpen ? <section aria-label="Not on map" className="space-y-2 rounded-xl bg-[#1b2124] p-3"><label className="block text-xs">Search unplaced customers<input className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-white/20 bg-[#262d30] px-3 text-base" value={query} maxLength={120} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>{listError ? <p role="alert">{listError}<button className={button} onClick={() => setRevision(n => n + 1)}>Retry list</button></p> : !list ? <p className="text-xs">Loading customers…</p> : <><ul>{list.rows.map(row => <li key={row.customerId}><button className={`${button} my-1 w-full text-left`} onClick={() => setSelected(row.customerId)}>{row.name}{row.city ? ` · ${row.city}` : ''}</button></li>)}</ul>{!list.total ? <p className="text-xs">No unplaced customers match.</p> : null}<div className="flex items-center gap-3"><button className={button} disabled={page === 1} onClick={() => setPage(n => n - 1)}>Previous</button><span className="text-base">Page {page}</span><button className={button} disabled={page * 20 >= list.total} onClick={() => setPage(n => n + 1)}>Next</button></div></>}</section> : null}
    <div className="relative isolate min-h-[440px] flex-1 overflow-hidden rounded-xl bg-[#1b2124]">
      <div ref={container} aria-label="Customer locations" className="absolute inset-0 z-0" />
      <aside aria-label="Map legend" className="pointer-events-none absolute bottom-7 left-2 z-[500] max-w-[calc(100%-1rem)] space-y-1 rounded-xl bg-[#1b2124]/95 p-3 text-xs">{(Object.keys(mapColours) as MapTone[]).map(tone => <p key={tone} className="flex items-center gap-2"><span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ background: mapColours[tone] }} />{toneMeanings[tone]}</p>)}</aside>
    </div>
    {selected ? <CustomerSheet key={selected} customerId={selected} financial={financial} onClose={() => setSelected(null)} onPlan={onPlan} onOrder={onOrder ? id => { setSelected(null); onOrder(id); } : undefined} onOpenOrder={onOpenOrder} onContacts={onContacts} onLocationSaved={() => { refresh.current(); setRevision(n => n + 1); }} /> : null}
  </section>;
}

'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MARKET_AREA } from '@/lib/account-types';
import { formatBoundingBox, mapColours, toneMeanings, parseMapPins, parseNotOnMap, parsePinLabs, readCustomerMap, type ApproxGroup, type MapPins, type MapPin, type MapTone, type PinLabs, type UnplacedCustomers } from '@/lib/customer-map';
import { CustomerSheet, type CustomerSheetProps, type MapPlacement } from './customer-sheet';

const button = 'min-h-11 rounded-xl border border-sf-line px-3 text-xs font-bold text-sf-ink disabled:opacity-50';
type Filter = 'Wallet' | 'Actions' | 'Orders' | 'No data';
const visible = (pin: MapPin, filter: Filter | null) => filter === 'Wallet' ? pin.focus || pin.tone === 'green' : filter === 'Actions' ? pin.tone === 'red' || pin.tone === 'amber' : filter === 'Orders' ? pin.openOrders > 0 : filter === 'No data' ? pin.tone === 'grey' : true;
// The gateway has no member-level focus/order counts. Only tone-based chips
// can exclude aggregates; retain their supplied count rather than invent one.
const groupVisible = (group: ApproxGroup, filter: Filter | null) => filter === 'Wallet' ? group.tone === 'green' : filter === 'Actions' ? group.tone === 'red' || group.tone === 'amber' : filter === 'No data' ? group.tone === 'grey' : true;
const shortDate = (value: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(new Date(`${value}T00:00:00+05:30`));
const orderBadge = (count: number, offset = 8) => count > 0 ? `<span style="position:absolute;right:-${offset}px;top:-${offset}px;min-width:22px;height:22px;border-radius:12px;background:white;color:var(--color-sf-ink);text-align:center;font:600 15px/22px sans-serif">${count}</span>` : '';
function groupIcon(group: ApproxGroup) {
  const size = group.count >= 50 ? 40 : group.count >= 10 ? 34 : 28;
  return L.divIcon({ className: 'customer-map-group', iconSize: [44, 44], iconAnchor: [22, 22], html: `<span style="position:relative;display:flex;align-items:center;justify-content:center;width:44px;height:44px"><span style="position:absolute;width:${size}px;height:${size}px;border-width:2px;border-style:dashed;border-color:color-mix(in srgb, var(--color-sf-ink) 70%, transparent);border-radius:50%;background:${mapColours[group.tone]}d9"></span><span style="position:relative;color:white;font:700 12px/1 sans-serif">${group.count}</span>${orderBadge(group.openOrders, 5)}</span>` });
}
function pinIcon(pin: MapPin) {
  const size = pin.focus ? 44 : 34;
  // Names are assigned through DOM attributes by Leaflet, never interpolated as HTML.
  return L.divIcon({ className: 'customer-map-marker', iconSize: [size, size + 10], iconAnchor: [size / 2, size + 5], html: `<span style="display:block;position:relative;width:${size}px;height:${size}px"><span style="position:absolute;inset:0;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${mapColours[pin.tone]};border:2px solid #fff;box-shadow:0 2px 6px #0008"></span><svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" style="position:absolute;top:${(size - 22) / 2}px;left:${(size - 22) / 2}px;fill:none;stroke:white;stroke-width:2"><path d="M9 3h6M10 3v7L4 20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1l-6-10V3M8 15h8"/></svg>${orderBadge(pin.openOrders)}</span>` });
}

export function CustomerMap({ financial, onBack, initialCustomerId, onPlan, onOrder, onOpenOrder, onContacts }: {
  financial: boolean; onBack: () => void; initialCustomerId?: string;
} & Pick<CustomerSheetProps, 'onPlan' | 'onOrder' | 'onOpenOrder' | 'onContacts'>) {
  const container = useRef<HTMLDivElement>(null); const map = useRef<L.Map | null>(null);
  const [pins, setPins] = useState<MapPins | null>(null); const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter | null>(financial ? 'Wallet' : null);
  const [selected, setSelected] = useState<string | null>(initialCustomerId ?? null);
  const [placement, setPlacement] = useState<MapPlacement | null>(null);
  const placing = useRef(false);
  const markers = useRef(new Map<string, { signature: string; marker: L.Marker }>());
  useEffect(() => { placing.current = !!placement; }, [placement]);
  const [centre, setCentre] = useState({ lat: 0, lng: 0 });
  const [placeError, setPlaceError] = useState(''); const [saving, setSaving] = useState(false);
  const saveFlight = useRef(false);
  const [listSource, setListSource] = useState<'unplaced' | ApproxGroup | null>(null); const [list, setList] = useState<UnplacedCustomers | PinLabs | null>(null);
  const [query, setQuery] = useState(''); const [page, setPage] = useState(1); const [listError, setListError] = useState('');
  const [revision, setRevision] = useState(0); const refresh = useRef<() => void>(() => {});
  function openList(source: 'unplaced' | ApproxGroup) { setListSource(source); setQuery(''); setPage(1); setList(null); setListError(''); }
  const listTitle = listSource && listSource !== 'unplaced' ? `PIN ${listSource.pinCode} · approx · ${listSource.count} labs` : 'Not on map';
  function startPlacement(next: MapPlacement) {
    const instance = map.current; if (!instance) return;
    const location = next.location;
    const start = location?.precision === 'pin' && location.lat != null && location.lng != null ? location : pins?.approxGroups.find(group => group.pinCode === location?.approximate?.pinCode);
    if (start?.lat != null && start.lng != null) instance.setView([start.lat, start.lng], location?.precision === 'pin' ? 17 : 15, { animate: false });
    setCentre(instance.getCenter()); setPlaceError(''); setListSource(null); setPlacement(next);
  }
  useEffect(() => {
    const instance = map.current; if (!placement || !instance) return;
    instance.getContainer().focus({ preventScroll: true });
    const moved = () => setCentre(instance.getCenter());
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saveFlight.current) { event.preventDefault(); setPlacement(null); } };
    instance.on('move', moved); document.addEventListener('keydown', escape);
    return () => { instance.off('move', moved); document.removeEventListener('keydown', escape); };
  }, [placement]);
  async function savePlacement() {
    if (!placement || !map.current || saveFlight.current) return;
    saveFlight.current = true; setSaving(true); setPlaceError('');
    try {
      const position = map.current.getCenter();
      const message = await placement.save(position.lat, position.lng);
      if (message) setPlaceError(message); else setPlacement(null);
    } finally { saveFlight.current = false; setSaving(false); }
  }
  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, { zoomControl: true, minZoom: 8, maxBounds: [[MARKET_AREA.minLatitude, MARKET_AREA.minLongitude], [MARKET_AREA.maxLatitude, MARKET_AREA.maxLongitude]], maxBoundsViscosity: 0.8 });
    map.current = instance;
    const markerCache = markers.current;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · PIN locations: India Post via data.gov.in (GODL-India)', maxZoom: 19 }).addTo(instance);
    const attribution = instance.attributionControl.getContainer();
    if (attribution) attribution.style.fontSize = '12px';
    instance.fitBounds([[MARKET_AREA.minLatitude, MARKET_AREA.minLongitude], [MARKET_AREA.maxLatitude, MARKET_AREA.maxLongitude]]);
    let timer: ReturnType<typeof setTimeout>; let controller: AbortController | null = null;
    function schedule() {
      clearTimeout(timer); controller?.abort();
      timer = setTimeout(() => {
        const request = new AbortController(); controller = request;
        const b = instance.getBounds();
        const south = Math.max(MARKET_AREA.minLatitude, b.getSouth()), north = Math.min(MARKET_AREA.maxLatitude, b.getNorth());
        const west = Math.max(MARKET_AREA.minLongitude, b.getWest()), east = Math.min(MARKET_AREA.maxLongitude, b.getEast());
        if (south >= north || west >= east) { setPins(previous => previous ? { ...previous, pins: [], approxGroups: [] } : null); return; }
        const requests: Promise<MapPins>[] = [];
        // The market is 3.2° tall; the gateway accepts boxes at most 3° across.
        for (let s = south; s < north; s += 3) for (let w = west; w < east; w += 3) {
          const bbox = formatBoundingBox({ south: s, west: w, north: Math.min(s + 3, north), east: Math.min(w + 3, east) });
          requests.push(readCustomerMap(`/api/customer-map?bbox=${bbox}`, parseMapPins, request.signal));
        }
        void Promise.all(requests).then(results => {
          if (request.signal.aborted) return;
          const unique = new Map(results.flatMap(result => result.pins).map(pin => [pin.customerId, pin]));
          const groups = new Map(results.flatMap(result => result.approxGroups).map(group => [group.pinCode, group]));
          setPins({ ...results[0], pins: [...unique.values()].slice(0, 500), approxGroups: [...groups.values()].slice(0, 500) }); setError('');
        }).catch(() => { if (!request.signal.aborted) { setPins(null); setError('Customer map could not load. Try again.'); } });
      }, 300);
    }
    refresh.current = schedule; instance.on('moveend', schedule); schedule();
    const resize = new ResizeObserver(() => instance.invalidateSize()); resize.observe(container.current);
    return () => { clearTimeout(timer); controller?.abort(); resize.disconnect(); instance.off('moveend', schedule); instance.remove(); markerCache.clear(); map.current = null; };
  }, []);
  useEffect(() => {
    if (!map.current) return;
    // Keep unchanged markers attached across viewport refreshes. Replacing the
    // layer detaches their circle/count DOM even when the data is identical.
    const retained = new Set<string>();
    function changed(key: string, value: MapPin | ApproxGroup) {
      retained.add(key);
      const previous = markers.current.get(key), signature = JSON.stringify(value);
      if (previous?.signature === signature) return null;
      previous?.marker.remove();
      return signature;
    }
    for (const pin of pins?.pins ?? []) {
      if (!visible(pin, filter)) continue;
      const key = `lab:${pin.customerId}`, signature = changed(key, pin);
      if (signature === null) continue;
      const label = `${pin.name}, ${toneMeanings[pin.tone]}`;
      const marker = L.marker([pin.lat, pin.lng], { icon: pinIcon(pin), title: label, alt: label, keyboard: true }).addTo(map.current).on('click', () => { if (placing.current) return; setListSource(null); setSelected(pin.customerId); });
      markers.current.set(key, { signature, marker });
      const element = marker.getElement();
      element?.setAttribute('aria-label', label);
      element?.setAttribute('role', 'button');
      if (element) { element.style.minWidth = '44px'; element.style.minHeight = '44px'; }
    }
    for (const approx of pins?.approxGroups ?? []) {
      if (!groupVisible(approx, filter)) continue;
      const key = `pin:${approx.pinCode}`, signature = changed(key, approx);
      if (signature === null) continue;
      const label = `PIN ${approx.pinCode}, approx, ${approx.count} labs, ${toneMeanings[approx.tone]}`;
      const marker = L.marker([approx.lat, approx.lng], { icon: groupIcon(approx), title: label, alt: label, keyboard: true }).addTo(map.current).on('click', () => { if (!placing.current) openList(approx); });
      markers.current.set(key, { signature, marker });
      marker.getElement()?.setAttribute('aria-label', label);
      marker.getElement()?.setAttribute('role', 'button');
    }
    for (const [key, entry] of markers.current) if (!retained.has(key)) { entry.marker.remove(); markers.current.delete(key); }
  }, [pins, filter]);
  useEffect(() => {
    if (!listSource) return;
    const controller = new AbortController();
    const source: Record<string, string> = listSource === 'unplaced' ? { notOnMap: '1' } : { pin: listSource.pinCode };
    const timer = setTimeout(() => { setList(null); setListError(''); void readCustomerMap(`/api/customer-map?${new URLSearchParams({ ...source, page: String(page), q: query })}`, listSource === 'unplaced' ? parseNotOnMap : parsePinLabs, controller.signal).then(result => { if (result.page !== page) throw new Error('Unexpected page'); if (!controller.signal.aborted) setList(result); }).catch(() => { if (!controller.signal.aborted) setListError('Customers could not load. Try again.'); }); }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [listSource, page, query, revision]);
  return <section aria-label="Customer map" className="flex min-h-[calc(100dvh-12rem)] min-w-0 flex-col gap-3 text-sf-ink">
    <header className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-sf-line-soft bg-white p-3"><button className={button} onClick={onBack}>Back to accounts</button><h3 className="text-base font-semibold">Map</h3>
      <div aria-label="Map coverage" className="flex w-full flex-wrap items-center gap-1 text-xs tabular-nums">{pins ? <><span><span className="text-base">{pins.coverage.placed}</span> placed</span><span aria-hidden="true">·</span><span><span className="text-base">{pins.coverage.approx}</span> approx</span><span aria-hidden="true">·</span><button className="min-h-11 font-semibold" aria-expanded={listSource === 'unplaced'} onClick={() => listSource === 'unplaced' ? setListSource(null) : openList('unplaced')}><span className="text-base">{pins.notOnMapCount}</span> not on map</button></> : 'Loading coverage…'}</div>
      {pins ? <p aria-label="Map freshness" className="w-full text-xs leading-4 text-sf-muted">Updated {new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(pins.freshness.calculatedAt))}{financial ? !pins.freshness.certified ? ' · Wallet not certified' : pins.freshness.walletAsOf ? ` · Wallet as of ${shortDate(pins.freshness.walletAsOf)}` : '' : ''}</p> : null}
      <div aria-label="Map filters" className="flex w-full flex-wrap gap-2">{(['Wallet', 'Actions', 'Orders', 'No data'] as const).filter(name => financial || name !== 'Wallet').map(name => <button key={name} className={`${button} ${filter === name ? 'bg-sf-brand text-white' : ''}`} aria-pressed={filter === name} onClick={() => setFilter(current => current === name ? null : name)}>{name}</button>)}</div>
    </header>
    {error ? <p role="alert" className="text-sm text-sf-danger">{error} <button className="min-h-11 px-3 underline" onClick={() => refresh.current()}>Retry</button></p> : null}
    {listSource ? <section aria-label={listTitle} className="space-y-2 rounded-xl border border-sf-line-soft bg-white p-3"><div className="flex items-center justify-between gap-2"><h4 className="text-base font-semibold">{listTitle}</h4><button className={button} onClick={() => setListSource(null)}>Close list</button></div><label className="block text-xs">{listSource === 'unplaced' ? 'Search unplaced customers' : 'Search PIN customers'}<input className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-sf-line bg-sf-soft-0 px-3 text-base" value={query} maxLength={120} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>{listError ? <p role="alert">{listError}<button className={button} onClick={() => setRevision(n => n + 1)}>Retry list</button></p> : !list ? <p className="text-xs">Loading customers…</p> : <><ul>{list.rows.map(row => <li key={row.customerId}><button className={`${button} my-1 flex w-full items-center gap-2 text-left`} onClick={() => setSelected(row.customerId)}>{'tone' in row ? <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ background: mapColours[row.tone as MapTone] }} /> : null}<span>{row.name}{row.city ? ` · ${row.city}` : ''}</span>{'tone' in row ? <span className="sr-only">{`, ${toneMeanings[row.tone as MapTone]}`}</span> : null}</button></li>)}</ul>{!list.total ? <p className="text-xs">{listSource === 'unplaced' ? 'No unplaced customers match.' : 'No PIN customers match.'}</p> : null}<div className="flex items-center gap-3"><button className={button} disabled={page === 1} onClick={() => setPage(n => n - 1)}>Previous</button><span className="text-base">Page {page}</span><button className={button} disabled={page * 20 >= list.total} onClick={() => setPage(n => n + 1)}>Next</button></div></>}</section> : null}
    <div className="relative isolate min-h-[440px] flex-1 overflow-hidden rounded-xl bg-white">
      {/* Leaflet's mouse-down focus restores window scroll only. Focus first
          without scrolling the Accounts pane, so the marker stays under the pointer. */}
      <div ref={container} aria-label="Customer locations" className="absolute inset-0 z-0" onMouseDownCapture={event => event.currentTarget.focus({ preventScroll: true })} />
      {placement ? <>
        <svg data-testid="placement-crosshair" aria-hidden="true" viewBox="0 0 32 32" className="pointer-events-none absolute left-1/2 top-1/2 z-[500] size-8 -translate-x-1/2 -translate-y-1/2 fill-none"><path d="M16 2v28M2 16h28" stroke="white" strokeWidth="6" /><path d="M16 2v28M2 16h28" stroke="var(--color-sf-ink)" strokeWidth="2" /></svg>
        <section aria-label="Place on map" className="absolute inset-x-2 bottom-8 z-[600] rounded-xl border border-sf-line bg-white p-2 text-xs">
          <div className="flex items-center gap-2"><p className="min-w-0 flex-1 break-words">Place {placement.name}</p><button className={`${button} shrink-0`} disabled={saving} onClick={() => void savePlacement()}>Save here</button><button className={`${button} shrink-0`} disabled={saving} onClick={() => setPlacement(null)}>Cancel</button></div>
          <p aria-label="Map centre" className="text-xs tabular-nums text-sf-muted">{centre.lat.toFixed(5)}, {centre.lng.toFixed(5)}</p>
          {placeError ? <p role="alert" className="break-words text-xs text-sf-warm">{placeError}</p> : null}
        </section>
      </> : null}
      <aside aria-label="Map legend" className={`pointer-events-none absolute ${placement ? 'top-16' : 'bottom-16'} left-2 z-[500] max-w-[calc(100%-1rem)] space-y-1 rounded-xl border border-sf-line-soft bg-white/95 shadow-xl p-3 text-xs`}>{(Object.keys(mapColours) as MapTone[]).map(tone => <p key={tone} className="flex items-center gap-2"><span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ background: mapColours[tone] }} />{toneMeanings[tone]}</p>)}<p className="flex items-center gap-2"><span aria-hidden="true" className="size-3 shrink-0 rounded-full border-2 border-dashed border-sf-ink/70" />Approx (PIN centre)</p></aside>
    </div>
    {selected ? <CustomerSheet key={selected} customerId={selected} financial={financial} placing={!!placement} onPlaceOnMap={startPlacement} onClose={() => setSelected(null)} onPlan={onPlan} onOrder={onOrder ? id => { setSelected(null); onOrder(id); } : undefined} onOpenOrder={onOpenOrder} onContacts={onContacts} onLocationSaved={() => { refresh.current(); setRevision(n => n + 1); }} /> : null}
  </section>;
}

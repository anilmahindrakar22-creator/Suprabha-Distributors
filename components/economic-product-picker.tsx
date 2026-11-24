'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { productKey, normalizeEconomicProductPage, type EconomicProductFilter, type EconomicProductPage, type EconomicProduct } from '@/lib/instrument-economics-products';
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty } from '@/components/ui/combobox';

export function useEconomicProducts(filter: EconomicProductFilter, { enabled }: { enabled: boolean }) {
  const key = productKey({ ...filter, limit: filter.limit ?? 200 });
  const cache = useRef(new Map<string, EconomicProductPage>());
  const [page, setPage] = useState<{ key: string; value: EconomicProductPage } | null>(null);
  const [request, setRequest] = useState({ key, offset: filter.offset ?? 0, retry: 0 });
  const [status, setStatus] = useState({ key: '', loading: false, error: false });
  const offset = request.key === key ? request.offset : filter.offset ?? 0;
  const retryCount = request.retry;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const params = new URLSearchParams(key);
    const initialOffset = Number(params.get('offset') ?? 0);
    const cached = cache.current.get(key);
    if (cached && (offset === initialOffset || offset === cached.offset) && !retryCount) {
      setPage({ key, value: cached }); setStatus({ key, loading: false, error: false });
      return () => controller.abort();
    }
    setStatus({ key, loading: true, error: false });
    const timer = setTimeout(async () => {
      try {
        params.set('offset', String(offset));
        const response = await fetch(`/api/instrument-economics/products?${params}`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Product search failed');
        const next = normalizeEconomicProductPage(await response.json());
        if (controller.signal.aborted) return;
        const previous = cache.current.get(key);
        const value = { ...next, rows: offset > initialOffset && previous ? [...previous.rows, ...next.rows] : next.rows };
        cache.current.delete(key); cache.current.set(key, value);
        if (cache.current.size > 20) cache.current.delete(cache.current.keys().next().value!);
        setPage({ key, value }); setStatus({ key, loading: false, error: false });
      } catch {
        if (!controller.signal.aborted) setStatus({ key, loading: false, error: true });
      }
    }, params.has('q') ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, enabled, offset, retryCount]);
  const current = enabled && page?.key === key ? page.value : null;
  const loading = enabled && (status.key !== key || status.loading);
  return {
    rows: current?.rows ?? [], companies: current?.companies ?? [], total: current?.total ?? 0, loading,
    error: enabled && status.key === key && status.error,
    loadMore: () => {
      if (!loading && current && current.rows.length < current.total) setRequest({ key, offset: (filter.offset ?? 0) + current.rows.length, retry: 0 });
    },
    retry: () => setRequest(previous => ({ key, offset, retry: previous.retry + 1 })),
  };
}

export function EconomicProductPicker({ filter = {}, name, label, value, onChange, placeholder = 'Search products…', required = false }: {
  filter?: EconomicProductFilter; name: string; label: string; value: EconomicProduct | null;
  onChange: (row: EconomicProduct | null) => void; placeholder?: string; required?: boolean;
}) {
  const optionLabel = productLabel;
  const id = useId();
  const [query, setQuery] = useState(filter.q ?? '');
  const [inputText, setInputText] = useState(value ? optionLabel(value) : '');
  const [open, setOpen] = useState(false);
  const [activated, setActivated] = useState(false);
  const [selected, setSelected] = useState(value);
  const chosen = value ? (selected?.productId === value.productId ? selected : value) : null;
  const { rows: loadedRows, total, loading, error, loadMore, retry } = useEconomicProducts({ ...filter, limit: filter.limit ?? 50, q: query || undefined }, { enabled: activated });
  const rows = [...new Map(loadedRows.map(row => [row.productId, row])).values()];
  const buttonClass = 'min-h-11 w-full rounded-lg border border-sf-line px-3 py-2 text-left text-sm disabled:opacity-50';
  return <div className="grid min-w-0 gap-1 text-xs font-semibold">
    <label htmlFor={id}>{label}</label>
    <input type="hidden" name={name} value={chosen?.productId ?? ''} />
    <Combobox items={rows} filteredItems={rows} filter={null} value={chosen} required={required} open={open} onOpenChange={nextOpen => { setOpen(nextOpen); if (nextOpen) setActivated(true); }} inputValue={open ? inputText : chosen ? optionLabel(chosen) : ''}
      itemToStringLabel={optionLabel} itemToStringValue={row => row.productId} isItemEqualToValue={(a, b) => a.productId === b.productId}
      onInputValueChange={(text, details) => { setInputText(text); if (details.reason === 'input-change' || details.reason === 'input-clear') setQuery(text); }}
      onValueChange={row => { setSelected(row); onChange(row); setInputText(row ? optionLabel(row) : ''); setQuery(''); }}>
      <ComboboxInput id={id} placeholder={placeholder} showClear className="min-h-11 w-full min-w-0 rounded-lg border-sf-line bg-white" />
      <ComboboxContent className="min-w-0 max-w-[calc(100vw-2rem)] bg-white text-sf-strong">
        <ComboboxList>{(row: EconomicProduct) => <ComboboxItem key={row.productId} value={row} className="min-h-11 whitespace-normal break-words py-3">{optionLabel(row)}</ComboboxItem>}</ComboboxList>
        {loading ? <output className="block p-3">Loading products…</output> : null}
        <ComboboxEmpty>{!loading && !error ? 'No matching products.' : null}</ComboboxEmpty>
        {loadedRows.length < total ? <button type="button" disabled={loading} onClick={loadMore} className={buttonClass}>Show more ({total - loadedRows.length} left)</button> : null}
      </ComboboxContent>
    </Combobox>
    {error ? <div role="alert" className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-normal text-sf-strong">
      Could not load products.
      <button type="button" className="min-h-11 rounded-lg border border-sf-line bg-white px-4 text-sm font-semibold" onClick={() => { retry(); setOpen(true); }}>Retry</button>
    </div> : null}
  </div>;
}


export function productLabel(row: EconomicProduct): string { return row.productName && row.productName !== row.productId ? `${row.productName} · ${row.productId}` : row.productId; }

export function useProductOptions(q: string): [string, string][] {
  const { rows } = useEconomicProducts({ q: q.trim() || undefined, limit: 50 }, { enabled: q.trim().length >= 2 });
  return [...new Map(rows.map(row => [row.productId, productLabel(row)])).entries()].slice(0, 50);
}

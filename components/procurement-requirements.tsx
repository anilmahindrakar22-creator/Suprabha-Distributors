'use client';

import { useEffect, useRef, useState } from 'react';

type RequirementRow = {
  tallyKey: string;
  itemName: string;
  openDemand: number;
  currentStock: number | null;
  shortage: number | null;
  affectedOrders: number;
  priority: string;
  oldestOrderAt: string;
};

type RequirementsResponse = {
  fetchedAt: string | null;
  rows: RequirementRow[];
  pagination: { page: number; pageCount: number; total: number };
};

function quantity(value: number) {
  return Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function displayDate(value: string | null) {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unavailable';
  return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
}

function priorityLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'urgent' || normalized === 'high' || normalized === 'normal') {
    return normalized[0].toUpperCase() + normalized.slice(1);
  }
  return 'Review';
}

export function ProcurementRequirements() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<RequirementsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => () => requestRef.current?.controller.abort(), []);

  async function load(nextPage: number) {
    requestRef.current?.controller.abort();
    const controller = new AbortController();
    const id = ++requestIdRef.current;
    requestRef.current = { id, controller };
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/requirements?page=${nextPage}`, { cache: 'no-store', signal: controller.signal });
      const body = await response.json() as RequirementsResponse & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Customer requirements could not be loaded.');
      if (!Array.isArray(body.rows) || !body.pagination || !Number.isSafeInteger(body.pagination.page) || body.pagination.page < 1
        || !Number.isSafeInteger(body.pagination.pageCount) || body.pagination.pageCount < 1 || !Number.isSafeInteger(body.pagination.total) || body.pagination.total < 0
        || body.rows.some((row) => !row || typeof row.tallyKey !== 'string' || typeof row.itemName !== 'string'
          || typeof row.openDemand !== 'number' || !Number.isFinite(row.openDemand) || row.openDemand <= 0
          || !Number.isSafeInteger(row.affectedOrders) || row.affectedOrders < 1 || typeof row.priority !== 'string' || typeof row.oldestOrderAt !== 'string'
          || !(row.currentStock === null || typeof row.currentStock === 'number' && Number.isFinite(row.currentStock))
          || !(row.shortage === null || typeof row.shortage === 'number' && Number.isFinite(row.shortage) && row.shortage >= 0))) throw new Error('Customer requirements response was incomplete.');
      if (requestRef.current?.id !== id) return;
      setResult(body);
      setPage(body.pagination.page);
    } catch (cause) {
      if (requestRef.current?.id !== id || controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Customer requirements could not be loaded.');
    } finally {
      if (requestRef.current?.id === id) setLoading(false);
    }
  }

  function toggle() {
    if (open) {
      requestRef.current?.controller.abort();
      requestRef.current = null;
      requestIdRef.current += 1;
      setLoading(false);
      setOpen(false);
      return;
    }
    setOpen(true);
    void load(1);
  }

  const pagination = result?.pagination;
  return <section aria-label="Customer demand and requirements" className="mt-3 rounded-xl border border-[#dce7e5] bg-white p-3">
    <button type="button" aria-expanded={open} onClick={toggle} className="flex min-h-10 w-full items-center justify-between gap-3 text-left text-sm font-bold text-[#31585d]">
      <span>Customer demand / requirements</span><span aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
    {open ? <div className="mt-2 border-t border-[#e3ecea] pt-3">
      <p className="text-xs leading-5 text-[#587275]">Customer demand from open orders is separate from stock replenishment. This is an advisory view, not an allocation or reservation.</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[#718487]">Tally catalog stock as of: <strong className="font-semibold text-[#456367]">{displayDate(result?.fetchedAt ?? null)}</strong></p>
        <button type="button" disabled={loading} onClick={() => void load(page)} className="min-h-9 rounded-lg border border-[#cedfdd] bg-white px-3 text-xs font-bold text-[#31585d] disabled:opacity-50">{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      <p className="mt-2 text-xs text-[#805b20]">Catalog stock may be older than the latest upload. Check its date before procurement; picked but unbilled stock is not reserved here.</p>
      {error ? <p role="alert" className="mt-2 text-sm text-[#8d3a34]">{error}</p> : null}
      {loading && !result ? <p className="mt-3 text-sm text-[#718487]">Loading customer demand…</p> : null}
      {result ? <>
        <p className="mt-2 text-xs text-[#718487]">{quantity(result.pagination.total)} items with open demand</p>
        <div className="mt-2 space-y-2">
          {result.rows.map((row) => <article key={row.tallyKey} className="rounded-lg border border-[#e3ecea] bg-[#fbfcfb] p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="min-w-0 flex-1 break-words text-sm font-bold text-[#274b50]">{row.itemName}</h3>
              <span className="shrink-0 rounded-full bg-[#edf4f2] px-2 py-1 text-[11px] font-semibold text-[#456367]">{priorityLabel(row.priority)}</span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
              <div><dt className="text-[#718487]">Open demand</dt><dd className="mt-0.5 font-semibold text-[#173239]">{quantity(row.openDemand)}</dd></div>
              <div><dt className="text-[#718487]">Current stock</dt><dd className="mt-0.5 font-semibold text-[#173239]">{row.currentStock === null ? 'Unknown · review' : quantity(row.currentStock)}</dd></div>
              <div><dt className="text-[#718487]">Shortage</dt><dd className="mt-0.5 font-semibold text-[#173239]">{row.shortage === null ? 'Unknown · review' : quantity(row.shortage)}</dd></div>
              <div><dt className="text-[#718487]">Affected orders</dt><dd className="mt-0.5 font-semibold text-[#173239]">{quantity(row.affectedOrders)}</dd></div>
            </dl>
            <p className="mt-2 text-[11px] text-[#718487]">Oldest open order: {displayDate(row.oldestOrderAt)}</p>
          </article>)}
          {!result.rows.length ? <p className="rounded-lg bg-[#fbfcfb] p-3 text-sm text-[#718487]">No open customer demand on this page.</p> : null}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[#587275]">
          <span>Page {result.pagination.page} of {result.pagination.pageCount}</span>
          <div className="flex gap-2">
            <button type="button" disabled={loading || page <= 1} onClick={() => void load(page - 1)} className="min-h-9 rounded-lg border border-[#cedfdd] px-3 font-bold disabled:opacity-40">Previous</button>
            <button type="button" disabled={loading || !pagination || page >= pagination.pageCount} onClick={() => void load(page + 1)} className="min-h-9 rounded-lg border border-[#cedfdd] px-3 font-bold disabled:opacity-40">Next</button>
          </div>
        </div>
      </> : null}
    </div> : null}
  </section>;
}

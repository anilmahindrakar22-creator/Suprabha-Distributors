'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { readJsonBody } from '@/lib/http-json';

type RequirementRow = {
  tallyKey: string;
  itemName: string;
  openDemand: number;
  currentStock: number | null;
  shortage: number | null;
  state: 'shortage' | 'unknown' | 'covered';
  affectedOrders: number;
  priority: string;
  oldestOrderAt: string;
};

type RequirementsResponse = {
  fetchedAt: string | null;
  rows: RequirementRow[];
  counts: { shortageItems: number; unknownItems: number; coveredItems: number };
  pagination: { page: number; pageCount: number; total: number };
};

type WaitingOrder = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  status: string;
  remainingQuantity: number;
  priority: string;
  createdAt: string;
};

type WaitingOrdersResponse = {
  orders: WaitingOrder[];
  pagination: { page: number; pageCount: number; total: number };
};

type StockIncreaseAlert = {
  tallyKey: string;
  itemName: string;
  stockBefore: number;
  stockAfter: number;
  currentStock: number | null;
  waitingOrders: number;
  waitingQuantity: number;
  coveredOrders: number | null;
  sourceAt: string;
  affectedOrders: number;
};

type StockIncreaseResponse = {
  alerts: StockIncreaseAlert[];
  windowDays: number;
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
  const [waitingKey, setWaitingKey] = useState<string | null>(null);
  const [waitingOrigin, setWaitingOrigin] = useState<string | null>(null);
  const [waitingPage, setWaitingPage] = useState(1);
  const [waitingResult, setWaitingResult] = useState<WaitingOrdersResponse | null>(null);
  const [waitingLoading, setWaitingLoading] = useState(false);
  const [waitingError, setWaitingError] = useState('');
  const waitingRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const waitingRequestIdRef = useRef(0);
  const [alertsPage, setAlertsPage] = useState(1);
  const [alertsResult, setAlertsResult] = useState<StockIncreaseResponse | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState('');
  const alertsRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const alertsRequestIdRef = useRef(0);

  useEffect(() => () => {
    requestRef.current?.controller.abort();
    waitingRequestRef.current?.controller.abort();
    alertsRequestRef.current?.controller.abort();
  }, []);

  function resetWaitingOrders() {
    waitingRequestRef.current?.controller.abort();
    waitingRequestRef.current = null;
    waitingRequestIdRef.current += 1;
    setWaitingLoading(false);
    setWaitingKey(null);
    setWaitingOrigin(null);
    setWaitingResult(null);
    setWaitingError('');
  }

  async function loadWaitingOrders(itemKey: string, nextPage: number) {
    waitingRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const id = ++waitingRequestIdRef.current;
    waitingRequestRef.current = { id, controller };
    setWaitingLoading(true);
    setWaitingError('');
    try {
      const response = await fetch(`/api/requirements?itemKey=${encodeURIComponent(itemKey)}&page=${nextPage}`, { cache: 'no-store', signal: controller.signal });
      const body = await readJsonBody<WaitingOrdersResponse & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || 'Waiting orders could not be loaded.');
      if (!Array.isArray(body.orders) || !body.pagination || !Number.isSafeInteger(body.pagination.page) || body.pagination.page !== nextPage
        || !Number.isSafeInteger(body.pagination.pageCount) || body.pagination.pageCount < 1 || !Number.isSafeInteger(body.pagination.total) || body.pagination.total < 0
        || body.orders.length > 20 || body.orders.some((order) => !order || typeof order.orderId !== 'string' || !order.orderId.trim()
          || typeof order.orderNumber !== 'string' || !order.orderNumber.trim() || typeof order.customerName !== 'string' || !order.customerName.trim()
          || typeof order.status !== 'string' || !order.status.trim() || typeof order.priority !== 'string' || !order.priority.trim()
          || typeof order.createdAt !== 'string' || !order.createdAt.trim() || Number.isNaN(Date.parse(order.createdAt))
          || typeof order.remainingQuantity !== 'number' || !Number.isFinite(order.remainingQuantity) || order.remainingQuantity <= 0)) throw new Error('Waiting orders response was incomplete.');
      if (waitingRequestRef.current?.id !== id) return;
      setWaitingResult(body);
      setWaitingPage(body.pagination.page);
    } catch (cause) {
      if (waitingRequestRef.current?.id !== id || controller.signal.aborted) return;
      setWaitingError(cause instanceof Error ? cause.message : 'Waiting orders could not be loaded.');
    } finally {
      if (waitingRequestRef.current?.id === id) setWaitingLoading(false);
    }
  }

  function toggleWaitingOrders(itemKey: string, origin = itemKey) {
    if (waitingKey === itemKey && waitingOrigin === origin) {
      waitingRequestRef.current?.controller.abort();
      waitingRequestRef.current = null;
      waitingRequestIdRef.current += 1;
      setWaitingLoading(false);
      setWaitingKey(null);
      setWaitingOrigin(null);
      setWaitingResult(null);
      setWaitingError('');
      return;
    }
    waitingRequestRef.current?.controller.abort();
    waitingRequestRef.current = null;
    waitingRequestIdRef.current += 1;
    setWaitingKey(itemKey);
    setWaitingOrigin(origin);
    setWaitingPage(1);
    setWaitingResult(null);
    setWaitingError('');
    void loadWaitingOrders(itemKey, 1);
  }

  async function load(nextPage: number) {
    resetWaitingOrders();
    requestRef.current?.controller.abort();
    const controller = new AbortController();
    const id = ++requestIdRef.current;
    requestRef.current = { id, controller };
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/requirements?page=${nextPage}`, { cache: 'no-store', signal: controller.signal });
      const body = await readJsonBody<RequirementsResponse & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || 'Customer requirements could not be loaded.');
      if (!body.counts || ![body.counts.shortageItems, body.counts.unknownItems, body.counts.coveredItems].every((count) => Number.isSafeInteger(count) && count >= 0)
        || !Array.isArray(body.rows) || !body.pagination || !Number.isSafeInteger(body.pagination.page) || body.pagination.page < 1
        || !Number.isSafeInteger(body.pagination.pageCount) || body.pagination.pageCount < 1 || !Number.isSafeInteger(body.pagination.total) || body.pagination.total < 0
        || body.rows.some((row) => !row || typeof row.tallyKey !== 'string' || typeof row.itemName !== 'string'
          || !['shortage', 'unknown', 'covered'].includes(row.state)
          || (row.state === 'shortage' ? !(row.shortage !== null && row.shortage > 0 && row.currentStock !== null) : row.state === 'unknown' ? !(row.currentStock === null && row.shortage === null) : !(row.shortage === 0 && row.currentStock !== null))
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

  async function loadAlerts(nextPage: number) {
    if (waitingOrigin?.startsWith('alert:')) resetWaitingOrders();
    alertsRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const id = ++alertsRequestIdRef.current;
    alertsRequestRef.current = { id, controller };
    setAlertsLoading(true);
    setAlertsError('');
    try {
      const response = await fetch(`/api/requirements?alerts=1&page=${nextPage}`, { cache: 'no-store', signal: controller.signal });
      const body = await readJsonBody<StockIncreaseResponse & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || 'Reported stock increases could not be loaded.');
      if (body.windowDays !== 7 || !Array.isArray(body.alerts) || body.alerts.length > 20 || !body.pagination
        || !Number.isSafeInteger(body.pagination.page) || body.pagination.page !== nextPage
        || !Number.isSafeInteger(body.pagination.pageCount) || body.pagination.pageCount < 1
        || !Number.isSafeInteger(body.pagination.total) || body.pagination.total < 0
        || body.alerts.some((alert) => !alert || typeof alert.tallyKey !== 'string' || !alert.tallyKey.trim()
          || typeof alert.itemName !== 'string' || !alert.itemName.trim()
          || typeof alert.stockBefore !== 'number' || !Number.isFinite(alert.stockBefore)
          || typeof alert.stockAfter !== 'number' || !Number.isFinite(alert.stockAfter) || alert.stockAfter <= 0 || alert.stockAfter <= alert.stockBefore
          || typeof alert.sourceAt !== 'string' || !alert.sourceAt.trim() || Number.isNaN(Date.parse(alert.sourceAt))
          || !Number.isSafeInteger(alert.affectedOrders) || alert.affectedOrders < 1
          || !(alert.currentStock === null || typeof alert.currentStock === 'number' && Number.isFinite(alert.currentStock))
          || !Number.isSafeInteger(alert.waitingOrders) || alert.waitingOrders < 0
          || typeof alert.waitingQuantity !== 'number' || !Number.isFinite(alert.waitingQuantity) || alert.waitingQuantity < 0
          || !(alert.coveredOrders === null || Number.isSafeInteger(alert.coveredOrders) && alert.coveredOrders >= 0 && alert.coveredOrders <= alert.waitingOrders)
          || (alert.currentStock === null) !== (alert.coveredOrders === null))) throw new Error('Reported stock increases response was incomplete.');
      if (alertsRequestRef.current?.id !== id) return;
      setAlertsResult(body);
      setAlertsPage(body.pagination.page);
    } catch (cause) {
      if (alertsRequestRef.current?.id !== id || controller.signal.aborted) return;
      setAlertsError(cause instanceof Error ? cause.message : 'Reported stock increases could not be loaded.');
    } finally {
      if (alertsRequestRef.current?.id === id) setAlertsLoading(false);
    }
  }

  function renderWaitingOrders(itemKey: string, itemName: string, origin = itemKey) {
    if (waitingKey !== itemKey || waitingOrigin !== origin) return null;
    return <div className="mt-2 rounded-lg bg-sf-soft-0 p-3" aria-label={`Waiting orders for ${itemName}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-sf-label">Waiting orders</p>
        <button type="button" disabled={waitingLoading} onClick={() => void loadWaitingOrders(itemKey, waitingPage)} className="min-h-11 rounded-lg border border-sf-line bg-white px-3 text-xs font-bold text-sf-body disabled:opacity-50">{waitingLoading ? 'Loading…' : 'Refresh orders'}</button>
      </div>
      {waitingError ? <p role="alert" className="mt-2 text-sm text-sf-danger">{waitingError}</p> : null}
      {waitingLoading && !waitingResult ? <p className="mt-2 text-sm text-sf-subtle">Loading waiting orders…</p> : null}
      {waitingResult ? <>
        <div className="mt-2 space-y-2">
          {waitingResult.orders.map((order) => <div key={order.orderId} className="break-words rounded-md border border-sf-line-soft bg-white p-2 text-xs">
            <p className="font-semibold text-sf-strong">{order.customerName} · {order.orderNumber}</p>
            <p className="mt-1 text-sf-muted">{order.status} · Remaining: {quantity(order.remainingQuantity)}</p>
          </div>)}
          {!waitingResult.orders.length ? <p className="text-xs text-sf-subtle">No waiting orders on this page.</p> : null}
        </div>
        {waitingResult.pagination.pageCount > 1 ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-sf-muted">
          <span>Page {waitingResult.pagination.page} of {waitingResult.pagination.pageCount}</span>
          <div className="flex gap-2">
            <button type="button" disabled={waitingLoading || waitingPage <= 1} onClick={() => void loadWaitingOrders(itemKey, waitingPage - 1)} className="min-h-11 rounded-lg border border-sf-line px-3 font-bold disabled:opacity-40">Previous</button>
            <button type="button" disabled={waitingLoading || waitingPage >= waitingResult.pagination.pageCount} onClick={() => void loadWaitingOrders(itemKey, waitingPage + 1)} className="min-h-11 rounded-lg border border-sf-line px-3 font-bold disabled:opacity-40">Next</button>
          </div>
        </div> : null}
      </> : null}
    </div>;
  }

  async function loadSection(requirementsPage: number, stockAlertsPage: number) {
    await Promise.all([load(requirementsPage), loadAlerts(stockAlertsPage)]);
  }

  function toggle() {
    if (open) {
      requestRef.current?.controller.abort();
      requestRef.current = null;
      requestIdRef.current += 1;
      setLoading(false);
      alertsRequestRef.current?.controller.abort();
      alertsRequestRef.current = null;
      alertsRequestIdRef.current += 1;
      setAlertsLoading(false);
      resetWaitingOrders();
      setOpen(false);
      return;
    }
    setOpen(true);
    void loadSection(1, 1);
  }

  const pagination = result?.pagination;
  return <section aria-label="Customer demand and requirements" className="mt-3 rounded-xl border border-sf-line-soft bg-white p-3">
    <button type="button" aria-expanded={open} onClick={toggle} className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-bold text-sf-body">
      <span>Customer demand / requirements</span><span aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
    {open ? <div className="mt-2 border-t border-sf-line-soft pt-3">
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 text-xs leading-5 text-sf-subtle">Advisory view from Tally stock as of {displayDate(result?.fetchedAt ?? null)}; nothing is reserved or allocated.</p>
        <button type="button" disabled={loading || alertsLoading} onClick={() => void loadSection(page, alertsPage)} className="min-h-11 rounded-lg border border-sf-line bg-white px-3 text-xs font-bold text-sf-body disabled:opacity-50">{loading || alertsLoading ? 'Loading…' : 'Refresh'}</button>
      </div>
      {result ? <p className="mt-2 text-xs font-semibold text-sf-label">Need to order: {result.counts.shortageItems} · Stock unknown: {result.counts.unknownItems} · Covered by stock: {result.counts.coveredItems}</p> : null}
      <div className="mt-3 rounded-lg border border-sf-line-soft bg-sf-soft-0 p-3">
        {alertsResult && alertsResult.pagination.total > 0 ? <h2 className="text-sm font-bold text-sf-body">New stock for waiting orders ({alertsResult.pagination.total})</h2> : null}
        <div>
          {alertsError ? <p role="alert" className="mt-2 text-sm text-sf-danger">{alertsError}</p> : null}
          {alertsLoading && !alertsResult ? <p className="mt-2 text-sm text-sf-subtle">Loading reported stock increases…</p> : null}
          {alertsResult ? <>
            <div className="mt-2 space-y-2">
              {alertsResult.alerts.map((alert, index) => <article key={`${alert.tallyKey}-${alert.sourceAt}-${index}`} className="rounded-lg border border-sf-line-soft bg-white p-3">
                <h3 className="break-words text-sm font-bold text-sf-strong">{alert.itemName}</h3>
                <p className={`mt-1 text-xs ${alert.coveredOrders !== null && alert.coveredOrders === alert.waitingOrders ? 'font-semibold text-sf-success' : 'text-sf-body'}`}>
                  {alert.coveredOrders === null ? 'current stock unknown' : <>Tally now shows {quantity(alert.currentStock!)} · {alert.coveredOrders === alert.waitingOrders ? (alert.waitingOrders === 1 ? 'enough for the waiting order' : alert.waitingOrders === 2 ? 'enough for both waiting orders' : `enough for all ${alert.waitingOrders} waiting orders`) : `enough for ${alert.coveredOrders} of ${alert.waitingOrders} waiting orders`}</>}
                </p>
                <p className="mt-1 text-xs text-sf-muted">{quantity(alert.stockBefore)} → {quantity(alert.stockAfter)} on {displayDate(alert.sourceAt)}</p>
                <button type="button" aria-expanded={waitingOrigin === `alert:${alert.tallyKey}:${alert.sourceAt}`} onClick={() => toggleWaitingOrders(alert.tallyKey, `alert:${alert.tallyKey}:${alert.sourceAt}`)} className="mt-2 min-h-11 rounded-lg border border-sf-line px-3 text-xs font-bold text-sf-body">{waitingOrigin === `alert:${alert.tallyKey}:${alert.sourceAt}` ? 'Hide waiting orders' : 'View waiting orders'}</button>
                {renderWaitingOrders(alert.tallyKey, alert.itemName, `alert:${alert.tallyKey}:${alert.sourceAt}`)}
              </article>)}
              {!alertsResult.pagination.total ? <p className="text-xs text-sf-subtle">No new stock for waiting orders in the last 7 days.</p> : !alertsResult.alerts.length ? <p className="text-xs text-sf-subtle">No reported increases on this page.</p> : null}
            </div>
            {alertsResult.pagination.pageCount > 1 ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-sf-muted">
              <span>Page {alertsResult.pagination.page} of {alertsResult.pagination.pageCount}</span>
              <div className="flex gap-2">
                <button type="button" disabled={alertsLoading || alertsPage <= 1} onClick={() => void loadAlerts(alertsPage - 1)} className="min-h-11 rounded-lg border border-sf-line px-3 font-bold disabled:opacity-40">Previous</button>
                <button type="button" disabled={alertsLoading || alertsPage >= alertsResult.pagination.pageCount} onClick={() => void loadAlerts(alertsPage + 1)} className="min-h-11 rounded-lg border border-sf-line px-3 font-bold disabled:opacity-40">Next</button>
              </div>
            </div> : null}
          </> : null}
        </div>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-sf-danger">{error}</p> : null}
      {loading && !result ? <p className="mt-3 text-sm text-sf-subtle">Loading customer demand…</p> : null}
      {result ? <>
        <div className="mt-2 space-y-2">
          {result.rows.map((row, index) => <Fragment key={row.tallyKey}>
            {index === 0 || result.rows[index - 1].state !== row.state ? <h2 className="pt-2 text-xs font-bold text-sf-label">{row.state === 'shortage' ? 'Need to order' : row.state === 'unknown' ? 'Stock unknown, check Tally' : 'Covered by current stock'}</h2> : null}
            <article className={`rounded-lg border border-sf-line-soft p-3 ${row.state === 'covered' ? 'bg-white text-sf-muted [&_dd]:text-sf-muted [&_h3]:text-sf-muted' : 'bg-sf-soft-0'}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="min-w-0 flex-1 break-words text-sm font-bold text-sf-strong">{row.itemName}</h3>
              <span className="shrink-0 rounded-full bg-sf-soft-2 px-2 py-1 text-xs font-semibold text-sf-label">{priorityLabel(row.priority)}</span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 break-words text-xs sm:grid-cols-4">
              <div><dt className="text-sf-subtle">Open demand</dt><dd className="mt-0.5 font-semibold text-sf-strong">{quantity(row.openDemand)}</dd></div>
              <div><dt className="text-sf-subtle">Current stock</dt><dd className="mt-0.5 font-semibold text-sf-strong">{row.currentStock === null ? 'Unknown · review' : quantity(row.currentStock)}</dd></div>
              <div><dt className="text-sf-subtle">Shortage</dt><dd className={row.state === 'shortage' ? 'mt-0.5 text-sm font-bold text-sf-warning' : 'mt-0.5 font-semibold text-sf-strong'}>{row.shortage === null ? 'Unknown · review' : quantity(row.shortage)}</dd></div>
              <div><dt className="text-sf-subtle">Affected orders</dt><dd className="mt-0.5 font-semibold text-sf-strong">{quantity(row.affectedOrders)}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-sf-subtle">Oldest open order: {displayDate(row.oldestOrderAt)}</p>
            <button type="button" aria-expanded={waitingOrigin === row.tallyKey} onClick={() => toggleWaitingOrders(row.tallyKey)} className="mt-3 min-h-11 rounded-lg border border-sf-line px-3 text-xs font-bold text-sf-body">
              {waitingOrigin === row.tallyKey ? 'Hide waiting orders' : 'View waiting orders'}
            </button>
            {renderWaitingOrders(row.tallyKey, row.itemName)}
          </article></Fragment>)}
          {!result.rows.length ? <p className="rounded-lg bg-sf-soft-0 p-3 text-sm text-sf-subtle">No open customer demand on this page.</p> : null}
        </div>
        {result.pagination.pageCount > 1 ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-sf-muted">
          <span>Page {result.pagination.page} of {result.pagination.pageCount}</span>
          <div className="flex gap-2">
            <button type="button" disabled={loading || page <= 1} onClick={() => void load(page - 1)} className="min-h-11 rounded-lg border border-sf-line px-3 font-bold disabled:opacity-40">Previous</button>
            <button type="button" disabled={loading || !pagination || page >= pagination.pageCount} onClick={() => void load(page + 1)} className="min-h-11 rounded-lg border border-sf-line px-3 font-bold disabled:opacity-40">Next</button>
          </div>
        </div> : null}
      </> : null}
    </div> : null}
  </section>;
}

'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { readJsonBody } from '@/lib/http-json';

import { toOrderReasonText, toOrderStockText, type ToOrderResponse } from '@/lib/to-order';

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

export function ProcurementRequirements({ onOpenOrder }: { onOpenOrder?: (orderId: string, orderNumber: string) => void } = {}) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ToOrderResponse | null>(null);
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
    if (nextPage === 1 && !waitingOrigin?.startsWith('alert:')) resetWaitingOrders();
    requestRef.current?.controller.abort();
    const controller = new AbortController();
    const id = ++requestIdRef.current;
    requestRef.current = { id, controller };
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/requirements?view=to_order&page=${nextPage}`, { cache: 'no-store', signal: controller.signal });
      const body = await readJsonBody<ToOrderResponse & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || 'To order could not be loaded.');
      if (body.view !== 'to_order' || body.page !== nextPage || body.pageSize !== 25
        || ![body.total, body.waitingCount, body.unknownCount].every((count) => Number.isSafeInteger(count) && count >= 0)
        || !Array.isArray(body.items) || body.items.length > 25
        || body.items.some((item) => !item || typeof item.itemKey !== 'string' || !item.itemKey.trim()
          || typeof item.itemName !== 'string' || !item.itemName.trim()
          || !['order', 'stock_unknown'].includes(item.state)
          || !Number.isSafeInteger(item.waitingOrders) || item.waitingOrders < 0
          || !Array.isArray(item.reasons) || item.reasons.some((reason) => !['waiting_orders', 'below_reorder'].includes(reason))
          || ![item.closing, item.reorderLevel, item.minimumOrder, item.tallyOpenPurchase, item.suggestedQty].every((value) => value === null || typeof value === 'number' && Number.isFinite(value))
          || typeof item.openDemand !== 'number' || !Number.isFinite(item.openDemand) || item.openDemand < 0
          || (item.state === 'order' && (item.suggestedQty === null || item.suggestedQty < 0))))
        throw new Error('To order response was incomplete.');
      if (requestRef.current?.id !== id) return;
      setResult((previous) => nextPage === 1 || !previous ? body : { ...body, items: [...previous.items, ...body.items] });
      setPage(body.page);
    } catch (cause) {
      if (requestRef.current?.id !== id || controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'To order could not be loaded.');
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
      {waitingError ? <p role="alert" className="mt-2 inline-flex items-center gap-1 text-sm text-sf-danger"><CircleAlert size={14} aria-hidden="true" className="shrink-0" />{waitingError}</p> : null}
      {waitingLoading && !waitingResult ? <p className="mt-2 text-sm text-sf-subtle">Loading waiting orders…</p> : null}
      {waitingResult ? <>
        <div className="mt-2 space-y-2">
          {waitingResult.orders.map((order) => {
            const content = <><span className="block font-semibold text-sf-strong">{order.customerName} · {order.orderNumber}</span><span className="mt-1 block text-sf-muted">{order.status} · Remaining: {quantity(order.remainingQuantity)}</span></>;
            const rowClass = 'break-words rounded-md border border-sf-line-soft bg-white p-2 text-xs';
            return onOpenOrder ? <button key={order.orderId} type="button" onClick={() => onOpenOrder(order.orderId, order.orderNumber)} aria-label={`Open order ${order.orderNumber}`} className={`${rowClass} min-h-11 w-full text-left hover:bg-sf-soft`}>{content}</button> : <div key={order.orderId} className={rowClass}>{content}</div>;
          })}
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

  const loadInitial = useEffectEvent(() => {
    void load(1);
    void loadAlerts(1);
  });

  useEffect(() => {
    const timer = setTimeout(() => loadInitial(), 0);
    return () => clearTimeout(timer);
  }, []);

  const items = [...(result?.items ?? [])].sort((a, b) => Number(a.state === 'stock_unknown') - Number(b.state === 'stock_unknown'));
  return <section aria-label="To order" className="mt-3 min-w-0 rounded-xl border border-sf-line-soft bg-sf-soft p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-bold text-sf-body">To order</h2>
        <p className="mt-1 text-xs leading-5 text-sf-subtle">Suggested quantity covers waiting customer orders and refills to the Tally reorder level.</p>
      </div>
      <button type="button" disabled={loading || alertsLoading} onClick={() => { void load(1); void loadAlerts(alertsPage); }} className="min-h-11 rounded-lg border border-sf-line bg-sf-soft-0 px-3 text-xs font-bold text-sf-body disabled:opacity-50">{loading || alertsLoading ? 'Loading…' : 'Refresh'}</button>
    </div>
    {result ? <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-sf-label">
      <span className="rounded-full bg-sf-soft-2 px-3 py-2">{result.total} to order</span>
      <span className="rounded-full bg-sf-soft-2 px-3 py-2">{result.waitingCount} with customers waiting</span>
      {result.unknownCount > 0 ? <span className="rounded-full bg-sf-soft-2 px-3 py-2">{result.unknownCount} stock unknown</span> : null}
    </div> : null}
    {error ? <p role="alert" className="mt-2 text-sm text-sf-danger">{error}</p> : null}
    {loading && !result ? <p className="mt-3 text-sm text-sf-subtle">Loading to order…</p> : null}
    <div className="mt-3 space-y-2">
      {items.map((item) => <article key={item.itemKey} aria-label={item.itemName} className={`min-w-0 rounded-lg border border-sf-line-soft px-3 py-2 ${item.state === 'stock_unknown' ? 'bg-sf-soft-2 text-sf-muted' : 'bg-sf-soft-0 text-sf-body'}`}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 break-words text-sm font-bold">{item.itemName}</h3>
          <p className="shrink-0 text-right text-lg font-bold">Order {item.state === 'stock_unknown' || item.suggestedQty === null ? '—' : quantity(item.suggestedQty)}</p>
        </div>
        <p className="mt-0.5 break-words text-xs">{toOrderReasonText(item)}</p>
        <p className="mt-0.5 break-words text-xs text-sf-muted">{toOrderStockText(item)}</p>
        {item.waitingOrders > 0 ? <button type="button" aria-expanded={waitingOrigin === item.itemKey} onClick={() => toggleWaitingOrders(item.itemKey)} className="mt-2 min-h-11 rounded-lg border border-sf-line px-3 text-xs font-bold text-sf-body">
          {waitingOrigin === item.itemKey ? 'Hide waiting orders' : 'View waiting orders'}
        </button> : null}
        {renderWaitingOrders(item.itemKey, item.itemName)}
      </article>)}
      {result && !result.total ? <p className="text-sm text-sf-subtle">Nothing to order.</p> : null}
    </div>
    {result && result.items.length < result.total ? <button type="button" disabled={loading} onClick={() => void load(page + 1)} className="mt-3 min-h-11 rounded-lg border border-sf-line px-3 text-xs font-bold text-sf-body disabled:opacity-50">{loading ? 'Loading…' : 'Load more'}</button> : null}
      <div className="mt-3 rounded-lg border border-sf-line-soft bg-sf-soft-0 p-3">
        {alertsResult && alertsResult.pagination.total > 0 ? <h2 className="text-sm font-bold text-sf-body">New stock for waiting orders ({alertsResult.pagination.total})</h2> : null}
        <div>
          {alertsError ? <p role="alert" className="mt-2 inline-flex items-center gap-1 text-sm text-sf-danger"><CircleAlert size={14} aria-hidden="true" className="shrink-0" />{alertsError}</p> : null}
          {alertsLoading && !alertsResult ? <p className="mt-2 text-sm text-sf-subtle">Loading reported stock increases…</p> : null}
          {alertsResult ? <>
            <div className="mt-2 space-y-2">
              {alertsResult.alerts.map((alert, index) => <article key={`${alert.tallyKey}-${alert.sourceAt}-${index}`} className="rounded-lg border border-sf-line-soft bg-white p-3">
                <h3 className="break-words text-sm font-bold text-sf-strong">{alert.itemName}</h3>
                <p className={`mt-1 text-xs ${alert.coveredOrders !== null && alert.coveredOrders === alert.waitingOrders ? 'inline-flex items-center gap-1 font-semibold text-sf-success' : 'text-sf-body'}`}>
                  {alert.coveredOrders !== null && alert.coveredOrders === alert.waitingOrders ? <CircleCheck size={14} aria-hidden="true" className="shrink-0" /> : null}
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
  </section>;
}

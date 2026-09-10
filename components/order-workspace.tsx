'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type {
  CatalogItem,
  CustomerDirectoryEntry,
  OrderBootstrap,
  OrderCommand,
  OrderEvent,
  OrderSummary,
} from '@/lib/order-types';
import { billingHandoffText, canRoleTransitionOrder, orderAttentionReasons, orderBackOrderedQuantity, orderDeliveryReminder, orderOperationsText, orderStage, repeatOrderTemplate, searchCatalog, searchCustomers, tallyInvoiceLineReconciliation, tallyInvoiceReconciliationDetail } from '@/lib/order-types';
import { orderListUrl } from '@/lib/order-list-query';
import { offlineDraftRecoveryError, readOfflineDraftConsent, readOfflineOrderDraft, removeOfflineOrderDraft, restoreOfflineDraftLines, updateOfflineDraftState, writeOfflineDraftConsent, writeOfflineOrderDraft, type OfflineDraftState } from '@/lib/offline-order-drafts';
import { readCatalogCache, removeCatalogCache, writeCatalogCache } from '@/lib/catalog-cache';
import { readCustomerCache, removeCustomerCache, writeCustomerCache } from '@/lib/customer-cache';
import { applyOrderAcknowledgement } from '@/lib/order-acknowledgement';
import { OrderSubmissionError, orderSubmissionError, recoverAcceptedOrder } from '@/lib/order-submission';
import { loadOrderBootstrap } from '@/lib/order-bootstrap-cache';
import { retryPendingOfflineOrder } from '@/lib/offline-order-retry';
import { acknowledgeOrderCommand, prepareOrderCommandRetry } from '@/lib/order-command-idempotency';
import { loadOrderCatalog, loadOrderCustomers } from '@/lib/order-capture-masters';

type DraftLine = { tallyKey: string; item: CatalogItem | null; quantity: number };
const statusNames: Record<string, string> = {
  phone_order_received: 'Phone order received',
  awaiting_confirmation: 'Awaiting confirmation',
  awaiting_approval: 'Awaiting approval',
  confirmed: 'Confirmed',
  partially_reserved: 'Partially reserved',
  fully_reserved: 'Fully reserved',
  ready_for_picking: 'Ready for picking',
  picked: 'Picked',
  packed: 'Packed',
  awaiting_tally_billing: 'Awaiting Tally billing',
  billed_in_tally: 'Billed in Tally',
  ready_for_dispatch: 'Ready for dispatch',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const nextStatus: Record<string, { label: string; status: string }> = {
  phone_order_received: { label: 'Send for confirmation', status: 'awaiting_confirmation' },
  awaiting_confirmation: { label: 'Confirm order', status: 'confirmed' },
  awaiting_approval: { label: 'Approve order', status: 'confirmed' },
  confirmed: { label: 'Pick & pack complete', status: 'packed' },
  partially_reserved: { label: 'Pick & pack complete', status: 'packed' },
  fully_reserved: { label: 'Pick & pack complete', status: 'packed' },
  ready_for_picking: { label: 'Pick & pack complete', status: 'packed' },
  picked: { label: 'Pick & pack complete', status: 'packed' },
  packed: { label: 'Send to Tally billing', status: 'awaiting_tally_billing' },
  awaiting_tally_billing: { label: 'Mark billed', status: 'billed_in_tally' },
  billed_in_tally: { label: 'Ready for dispatch', status: 'ready_for_dispatch' },
};

function formatQuantity(value: number) {
  return Math.round(Number(value || 0)).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function statusLabel(status: string) {
  return statusNames[status] || status.replaceAll('_', ' ');
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Unable to complete the request');
  return body;
}

export function OrderWorkspace({ actorEmail, initialStatus = 'open' }: { actorEmail: string; initialStatus?: string }) {
  const [data, setData] = useState<OrderBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [captureDate, setCaptureDate] = useState('');
  const [captureDateTo, setCaptureDateTo] = useState('');
  const [status, setStatus] = useState(initialStatus);
  const [creating, setCreating] = useState(false);
  const [repeatOrder, setRepeatOrder] = useState<OrderSummary | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [deviceDraftState, setDeviceDraftState] = useState<OfflineDraftState | null>(null);
  const [page, setPage] = useState(1);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef<OrderBootstrap | null>(null);
  const retryingDraftRef = useRef(false);
  const pendingCommandKeysRef = useRef(new Map<string, string>());

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!data) return;
    const catalogVersion = data.snapshot.catalogVersion || data.snapshot.fetchedAt;
    const customerVersion = data.customerVersion || '';
    const timer = window.setTimeout(() => {
      void loadOrderCatalog(actorEmail, catalogVersion).catch(() => undefined);
      void loadOrderCustomers(actorEmail, customerVersion).catch(() => undefined);
    }, 750);
    return () => window.clearTimeout(timer);
  }, [actorEmail, data]);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      const result = await readResponse<OrderBootstrap>(await fetch(orderListUrl({ page, query, status, captureDate, captureDateTo }), { cache: 'no-store' }));
      setData(result);
      setDeviceDraftState(readOfflineOrderDraft(localStorage, result.actor.email)?.state || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load orders');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [captureDate, captureDateTo, page, query, status]);

  useEffect(() => {
    if (creating || deviceDraftState !== 'pending') return;
    let active = true;
    async function retryPendingDraft() {
      if (retryingDraftRef.current || !navigator.onLine || document.hidden) return;
      retryingDraftRef.current = true;
      try {
        const result = await retryPendingOfflineOrder(localStorage, actorEmail);
        if (!active) return;
        if (result.status === 'sent') {
          setDeviceDraftState(null);
          setNotice(`${result.orderNumber} sent successfully after reconnecting.`);
          await load();
        } else if (result.status === 'needs_attention') {
          setDeviceDraftState('error');
          setError(result.message);
        }
      } finally {
        retryingDraftRef.current = false;
      }
    }
    const retryWhenVisible = () => { if (!document.hidden) void retryPendingDraft(); };
    const timer = window.setInterval(() => void retryPendingDraft(), 60_000);
    window.addEventListener('online', retryPendingDraft);
    window.addEventListener('focus', retryPendingDraft);
    window.addEventListener('pageshow', retryPendingDraft);
    document.addEventListener('visibilitychange', retryWhenVisible);
    void retryPendingDraft();
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('online', retryPendingDraft);
      window.removeEventListener('focus', retryPendingDraft);
      window.removeEventListener('pageshow', retryPendingDraft);
      document.removeEventListener('visibilitychange', retryWhenVisible);
    };
  }, [actorEmail, creating, deviceDraftState, load]);

  useEffect(() => {
    if (initialStatus !== 'open') return;
    let active = true;
    loadOrderBootstrap(actorEmail)
      .then((result) => {
        if (active) {
          setData(result);
          setDeviceDraftState(readOfflineOrderDraft(localStorage, result.actor.email)?.state || null);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Unable to load orders');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [actorEmail, initialStatus]);

  const firstFilterRun = useRef(true);
  useEffect(() => {
    if (firstFilterRun.current) {
      firstFilterRun.current = false;
      if (page === 1 && !query && !captureDate && !captureDateTo && status === 'open') return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      fetch(orderListUrl({ page, query, status, captureDate, captureDateTo }), { cache: 'no-store', signal: controller.signal })
        .then((response) => readResponse<OrderBootstrap>(response))
        .then((result) => {
          setData(result);
          setDeviceDraftState(readOfflineOrderDraft(localStorage, result.actor.email)?.state || null);
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load orders');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, query ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [actorEmail, captureDate, captureDateTo, page, query, status]);

  const visibleOrders = data?.orders || [];
  const displayedOrders = visibleOrders;
  const currentPage = data?.pagination?.page || page;
  const pageCount = data?.pagination?.pageCount || 1;
  const totalOrders = data?.pagination?.total ?? visibleOrders.length;

  function exportVisibleOrders() {
    if (!totalOrders) return;
    const link = document.createElement('a');
    link.href = orderListUrl({ page: 1, query, status, captureDate, captureDateTo }, true);
    link.click();
  }

  async function openNewOrder(template?: OrderSummary) {
    if (catalogLoading) return;
    setError('');
    setCatalogLoading(true);
    let current = dataRef.current;
    try {
      if (!current) {
        current = await loadOrderBootstrap(actorEmail);
        dataRef.current = current;
        setData(current);
        setDeviceDraftState(readOfflineOrderDraft(localStorage, current.actor.email)?.state || null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load order capture');
      setCatalogLoading(false);
      return;
    }
    try {
      const catalogVersion = current.snapshot.catalogVersion || current.snapshot.fetchedAt;
      const customerVersion = current.customerVersion || '';
      const trustedDevice = readOfflineDraftConsent(localStorage, current.actor.email);
      let catalog = current.snapshot.catalog.length > 0 ? current.snapshot.catalog : readCatalogCache(sessionStorage, current.actor.email, catalogVersion) || (trustedDevice ? readCatalogCache(localStorage, current.actor.email, catalogVersion) : null);
      let customers = current.customers.length > 0 ? current.customers : readCustomerCache(sessionStorage, current.actor.email, customerVersion) || (trustedDevice ? readCustomerCache(localStorage, current.actor.email, customerVersion) : null);
      const catalogRequest = catalog
        ? Promise.resolve(null)
        : loadOrderCatalog(actorEmail, catalogVersion);
      const customerRequest = customers
        ? Promise.resolve(null)
        : loadOrderCustomers(actorEmail, customerVersion);
      const [catalogResult, customerResult] = await Promise.all([catalogRequest, customerRequest]);
      if (catalogResult) {
        catalog = catalogResult.catalog;
      }
      if (customerResult) {
        customers = customerResult.customers;
      }
      const resolvedCatalogVersion = catalogResult?.catalogVersion || catalogVersion;
      const resolvedCustomerVersion = customerResult?.customerVersion || customerVersion;
      writeCatalogCache(sessionStorage, current.actor.email, resolvedCatalogVersion, catalog || []);
      writeCustomerCache(sessionStorage, current.actor.email, resolvedCustomerVersion, customers || []);
      if (trustedDevice) {
        writeCatalogCache(localStorage, current.actor.email, resolvedCatalogVersion, catalog || []);
        writeCustomerCache(localStorage, current.actor.email, resolvedCustomerVersion, customers || []);
      }
      setData((value) => value ? {
        ...value,
        customerVersion: customerResult?.customerVersion || value.customerVersion,
        customers: customers || [],
        snapshot: { ...value.snapshot, catalogVersion: catalogResult?.catalogVersion || value.snapshot.catalogVersion, catalog: catalog || [] },
      } : value);
      const savedDraft = readOfflineOrderDraft(localStorage, current.actor.email);
      if (template && savedDraft) {
        setNotice('Finish or discard the saved order on this device before repeating another order.');
        setRepeatOrder(null);
      } else {
        setRepeatOrder(template || null);
      }
      setCreating(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load Tally customers and products');
    } finally {
      setCatalogLoading(false);
    }
  }

  async function runCommand(command: OrderCommand, success: string) {
    const scrollTop = workspaceRef.current?.scrollTop;
    const prepared = prepareOrderCommandRetry(command, pendingCommandKeysRef.current, undefined, actorEmail);
    setError('');
    setNotice('');
    try {
      const result = await readResponse<{ orderId?: string; status?: string; version?: number; exceptionId?: string; installationId?: string }>(
        await fetch('/api/orders', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(prepared.command),
        }),
      );
      acknowledgeOrderCommand(prepared.identity, pendingCommandKeysRef.current);
      setNotice(success);
      const patched = dataRef.current ? applyOrderAcknowledgement(dataRef.current, prepared.command, result) : null;
      if (patched) {
        dataRef.current = patched;
        setData(patched);
      }
      else await load();
      window.requestAnimationFrame(() => {
        if (workspaceRef.current && scrollTop !== undefined) workspaceRef.current.scrollTop = scrollTop;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update order');
    }
  }

  async function advance(order: OrderSummary, tallyInvoiceNumber?: string) {
    const action = nextStatus[order.status];
    if (!action) return;
    await runCommand(
      {
        action: 'transition_order',
        payload: {
          idempotencyKey: crypto.randomUUID(),
          orderId: order.id,
          expectedVersion: order.version,
          toStatus: action.status,
          tallyInvoiceNumber: tallyInvoiceNumber?.trim() || undefined,
        },
      },
      `${order.orderNumber} moved to ${statusLabel(action.status)}.`,
    );
  }

  async function cancelOrder(order: OrderSummary, reason: string) {
    await runCommand(
      {
        action: 'transition_order',
        payload: {
          idempotencyKey: crypto.randomUUID(),
          orderId: order.id,
          expectedVersion: order.version,
          toStatus: 'cancelled',
          reason: reason.trim(),
        },
      },
      `${order.orderNumber} cancelled.`,
    );
  }

  async function saveFulfilment(order: OrderSummary, payload: Extract<OrderCommand, { action: 'save_fulfilment' }>['payload']) {
    await runCommand({ action: 'save_fulfilment', payload }, `${order.orderNumber} fulfilment details saved.`);
  }
  async function editOrder(order: OrderSummary, payload: Extract<OrderCommand, { action: 'edit_order' }>['payload']) {
    await runCommand({ action: 'edit_order', payload }, `${order.orderNumber} updated.`);
  }

  async function updateDelivery(order: OrderSummary, command: Extract<OrderCommand, { action: 'save_dispatch' | 'confirm_delivery' }>) {
    await runCommand(command, command.action === 'save_dispatch' ? `${order.orderNumber} marked dispatched.` : `${order.orderNumber} delivery confirmed.`);
  }
  async function updateException(order: OrderSummary, command: Extract<OrderCommand, { action: 'create_exception' | 'resolve_exception' }>) {
    await runCommand(command, `${order.orderNumber} delivery exception updated.`);
  }
  async function updateInstallation(order: OrderSummary, command: Extract<OrderCommand, { action: 'schedule_installation' | 'complete_installation' }>) {
    await runCommand(command, `${order.orderNumber} installation record updated.`);
  }
  async function recordBillingReview(order: OrderSummary, command: Extract<OrderCommand, { action: 'record_billing_review' }>) {
    await runCommand(command, `${order.orderNumber} billing review recorded.`);
  }
  async function setOrderPriority(order: OrderSummary, priority: 'normal' | 'high' | 'urgent') {
    await runCommand({ action: 'set_order_priority', payload: { orderId: order.id, expectedVersion: order.version, priority } }, `${order.orderNumber} priority updated.`);
  }

  async function setOrderAssignee(order: OrderSummary, assignedToEmail?: string) {
    await runCommand({ action: 'set_order_assignee', payload: { orderId: order.id, expectedVersion: order.version, assignedToEmail } }, assignedToEmail ? `${order.orderNumber} assigned.` : `${order.orderNumber} assignment cleared.`);
  }

  const operations = data?.operations || {};
  const staleText = data?.snapshot.fetchedAt || 'No Tally snapshot';

  return (
    <div ref={workspaceRef} className="h-full overflow-y-auto bg-[#f7f6f1]">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#277b69]">
              Daily order control
            </p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-[#092f36]">
              Orders
            </h1>
            <p className="mt-2 text-sm text-[#667b7e]">
              Capture orders, pick and pack them, then hand billing to Tally.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <button
              type="button"
              onClick={() => void openNewOrder()}
              disabled={catalogLoading}
              className="min-h-12 rounded-xl bg-[#092f36] px-5 font-bold text-white shadow-sm transition hover:bg-[#0d4549] disabled:opacity-50"
            >
              {catalogLoading ? 'Loading products…' : deviceDraftState ? 'Continue order' : '+ Order'}
            </button>
            {deviceDraftState ? <span aria-live="polite" className={`text-xs font-bold ${deviceDraftState === 'pending' ? 'text-[#9a6412]' : deviceDraftState === 'error' ? 'text-[#a0443b]' : 'text-[#587275]'}`}>{deviceDraftState === 'pending' ? '1 pending order on this device' : deviceDraftState === 'error' ? '1 device draft needs attention' : '1 draft on this device'}</span> : null}
          </div>
        </header>

        <section aria-label="Order summary" className="mt-6 grid gap-3 sm:grid-cols-3">
          <SummaryCard label="Phone orders today" value={operations.phoneOrdersToday} />
          <SummaryCard label="Awaiting confirmation" value={operations.awaitingConfirmation} tone="watch" />
          <SummaryCard label="Awaiting Tally billing" value={operations.awaitingTallyBilling} />
        </section>

        <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-[#dce7e5] bg-white p-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <label className="mb-1 block text-xs font-bold text-[#587275]" htmlFor="order-search">Find existing order</label>
            <input
              id="order-search"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(1); }}
              placeholder="Customer, product, invoice, phone, or order"
              className="min-h-11 w-full rounded-xl border border-[#cedfdd] px-4 pr-16 outline-none focus:border-[#64d4ad] focus:ring-3 focus:ring-[#64d4ad]/20"
            />
            {query ? <button type="button" onClick={() => { setQuery(''); setPage(1); }} className="absolute bottom-1 right-1 min-h-9 rounded-lg px-3 text-xs font-bold text-[#456367] hover:bg-[#edf3f1]">Clear</button> : null}
          </div>
          <button type="button" aria-pressed={query === `assignee:${actorEmail.toLocaleLowerCase('en-IN')}`} onClick={() => { setQuery((current) => current === `assignee:${actorEmail.toLocaleLowerCase('en-IN')}` ? '' : `assignee:${actorEmail.toLocaleLowerCase('en-IN')}`); setStatus('open'); setCaptureDate(''); setCaptureDateTo(''); setPage(1); }} className="min-h-11 rounded-xl border border-[#cedfdd] px-4 font-bold text-[#31585d] hover:bg-[#f1f6f4] aria-pressed:border-[#64d4ad] aria-pressed:bg-[#eaf8f1]">My work</button>
          <button type="button" aria-pressed={query === 'assignee:unassigned'} onClick={() => { setQuery((current) => current === 'assignee:unassigned' ? '' : 'assignee:unassigned'); setStatus('open'); setCaptureDate(''); setCaptureDateTo(''); setPage(1); }} className="min-h-11 rounded-xl border border-[#cedfdd] px-4 font-bold text-[#31585d] hover:bg-[#f1f6f4] aria-pressed:border-[#64d4ad] aria-pressed:bg-[#eaf8f1]">Unassigned</button>
          <label className="text-xs font-bold text-[#587275]">Order date from<input type="date" value={captureDate} max={captureDateTo || undefined} onChange={(event) => { const nextDate = event.target.value; setCaptureDate(nextDate); if (!nextDate || (captureDateTo && nextDate > captureDateTo)) setCaptureDateTo(''); setPage(1); }} className="mt-1 block min-h-11 rounded-xl border border-[#cedfdd] bg-white px-3 font-normal outline-none focus:border-[#64d4ad]" /></label>
          <label className="text-xs font-bold text-[#587275]">To (optional)<input type="date" value={captureDateTo} min={captureDate || undefined} disabled={!captureDate} onChange={(event) => { setCaptureDateTo(event.target.value); setPage(1); }} className="mt-1 block min-h-11 rounded-xl border border-[#cedfdd] bg-white px-3 font-normal outline-none focus:border-[#64d4ad] disabled:bg-[#edf3f1]" /></label>
          <label className="sr-only" htmlFor="order-status">Filter by status</label>
          <select
            id="order-status"
            value={status}
            onChange={(event) => { setStatus(event.target.value); setPage(1); }}
            className="min-h-11 rounded-xl border border-[#cedfdd] bg-white px-3 outline-none focus:border-[#64d4ad]"
          >
            <option value="open">Active orders</option>
            <option value="attention">Needs attention</option>
            <option value="billing">Tally billing queue</option>
            <option value="billing_attention">Billing attention</option>
            <option value="history">Old orders</option>
            <option value="all">All orders</option>
            <option value="awaiting_confirmation">Awaiting confirmation</option>
            <option value="awaiting_approval">Awaiting approval</option>
            <option value="confirmed">Confirmed</option>
            <option value="picking">Pick &amp; pack</option>
            <option value="packed">Packed</option>
            <option value="awaiting_tally_billing">Awaiting Tally billing</option>
            <option value="dispatch_ready">Ready for dispatch</option>
            <option value="dispatched">Dispatched</option>
            <option value="delivery_due_today">Delivery due today</option>
            <option value="delivery_due_soon">Delivery due in 7 days</option>
            <option value="back_ordered">Partial fulfilment / back-orders</option>
            <option value="delivery_exception">Open delivery exceptions</option>
            <option value="priority_urgent">Urgent orders</option>
            <option value="priority_high">High &amp; urgent orders</option>
            <option value="overdue">Overdue deliveries</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button type="button" onClick={exportVisibleOrders} disabled={!totalOrders} className="min-h-11 rounded-xl border border-[#cedfdd] px-4 font-bold text-[#31585d] hover:bg-[#f1f6f4] disabled:opacity-50">
            Export
          </button>
          <button type="button" onClick={() => void load()} className="min-h-11 rounded-xl border border-[#cedfdd] px-4 font-bold text-[#31585d] hover:bg-[#f1f6f4]">
            Refresh
          </button>
        </div>

        {notice ? <p className="mt-4 rounded-xl border border-[#bfe5d8] bg-[#eaf8f1] px-4 py-3 text-sm font-semibold text-[#176246]">{notice}</p> : null}
        {error ? <p role="alert" className="mt-4 rounded-xl border border-[#efbbb6] bg-[#fff0ef] px-4 py-3 text-sm text-[#8d3a34]">{error}</p> : null}

        <section className="mt-4 overflow-hidden rounded-2xl border border-[#dce7e5] bg-white shadow-[0_8px_24px_rgba(9,47,54,0.05)]">
          <div className="flex items-center justify-between border-b border-[#e3ecea] px-5 py-4">
            <div>
              <h2 className="font-extrabold text-[#173239]">{status === 'history' ? 'Old orders' : status === 'billing_attention' ? 'Billing attention' : status === 'delivery_due_today' ? 'Deliveries due today' : status === 'delivery_due_soon' ? 'Deliveries due in 7 days' : status === 'back_ordered' ? 'Partial fulfilment / back-orders' : status === 'delivery_exception' ? 'Open delivery exceptions' : 'Order inbox'}</h2>
              <p className="mt-1 text-xs text-[#6b7e81]">Tally stock snapshot: {staleText}</p>
            </div>
            <span className="rounded-full bg-[#e2f8ef] px-3 py-1 text-xs font-extrabold text-[#136146]">{totalOrders} orders</span>
          </div>

          {loading ? (
            <div className="p-10 text-center text-sm text-[#6b7e81]">Loading orders…</div>
          ) : visibleOrders.length === 0 ? (
            <div className="p-10 text-center">
              <p className="font-bold text-[#31585d]">No matching orders</p>
              <p className="mt-2 text-sm text-[#708386]">{query ? `No orders match “${query}”. Clear the search to see the full list.` : status === 'history' ? 'Completed and cancelled orders will remain available here.' : status === 'billing_attention' ? 'No invoice, customer-ledger, product, quantity, or stale-verification issues need attention.' : status.startsWith('delivery_due_') ? 'No promised deliveries fall in this period.' : status === 'back_ordered' ? 'No prepared orders currently have a quantity shortage.' : status === 'delivery_exception' ? 'No delivery exceptions are currently open.' : 'New orders will appear here immediately.'}</p>
            </div>
          ) : (
            <div className="divide-y divide-[#e8efed]">
              {displayedOrders.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  actorRole={data?.actor.role || ''}
                  actorEmail={data?.actor.email || actorEmail}
                  tallyInvoices={data?.snapshot.tallyInvoices}
                  tallySnapshotFetchedAt={data?.snapshot.fetchedAt}
                  onAdvance={advance}
                  onCancel={cancelOrder}
                  onSaveFulfilment={saveFulfilment}
                  onDelivery={updateDelivery}
                  onEdit={editOrder}
                  onException={updateException}
                  onInstallation={updateInstallation}
                  onBillingReview={recordBillingReview}
                  onRepeat={(order) => void openNewOrder(order)}
                  onFindCustomer={(order) => { setQuery(`customer:${order.customerName}`); setStatus('all'); setCaptureDate(''); setCaptureDateTo(''); setPage(1); }}
                  onSetPriority={setOrderPriority}
                  onSetAssignee={setOrderAssignee}
                />
              ))}
            </div>
          )}
          {!loading && pageCount > 1 ? <nav aria-label="Order pages" className="flex items-center justify-between gap-3 border-t border-[#e3ecea] px-5 py-4"><button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="min-h-10 rounded-xl border border-[#cedfdd] px-4 font-bold text-[#31585d] disabled:opacity-40">Previous</button><span className="text-xs font-bold text-[#6b7e81]">Page {currentPage} of {pageCount}</span><button type="button" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="min-h-10 rounded-xl border border-[#cedfdd] px-4 font-bold text-[#31585d] disabled:opacity-40">Next</button></nav> : null}
        </section>
      </div>

      {creating && data ? (
        <NewOrderPanel
          data={data}
          templateOrder={repeatOrder}
          onClose={() => {
            setDeviceDraftState(readOfflineOrderDraft(localStorage, data.actor.email)?.state || null);
            setRepeatOrder(null);
            setCreating(false);
            setRepeatOrder(null);
          }}
          onCreated={(number) => {
            setDeviceDraftState(null);
            setCreating(false);
            setNotice(`${number} captured successfully.`);
            void load();
          }}
          onViewCustomer={(customerName) => {
            setQuery(`customer:${customerName}`);
            setStatus('all');
            setCaptureDate('');
            setCaptureDateTo('');
            setPage(1);
            setRepeatOrder(null);
            setCreating(false);
          }}
        />
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value, tone = 'normal' }: { label: string; value?: number; tone?: 'normal' | 'watch' }) {
  return (
    <article className={`rounded-2xl border p-5 ${tone === 'watch' ? 'border-[#f0d7a5] bg-[#fff9ec]' : 'border-[#dce7e5] bg-white'}`}>
      <p className="text-xs font-bold text-[#6b7e81]">{label}</p>
      <strong className="mt-3 block text-3xl font-black text-[#092f36]">{Number(value || 0).toLocaleString('en-IN')}</strong>
    </article>
  );
}

function OrderRow({
  order,
  actorRole,
  actorEmail,
  tallyInvoices,
  tallySnapshotFetchedAt,
  onAdvance,
  onCancel,
  onSaveFulfilment,
  onDelivery,
  onEdit,
  onException,
  onInstallation,
  onBillingReview,
  onRepeat,
  onFindCustomer,
  onSetPriority,
  onSetAssignee,
}: {
  order: OrderSummary;
  actorRole: string;
  actorEmail: string;
  tallyInvoices: OrderBootstrap['snapshot']['tallyInvoices'];
  tallySnapshotFetchedAt?: string;
  onAdvance: (order: OrderSummary, tallyInvoiceNumber?: string) => Promise<void>;
  onCancel: (order: OrderSummary, reason: string) => Promise<void>;
  onSaveFulfilment: (order: OrderSummary, payload: Extract<OrderCommand, { action: 'save_fulfilment' }>['payload']) => Promise<void>;
  onDelivery: (order: OrderSummary, command: Extract<OrderCommand, { action: 'save_dispatch' | 'confirm_delivery' }>) => Promise<void>;
  onEdit: (order: OrderSummary, payload: Extract<OrderCommand, { action: 'edit_order' }>['payload']) => Promise<void>;
  onException: (order: OrderSummary, command: Extract<OrderCommand, { action: 'create_exception' | 'resolve_exception' }>) => Promise<void>;
  onInstallation: (order: OrderSummary, command: Extract<OrderCommand, { action: 'schedule_installation' | 'complete_installation' }>) => Promise<void>;
  onBillingReview: (order: OrderSummary, command: Extract<OrderCommand, { action: 'record_billing_review' }>) => Promise<void>;
  onRepeat: (order: OrderSummary) => void;
  onFindCustomer: (order: OrderSummary) => void;
  onSetPriority: (order: OrderSummary, priority: 'normal' | 'high' | 'urgent') => Promise<void>;
  onSetAssignee: (order: OrderSummary, assignedToEmail?: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState(order.tallyInvoiceNumber || '');
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const action = nextStatus[order.status];
  const canAdvance = Boolean(action && canRoleTransitionOrder(actorRole, order.status, action.status));
  const total = Number(order.totalQuantity || 0);
  const requiresInvoice = order.status === 'awaiting_tally_billing';
  const canCancel = actorRole === 'administrator' && !['cancelled', 'delivered'].includes(order.status);
  const canRepeat = ['administrator', 'sales', 'operations', 'management'].includes(actorRole);
  const attention = orderAttentionReasons(order);
  const backOrderedQuantity = attention.includes('Partial fulfilment or back-order') ? orderBackOrderedQuantity(order) : 0;
  const invoiceMatch = tallyInvoiceReconciliationDetail(order, tallyInvoices, new Date(), tallySnapshotFetchedAt);
  const lineMatch = tallyInvoiceLineReconciliation(order, tallyInvoices, new Date(), tallySnapshotFetchedAt);
  const invoiceState = invoiceMatch.state;
  const deliveryReminder = orderDeliveryReminder(order);
  return (
    <article className="p-5">
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr_auto] lg:items-center">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-[#092f36]">{order.orderNumber}</strong>
          <span className="rounded-full bg-[#edf3f1] px-2.5 py-1 text-[11px] font-extrabold text-[#46686c]">{orderStage(order.status)}</span>
          {order.priority && order.priority !== 'normal' ? <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${order.priority === 'urgent' ? 'bg-[#fff0ef] text-[#9a3f37]' : 'bg-[#fff1d6] text-[#8a5a0a]'}`}>{order.priority === 'urgent' ? 'Urgent' : 'High priority'}</span> : null}
          {order.assignedToEmail ? <span className="rounded-full bg-[#e8f4fa] px-2.5 py-1 text-[11px] font-extrabold text-[#315f75]">Assigned: {order.assignedToEmail}</span> : null}
          {deliveryReminder ? <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${deliveryReminder === 'overdue' ? 'bg-[#fff0ef] text-[#9a3f37]' : deliveryReminder === 'today' ? 'bg-[#fff1d6] text-[#8a5a0a]' : 'bg-[#e8f4fa] text-[#315f75]'}`}>{deliveryReminder === 'overdue' ? 'Delivery overdue' : deliveryReminder === 'today' ? 'Delivery due today' : 'Delivery due soon'}</span> : null}
          {lineMatch.state === 'mismatch' ? <span className="rounded-full bg-[#fff0ef] px-2.5 py-1 text-[11px] font-extrabold text-[#8d3a34]">Billing mismatch</span> : null}
        </div>
        <p className="mt-2 font-bold text-[#274b50]">{order.customerName}</p>
        <p className="mt-1 text-xs text-[#718487]">{order.customerPhone || 'No phone recorded'} · {order.lineCount} line{order.lineCount === 1 ? '' : 's'}</p>
        {order.expectedDeliveryDate ? <p className="mt-1 text-xs font-bold text-[#456367]">Promised delivery: {new Date(`${order.expectedDeliveryDate}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}</p> : null}
        {backOrderedQuantity > 0 ? <p className="mt-1 text-xs font-extrabold text-[#9a6412]">Short by {formatQuantity(backOrderedQuantity)}</p> : null}
        {attention.length ? <p className="mt-2 text-xs font-bold text-[#9a6412]">Needs attention: {attention.join(' · ')}</p> : null}
      </div>
      <div>
        <p className="text-xs font-bold text-[#708386]">Ordered quantity</p>
        <p className="mt-1 font-extrabold text-[#274b50]">{formatQuantity(total)}</p>
      </div>
      {action && canAdvance ? (
        <div className="flex min-w-48 flex-col gap-2">
          {requiresInvoice ? <label className="text-xs font-bold text-[#587275]">Tally invoice number(s)<input maxLength={160} value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="Use commas for split invoices" className="mt-1 min-h-10 w-full rounded-lg border border-[#cedfdd] px-3 font-normal text-[#173239] outline-none focus:border-[#64d4ad]" /></label> : null}
          <button
          type="button"
          disabled={busy || (requiresInvoice && !invoiceNumber.trim())}
          onClick={async () => { setBusy(true); try { await onAdvance(order, invoiceNumber); } finally { setBusy(false); } }}
          className="min-h-11 rounded-xl border border-[#badfd4] bg-[#effbf6] px-4 text-sm font-extrabold text-[#126044] hover:bg-[#e2f8ef] disabled:opacity-50"
        >
          {busy ? 'Updating…' : action.label}
        </button>
        {canCancel ? <button type="button" disabled={busy} onClick={() => setCancelling(true)} className="min-h-10 rounded-xl px-4 text-sm font-bold text-[#9a4e47] hover:bg-[#fff0ef] disabled:opacity-50">Cancel order</button> : null}
        </div>
      ) : canCancel ? <button type="button" disabled={busy} onClick={() => setCancelling(true)} className="min-h-10 rounded-xl px-4 text-sm font-bold text-[#9a4e47] hover:bg-[#fff0ef] disabled:opacity-50">Cancel order</button> : <span className="text-xs font-bold text-[#7d8f91]">No action due</span>}
      </div>
      {cancelling ? <div className="mt-4 rounded-xl border border-[#efbbb6] bg-[#fff8f7] p-4"><label className="text-sm font-bold text-[#7d413c]">Why is this order being cancelled?<textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} rows={2} maxLength={500} className="mt-2 w-full rounded-xl border border-[#dfbbb7] bg-white p-3 font-normal text-[#173239] outline-none focus:border-[#d06a61]" placeholder="Cancellation reason is required" /></label><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => { setCancelling(false); setCancelReason(''); }} className="min-h-10 rounded-xl px-4 font-bold text-[#557174]">Keep order</button><button type="button" disabled={busy || !cancelReason.trim()} onClick={async () => { setBusy(true); try { await onCancel(order, cancelReason); setCancelling(false); } finally { setBusy(false); } }} className="min-h-10 rounded-xl bg-[#a54c44] px-4 font-bold text-white disabled:opacity-50">{busy ? 'Cancelling…' : 'Confirm cancellation'}</button></div></div> : null}
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => onFindCustomer(order)} className="min-h-10 rounded-xl border border-[#cedfdd] px-4 text-sm font-bold text-[#31585d] hover:bg-[#f1f6f4]">Customer orders</button>{canRepeat ? <button type="button" onClick={() => onRepeat(order)} className="min-h-10 rounded-xl border border-[#cedfdd] px-4 text-sm font-bold text-[#31585d] hover:bg-[#f1f6f4]">Repeat as new order</button> : null}</div>
      {!['delivered', 'cancelled'].includes(order.status) && ['administrator', 'sales', 'operations', 'management'].includes(actorRole) ? <PriorityControl order={order} onSave={onSetPriority} /> : null}
      {!order.assignedToEmail && !['delivered', 'cancelled'].includes(order.status) && ['administrator', 'operations', 'management'].includes(actorRole) ? <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onSetAssignee(order, actorEmail); } finally { setBusy(false); } }} className="ml-3 min-h-10 rounded-xl border border-[#9ddbc5] bg-[#edf9f4] px-4 text-xs font-bold text-[#277b69] disabled:opacity-50">{busy ? 'Taking…' : 'Take this order'}</button> : null}
      {!['delivered', 'cancelled'].includes(order.status) && ['administrator', 'operations', 'management'].includes(actorRole) ? <AssignmentControl order={order} onSave={onSetAssignee} /> : null}
      <OrderSummaryCopy order={order} />
      <details className="mt-4 rounded-xl bg-[#f6f8f7] px-4 py-3 text-sm">
        <summary className="cursor-pointer font-bold text-[#456367]">View order details</summary>
        <div className="mt-3 grid gap-4 border-t border-[#dfe9e7] pt-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[#708386]">Products</p>
            <ul className="mt-2 space-y-2">{(order.lines || []).map((line) => <li key={line.tallyKey} className="flex justify-between gap-4"><span><strong className="block text-[#274b50]">{line.itemName}</strong><small className="text-[#718487]">{line.itemGroup || 'Tally stock item'}</small></span><span className="shrink-0 font-bold text-[#274b50]">{formatQuantity(line.quantity)} {line.baseUnit || ''}</span></li>)}</ul>
          </div>
          <dl className="grid grid-cols-[auto_1fr] content-start gap-x-3 gap-y-2 text-xs">
            <dt className="font-bold text-[#708386]">Internal status</dt><dd>{statusLabel(order.status)}</dd>
            <dt className="font-bold text-[#708386]">Order date</dt><dd>{new Date(order.createdAt).toLocaleString('en-IN')}</dd>
            <dt className="font-bold text-[#708386]">Last updated</dt><dd>{new Date(order.updatedAt).toLocaleString('en-IN')}</dd>
            <dt className="font-bold text-[#708386]">Source</dt><dd className="capitalize">{order.source.replaceAll('_', ' ')}</dd>
            <dt className="font-bold text-[#708386]">Tally invoice</dt><dd>{order.tallyInvoiceNumber || 'Not billed yet'}{invoiceState === 'verified' ? <span title="Invoice number, financial year, and customer ledger matched" className="ml-2 rounded-full bg-[#eaf8f1] px-2 py-0.5 font-bold text-[#176246]">Invoice matched</span> : invoiceState === 'unmatched' ? <span className="ml-2 rounded-full bg-[#fff1d6] px-2 py-0.5 font-bold text-[#8a5a0a]">Invoice not found</span> : invoiceState === 'customer_mismatch' ? <span title="The invoice exists under a different Tally customer ledger" className="ml-2 rounded-full bg-[#fff0ef] px-2 py-0.5 font-bold text-[#8d3a34]">Customer ledger differs</span> : invoiceState === 'ambiguous' ? <span title="More than one Tally voucher has this invoice identity" className="ml-2 rounded-full bg-[#fff0ef] px-2 py-0.5 font-bold text-[#8d3a34]">Duplicate invoice match</span> : invoiceState === 'verification_stale' ? <span title="The latest Tally data is over 20 minutes old" className="ml-2 rounded-full bg-[#fff1d6] px-2 py-0.5 font-bold text-[#8a5a0a]">Match needs fresh sync</span> : invoiceState === 'awaiting_sync' ? <span className="ml-2 text-[#708386]">Awaiting connector update</span> : null}</dd>
            {invoiceMatch.matchedVoucherNumber ? <><dt className="font-bold text-[#708386]">Matched Tally voucher</dt><dd className="font-bold text-[#176246]">{invoiceMatch.matchedVoucherNumber}</dd></> : null}
            {order.tallyInvoiceNumber ? <><dt className="font-bold text-[#708386]">Product & quantity check</dt><dd>{lineMatch.state === 'matched' ? <span className="rounded-full bg-[#eaf8f1] px-2 py-0.5 font-bold text-[#176246]">Products and quantities matched</span> : lineMatch.state === 'mismatch' ? <span className="rounded-full bg-[#fff0ef] px-2 py-0.5 font-bold text-[#8d3a34]">Mismatch found</span> : lineMatch.state === 'awaiting_detail' ? <span className="text-[#708386]">Awaiting invoice details</span> : <span className="text-[#708386]">Available after invoice identity is matched</span>}</dd></> : null}
            <dt className="font-bold text-[#708386]">Notes</dt><dd>{order.notes || 'No notes'}</dd>
          </dl>
        </div>
        {lineMatch.state === 'mismatch' ? <div className="mt-3 rounded-xl border border-[#efc6c2] bg-[#fff8f7] p-3"><p className="text-xs font-extrabold uppercase tracking-wide text-[#8d3a34]">Tally invoice differences</p><ul className="mt-2 space-y-1 text-sm text-[#6f3f3b]">{lineMatch.differences.map((difference) => <li key={difference.itemName}>{difference.itemName}: ordered {formatQuantity(difference.orderedQuantity)}, invoiced {formatQuantity(difference.invoicedQuantity)}</li>)}</ul><BillingReviewPanel order={order} actorRole={actorRole} onSave={onBillingReview} /></div> : null}
        {!['cancelled', 'delivered'].includes(order.status) ? <FulfilmentEditor order={order} onSave={onSaveFulfilment} /> : null}
        {['ready_for_dispatch', 'dispatched', 'delivered'].includes(order.status) ? <DispatchPanel order={order} actorRole={actorRole} onSave={onDelivery} /> : null}
        {['phone_order_received','awaiting_confirmation','awaiting_approval','confirmed','partially_reserved','fully_reserved','ready_for_picking','picked','packed'].includes(order.status) ? <OrderEditPanel order={order} onSave={onEdit} /> : null}
        <DeliveryExceptionPanel order={order} onSave={onException} />
        <InstallationPanel order={order} onSave={onInstallation} />
        {order.status === 'awaiting_tally_billing' ? <BillingHandoff order={order} /> : null}
        <OrderActivityLog key={`${order.id}-${order.version}`} orderId={order.id} initialEvents={order.events || []} />
      </details>
    </article>
  );
}

function BillingReviewPanel({ order, actorRole, onSave }: { order: OrderSummary; actorRole: string; onSave: (order: OrderSummary, command: Extract<OrderCommand, { action: 'record_billing_review' }>) => Promise<void> }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<'investigating' | 'accepted_difference' | 'tally_corrected'>('investigating'); const [note, setNote] = useState('');
  if (!['administrator', 'accounts', 'operations', 'management'].includes(actorRole)) return <p className="mt-3 text-xs text-[#718487]">Accounts or operations must review this difference.</p>;
  return <div className="mt-3 border-t border-[#efcfcc] pt-3"><button type="button" onClick={() => setOpen((value) => !value)} className="text-xs font-extrabold text-[#7d413c]">{open ? '− Hide review' : '+ Record review'}</button>{open ? <div className="mt-2 grid gap-2 sm:grid-cols-[180px_1fr_auto]"><select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)} className="min-h-10 rounded-lg border border-[#dfbbb7] bg-white px-2 text-xs"><option value="investigating">Investigating</option><option value="tally_corrected">Corrected in Tally</option><option value="accepted_difference">Accepted difference</option></select><input value={note} onChange={(event) => setNote(event.target.value)} minLength={3} maxLength={1000} placeholder="What was checked or corrected?" className="min-h-10 rounded-lg border border-[#dfbbb7] bg-white px-3 text-xs"/><button type="button" disabled={busy || note.trim().length < 3} onClick={async () => { setBusy(true); try { await onSave(order, { action: 'record_billing_review', payload: { orderId: order.id, expectedVersion: order.version, outcome, note: note.trim() } }); setNote(''); setOpen(false); } finally { setBusy(false); } }} className="min-h-10 rounded-lg bg-[#7d413c] px-3 text-xs font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save review'}</button></div> : null}</div>;
}

function OrderActivityLog({ orderId, initialEvents }: { orderId: string; initialEvents: OrderEvent[] }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState(initialEvents);
  const [loaded, setLoaded] = useState(initialEvents.length > 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function loadEvents() {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const result = await readResponse<{ events: OrderEvent[] }>(await fetch(`/api/orders?eventsFor=${encodeURIComponent(orderId)}`, { cache: 'no-store' }));
      setEvents(result.events || []);
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load activity');
    } finally {
      setLoading(false);
    }
  }
  function toggle() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && !loaded) void loadEvents();
  }
  return <div className="mt-5 border-t border-[#dfe9e7] pt-4"><button type="button" onClick={toggle} aria-expanded={open} className="text-xs font-bold uppercase tracking-wide text-[#456367]">{open ? '−' : '+'} Activity log</button>{open ? loading ? <p className="mt-2 text-xs text-[#718487]">Loading activity…</p> : error ? <div className="mt-2 flex items-center gap-3"><p role="alert" className="text-xs text-[#8d3a34]">{error}</p><button type="button" onClick={() => void loadEvents()} className="text-xs font-bold text-[#31585d]">Retry</button></div> : events.length ? <ol className="mt-3 space-y-3">{events.map((event) => <li key={event.id} className="grid grid-cols-[10px_1fr] gap-3"><span className="mt-1.5 size-2.5 rounded-full bg-[#64d4ad]" /><div><p className="font-bold text-[#274b50]">{event.toStatus ? `${statusLabel(event.fromStatus || 'new')} → ${statusLabel(event.toStatus)}` : event.eventType.replaceAll('_', ' ')}</p><p className="mt-0.5 text-xs text-[#718487]">{event.actorEmail} ({event.actorRole}) · {new Date(event.createdAt).toLocaleString('en-IN')}</p>{event.reason ? <p className="mt-1 text-xs text-[#80524d]">Reason: {event.reason}</p> : null}</div></li>)}</ol> : <p className="mt-2 text-xs text-[#718487]">No recorded activity yet.</p> : null}</div>;
}

async function readOrderSubmission(response: Response) {
  const body = (await response.json().catch(() => ({}))) as { error?: string; orderNumber?: string };
  if (!response.ok) throw orderSubmissionError(response.status, body.error);
  return body;
}

function InstallationPanel({ order, onSave }: { order: OrderSummary; onSave: (order: OrderSummary, command: Extract<OrderCommand, { action: 'schedule_installation' | 'complete_installation' }>) => Promise<void> }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [tallyKey, setTallyKey] = useState(order.lines[0]?.tallyKey || ''); const [scheduledDate, setScheduledDate] = useState('');
  const [siteContact, setSiteContact] = useState(''); const [engineerEmail, setEngineerEmail] = useState('');
  const [completion, setCompletion] = useState<Record<string, { serial: string; notes: string }>>({});
  const installations = order.installations || []; const scheduled = installations.filter((item) => item.status === 'scheduled').length;
  return <div className="mt-5 border-t border-[#dfe9e7] pt-4"><button type="button" onClick={() => setOpen((value) => !value)} className="font-bold text-[#31585d]">{open ? '−' : '+'} Equipment installation{scheduled ? ` (${scheduled} scheduled)` : ''}</button>{open ? <div className="mt-3 space-y-3 rounded-xl bg-white p-4">{installations.map((item) => { const current = completion[item.id] || { serial: '', notes: '' }; return <div key={item.id} className="rounded-lg border border-[#dce7e5] p-3"><div className="flex flex-wrap justify-between gap-2"><strong className="text-[#274b50]">{item.itemName}</strong><span className="text-xs font-bold capitalize text-[#587275]">{item.status}</span></div><p className="mt-1 text-xs text-[#718487]">Scheduled {new Date(`${item.scheduledDate}T00:00:00`).toLocaleDateString('en-IN')}{item.engineerEmail ? ` · ${item.engineerEmail}` : ''}</p>{item.status === 'completed' ? <p className="mt-2 text-xs text-[#176246]">Serial {item.serialNumber} · {item.commissioningNotes}</p> : <div className="mt-3 grid gap-2 sm:grid-cols-[160px_1fr_auto]"><input value={current.serial} onChange={(event) => setCompletion((value) => ({ ...value, [item.id]: { ...current, serial: event.target.value } }))} placeholder="Serial number" maxLength={100} className="min-h-10 rounded-lg border px-3 text-xs" /><input value={current.notes} onChange={(event) => setCompletion((value) => ({ ...value, [item.id]: { ...current, notes: event.target.value } }))} placeholder="Commissioning checks / notes" maxLength={1000} className="min-h-10 rounded-lg border px-3 text-xs" /><button type="button" disabled={busy || current.serial.trim().length < 2 || current.notes.trim().length < 3} onClick={async () => { setBusy(true); try { await onSave(order, { action: 'complete_installation', payload: { orderId: order.id, expectedVersion: order.version, installationId: item.id, serialNumber: current.serial.trim(), commissioningNotes: current.notes.trim() } }); } finally { setBusy(false); } }} className="min-h-10 rounded-lg border border-[#badfd4] px-3 text-xs font-bold text-[#126044] disabled:opacity-50">Complete</button></div>}</div>; })}<div className="grid gap-2 border-t border-[#e3ecea] pt-3 sm:grid-cols-2"><select value={tallyKey} onChange={(event) => setTallyKey(event.target.value)} className="min-h-10 rounded-lg border px-2 text-xs">{order.lines.map((line) => <option key={line.tallyKey} value={line.tallyKey}>{line.itemName}</option>)}</select><input type="date" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} className="min-h-10 rounded-lg border px-3 text-xs" /><input value={siteContact} onChange={(event) => setSiteContact(event.target.value)} placeholder="Site contact (optional)" maxLength={200} className="min-h-10 rounded-lg border px-3 text-xs" /><input type="email" maxLength={254} value={engineerEmail} onChange={(event) => setEngineerEmail(event.target.value)} placeholder="Engineer email (optional)" className="min-h-10 rounded-lg border px-3 text-xs" /></div><div className="flex justify-end"><button type="button" disabled={busy || !tallyKey || !scheduledDate || order.status === 'cancelled'} onClick={async () => { setBusy(true); try { await onSave(order, { action: 'schedule_installation', payload: { orderId: order.id, expectedVersion: order.version, tallyKey, scheduledDate, siteContact: siteContact.trim(), engineerEmail: engineerEmail.trim() } }); } finally { setBusy(false); } }} className="min-h-10 rounded-lg bg-[#092f36] px-4 text-xs font-bold text-white disabled:opacity-50">Schedule installation</button></div><p className="text-xs text-[#718487]">Use this only for equipment lines. Reagents need no installation record.</p></div> : null}</div>;
}

function DeliveryExceptionPanel({ order, onSave }: { order: OrderSummary; onSave: (order: OrderSummary, command: Extract<OrderCommand, { action: 'create_exception' | 'resolve_exception' }>) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<'delayed' | 'failed_delivery' | 'damaged' | 'wrong_item' | 'other'>('delayed');
  const [summary, setSummary] = useState('');
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const exceptions = order.exceptions || [];
  const openCount = exceptions.filter((item) => item.status === 'open').length;
  return <div className="mt-5 border-t border-[#dfe9e7] pt-4"><button type="button" onClick={() => setOpen((value) => !value)} className="font-bold text-[#31585d]">{open ? '−' : '+'} Delivery exceptions{openCount ? ` (${openCount} open)` : ''}</button>{open ? <div className="mt-3 space-y-3 rounded-xl bg-white p-4">{exceptions.map((item) => <div key={item.id} className="rounded-lg border border-[#dce7e5] p-3"><div className="flex flex-wrap justify-between gap-2"><strong className="capitalize text-[#274b50]">{item.category.replaceAll('_', ' ')}</strong><span className={`rounded-full px-2 py-1 text-[11px] font-bold ${item.status === 'open' ? 'bg-[#fff1d6] text-[#8a5a0a]' : 'bg-[#eaf8f1] text-[#176246]'}`}>{item.status}</span></div><p className="mt-1 text-xs text-[#587275]">{item.summary}</p>{item.status === 'resolved' ? <p className="mt-2 text-xs text-[#176246]">Resolution: {item.resolution}</p> : <div className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={resolutions[item.id] || ''} onChange={(event) => setResolutions((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="How was it resolved?" maxLength={500} className="min-h-10 flex-1 rounded-lg border px-3 text-xs" /><button type="button" disabled={busy || (resolutions[item.id] || '').trim().length < 3} onClick={async () => { setBusy(true); try { await onSave(order, { action: 'resolve_exception', payload: { orderId: order.id, expectedVersion: order.version, exceptionId: item.id, resolution: resolutions[item.id].trim() } }); } finally { setBusy(false); } }} className="min-h-10 rounded-lg border border-[#badfd4] px-3 text-xs font-bold text-[#126044] disabled:opacity-50">Resolve</button></div>}</div>)}<div className="grid gap-2 border-t border-[#e3ecea] pt-3 sm:grid-cols-[170px_1fr_auto]"><select value={category} onChange={(event) => setCategory(event.target.value as typeof category)} className="min-h-10 rounded-lg border px-2 text-xs"><option value="delayed">Delayed</option><option value="failed_delivery">Failed delivery</option><option value="damaged">Damaged</option><option value="wrong_item">Wrong item</option><option value="other">Other</option></select><input value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={500} placeholder="What happened?" className="min-h-10 rounded-lg border px-3 text-xs" /><button type="button" disabled={busy || summary.trim().length < 3 || ['cancelled', 'delivered'].includes(order.status)} onClick={async () => { setBusy(true); try { await onSave(order, { action: 'create_exception', payload: { orderId: order.id, expectedVersion: order.version, category, summary: summary.trim() } }); setSummary(''); } finally { setBusy(false); } }} className="min-h-10 rounded-lg bg-[#092f36] px-3 text-xs font-bold text-white disabled:opacity-50">Add exception</button></div>{['cancelled', 'delivered'].includes(order.status) ? <p className="text-xs text-[#718487]">Closed orders cannot receive new exceptions.</p> : null}</div> : null}</div>;
}

function BillingHandoff({ order }: { order: OrderSummary }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(billingHandoffText(order));
      setState('copied');
    } catch {
      setState('error');
    }
  }
  return <div className="mt-5 flex flex-col gap-2 border-t border-[#dfe9e7] pt-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold text-[#31585d]">Tally billing handoff</p><p className="text-xs text-[#718487]">Copies the customer, products, quantities, delivery details, and notes.</p>{state === 'error' ? <p className="mt-1 text-xs font-bold text-[#9a4e47]">Copy was blocked. Please allow clipboard access and try again.</p> : null}</div><button type="button" onClick={() => void copy()} className="min-h-10 shrink-0 rounded-xl border border-[#badfd4] bg-white px-4 text-sm font-bold text-[#126044] hover:bg-[#effbf6]">{state === 'copied' ? 'Copied' : 'Copy for Tally'}</button></div>;
}

function OrderEditPanel({ order, onSave }: { order: OrderSummary; onSave: (order: OrderSummary, payload: Extract<OrderCommand, { action: 'edit_order' }>['payload']) => Promise<void> }) {
  const [open,setOpen]=useState(false); const [busy,setBusy]=useState(false); const [customerName,setCustomerName]=useState(order.customerName); const [customerPhone,setCustomerPhone]=useState(order.customerPhone||''); const [notes,setNotes]=useState(order.notes||''); const [reason,setReason]=useState(''); const [lines,setLines]=useState(()=>order.lines.map(line=>({tallyKey:line.tallyKey,itemName:line.itemName,quantity:Math.max(1,Math.round(line.quantity)),fulfilled:Math.max(0,Math.round(Number(line.fulfilledQuantity||0)))})));
  const reasonRequired=!['phone_order_received','awaiting_confirmation','awaiting_approval'].includes(order.status);
  return <div className="mt-5 border-t border-[#dfe9e7] pt-4"><button type="button" onClick={()=>setOpen(v=>!v)} className="font-bold text-[#31585d]">{open?'−':'+'} Edit order</button>{open?<div className="mt-3 space-y-3 rounded-xl bg-white p-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold">Customer name<input maxLength={200} value={customerName} onChange={e=>setCustomerName(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border px-3 font-normal" /></label><label className="text-xs font-bold">Phone<input maxLength={40} value={customerPhone} onChange={e=>setCustomerPhone(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border px-3 font-normal" /></label></div>{lines.map((line,index)=><label key={line.tallyKey} className="grid grid-cols-[1fr_110px] items-center gap-3 text-xs font-bold">{line.itemName}<input type="number" min={Math.max(line.fulfilled,1)} max="1000000" step="1" value={line.quantity} onChange={e=>setLines(current=>current.map((item,i)=>i===index?{...item,quantity:Number(e.target.value)}:item))} className="min-h-10 rounded-lg border px-2 text-right font-normal" /></label>)}<label className="text-xs font-bold">Notes<textarea maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border p-2 font-normal" /></label>{reasonRequired?<label className="text-xs font-bold text-[#80524d]">Reason for change<textarea required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border p-2 font-normal" /></label>:null}<div className="flex justify-end"><button type="button" disabled={busy||customerName.trim().length<2||(reasonRequired&&!reason.trim())} onClick={async()=>{setBusy(true);try{await onSave(order,{orderId:order.id,expectedVersion:order.version,customerName:customerName.trim(),customerPhone:customerPhone.trim(),notes:notes.trim(),reason:reason.trim(),lines:lines.map(({tallyKey,quantity})=>({tallyKey,quantity}))});}finally{setBusy(false)}}} className="min-h-10 rounded-xl bg-[#092f36] px-4 font-bold text-white disabled:opacity-50">{busy?'Saving…':'Save changes'}</button></div></div>:null}</div>;
}

function FulfilmentEditor({ order, onSave }: { order: OrderSummary; onSave: (order: OrderSummary, payload: Extract<OrderCommand, { action: 'save_fulfilment' }>['payload']) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState(order.deliveryAddress || '');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(order.expectedDeliveryDate || '');
  const [lines, setLines] = useState(() => order.lines.map((line) => ({ tallyKey: line.tallyKey, itemName: line.itemName, quantity: Math.max(1, Math.round(line.quantity)), fulfilledQuantity: Math.max(0, Math.round(Number(line.fulfilledQuantity || 0))) })));
  const backOrdered = lines.reduce((sum, line) => sum + Math.max(line.quantity - line.fulfilledQuantity, 0), 0);
  return <div className="mt-5 border-t border-[#dfe9e7] pt-4"><button type="button" onClick={() => setOpen((value) => !value)} className="font-bold text-[#31585d]">{open ? '−' : '+'} Fulfilment details</button>{open ? <div className="mt-3 space-y-4 rounded-xl bg-white p-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-[#587275]">Expected delivery<input type="date" value={expectedDeliveryDate} onChange={(event) => setExpectedDeliveryDate(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#cedfdd] px-3 font-normal" /></label><label className="text-xs font-bold text-[#587275]">Delivery address<input maxLength={1000} value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#cedfdd] px-3 font-normal" /></label></div><div className="space-y-2">{lines.map((line, index) => <div key={line.tallyKey} className="grid gap-2 rounded-lg bg-[#f6f8f7] p-3 sm:grid-cols-[1fr_120px]"><strong className="text-sm text-[#274b50]">{line.itemName}<small className="block font-normal text-[#718487]">Ordered {formatQuantity(line.quantity)}</small></strong><label className="text-xs font-bold">Fulfilled<input type="number" min="0" max={line.quantity} step="1" value={line.fulfilledQuantity} onChange={(event) => setLines((current) => current.map((item, position) => position === index ? { ...item, fulfilledQuantity: Number(event.target.value) } : item))} className="mt-1 min-h-10 w-full rounded-lg border px-2 font-normal" /></label></div>)}</div><p className="text-xs text-[#718487]">Batch, expiry and stock adjustments continue to be recorded only in Tally Prime.</p><div className="flex items-center justify-between gap-3"><p className={`text-xs font-bold ${backOrdered > 0 ? 'text-[#9a6412]' : 'text-[#277b69]'}`}>{backOrdered > 0 ? `${formatQuantity(backOrdered)} back-ordered` : 'Fully fulfilled'}</p><button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onSave(order, { orderId: order.id, expectedVersion: order.version, deliveryAddress, expectedDeliveryDate, lines: lines.map(({ tallyKey, fulfilledQuantity }) => ({ tallyKey, fulfilledQuantity })) }); } finally { setBusy(false); } }} className="min-h-10 rounded-xl bg-[#092f36] px-4 font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save fulfilment'}</button></div></div> : null}</div>;
}

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function DispatchPanel({ order, actorRole, onSave }: { order: OrderSummary; actorRole: string; onSave: (order: OrderSummary, command: Extract<OrderCommand, { action: 'save_dispatch' | 'confirm_delivery' }>) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [courierName, setCourierName] = useState(order.courierName || '');
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber || '');
  const [dispatchDate, setDispatchDate] = useState(order.dispatchDate || new Date().toISOString().slice(0, 10));
  const [vehicleNumber, setVehicleNumber] = useState(order.vehicleNumber || '');
  const [deliveredAt, setDeliveredAt] = useState(order.deliveredAt ? localDateTimeValue(new Date(order.deliveredAt)) : localDateTimeValue());
  const [receivedBy, setReceivedBy] = useState(order.receivedBy || '');
  const [podReference, setPodReference] = useState(order.podReference || '');
  const canUpdate = ['administrator', 'operations'].includes(actorRole);
  if (order.status === 'delivered') return <div className="mt-5 border-t border-[#dfe9e7] pt-4"><p className="font-bold text-[#31585d]">Delivery confirmation</p><p className="mt-2 text-sm text-[#587275]">Received by {order.receivedBy} on {order.deliveredAt ? new Date(order.deliveredAt).toLocaleString('en-IN') : '—'}{order.podReference ? ` · POD ${order.podReference}` : ''}</p></div>;
  return <div className="mt-5 border-t border-[#dfe9e7] pt-4"><p className="font-bold text-[#31585d]">{order.status === 'ready_for_dispatch' ? 'Dispatch details' : 'Delivery confirmation'}</p>{order.status === 'ready_for_dispatch' ? <div className="mt-3 grid gap-3 rounded-xl bg-white p-4 sm:grid-cols-2"><label className="text-sm font-bold">Courier / transporter<input maxLength={160} value={courierName} onChange={(event) => setCourierName(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border px-3 font-normal" /></label><label className="text-sm font-bold">Tracking / docket number<input maxLength={160} value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border px-3 font-normal" /></label><label className="text-sm font-bold">Dispatch date<input type="date" value={dispatchDate} onChange={(event) => setDispatchDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border px-3 font-normal" /></label><label className="text-sm font-bold">Vehicle number <span className="font-normal text-[#718487]">(optional)</span><input value={vehicleNumber} onChange={(event) => setVehicleNumber(event.target.value)} maxLength={40} className="mt-1 min-h-11 w-full rounded-lg border px-3 font-normal" /></label><div className="sm:col-span-2 flex justify-end"><button type="button" disabled={!canUpdate || busy || courierName.trim().length < 2 || trackingNumber.trim().length < 2 || !dispatchDate} onClick={async () => { setBusy(true); try { await onSave(order, { action: 'save_dispatch', payload: { orderId: order.id, expectedVersion: order.version, courierName: courierName.trim(), trackingNumber: trackingNumber.trim(), dispatchDate, vehicleNumber: vehicleNumber.trim() } }); } finally { setBusy(false); } }} className="min-h-11 rounded-xl bg-[#092f36] px-5 font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Mark dispatched'}</button></div></div> : <div className="mt-3 grid gap-3 rounded-xl bg-white p-4 sm:grid-cols-2"><p className="sm:col-span-2 text-sm text-[#587275]">{order.courierName} · {order.trackingNumber}{order.vehicleNumber ? ` · ${order.vehicleNumber}` : ''}</p><label className="text-sm font-bold">Delivered at<input type="datetime-local" value={deliveredAt} onChange={(event) => setDeliveredAt(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border px-3 font-normal" /></label><label className="text-sm font-bold">Received by<input value={receivedBy} onChange={(event) => setReceivedBy(event.target.value)} maxLength={160} className="mt-1 min-h-11 w-full rounded-lg border px-3 font-normal" /></label><label className="text-sm font-bold sm:col-span-2">Proof of delivery reference <span className="font-normal text-[#718487]">(optional)</span><input value={podReference} onChange={(event) => setPodReference(event.target.value)} maxLength={160} className="mt-1 min-h-11 w-full rounded-lg border px-3 font-normal" /></label><div className="sm:col-span-2 flex justify-end"><button type="button" disabled={!canUpdate || busy || receivedBy.trim().length < 2 || !deliveredAt} onClick={async () => { setBusy(true); try { await onSave(order, { action: 'confirm_delivery', payload: { orderId: order.id, expectedVersion: order.version, deliveredAt: new Date(deliveredAt).toISOString(), receivedBy: receivedBy.trim(), podReference: podReference.trim() } }); } finally { setBusy(false); } }} className="min-h-11 rounded-xl bg-[#092f36] px-5 font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Confirm delivery'}</button></div></div>}</div>;
}

function NewOrderPanel({ data, templateOrder, onClose, onCreated, onViewCustomer }: { data: OrderBootstrap; templateOrder: OrderSummary | null; onClose: () => void; onCreated: (number: string) => void; onViewCustomer: (customerName: string) => void }) {
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!hydrated) return null;
  return <HydratedNewOrderPanel data={data} templateOrder={templateOrder} onClose={onClose} onCreated={onCreated} onViewCustomer={onViewCustomer} />;
}

function OrderSummaryCopy({ order }: { order: OrderSummary }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(orderOperationsText(order));
      setState('copied');
    } catch {
      setState('error');
    }
  }
  return <div className="mt-3 flex items-center gap-3"><button type="button" onClick={() => void copy()} className="min-h-10 rounded-xl border border-[#cedfdd] px-4 text-sm font-bold text-[#31585d] hover:bg-[#f1f6f4]">{state === 'copied' ? 'Summary copied' : 'Copy order summary'}</button>{state === 'error' ? <span className="text-xs font-bold text-[#9a4e47]">Clipboard access was blocked.</span> : null}</div>;
}

function PriorityControl({ order, onSave }: { order: OrderSummary; onSave: (order: OrderSummary, priority: 'normal' | 'high' | 'urgent') => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return <label className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-[#587275]">Priority<select value={order.priority || 'normal'} disabled={busy} onChange={async (event) => { setBusy(true); try { await onSave(order, event.target.value as 'normal' | 'high' | 'urgent'); } finally { setBusy(false); } }} className="min-h-10 rounded-xl border border-[#cedfdd] bg-white px-3 text-sm font-normal text-[#173239]"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>;
}

function AssignmentControl({ order, onSave }: { order: OrderSummary; onSave: (order: OrderSummary, assignedToEmail?: string) => Promise<void> }) {
  const [value, setValue] = useState(order.assignedToEmail || '');
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<Array<{ email: string; role: string }>>([]);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  async function loadUsers() {
    if (loadState === 'loading' || loadState === 'loaded') return;
    setLoadState('loading');
    try {
      const result = await readResponse<{ users: Array<{ email: string; role: string }> }>(await fetch('/api/users?scope=assignable', { cache: 'no-store' }));
      setUsers(result.users);
      setLoadState('loaded');
    } catch {
      setLoadState('error');
    }
  }
  return <details onToggle={(event) => { if (event.currentTarget.open) void loadUsers(); }} className="mt-3 max-w-xl rounded-xl border border-[#dce7e5] bg-[#fbfcfb] px-3 py-2 text-xs"><summary className="cursor-pointer font-bold text-[#587275]">{order.assignedToEmail ? 'Change owner' : 'Assign owner'}</summary><div className="mt-2 flex flex-col gap-2 sm:flex-row"><label className="flex-1 font-bold text-[#587275]">Approved user<select value={value} disabled={loadState !== 'loaded'} onChange={(event) => setValue(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#cedfdd] bg-white px-3 font-normal text-[#173239]"><option value="">Unassigned</option>{order.assignedToEmail && !users.some((user) => user.email === order.assignedToEmail) ? <option value={order.assignedToEmail}>{order.assignedToEmail}</option> : null}{users.map((user) => <option key={user.email} value={user.email}>{user.email} · {user.role}</option>)}</select></label><div className="flex items-end"><button type="button" disabled={busy || loadState !== 'loaded' || value === (order.assignedToEmail || '')} onClick={async () => { setBusy(true); try { await onSave(order, value || undefined); } finally { setBusy(false); } }} className="min-h-10 rounded-lg bg-[#092f36] px-4 font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button></div></div>{loadState === 'loading' ? <p className="mt-2 text-[#718487]">Loading approved users…</p> : loadState === 'error' ? <button type="button" onClick={() => { setLoadState('idle'); void loadUsers(); }} className="mt-2 font-bold text-[#9a4e47]">Could not load users · Retry</button> : <p className="mt-2 text-[#718487]">Only active StockFlow users are shown.</p>}</details>;
}

function HydratedNewOrderPanel({ data, templateOrder, onClose, onCreated, onViewCustomer }: { data: OrderBootstrap; templateOrder: OrderSummary | null; onClose: () => void; onCreated: (number: string) => void; onViewCustomer: (customerName: string) => void }) {
  const [initialDraft] = useState(() => readOfflineOrderDraft(localStorage, data.actor.email));
  const initialPayload = initialDraft?.command.payload;
  const templatePayload = templateOrder ? repeatOrderTemplate(templateOrder) : undefined;
  const [customerName, setCustomerName] = useState(initialPayload?.customerName || templatePayload?.customerName || '');
  const [customerPhone, setCustomerPhone] = useState(initialPayload?.customerPhone || templatePayload?.customerPhone || '');
  const [customerCity, setCustomerCity] = useState(initialPayload?.customerCity || '');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | undefined>(initialPayload?.customerId);
  const [customerSuggestionsOpen, setCustomerSuggestionsOpen] = useState(false);
  const [customerHistory, setCustomerHistory] = useState<{ orders: OrderSummary[]; total: number } | null>(null);
  const [customerHistoryState, setCustomerHistoryState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [notes, setNotes] = useState(initialPayload?.notes || '');
  const [priority, setPriority] = useState<'normal' | 'high' | 'urgent'>(initialPayload?.priority || 'normal');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(initialPayload?.expectedDeliveryDate || '');
  const [productQuery, setProductQuery] = useState('');
  const [restoredLines] = useState(() => restoreOfflineDraftLines(data.snapshot.catalog, initialPayload?.lines || templatePayload?.lines || []));
  const [lines, setLines] = useState<DraftLine[]>(restoredLines);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(() => offlineDraftRecoveryError(initialDraft, restoredLines.some((line) => !line.item)));
  const [idempotencyKey] = useState(() => initialPayload?.idempotencyKey || crypto.randomUUID());
  const [draftState, setDraftState] = useState<OfflineDraftState>(initialDraft?.state || 'draft');
  const [saveOnDevice, setSaveOnDevice] = useState(() => Boolean(initialDraft) || readOfflineDraftConsent(localStorage, data.actor.email));

  function changeTrustedDevice(allowed: boolean) {
    if (!writeOfflineDraftConsent(localStorage, data.actor.email, allowed)) {
      setError('This browser could not update device-saving permission.');
      return;
    }
    setSaveOnDevice(allowed);
    if (allowed) {
      const catalogVersion = data.snapshot.catalogVersion || data.snapshot.fetchedAt;
      const catalogSaved = writeCatalogCache(localStorage, data.actor.email, catalogVersion, data.snapshot.catalog);
      const customersSaved = writeCustomerCache(localStorage, data.actor.email, data.customerVersion || '', data.customers);
      if (!catalogSaved || !customersSaved) setError('Device storage is full. The draft can stay open, but product or customer search may not survive a restart.');
      void navigator.storage?.persist?.().catch(() => false);
    } else {
      removeOfflineOrderDraft(localStorage, data.actor.email);
      removeCatalogCache(localStorage, data.actor.email);
      removeCustomerCache(localStorage, data.actor.email);
    }
  }

  function discardSavedOrder() {
    if (!window.confirm('Discard this unsent order from this device? This cannot be undone.')) return;
    removeOfflineOrderDraft(localStorage, data.actor.email);
    onClose();
  }

  useEffect(() => {
    if (!saveOnDevice || draftState === 'pending' || (!customerName.trim() && lines.length === 0 && !notes.trim())) return;
    const timer = window.setTimeout(() => {
      const saved = writeOfflineOrderDraft(localStorage, {
        schemaVersion: 1,
        actorEmail: data.actor.email,
        state: draftState,
        updatedAt: new Date().toISOString(),
        command: { action: 'create_order', payload: { idempotencyKey, customerId: selectedCustomerId, customerName: customerName.trim(), customerPhone: customerPhone.trim(), customerCity: customerCity.trim(), source: 'phone', priority, expectedDeliveryDate: expectedDeliveryDate || undefined, notes: notes.trim(), lines: lines.map((line) => ({ tallyKey: line.tallyKey, quantity: line.quantity })) } },
      });
      if (!saved) setError('This browser could not save the draft. Free device storage or turn off device saving.');
    }, 400);
    return () => window.clearTimeout(timer);
  }, [customerCity, customerName, customerPhone, data.actor.email, draftState, expectedDeliveryDate, idempotencyKey, lines, notes, priority, saveOnDevice, selectedCustomerId]);

  useEffect(() => {
    let active = true;
    async function retryPending() {
      const saved = readOfflineOrderDraft(localStorage, data.actor.email);
      if (!saved || saved.state !== 'pending' || !navigator.onLine) return;
      setSubmitting(true);
      try {
        const response = await fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(saved.command) });
        const result = await readOrderSubmission(response);
        removeOfflineOrderDraft(localStorage, data.actor.email);
        if (active) onCreated(result.orderNumber || 'Order');
      } catch (cause) {
        if (cause instanceof OrderSubmissionError && cause.kind === 'conflict') {
          const accepted = await recoverAcceptedOrder(saved.command.payload.idempotencyKey);
          if (accepted) {
            removeOfflineOrderDraft(localStorage, data.actor.email);
            if (active) onCreated(accepted);
            return;
          }
        }
        if (!(cause instanceof TypeError) && !(cause instanceof OrderSubmissionError && cause.retryable) && navigator.onLine) {
          const message = cause instanceof Error ? cause.message : 'Unable to create order';
          updateOfflineDraftState(localStorage, data.actor.email, 'error', message);
          if (active) { setDraftState('error'); setError(message); }
        }
      } finally {
        if (active) setSubmitting(false);
      }
    }
    window.addEventListener('online', retryPending);
    const initialRetry = window.setTimeout(retryPending, 0);
    return () => { active = false; window.clearTimeout(initialRetry); window.removeEventListener('online', retryPending); };
  }, [data.actor.email, onCreated]);

  const matches = useMemo(() => {
    const selected = new Set(lines.map((line) => line.tallyKey));
    return lines.length >= 50 ? [] : searchCatalog(data.snapshot.catalog, productQuery, selected);
  }, [data.snapshot.catalog, lines, productQuery]);

  const customerMatches = useMemo(
    () => searchCustomers(data.customers, customerName),
    [customerName, data.customers],
  );
  const selectedCustomer = data.customers.find((customer) => customer.id === selectedCustomerId);

  useEffect(() => {
    if (!selectedCustomer) return;
    const controller = new AbortController();
    fetch(orderListUrl({ page: 1, query: `customer:${selectedCustomer.name}`, status: 'all', captureDate: '' }), { cache: 'no-store', signal: controller.signal })
      .then((response) => readResponse<OrderBootstrap>(response))
      .then((result) => { setCustomerHistory({ orders: result.orders.slice(0, 5), total: result.pagination?.total || result.orders.length }); setCustomerHistoryState('idle'); })
      .catch((cause) => { if (cause instanceof DOMException && cause.name === 'AbortError') return; setCustomerHistory(null); setCustomerHistoryState('error'); });
    return () => controller.abort();
  }, [selectedCustomer]);

  function chooseCustomer(customer: CustomerDirectoryEntry) {
    setSelectedCustomerId(customer.id);
    setCustomerName(customer.name);
    setCustomerPhone(customer.phone || '');
    setCustomerCity(customer.city || '');
    setCustomerSuggestionsOpen(false);
    setCustomerHistory(null);
    setCustomerHistoryState('loading');
  }

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (customerName.trim().length < 2 || lines.length === 0) {
      setError('Add a customer and at least one product.');
      return;
    }
    if (lines.some((line) => !line.item)) {
      setError('Remove unavailable products and select their current Tally catalogue replacements before saving.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const existing = data.customers.find(
        (item) => item.id === selectedCustomerId || item.name === customerName.trim(),
      );
      const body: Extract<OrderCommand, { action: 'create_order' }> = {
        action: 'create_order',
        payload: {
          idempotencyKey,
          customerId: existing?.id,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          customerCity: customerCity.trim(),
          source: 'phone',
          priority,
          expectedDeliveryDate: expectedDeliveryDate || undefined,
          notes: notes.trim(),
          lines: lines.map((line) => ({ tallyKey: line.tallyKey, quantity: line.quantity })),
        },
      };
      if (saveOnDevice && !writeOfflineOrderDraft(localStorage, { schemaVersion: 1, actorEmail: data.actor.email, state: 'pending', command: body, updatedAt: new Date().toISOString() })) throw new Error('This browser could not save the pending order. Free device storage and retry.');
      setDraftState('pending');
      const response = await fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await readOrderSubmission(response);
      removeOfflineOrderDraft(localStorage, data.actor.email);
      onCreated(result.orderNumber || 'Order');
    } catch (cause) {
      if (cause instanceof OrderSubmissionError && cause.kind === 'conflict') {
        const accepted = await recoverAcceptedOrder(idempotencyKey);
        if (accepted) {
          removeOfflineOrderDraft(localStorage, data.actor.email);
          onCreated(accepted);
          return;
        }
      }
      const message = cause instanceof Error ? cause.message : 'Unable to create order';
      const waiting = !navigator.onLine || cause instanceof TypeError || cause instanceof OrderSubmissionError && cause.retryable;
      const savedForRetry = waiting && saveOnDevice && Boolean(updateOfflineDraftState(localStorage, data.actor.email, 'pending'));
      if (!waiting && saveOnDevice) updateOfflineDraftState(localStorage, data.actor.email, 'error', message);
      setDraftState(savedForRetry ? 'pending' : 'error');
      setError(savedForRetry ? 'Order saved on this device. Retry when the connection returns.' : waiting ? 'Connection lost. This order was not stored because device saving is off.' : message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#092f36]/45 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <dialog open aria-labelledby="new-order-title" className="ml-auto mr-0 h-full max-h-none w-full max-w-2xl overflow-y-auto bg-[#f7f6f1] p-0 shadow-2xl">
        <form onSubmit={submit}>
          <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#dce7e5] bg-white/95 px-5 py-4 backdrop-blur">
            <div><p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#277b69]">Order</p><h2 id="new-order-title" className="mt-1 text-xl font-black text-[#092f36]">{templateOrder ? 'Repeat order' : 'New order'}</h2>{templateOrder ? <p className="mt-1 text-xs text-[#6b7e81]">Based on {templateOrder.orderNumber}; saved as a separate new order.</p> : null}</div>
            <button type="button" onClick={onClose} className="min-h-10 rounded-xl border border-[#d1dfdd] px-3 font-bold text-[#557174]">Close</button>
          </header>
          <div className="space-y-5 p-5 sm:p-7">
            <fieldset className="rounded-2xl border border-[#dce7e5] bg-white p-5">
              <legend className="px-2 text-sm font-extrabold text-[#274b50]">Customer</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="relative sm:col-span-2 text-sm font-bold text-[#456367]">Name
                  <input
                    required
                    maxLength={200}
                    value={customerName}
                    onChange={(event) => {
                      setCustomerName(event.target.value);
                      setSelectedCustomerId(undefined);
                      setCustomerHistory(null);
                      setCustomerHistoryState('idle');
                      setCustomerSuggestionsOpen(true);
                    }}
                    onFocus={() => setCustomerSuggestionsOpen(true)}
                    onBlur={() => window.setTimeout(() => setCustomerSuggestionsOpen(false), 120)}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={customerSuggestionsOpen && customerMatches.length > 0}
                    aria-controls="customer-suggestions"
                    autoComplete="off"
                    className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] px-3 font-normal outline-none focus:border-[#64d4ad]"
                    placeholder="Type a Tally ledger name"
                  />
                  {customerSuggestionsOpen && customerMatches.length > 0 ? (
                    <ul id="customer-suggestions" aria-label="Matching Tally customer ledgers" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-[#cfe0dd] bg-white py-1 shadow-xl">
                      {customerMatches.map((customer) => (
                        <li key={customer.id}>
                          <button
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => chooseCustomer(customer)}
                            className="block min-h-12 w-full px-3 py-2 text-left font-normal hover:bg-[#f2faf7] focus:bg-[#f2faf7] focus:outline-none"
                          >
                            <strong className="block text-sm text-[#173239]">{customer.name}</strong>
                            <small className="block text-[#718487]">{[customer.city, customer.phone].filter(Boolean).join(' · ') || 'Tally customer ledger'}{customer.tallyBalance !== undefined && customer.tallyBalance !== null ? ` · Tally balance ₹${customer.tallyBalance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : ''}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {selectedCustomer ? <CustomerAccountPreview customer={selectedCustomer} history={customerHistory} state={customerHistoryState} onViewOrders={() => onViewCustomer(selectedCustomer.name)} /> : null}
                </label>
                <details className="sm:col-span-2 rounded-xl bg-[#f6f8f7] px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-bold text-[#456367]">Contact details <span className="font-normal text-[#718487]">(optional)</span></summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold text-[#456367]">Phone<input maxLength={40} value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] bg-white px-3 font-normal outline-none focus:border-[#64d4ad]" inputMode="tel" /></label>
                    <label className="text-sm font-bold text-[#456367]">City<input maxLength={120} value={customerCity} onChange={(event) => setCustomerCity(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] bg-white px-3 font-normal outline-none focus:border-[#64d4ad]" /></label>
                  </div>
                </details>
              </div>
            </fieldset>

            <fieldset className="rounded-2xl border border-[#dce7e5] bg-white p-5">
              <legend className="px-2 text-sm font-extrabold text-[#274b50]">Products</legend>
              <label className="text-sm font-bold text-[#456367]">Find product<input maxLength={200} value={productQuery} onChange={(event) => setProductQuery(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] px-3 font-normal outline-none focus:border-[#64d4ad]" placeholder="Type a product name" /></label>
              {matches.length ? <div className="mt-2 overflow-hidden rounded-xl border border-[#dce7e5]">{matches.map((item) => <button key={item.tallyKey} type="button" onClick={() => { setLines((current) => [...current, { tallyKey: item.tallyKey, item, quantity: 1 }]); setProductQuery(''); }} className="flex min-h-12 w-full items-center justify-between gap-4 border-b border-[#edf2f0] px-3 text-left last:border-0 hover:bg-[#f2faf7]"><span><strong className="block text-sm text-[#173239]">{item.item}</strong><small className="text-[#718487]">{item.group}</small></span><span className="shrink-0 text-xs font-bold text-[#277b69]">Available {formatQuantity(item.closing)} {item.baseUnit}</span></button>)}</div> : null}
              {productQuery.trim() && matches.length === 0 ? <p className="mt-2 rounded-xl bg-[#fff7e8] px-3 py-2 text-sm text-[#805b20]">No Tally products match “{productQuery.trim()}”.</p> : null}
              <div className="mt-4 space-y-2">{lines.map((line) => <div key={line.tallyKey} className={`grid grid-cols-[1fr_90px_auto] items-center gap-3 rounded-xl p-3 ${line.item ? 'bg-[#f2f7f5]' : 'border border-[#efbbb6] bg-[#fff0ef]'}`}><div className="min-w-0"><strong className="block truncate text-sm text-[#173239]">{line.item?.item || `Unavailable Tally item (${line.tallyKey})`}</strong><small className={line.item ? 'text-[#718487]' : 'font-bold text-[#8d3a34]'}>{line.item ? `Closing ${formatQuantity(line.item.closing)} ${line.item.baseUnit}` : 'Remove and select its current catalogue replacement'}</small></div><label className="sr-only" htmlFor={`qty-${line.tallyKey}`}>Quantity for {line.item?.item || line.tallyKey}</label><input id={`qty-${line.tallyKey}`} type="number" min="1" max="1000000" step="1" required value={line.quantity} onChange={(event) => setLines((current) => current.map((entry) => entry.tallyKey === line.tallyKey ? { ...entry, quantity: Number(event.target.value) } : entry))} className="min-h-10 rounded-lg border border-[#cedfdd] px-2 text-right" /><button type="button" onClick={() => setLines((current) => current.filter((entry) => entry.tallyKey !== line.tallyKey))} aria-label={`Remove ${line.item?.item || line.tallyKey}`} className="size-10 rounded-lg text-xl text-[#9a4e47] hover:bg-[#ffeae8]">×</button></div>)}</div>
              {lines.length >= 50 ? <p className="mt-2 text-xs font-bold text-[#805b20]">Maximum 50 products per order.</p> : null}
              {lines.length === 0 ? <p className="mt-4 rounded-xl bg-[#f6f8f7] p-4 text-center text-sm text-[#718487]">Search and add the products requested on the call.</p> : null}
            </fieldset>

            <details className="rounded-2xl border border-[#dce7e5] bg-white p-4">
              <summary className="cursor-pointer text-sm font-bold text-[#456367]">Add order notes <span className="font-normal text-[#718487]">(optional)</span></summary>
              <label className="sr-only" htmlFor="order-notes">Order notes</label>
              <textarea id="order-notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} rows={3} className="mt-3 w-full rounded-xl border border-[#cedfdd] p-3 font-normal outline-none focus:border-[#64d4ad]" placeholder="Delivery instructions, contact person, or urgency" />
            </details>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="rounded-2xl border border-[#dce7e5] bg-white p-4 text-sm font-bold text-[#456367]">Order priority<select value={priority} onChange={(event) => setPriority(event.target.value as 'normal' | 'high' | 'urgent')} className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] bg-white px-3 font-normal text-[#173239]"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
              <label className="rounded-2xl border border-[#dce7e5] bg-white p-4 text-sm font-bold text-[#456367]">Promised delivery <span className="font-normal text-[#718487]">(optional)</span><input type="date" value={expectedDeliveryDate} onChange={(event) => setExpectedDeliveryDate(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] bg-white px-3 font-normal text-[#173239]" /></label>
            </div>
            <label className="flex items-start gap-3 rounded-2xl border border-[#dce7e5] bg-white p-4 text-sm text-[#456367]"><input type="checkbox" checked={saveOnDevice} disabled={draftState === 'pending'} onChange={(event) => changeTrustedDevice(event.target.checked)} className="mt-1 size-4 accent-[#277b69]" /><span><strong className="block text-[#274b50]">Save this draft on this device</strong>Use this only on a trusted device. Unsubmitted drafts expire after seven days. Pending orders and orders needing attention stay saved until sent or discarded. Product and customer search is also retained for restart recovery.</span></label>
            {customerName.trim() || lines.length > 0 ? <p aria-live="polite" className={`rounded-xl px-4 py-3 text-sm font-semibold ${draftState === 'error' ? 'bg-[#fff0ef] text-[#8d3a34]' : draftState === 'pending' ? 'bg-[#fff7e8] text-[#805b20]' : 'bg-[#edf7f4] text-[#456367]'}`}>{draftState === 'pending' ? 'Waiting to send. Your order is safe on this device.' : draftState === 'error' ? 'Draft needs attention before it can be sent.' : saveOnDevice ? 'Draft saved on this device.' : 'Draft is kept only while this form remains open.'}</p> : null}
            {initialDraft ? <button type="button" onClick={discardSavedOrder} className="min-h-10 rounded-xl px-4 text-sm font-bold text-[#9a4e47] hover:bg-[#fff0ef]">Discard saved order</button> : null}
            {error ? <p role="alert" className="rounded-xl border border-[#efbbb6] bg-[#fff0ef] px-4 py-3 text-sm text-[#8d3a34]">{error}</p> : null}
          </div>
          <footer className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-[#dce7e5] bg-white/95 px-5 py-4 backdrop-blur"><p className="text-xs text-[#718487]">{lines.length} product{lines.length === 1 ? '' : 's'} · {lines.some((line) => !line.item) ? 'product needs replacement' : draftState === 'pending' ? 'waiting to send' : saveOnDevice ? 'draft protected' : 'ready to save'}</p><button type="submit" disabled={submitting || lines.length === 0 || lines.some((line) => !line.item)} className="min-h-12 rounded-xl bg-[#092f36] px-6 font-extrabold text-white hover:bg-[#0d4549] disabled:opacity-50">{submitting ? 'Saving…' : draftState === 'pending' || draftState === 'error' ? 'Retry order' : 'Save order'}</button></footer>
        </form>
      </dialog>
    </div>
  );
}

function CustomerAccountPreview({ customer, history, state, onViewOrders }: { customer: CustomerDirectoryEntry; history: { orders: OrderSummary[]; total: number } | null; state: 'idle' | 'loading' | 'error'; onViewOrders: () => void }) {
  return <section aria-label="Customer account" className="mt-2 rounded-xl border border-[#dce7e5] bg-[#fbfcfb] p-3 text-xs font-normal">
    <div className="flex items-start justify-between gap-3"><div><strong className="block text-sm text-[#274b50]">Customer account</strong><span className="mt-1 block text-[#718487]">{[customer.city, customer.phone].filter(Boolean).join(' · ') || 'Contact details unavailable in Tally'}</span></div>{history ? <button type="button" onClick={onViewOrders} className="min-h-9 shrink-0 rounded-lg border border-[#cedfdd] bg-white px-3 font-bold text-[#31585d]">View all orders</button> : null}</div>
    {customer.tallyBalance !== undefined && customer.tallyBalance !== null ? <p className="mt-2 rounded-lg bg-[#f2f7f6] px-3 py-2 text-[#456367]">Read-only Tally ledger balance: <strong>₹{customer.tallyBalance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong>{customer.balanceAsOf ? ` · as of ${new Date(customer.balanceAsOf).toLocaleString('en-IN')}` : ''}</p> : null}
    {state === 'loading' ? <p className="mt-2 text-[#718487]">Loading this customer’s order history…</p> : null}
    {state === 'error' ? <p className="mt-2 rounded-lg bg-[#fff7e8] px-3 py-2 text-[#805b20]">Order history is unavailable right now. You can still save this order.</p> : null}
    {history ? <details className="mt-2"><summary className="cursor-pointer font-bold text-[#456367]">Previous orders ({history.total})</summary>{history.orders.length ? <ul className="mt-2 divide-y divide-[#e3ecea]">{history.orders.map((order) => <li key={order.id} className="flex items-center justify-between gap-3 py-2"><span><strong className="block text-[#274b50]">{order.orderNumber}</strong><small className="text-[#718487]">{new Date(order.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} · {orderStage(order.status)}</small></span><span className="shrink-0 font-bold text-[#456367]">{formatQuantity(order.totalQuantity)} qty</span></li>)}</ul> : <p className="mt-2 text-[#718487]">No previous orders found.</p>}{history.total > history.orders.length ? <p className="mt-2 text-[#718487]">Showing the latest {history.orders.length} orders.</p> : null}</details> : null}
  </section>;
}

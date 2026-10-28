'use client';

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUp, CircleCheck, Clock, Flame, Info, PackageX, PhoneCall, ReceiptText, ShieldAlert, ShieldCheck, ShieldQuestionMark, TriangleAlert, Truck, UserCheck } from 'lucide-react';
import type {
  CatalogItem,
  CustomerDirectoryEntry,
  DeliveryException,
  EquipmentInstallation,
  OrderBootstrap,
  OrderCommand,
  OrderEvent,
  OrderSummary,
} from '@/lib/order-types';
import { billingHandoffText, customerBalanceFreshness, customerDeliveryAddresses, customerPhoneHref, filterOrders, orderAttentionReasons, orderBackOrderedQuantity, orderDeliveryReminder, orderEventDescription, orderFollowUpReminder, orderMatchesCaptureDateRange, orderNextOwnerLabel, orderOperationsText, orderStage, repeatOrderTemplate, searchCatalog, searchCustomers, tallyInvoiceLineReconciliation, tallyInvoiceReconciliationDetail } from '@/lib/order-types';
import { nextStatus, nextStepFor } from '@/lib/order-next-step';
import { orderListUrl } from '@/lib/order-list-query';
import { offlineDraftRecoveryError, pinProtectedOfflineDevice, readOfflineDraftConsent, readOfflineOrderDraft, removeOfflineOrderDraft, restoreOfflineDraftLines, updateOfflineDraftState, writeOfflineDraftConsent, writeOfflineOrderDraft, type OfflineDraftState } from '@/lib/offline-order-drafts';
import { readCatalogCache, removeCatalogCache, writeCatalogCache } from '@/lib/catalog-cache';
import { readCustomerCache, removeCustomerCache, writeCustomerCache } from '@/lib/customer-cache';
import { applyCreatedOrderAcknowledgement, applyOrderAcknowledgement } from '@/lib/order-acknowledgement';
import { confirmedOrderNumber, OrderSubmissionError, orderSubmissionError, orderSubmissionTimeoutMs, recoverAcceptedOrder, retryableOrderSubmissionFailure } from '@/lib/order-submission';
import { loadOrderBootstrap } from '@/lib/order-bootstrap-cache';
import { startOrderLiveRefresh } from '@/lib/order-live-refresh';
import { retryPendingOfflineOrder } from '@/lib/offline-order-retry';
import { acknowledgeOrderCommand, prepareOrderCommandRetry } from '@/lib/order-command-idempotency';
import { loadOrderCatalog, loadOrderCustomers } from '@/lib/order-capture-masters';
import { recordOrderClientTiming } from '@/lib/order-client-timing';
import { PRICE_CHANGE_ROLES, type OrderPricingWorkspace, type PricingLineResolution } from '@/lib/pricing-types';
import { PricingOptions } from './pricing-options';
import { ProductRequest } from './product-request';
import { BackIcon, ChevronDownIcon, CompactOrderRow, OrderFlagBadge, OrderProgress, OrderStageChips, orderStageStyle, snapshotTimeLabel, type StageFilter } from './order-list';
import { deliveredTodayOrders, groupOrdersForList } from '@/lib/order-list-groups';
import { readJsonBody } from '@/lib/http-json';
import { orderDateLabel, orderDateTime } from '@/lib/order-date';
import { PriceApprovalCard } from './price-approval-card';
import { BillingSheetPanel } from './billing-sheet-panel';
import { RateCheckPanel, useRateCheck } from './rate-check-panel';
import { rateCheckBadge, RATE_CHECK_ROLES, RATE_CHECK_STATUSES } from '@/lib/rate-check';
import { BILLING_ROLES, BILLING_STATUSES } from '@/lib/billing-sheet';
import { courierChoices, defaultReceiver, isLocalDelivery, istToday, LOCAL_DELIVERY, type DispatchMode } from '@/lib/dispatch-options';
import { hasAnyStockFlowRole, type StockFlowRole } from '@/lib/user-types';
import { canAddOrderNotes, canBillChallan, canSendOnChallan, canCreateOrders, canEditOrders, canManageDeliveryExceptions, canManageInstallations, canRecordFulfilment } from '@/lib/order-permissions';
import type { TallyRecentProducts } from '@/lib/tally-recent-products';

type DraftLine = { tallyKey: string; item: CatalogItem | null; quantity: number };

function istDaysAgo(days: number) {
  const date = new Date(`${istToday()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function openOrderDays(order: OrderSummary) {
  if (['delivered', 'cancelled'].includes(order.status)) return 0;
  const created = new Date(order.createdAt);
  if (!Number.isFinite(created.getTime())) return 0;
  const createdDay = created.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return Math.floor((Date.parse(`${istToday()}T00:00:00Z`) - Date.parse(`${createdDay}T00:00:00Z`)) / 86_400_000);
}

// Retain the exact command after an ambiguous failure, even if the sheet is closed.
function useChallanCommand(order: OrderSummary, onChanged: () => Promise<void>) {
  const pending = useRef<{ action: 'send_on_challan' | 'bill_challan'; payload: Record<string, unknown> } | null>(null);
  const [hasPending, setHasPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(action: 'send_on_challan' | 'bill_challan', number: string) {
    if (busy) return false;
    setBusy(true); setError('');
    if (!pending.current) pending.current = { action, payload: { orderId: order.id, expectedVersion: order.version, [action === 'send_on_challan' ? 'challanNumber' : 'invoiceNumber']: number.trim(), idempotencyKey: crypto.randomUUID() } };
    setHasPending(true);
    try {
      const response = await fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pending.current) });
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429)) { pending.current = null; setHasPending(false); }
      await readResponse(response);
      await onChanged();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save challan details');
      return false;
    } finally { setBusy(false); }
  }
  return { busy, error, submit, pending: hasPending };
}
// A null draft means no customer is selected; callers supply only that customer's history.
export function findPossibleRepeat(lines: readonly { tallyKey: string }[] | null, recentOrders: readonly OrderSummary[], today: Date) {
  if (!lines?.length) return null;
  const keys = new Set(lines.map((line) => line.tallyKey));
  const now = today.getTime();
  let best: { order: OrderSummary; items: OrderSummary['lines'] } | null = null;
  for (const order of recentOrders) {
    const created = Date.parse(order.createdAt);
    if (order.status === 'delivered' || order.status === 'cancelled' || !Number.isFinite(created) || created > now || now - created > 7 * 24 * 60 * 60 * 1000) continue;
    const seen = new Set<string>();
    const items = order.lines.filter((line) => {
      if (!keys.has(line.tallyKey) || seen.has(line.tallyKey)) return false;
      seen.add(line.tallyKey);
      return true;
    });
    if (items.length && (!best || items.length > best.items.length || items.length === best.items.length && created > Date.parse(best.order.createdAt))) best = { order, items };
  }
  return best;
}

type OrderEntryPrice = { tallyKey: string; currentPrice: number | null; currentPriceSource: string; riskStatus: 'GREEN' | 'AMBER' | 'RED'; recommendationReason?: string };
type CreatedOrderResult = { orderId?: string; orderNumber?: string; status?: string; version?: number };
type CreatedOrderCommand = Extract<OrderCommand, { action: 'create_order' }>;
const desktopControlCenterQuery = '(min-width: 1024px)';

function subscribeDesktopControlCenter(callback: () => void) {
  const media = window.matchMedia(desktopControlCenterQuery);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

function desktopControlCenterSnapshot() {
  return window.matchMedia(desktopControlCenterQuery).matches;
}
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


function formatQuantity(value: number) {
  return Math.round(Number(value || 0)).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function statusLabel(status: string) {
  return statusNames[status] || status.replaceAll('_', ' ');
}

const queueNames: Record<string, string> = {
  open: 'Active orders', history: 'Old orders', attention: 'Orders needing attention', billing: 'Tally billing queue', billing_attention: 'Billing attention',
  awaiting_confirmation: 'Orders awaiting confirmation', awaiting_approval: 'Orders awaiting approval', confirmed: 'Confirmed orders', picking: 'Pick & pack queue', packed: 'Packed orders',
  awaiting_tally_billing: 'Orders awaiting Tally billing', dispatch_ready: 'Ready for dispatch', dispatched: 'Dispatched orders', follow_up_due: 'Follow-ups due', follow_up_upcoming: 'Upcoming follow-ups',
  delivery_attention: 'Delivery attention', delivery_due_today: 'Deliveries due today', delivery_due_soon: 'Deliveries due in 7 days', back_ordered: 'Partial fulfilment / back-orders',
  delivery_exception: 'Open delivery exceptions', priority_urgent: 'Urgent orders', priority_high: 'High-priority orders', overdue: 'Overdue deliveries', cancelled: 'Cancelled orders', all: 'All orders',
};

async function readResponse<T>(response: Response): Promise<T> {
  const body = await readJsonBody<T & { error?: string }>(response);
  if (!response.ok) throw new Error(body.error || 'Unable to complete the request');
  return body;
}

export function OrderWorkspace({ actorEmail, initialStatus = 'open', initialQuery = '', focusOrder, newOrderIds, onOrderActed }: {
  actorEmail: string;
  initialStatus?: string;
  initialQuery?: string;
  /** Open this exact order (from a notification). Found through the server's own access-checked list; fails closed. */
  focusOrder?: { orderId: string; orderNumber: string };
  /** Orders newly handed to this person by the frame's work notifications; tagged "New". */
  newOrderIds?: ReadonlySet<string>;
  /** Told about orders this person just moved or created, so their own hand-off is never announced back to them. */
  onOrderActed?: (orderId: string) => void;
}) {
  const [data, setData] = useState<OrderBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [focusNotice, setFocusNotice] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeOrderNumber, setNoticeOrderNumber] = useState('');
  const [query, setQuery] = useState(focusOrder?.orderNumber || initialQuery);
  const [pendingFocusId, setPendingFocusId] = useState(focusOrder?.orderId || '');
  const [captureDate, setCaptureDate] = useState('');
  const [captureDateTo, setCaptureDateTo] = useState('');
  const [status, setStatus] = useState(focusOrder ? 'all' : initialStatus);
  const [pricesToApprove, setPricesToApprove] = useState(false);
  const [creating, setCreating] = useState(false);
  const [repeatOrder, setRepeatOrder] = useState<OrderSummary | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [deviceDraftState, setDeviceDraftState] = useState<OfflineDraftState | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [openOrderId, setOpenOrderId] = useState('');
  const [retainedOpenOrder, setRetainedOpenOrder] = useState<OrderSummary | null>(null);
  const [deliveredToday, setDeliveredToday] = useState<OrderSummary[]>([]);
  const [deliveredRefresh, setDeliveredRefresh] = useState(0);
  const desktopControlCenter = useSyncExternalStore(subscribeDesktopControlCenter, desktopControlCenterSnapshot, () => false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const orderPageRef = useRef<HTMLDialogElement>(null);
  const dataRef = useRef<OrderBootstrap | null>(null);
  const retryingDraftRef = useRef(false);
  const pendingCommandKeysRef = useRef(new Map<string, string>());
  const latestListRequestRef = useRef(0);
  const openingOrderRequestRef = useRef(0);
  const mutationInFlightRef = useRef(false);
  const liveStateRef = useRef({ ready: false, creating: false, loading: true });
  useEffect(() => {
    liveStateRef.current = { ready: data !== null, creating, loading };
    if (creating) latestListRequestRef.current += 1;
  }, [data, creating, loading]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const load = useCallback(async (showLoading = false, showRefreshing = false, propagateFailure = false) => {
    const startedAt = performance.now();
    const requestId = ++latestListRequestRef.current;
    if (showLoading) setLoading(true);
    if (showRefreshing) setRefreshing(true);
    setError('');
    try {
      const result = await readResponse<OrderBootstrap>(await fetch(orderListUrl({ page, query, status, captureDate, captureDateTo }), { cache: 'no-store' }));
      if (requestId !== latestListRequestRef.current) return;
      recordOrderClientTiming('order_list_ms', startedAt);
      setData(result);
      setDeliveredRefresh((value) => value + 1);
      setDeviceDraftState(readOfflineOrderDraft(localStorage, result.actor.email)?.state || null);
    } catch (cause) {
      if (requestId === latestListRequestRef.current) setError(cause instanceof Error ? cause.message : 'Unable to load orders');
      if (propagateFailure) throw cause;
    } finally {
      if (requestId === latestListRequestRef.current) {
        if (showLoading) setLoading(false);
        if (showRefreshing) setRefreshing(false);
      }
    }
  }, [captureDate, captureDateTo, page, query, status]);

  useEffect(() => {
    const service = startOrderLiveRefresh({
      fetchSummary: (signal) => fetch('/api/orders?summary=1', { cache: 'no-store', signal }),
      online: () => navigator.onLine,
      active: () => document.visibilityState !== 'hidden',
      canRefresh: () => liveStateRef.current.ready && !liveStateRef.current.creating && !liveStateRef.current.loading && !mutationInFlightRef.current,
      refresh: () => load(false, false, true),
      onError: setError,
    });
    document.addEventListener('visibilitychange', service.wake);
    window.addEventListener('online', service.wake);
    window.addEventListener('focus', service.wake);
    return () => {
      service.stop();
      document.removeEventListener('visibilitychange', service.wake);
      window.removeEventListener('online', service.wake);
      window.removeEventListener('focus', service.wake);
    };
  }, [actorEmail, load]);

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
          setNoticeOrderNumber(result.orderNumber);
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
    if (initialStatus !== 'open' || initialQuery || focusOrder) return;
    const startedAt = performance.now();
    let active = true;
    const requestId = ++latestListRequestRef.current;
    loadOrderBootstrap(actorEmail)
      .then((result) => {
        if (active && requestId === latestListRequestRef.current) {
          recordOrderClientTiming('order_list_ms', startedAt);
          setData(result);
          setDeviceDraftState(readOfflineOrderDraft(localStorage, result.actor.email)?.state || null);
        }
      })
      .catch((cause: unknown) => {
        if (active && requestId === latestListRequestRef.current) {
          setError(cause instanceof Error ? cause.message : 'Unable to load orders');
        }
      })
      .finally(() => {
        if (active && requestId === latestListRequestRef.current) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [actorEmail, initialStatus, initialQuery, focusOrder]);

  const firstFilterRun = useRef(true);
  useEffect(() => {
    if (firstFilterRun.current) {
      firstFilterRun.current = false;
      if (page === 1 && !query && !captureDate && !captureDateTo && status === 'open') return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const startedAt = performance.now();
      const requestId = ++latestListRequestRef.current;
      setLoading(true);
      setError('');
      fetch(orderListUrl({ page, query, status, captureDate, captureDateTo }), { cache: 'no-store', signal: controller.signal })
        .then((response) => readResponse<OrderBootstrap>(response))
        .then((result) => {
          if (requestId !== latestListRequestRef.current) return;
          recordOrderClientTiming('order_list_ms', startedAt);
          setData(result);
          setDeviceDraftState(readOfflineOrderDraft(localStorage, result.actor.email)?.state || null);
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted && requestId === latestListRequestRef.current) setError(cause instanceof Error ? cause.message : 'Unable to load orders');
        })
        .finally(() => {
          if (!controller.signal.aborted && requestId === latestListRequestRef.current) setLoading(false);
        });
    }, query ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [actorEmail, captureDate, captureDateTo, page, query, status]);

  // Active = every pending order plus orders delivered today (IST). Older delivered and cancelled orders live in History.
  // Delivered-today rows come from page 1 of History (newest captured first), so an old order delivered today can be missed.
  const showsDeliveredToday = status === 'open' && page === 1 && !query && !captureDate && !captureDateTo;
  useEffect(() => {
    if (!showsDeliveredToday) return;
    const controller = new AbortController();
    fetch(orderListUrl({ page: 1, query: '', status: 'history', captureDate: '', captureDateTo: '' }), { cache: 'no-store', signal: controller.signal })
      .then((response) => readResponse<OrderBootstrap>(response))
      .then((result) => setDeliveredToday(deliveredTodayOrders(result.orders || [])))
      .catch(() => undefined);
    return () => controller.abort();
  }, [showsDeliveredToday, deliveredRefresh]);

  const loadedOrders = useMemo(() => data?.orders || [], [data]);
  const visibleOrders = useMemo(() => pricesToApprove && status === 'open' ? loadedOrders.filter((order) => order.pricingState === 'approval_required') : loadedOrders, [loadedOrders, pricesToApprove, status]);
  const orderGroups = useMemo(() => groupOrdersForList(visibleOrders, showsDeliveredToday ? deliveredToday : []), [visibleOrders, showsDeliveredToday, deliveredToday]);
  const displayedOrders = useMemo(() => orderGroups.flatMap((group) => group.orders), [orderGroups]);
  const openOrder = openOrderId ? displayedOrders.find((order) => order.id === openOrderId) || (retainedOpenOrder?.id === openOrderId ? retainedOpenOrder : undefined) : undefined;
  const orderPageId = !desktopControlCenter ? openOrder?.id : undefined;

  useEffect(() => {
    const dialog = orderPageRef.current;
    if (!dialog || !orderPageId) return;
    if (!dialog.open) dialog.showModal();
    return () => dialog.close();
  }, [orderPageId]);

  // Exact-order opening from a notification: the order is looked up through the normal, access-checked list
  // (search by its number across all statuses) and matched by ID. Not found means not visible to this person.
  if (pendingFocusId && !loading && data) {
    setPendingFocusId('');
    if (!displayedOrders.some((order) => order.id === pendingFocusId)) {
      setFocusNotice(`Order ${focusOrder?.orderNumber || ''} is not available to you, or it no longer exists.`);
      setQuery('');
      setStatus(initialStatus);
    }
    else if (desktopControlCenter) setSelectedOrderId(pendingFocusId);
    else setOpenOrderId(pendingFocusId);
  }
  const currentPage = data?.pagination?.page || page;
  const pageCount = data?.pagination?.pageCount || 1;
  const totalOrders = data?.pagination?.total ?? visibleOrders.length;
  const selectedOrder = displayedOrders.find((order) => order.id === selectedOrderId) || displayedOrders[0];
  const selectedOrderIndex = selectedOrder ? displayedOrders.findIndex((order) => order.id === selectedOrder.id) : -1;

  function moveDesktopSelectionAfter(orderId: string) {
    if (!desktopControlCenter) return;
    const completedIndex = displayedOrders.findIndex((order) => order.id === orderId);
    const nextOrder = displayedOrders[completedIndex + 1] || displayedOrders[completedIndex - 1];
    if (nextOrder) {
      setSelectedOrderId(nextOrder.id);
      window.requestAnimationFrame(() => document.getElementById(`desktop-order-${nextOrder.id}`)?.focus());
    }
  }

  function navigateDesktopQueue(key: string) {
    if (!displayedOrders.length) return;
    const currentIndex = selectedOrderIndex < 0 ? 0 : selectedOrderIndex;
    const targetIndex = key === 'Home' ? 0 : key === 'End' ? displayedOrders.length - 1 : key === 'ArrowUp' ? Math.max(0, currentIndex - 1) : Math.min(displayedOrders.length - 1, currentIndex + 1);
    const targetId = displayedOrders[targetIndex].id;
    setSelectedOrderId(targetId);
    window.requestAnimationFrame(() => document.getElementById(`desktop-order-${targetId}`)?.focus());
  }

  function exportVisibleOrders() {
    if (!totalOrders) return;
    const link = document.createElement('a');
    link.href = orderListUrl({ page: 1, query, status, captureDate, captureDateTo }, true);
    link.click();
  }

  async function openNewOrder(template?: OrderSummary) {
    if (catalogLoading) return;
    const requestId = ++openingOrderRequestRef.current;
    const startedAt = performance.now();
    setError('');
    setCatalogLoading(true);
    let current = dataRef.current;
    try {
      if (!current) {
        current = await loadOrderBootstrap(actorEmail);
        if (requestId !== openingOrderRequestRef.current) return;
        dataRef.current = current;
        setData(current);
        setDeviceDraftState(readOfflineOrderDraft(localStorage, current.actor.email)?.state || null);
      }
    } catch (cause) {
      if (requestId === openingOrderRequestRef.current) {
        setError(cause instanceof Error ? cause.message : 'Unable to load order capture');
        setCatalogLoading(false);
      }
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
      if (requestId !== openingOrderRequestRef.current) return;
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
      recordOrderClientTiming('order_open_ms', startedAt);
    } catch (cause) {
      if (requestId === openingOrderRequestRef.current) setError(cause instanceof Error ? cause.message : 'Unable to load Tally customers and products');
    } finally {
      if (requestId === openingOrderRequestRef.current) setCatalogLoading(false);
    }
  }

  function cancelOrderPreparation() {
    openingOrderRequestRef.current += 1;
    setCatalogLoading(false);
  }

  function warmOrderCapture() {
    const current = dataRef.current;
    if (!current) return;
    const catalogVersion = current.snapshot.catalogVersion || current.snapshot.fetchedAt;
    const customerVersion = current.customerVersion || '';
    const trustedDevice = readOfflineDraftConsent(localStorage, current.actor.email);
    const cachedCatalog = readCatalogCache(sessionStorage, current.actor.email, catalogVersion) || (trustedDevice ? readCatalogCache(localStorage, current.actor.email, catalogVersion) : null);
    const cachedCustomers = readCustomerCache(sessionStorage, current.actor.email, customerVersion) || (trustedDevice ? readCustomerCache(localStorage, current.actor.email, customerVersion) : null);
    if (!cachedCatalog) void loadOrderCatalog(actorEmail, catalogVersion).catch(() => undefined);
    if (!cachedCustomers) void loadOrderCustomers(actorEmail, customerVersion).catch(() => undefined);
  }

  async function runCommand(command: OrderCommand, success: string) {
    mutationInFlightRef.current = true;
    // A list read started before this command must not overwrite its acknowledgement.
    latestListRequestRef.current += 1;
    const scrollTop = workspaceRef.current?.scrollTop;
    const prepared = prepareOrderCommandRetry(command, pendingCommandKeysRef.current, undefined, actorEmail);
    setError('');
    setNotice('');
    setNoticeOrderNumber('');
    try {
      const result = await readResponse<{ orderId?: string; status?: string; version?: number; exceptionId?: string; installationId?: string }>(
        await fetch('/api/orders', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(prepared.command),
        }),
      );
      acknowledgeOrderCommand(prepared.identity, pendingCommandKeysRef.current);
      setDeliveredRefresh((value) => value + 1);
      setNotice(success);
      const acknowledgedOrderId = 'orderId' in prepared.command.payload ? prepared.command.payload.orderId : '';
      if (acknowledgedOrderId) onOrderActed?.(acknowledgedOrderId);
      const acknowledgedOrder = dataRef.current?.orders.find((order) => order.id === acknowledgedOrderId);
      setNoticeOrderNumber(acknowledgedOrder?.orderNumber || '');
       if (openOrder && dataRef.current) {
         const retained = applyOrderAcknowledgement({ ...dataRef.current, orders: [openOrder] }, prepared.command, result)?.orders[0];
         if (retained) setRetainedOpenOrder(retained);
       }
       const patched = dataRef.current ? applyOrderAcknowledgement(dataRef.current, prepared.command, result) : null;
       if (patched) {
         const updatedOpenOrder = patched.orders.find((order) => order.id === openOrderId);
         if (updatedOpenOrder) setRetainedOpenOrder(updatedOpenOrder);
         const remainingOrders = filterOrders(patched.orders, query, status).filter((order) => orderMatchesCaptureDateRange(order, captureDate, captureDateTo));
         const removedFromQueue = patched.orders.length - remainingOrders.length;
         const reconciled = removedFromQueue && patched.pagination ? {
           ...patched,
           orders: remainingOrders,
           pagination: {
             ...patched.pagination,
             total: Math.max(0, patched.pagination.total - removedFromQueue),
             pageCount: Math.max(1, Math.ceil(Math.max(0, patched.pagination.total - removedFromQueue) / patched.pagination.pageSize)),
           },
         } : { ...patched, orders: remainingOrders };
         dataRef.current = reconciled;
         setData(reconciled);
         if (removedFromQueue && remainingOrders.length === 0 && (reconciled.pagination?.total || 0) > 0) window.setTimeout(() => void load(), 0);
       }
      else await load();
       window.requestAnimationFrame(() => {
         if (workspaceRef.current && scrollTop !== undefined) workspaceRef.current.scrollTop = scrollTop;
       });
       return true;
     } catch (cause) {
       setError(cause instanceof Error ? cause.message : 'Unable to update order');
       return false;
     } finally {
       mutationInFlightRef.current = false;
     }
   }

  async function advance(order: OrderSummary, tallyInvoiceNumber?: string) {
    const action = nextStatus[order.status];
    if (!action) return;
    const completed = await runCommand(
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
    if (!completed) throw new Error('Order could not be moved. Please try again.');
    if (completed) moveDesktopSelectionAfter(order.id);
  }

  async function cancelOrder(order: OrderSummary, reason: string) {
    const completed = await runCommand(
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
    if (completed) moveDesktopSelectionAfter(order.id);
  }

  /** Record what was packed (keeping the delivery address and date), then mark the order packed. */
  async function packOrder(order: OrderSummary, lines: Array<{ tallyKey: string; fulfilledQuantity: number }>) {
    const saved = await runCommand({ action: 'save_fulfilment', payload: { orderId: order.id, expectedVersion: order.version, deliveryAddress: order.deliveryAddress ?? '', expectedDeliveryDate: order.expectedDeliveryDate || undefined, lines } }, `${order.orderNumber} packed quantities saved.`);
    if (!saved) throw new Error('Packed quantities could not be saved. Refresh and try again.');
    // The fulfilment save advances the order version by exactly one.
    await advance({ ...order, version: order.version + 1 });
  }
  async function saveFulfilment(order: OrderSummary, payload: Extract<OrderCommand, { action: 'save_fulfilment' }>['payload']) {
    await runCommand({ action: 'save_fulfilment', payload }, `${order.orderNumber} fulfilment details saved.`);
  }
  async function editOrder(order: OrderSummary, payload: Extract<OrderCommand, { action: 'edit_order' }>['payload']) {
    await runCommand({ action: 'edit_order', payload }, `${order.orderNumber} updated.`);
  }

  async function updateDelivery(order: OrderSummary, command: Extract<OrderCommand, { action: 'save_dispatch' | 'confirm_delivery' }>) {
    const completed = await runCommand(command, command.action === 'save_dispatch' ? `${order.orderNumber} marked dispatched.` : `${order.orderNumber} delivery confirmed.`);
    if (!completed) throw new Error('Delivery details could not be saved. Please try again.');
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
  async function addOrderNote(order: OrderSummary, note: string) {
    await runCommand({ action: 'add_order_note', payload: { orderId: order.id, expectedVersion: order.version, note } }, `${order.orderNumber} note added.`);
  }
  async function setOrderPriority(order: OrderSummary, priority: 'normal' | 'high' | 'urgent') {
    await runCommand({ action: 'set_order_priority', payload: { orderId: order.id, expectedVersion: order.version, priority } }, `${order.orderNumber} priority updated.`);
  }

  async function setOrderAssignee(order: OrderSummary, assignedToEmail?: string) {
    await runCommand({ action: 'set_order_assignee', payload: { orderId: order.id, expectedVersion: order.version, assignedToEmail } }, assignedToEmail ? `${order.orderNumber} assigned.` : `${order.orderNumber} assignment cleared.`);
  }

  async function updateOrderFollowUp(order: OrderSummary, command: Extract<OrderCommand, { action: 'set_order_follow_up' | 'complete_order_follow_up' }>) {
    await runCommand(command, command.action === 'set_order_follow_up' ? `${order.orderNumber} follow-up scheduled.` : `${order.orderNumber} follow-up completed.`);
  }

  const operations = data?.operations || {};
  const staleText = data?.snapshot.fetchedAt || 'No Tally snapshot';
  const actorRoles = data?.actor.roles ?? data?.actor.role;
  const approvalCount = status === 'open' && hasAnyStockFlowRole(actorRoles, ['administrator', 'management']) ? loadedOrders.filter((order) => order.pricingState === 'approval_required').length : 0;
  // After the last waiting price is approved the chip disappears; fall back to the Active list.
  if (pricesToApprove && data && approvalCount === 0) setPricesToApprove(false);
  const stageFilters: StageFilter[] = [
    { status: 'open', label: 'Active' },
    { status: 'recent', label: 'Recent' },
    { status: 'priority_high', label: 'Urgent & high' },
    ...(canBillChallan(actorRoles) && (operations.challanUnbilled ?? 0) > 0 ? [{ status: 'challan_unbilled', label: 'Challans to bill', count: operations.challanUnbilled }] : []),
    ...(approvalCount > 0 ? [{ status: 'prices_to_approve', label: 'Prices to approve', count: approvalCount, tone: 'warning' as const }] : []),
    { status: 'awaiting_confirmation', label: 'Confirm', count: operations.awaitingConfirmation, tone: 'confirm' },
    { status: 'picking', label: 'Pack', tone: 'pack' },
    { status: 'billing', label: 'Bill', count: operations.awaitingTallyBilling, tone: 'bill' },
    { status: 'dispatch_ready', label: 'Dispatch', count: operations.billedNotDispatched, tone: 'dispatch' },
    { status: 'attention', label: 'Issues', count: operations.needsAttention, tone: 'alert' },
  ];
  const activeStage = status === 'open' && captureDate === istDaysAgo(6) && !captureDateTo && !query ? 'recent'
    : pricesToApprove && status === 'open' ? 'prices_to_approve'
    : status;
  const yourQueue = hasAnyStockFlowRole(actorRoles, ['administrator', 'management']) ? 'awaiting_confirmation' : hasAnyStockFlowRole(actorRoles, ['accounts']) ? 'billing' : hasAnyStockFlowRole(actorRoles, ['warehouse']) ? 'picking' : '';
  function showQueue(queue: string) {
    setFocusNotice('');
    if (queue === 'prices_to_approve') {
      if (pricesToApprove) { setPricesToApprove(false); setStatus('open'); }
      else { setPricesToApprove(true); setStatus('open'); }
      setQuery(''); setCaptureDate(''); setCaptureDateTo(''); setPage(1);
      return;
    }
    setPricesToApprove(false);
    setStatus(queue === 'recent' ? 'open' : queue); setQuery(''); setCaptureDate(queue === 'recent' ? istDaysAgo(6) : ''); setCaptureDateTo(''); setPage(1);
  }
  function openOrderDetail(order: OrderSummary) {
    if (desktopControlCenter) setSelectedOrderId(order.id);
    else setOpenOrderId(order.id);
  }
  const orderRowProps = {
    actorRole: data?.actor.role || '',
    actorRoles: data?.actor.roles,
    actorEmail: data?.actor.email || actorEmail,
    tallyInvoices: data?.snapshot.tallyInvoices,
    tallySnapshotFetchedAt: data?.snapshot.fetchedAt,
    onAdvance: advance,
    onCancel: cancelOrder,
    onSaveFulfilment: saveFulfilment,
    onPack: packOrder,
    onDelivery: updateDelivery,
    onEdit: editOrder,
    onException: updateException,
    onInstallation: updateInstallation,
    onBillingReview: recordBillingReview,
    onAddNote: addOrderNote,
    onRepeat: (order: OrderSummary) => { setOpenOrderId(''); void openNewOrder(order); },
    onFindCustomer: (order: OrderSummary) => { setFocusNotice(''); setOpenOrderId(''); setQuery(`customer:${order.customerName}`); setStatus('all'); setCaptureDate(''); setCaptureDateTo(''); setPage(1); },
    onSetPriority: setOrderPriority,
    onSetAssignee: setOrderAssignee,
    onFollowUp: updateOrderFollowUp,
    onPricingChanged: () => load(false, true),
  };

  return (
    <div ref={workspaceRef} className="h-full overflow-y-auto bg-sf-page">
      <div className="mx-auto max-w-7xl px-3 pb-6 sm:px-6 lg:px-8">
        <div className="sticky top-0 z-20 -mx-3 border-b border-sf-line-soft bg-sf-page/95 px-3 pb-2 pt-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 lg:flex lg:flex-wrap lg:items-center lg:gap-x-3 lg:gap-y-2">
        <header className="flex items-center justify-between gap-2 lg:contents">
          <div className="min-w-0 lg:order-1">
            <h1 className="text-xl font-black tracking-tight text-sf-ink sm:text-2xl">
              Orders
            </h1>
            <p className="hidden">
              Confirm orders, send packed orders to Tally billing, then dispatch.
            </p>
          </div>
          <div className="relative flex shrink-0 items-center gap-2 lg:order-4 lg:ml-auto">

            {canCreateOrders(actorRoles) ? <button
              type="button"
              onClick={() => void openNewOrder()}
              onFocus={warmOrderCapture}
              onPointerEnter={warmOrderCapture}
              disabled={catalogLoading}
              className="min-h-11 rounded-xl bg-sf-ink px-4 font-bold text-white shadow-sm transition hover:bg-sf-ink-hover disabled:opacity-50"
            >
              {catalogLoading ? 'Loading products…' : deviceDraftState ? 'Continue order' : '+ Order'}
            </button> : null}

          </div>
        </header>
        {deviceDraftState ? <span aria-live="polite" className={`lg:order-5 lg:basis-full mt-1 block text-right text-xs font-bold ${deviceDraftState === 'pending' ? 'text-sf-warning' : deviceDraftState === 'error' ? 'text-sf-danger' : 'text-sf-muted'}`}>{deviceDraftState === 'pending' ? '1 pending order on this device' : deviceDraftState === 'error' ? '1 device draft needs attention' : '1 draft on this device'}</span> : null}

        <div className="mt-2 flex items-center gap-2 lg:order-2 lg:mt-0 lg:w-[22rem] lg:flex-none">
          <div className="relative min-w-0 flex-1">
            <label className="sr-only" htmlFor="order-search">Find existing order</label>
            <input
              id="order-search"
              type="search"
              value={query}
              onChange={(event) => { setFocusNotice(''); setQuery(event.target.value); setPage(1); }}
              placeholder="Search orders"
              className={`min-h-10 w-full rounded-xl border border-sf-line bg-white px-3.5 ${query ? 'pr-16' : ''} text-[15px] outline-none focus:border-sf-accent-bright focus:ring-3 focus:ring-sf-accent-bright/20`}
            />
            {query ? <button type="button" onClick={() => { setFocusNotice(''); setQuery(''); setPage(1); }} className="absolute bottom-0.5 right-1 min-h-9 rounded-lg px-3 text-xs font-bold text-sf-label hover:bg-sf-soft">Clear</button> : null}
          </div>
          <button type="button" aria-pressed={query === `assignee:${actorEmail.toLocaleLowerCase('en-IN')}`} onClick={() => { setFocusNotice(''); setQuery((current) => current === `assignee:${actorEmail.toLocaleLowerCase('en-IN')}` ? '' : `assignee:${actorEmail.toLocaleLowerCase('en-IN')}`); setStatus('open'); setCaptureDate(''); setCaptureDateTo(''); setPage(1); }} className="hidden min-h-10 shrink-0 rounded-xl border border-sf-line bg-white px-3 text-sm font-bold text-sf-body hover:bg-sf-soft aria-pressed:border-sf-accent-bright aria-pressed:bg-sf-accent-soft sm:block">My work</button>
          <button type="button" aria-expanded={mobileFiltersOpen} aria-controls="mobile-order-filters" onClick={() => setMobileFiltersOpen((open) => !open)} className={`flex min-h-10 shrink-0 items-center gap-1 rounded-xl border px-3 text-sm font-bold ${mobileFiltersOpen || !stageFilters.some((filter) => filter.status === status) || captureDate ? 'border-sf-ink bg-sf-ink text-white' : 'border-sf-line bg-white text-sf-body'}`}>Filters <span className={`transition ${mobileFiltersOpen ? 'rotate-180' : ''}`}><ChevronDownIcon /></span></button>
        </div>
        <nav aria-label="Order queues" className="mt-2 lg:order-3 lg:mt-0 lg:min-w-0 lg:flex-1">
          <OrderStageChips filters={stageFilters} active={activeStage} onSelect={showQueue} />
        </nav>
        <div id="mobile-order-filters" className={`${mobileFiltersOpen ? 'grid' : 'hidden'} mt-2 gap-3 rounded-2xl border border-sf-line-soft bg-white p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end lg:order-6 lg:basis-full`}>
          <div><label className="block text-xs font-bold text-sf-muted" htmlFor="order-status">Show orders</label>
          <select
            id="order-status"
            value={status}
            onChange={(event) => { setFocusNotice(''); setStatus(event.target.value); setPage(1); }}
            className="mt-1 block min-h-11 w-full rounded-xl border border-sf-line bg-white px-3 text-sm font-semibold text-sf-strong outline-none focus:border-sf-accent-bright"
          >
            <option value="open">Active orders</option>
            <option value="attention">Needs attention</option>
            <option value="billing">Tally billing queue</option>
            <option value="billing_attention">Billing attention</option>
            <option value="challan_unbilled">Challans to bill</option>
            <option value="history">Old orders</option>
            <option value="all">All orders</option>
            <option value="awaiting_confirmation">Awaiting confirmation</option>
            <option value="awaiting_approval">Awaiting approval</option>
            <option value="confirmed">Confirmed</option>
            <option value="picking">Pick &amp; pack</option>
            <option value="packed">Packed</option>
            <option value="awaiting_tally_billing">Awaiting Tally billing</option>
            <option value="dispatch_ready">Ready for dispatch</option>
            <option value="follow_up_due">Follow-ups due</option>
            <option value="follow_up_upcoming">Upcoming follow-ups</option>
            <option value="delivery_attention">Delivery attention</option>
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
          </div>
          <div className="grid grid-cols-2 gap-2 sm:w-80">
            <label className="text-xs font-bold text-sf-muted">Ordered from<input type="date" value={captureDate} max={captureDateTo || undefined} onChange={(event) => { const nextDate = event.target.value; setCaptureDate(nextDate); if (!nextDate || (captureDateTo && nextDate > captureDateTo)) setCaptureDateTo(''); setPage(1); }} className="mt-1 block min-h-11 w-full rounded-xl border border-sf-line bg-white px-2.5 text-sm font-normal text-sf-strong outline-none focus:border-sf-accent-bright" /></label>
            <label className="text-xs font-bold text-sf-muted">To (optional)<input type="date" value={captureDateTo} min={captureDate || undefined} disabled={!captureDate} onChange={(event) => { setCaptureDateTo(event.target.value); setPage(1); }} className="mt-1 block min-h-11 w-full rounded-xl border border-sf-line bg-white px-2.5 text-sm font-normal text-sf-strong outline-none focus:border-sf-accent-bright disabled:bg-sf-soft disabled:text-sf-faint" /></label>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-sf-soft-2 pt-3 sm:col-span-2">
            <button type="button" aria-pressed={query === `assignee:${actorEmail.toLocaleLowerCase('en-IN')}`} onClick={() => { setFocusNotice(''); setQuery((current) => current === `assignee:${actorEmail.toLocaleLowerCase('en-IN')}` ? '' : `assignee:${actorEmail.toLocaleLowerCase('en-IN')}`); setStatus('open'); setCaptureDate(''); setCaptureDateTo(''); setPage(1); }} className="min-h-10 rounded-full border border-sf-line px-3.5 text-sm font-bold text-sf-body hover:bg-sf-soft aria-pressed:border-sf-ink aria-pressed:bg-sf-ink aria-pressed:text-white sm:hidden">My work</button>
            <button type="button" aria-pressed={query === 'assignee:unassigned'} onClick={() => { setFocusNotice(''); setQuery((current) => current === 'assignee:unassigned' ? '' : 'assignee:unassigned'); setStatus('open'); setCaptureDate(''); setCaptureDateTo(''); setPage(1); }} className="min-h-10 rounded-full border border-sf-line px-3.5 text-sm font-bold text-sf-body hover:bg-sf-soft aria-pressed:border-sf-ink aria-pressed:bg-sf-ink aria-pressed:text-white">Unassigned</button>
            <button type="button" aria-pressed={status === 'history'} onClick={() => showQueue(status === 'history' ? 'open' : 'history')} className="min-h-10 rounded-full border border-sf-line px-3.5 text-sm font-bold text-sf-body hover:bg-sf-soft aria-pressed:border-sf-ink aria-pressed:bg-sf-ink aria-pressed:text-white">Old orders</button>
            <span className="ml-auto flex gap-1">
              <button type="button" onClick={exportVisibleOrders} disabled={!totalOrders} className="min-h-10 rounded-lg px-3 text-sm font-bold text-sf-accent hover:bg-sf-accent-soft disabled:opacity-40">Export</button>
              <button type="button" onClick={() => void load(false, true)} disabled={refreshing} aria-busy={refreshing} className="min-h-10 rounded-lg px-3 text-sm font-bold text-sf-accent hover:bg-sf-accent-soft disabled:opacity-60">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
            </span>
          </div>
        </div>
        </div>

        {notice ? <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-sf-accent-line bg-sf-accent-soft px-4 py-3 text-sm font-semibold text-sf-success"><p>{notice}</p>{noticeOrderNumber ? <button type="button" onClick={() => { setFocusNotice(''); setQuery(noticeOrderNumber); setStatus('all'); setCaptureDate(''); setCaptureDateTo(''); setPage(1); }} className="min-h-9 shrink-0 rounded-lg border border-sf-accent-line bg-white px-3 text-xs font-bold text-sf-accent">Review order</button> : null}</div> : null}
        {error ? <p role="alert" className="mt-4 rounded-xl border border-sf-danger-line bg-sf-danger-soft px-4 py-3 text-sm text-sf-danger">{error}</p> : null}
        {focusNotice ? <p role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sf-danger-line bg-sf-danger-soft px-4 py-3 text-sm text-sf-danger"><span>{focusNotice}</span><button type="button" onClick={() => setFocusNotice('')} className="min-h-9 shrink-0 rounded-lg border border-sf-danger-line bg-white px-3 text-xs font-bold">Dismiss</button></p> : null}

        <section className="mt-3 overflow-hidden rounded-2xl border border-sf-line-soft bg-white shadow-[0_1px_3px_rgba(9,47,54,0.06)]">
          <div className="flex items-center justify-between gap-3 border-b border-sf-line-soft px-4 py-2">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-extrabold text-sf-strong">{pricesToApprove && status === 'open' ? 'Prices to approve' : <>{queueNames[status] || statusLabel(status)}</>}</h2>
              {data ? <p className="hidden text-[11px] text-sf-subtle lg:block" title={staleText}>Tally stock {snapshotTimeLabel(data.snapshot.fetchedAt).toLocaleLowerCase('en-IN')}</p> : null}
            </div>
            <span className="flex shrink-0 items-center gap-2">
              {yourQueue && yourQueue !== status ? <button type="button" onClick={() => showQueue(yourQueue)} className="min-h-8 rounded-full px-2.5 text-xs font-bold text-sf-accent hover:bg-sf-accent-soft">Your queue</button> : null}
              {!data ? null : pricesToApprove && status === 'open' ? <span className="rounded-full bg-sf-warning-soft px-2.5 py-1 text-xs font-extrabold tabular-nums text-sf-warning">{visibleOrders.length} to approve</span> : <span className="rounded-full bg-sf-soft-2 px-2.5 py-1 text-xs font-extrabold tabular-nums text-sf-body">{totalOrders} {status === 'open' ? 'pending' : totalOrders === 1 ? 'order' : 'orders'}{showsDeliveredToday && deliveredToday.length ? <span className="hidden sm:inline"> · {deliveredToday.length} delivered today</span> : null}</span>}
            </span>
          </div>

          {loading ? (
            <div className="p-10 text-center text-sm text-sf-subtle">Loading orders…</div>
          ) : displayedOrders.length === 0 ? (
            <div className="p-10 text-center">
              <p className="font-bold text-sf-body">No matching orders</p>
              <p className="mt-2 text-sm text-sf-subtle">{query ? `No orders match “${query}”. Clear the search to see the full list.` : status === 'history' ? 'Completed and cancelled orders will remain available here.' : status === 'attention' ? 'No active orders are stalled or have unresolved operational issues.' : status === 'billing_attention' ? 'No invoice, customer-ledger, product, quantity, or stale-verification issues need attention.' : status.startsWith('delivery_due_') ? 'No promised deliveries fall in this period.' : status === 'back_ordered' ? 'No prepared orders currently have a quantity shortage.' : status === 'delivery_exception' ? 'No delivery exceptions are currently open.' : 'New orders will appear here immediately.'}</p>
            </div>
          ) : desktopControlCenter ? (
            <div className="grid items-start lg:h-[calc(100dvh-9.5rem)] lg:min-h-96 lg:grid-cols-[minmax(360px,440px)_minmax(0,1fr)]">
              <aside aria-label="Desktop order queue" className="h-full overflow-y-auto border-r border-sf-line-soft bg-sf-soft-0">
                {orderGroups.map((group) => <section key={group.id} aria-label={group.label}>
                  <h3 className={`sticky top-0 z-[1] border-b border-sf-soft-2 bg-sf-soft-0/95 px-4 py-1.5 text-[11px] font-extrabold uppercase tracking-wide backdrop-blur ${group.id === 'priority' ? 'text-sf-danger' : 'text-sf-subtle'}`}>{group.label} <span className="font-bold tabular-nums">· {group.orders.length}</span></h3>
                  {group.orders.map((order) => {
                  const selected = order.id === selectedOrder?.id;
                  const nextAction = nextStatus[order.status]?.label || orderNextOwnerLabel(order.status) || 'View order';
                  const stage = orderStageStyle(order.status);
                  return <button id={`desktop-order-${order.id}`} key={order.id} type="button" aria-label={`${order.orderNumber}, ${order.customerName}, ${orderStage(order.status)}`} aria-current={selected ? 'true' : undefined} title={`${order.assignedToEmail ? `Owner: ${order.assignedToEmail}` : 'Unassigned'} · Next: ${nextAction}`} onClick={() => setSelectedOrderId(order.id)} onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); navigateDesktopQueue(event.key); } }} className={`relative block w-full border-b border-sf-soft-2 flex min-h-11 items-center py-1.5 pl-5 pr-3 text-left outline-none hover:bg-white focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sf-accent-bright aria-current:bg-white aria-current:shadow-[inset_3px_0_0_#092f36] ${['delivered', 'cancelled'].includes(order.status) ? 'opacity-70' : ''}`}>
                    <span aria-hidden="true" className={`absolute inset-y-2 left-2 w-1 rounded-full ${stage.bar}`} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex min-w-0 items-baseline gap-2"><strong className="min-w-0 flex-1 truncate text-sm text-sf-ink">{order.customerName}</strong>{newOrderIds?.has(order.id) ? <span className="shrink-0 rounded-full bg-sf-ink px-1.5 py-0.5 text-[9px] font-black uppercase text-white">New</span> : null}<time dateTime={order.createdAt} title={`Ordered ${orderDateTime(order.createdAt)}`} className="shrink-0 text-[11px] font-semibold tabular-nums text-sf-subtle">{orderDateLabel(order.createdAt)}</time></span>
                      <span className="flex min-w-0 items-center gap-1.5"><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${stage.chip}`}>{stage.label}</span><OrderFlagBadge order={order} /><span className="min-w-0 truncate text-[11px] tabular-nums text-sf-subtle">{order.orderNumber}</span>{nextAction === 'View order' ? null : <span className="ml-auto shrink-0 pl-1 text-right text-[11px] font-bold text-sf-accent">{nextAction}</span>}</span>
                    </span>
                  </button>;
                  })}
                </section>)}
              </aside>
              <div aria-label="Selected order workspace" className="h-full min-w-0 overflow-y-auto overscroll-contain">
                <div className="sticky top-0 z-10 border-b border-sf-line-soft bg-white/95 px-4 py-2 backdrop-blur">
                  <div className="flex min-h-9 items-center justify-between gap-3">
                    <span aria-live="polite" className="text-xs font-bold text-sf-muted">Order {selectedOrderIndex + 1} of {displayedOrders.length} <span className="ml-2 font-normal text-sf-subtle">↑ ↓ to navigate</span></span>
                    <div className="flex gap-2">
                      <button type="button" aria-label="Previous order" disabled={selectedOrderIndex <= 0} onClick={() => setSelectedOrderId(displayedOrders[selectedOrderIndex - 1].id)} className="min-h-9 rounded-lg border border-sf-line px-3 text-xs font-bold text-sf-body disabled:opacity-35">Previous</button>
                      <button type="button" aria-label="Next order" disabled={selectedOrderIndex < 0 || selectedOrderIndex >= displayedOrders.length - 1} onClick={() => setSelectedOrderId(displayedOrders[selectedOrderIndex + 1].id)} className="min-h-9 rounded-lg border border-sf-line px-3 text-xs font-bold text-sf-body disabled:opacity-35">Next</button>
                    </div>
                  </div>
                  {selectedOrder ? <div className="mt-1.5 max-w-md"><OrderProgress status={selectedOrder.status} challan={selectedOrder.challanNumber ? { billed: Boolean(selectedOrder.tallyInvoiceNumber || selectedOrder.challanBilledAt) } : undefined} /></div> : null}
                </div>
                {selectedOrder ? <OrderRow key={selectedOrder.id} order={selectedOrder} {...orderRowProps} /> : null}
              </div>
            </div>
          ) : (
            <div>
              {orderGroups.map((group) => <section key={group.id} aria-label={group.label}>
                <h3 className={`border-b border-sf-soft-2 bg-sf-soft-0 px-4 py-1.5 text-[11px] font-extrabold uppercase tracking-wide ${group.id === 'priority' ? 'text-sf-danger' : 'text-sf-subtle'}`}>{group.label} <span className="font-bold tabular-nums">· {group.orders.length}</span></h3>
                {group.orders.map((order) => <CompactOrderRow key={order.id} order={order} onOpen={openOrderDetail} isNew={newOrderIds?.has(order.id)} />)}
              </section>)}
            </div>
          )}
          {!loading && pageCount > 1 ? <nav aria-label="Order pages" className="flex items-center justify-between gap-3 border-t border-sf-line-soft px-4 py-3"><button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="min-h-10 rounded-xl border border-sf-line px-4 font-bold text-sf-body disabled:opacity-40">Previous</button><span className="text-xs font-bold text-sf-subtle">Page {currentPage} of {pageCount}</span><button type="button" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="min-h-10 rounded-xl border border-sf-line px-4 font-bold text-sf-body disabled:opacity-40">Next</button></nav> : null}
        </section>
      </div>

      {openOrder && !desktopControlCenter ? (
        <dialog ref={orderPageRef} aria-modal="true" aria-label={`Order ${openOrder.orderNumber}`} onCancel={(event) => { event.preventDefault(); setOpenOrderId(''); }} className="fixed inset-0 z-40 m-0 flex size-full max-h-none max-w-none flex-col overflow-hidden border-0 bg-white p-0 text-sf-strong" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="shrink-0 border-b border-sf-line-soft bg-white px-2 pb-2 pt-1.5">
            <div className="flex items-center gap-1">
              <button type="button" autoFocus aria-label="Back to orders" onClick={() => setOpenOrderId('')} className="grid min-h-11 min-w-11 place-items-center rounded-xl text-sf-ink hover:bg-sf-soft"><BackIcon /></button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-black text-sf-ink">{openOrder.customerName}</p>
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-sf-subtle"><span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${orderStageStyle(openOrder.status).chip}`}>{orderStageStyle(openOrder.status).label}</span><OrderFlagBadge order={openOrder} /><span>{openOrder.orderNumber}</span><time dateTime={openOrder.createdAt} className="basis-full sm:basis-auto">Ordered {orderDateTime(openOrder.createdAt)}</time></p>
              </div>
            </div>
            <div className="mt-1.5 px-2"><OrderProgress status={openOrder.status} challan={openOrder.challanNumber ? { billed: Boolean(openOrder.tallyInvoiceNumber || openOrder.challanBilledAt) } : undefined} /></div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {notice ? <p className="mx-3 mt-3 flex items-center gap-1 rounded-xl border border-sf-success-line bg-sf-success-soft px-3 py-2 text-sm font-semibold text-sf-success"><CircleCheck aria-hidden="true" className="shrink-0" size={14} />{notice}</p> : null}
            {error ? <p className="mx-3 mt-3 rounded-xl border border-sf-danger-line bg-sf-danger-soft px-3 py-2 text-sm text-sf-danger">{error}</p> : null}
            <OrderRow key={openOrder.id} order={openOrder} inOrderPage {...orderRowProps} />
          </div>
        </dialog>
      ) : null}

      {catalogLoading && !creating ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-sf-ink/45 p-4" role="presentation"><dialog open aria-modal="true" aria-label="Preparing order" onKeyDown={(event) => { if (event.key === 'Escape') cancelOrderPreparation(); }} className="relative m-auto w-full max-w-sm rounded-2xl border border-sf-line-soft bg-white p-6 shadow-2xl"><h2 className="text-lg font-black text-sf-ink">Preparing order</h2><p className="mt-2 text-sm text-sf-muted">Loading customer and product lists…</p><button type="button" autoFocus onClick={cancelOrderPreparation} className="mt-5 min-h-10 rounded-xl border border-sf-line px-4 text-sm font-bold text-sf-body">Cancel</button></dialog></div> : null}
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
          onCreated={(number, command, result) => {
            if (result?.orderId) onOrderActed?.(result.orderId);
            setDeviceDraftState(null);
            setCreating(false);
            setNotice(`${number} captured successfully.`);
            setNoticeOrderNumber(number);
            const current = dataRef.current;
            const canApplyLocally = current && command && result && page === 1 && !query && !captureDate && !captureDateTo && status === 'open';
            const patched = canApplyLocally ? applyCreatedOrderAcknowledgement(current, command, result) : null;
            if (patched) {
              dataRef.current = patched;
              setData(patched);
            } else {
              void load();
            }
          }}
          onViewCustomer={(customerName) => {
            setFocusNotice('');
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

function OrderRow({
  order,
  actorRole,
  actorRoles,
  actorEmail,
  tallyInvoices,
  tallySnapshotFetchedAt,
  onAdvance,
  onCancel,
  onSaveFulfilment,
  onPack,
  onDelivery,
  onEdit,
  onException,
  onInstallation,
  onBillingReview,
  onAddNote,
  onRepeat,
  onFindCustomer,
  onSetPriority,
  onSetAssignee,
  onFollowUp,
  onPricingChanged,
  inOrderPage = false,
}: {
  order: OrderSummary;
  actorRole: string;
  actorRoles?: readonly StockFlowRole[];
  actorEmail: string;
  tallyInvoices: OrderBootstrap['snapshot']['tallyInvoices'];
  tallySnapshotFetchedAt?: string;
  onAdvance: (order: OrderSummary, tallyInvoiceNumber?: string) => Promise<void>;
  onCancel: (order: OrderSummary, reason: string) => Promise<void>;
  onSaveFulfilment: (order: OrderSummary, payload: Extract<OrderCommand, { action: 'save_fulfilment' }>['payload']) => Promise<void>;
  onPack: (order: OrderSummary, lines: Array<{ tallyKey: string; fulfilledQuantity: number }>) => Promise<void>;
  onDelivery: (order: OrderSummary, command: Extract<OrderCommand, { action: 'save_dispatch' | 'confirm_delivery' }>) => Promise<void>;
  onEdit: (order: OrderSummary, payload: Extract<OrderCommand, { action: 'edit_order' }>['payload']) => Promise<void>;
  onException: (order: OrderSummary, command: Extract<OrderCommand, { action: 'create_exception' | 'resolve_exception' }>) => Promise<void>;
  onInstallation: (order: OrderSummary, command: Extract<OrderCommand, { action: 'schedule_installation' | 'complete_installation' }>) => Promise<void>;
  onBillingReview: (order: OrderSummary, command: Extract<OrderCommand, { action: 'record_billing_review' }>) => Promise<void>;
  onAddNote: (order: OrderSummary, note: string) => Promise<void>;
  onRepeat: (order: OrderSummary) => void;
  onFindCustomer: (order: OrderSummary) => void;
  onSetPriority: (order: OrderSummary, priority: 'normal' | 'high' | 'urgent') => Promise<void>;
  onSetAssignee: (order: OrderSummary, assignedToEmail?: string) => Promise<void>;
  onFollowUp: (order: OrderSummary, command: Extract<OrderCommand, { action: 'set_order_follow_up' | 'complete_order_follow_up' }>) => Promise<void>;
  onPricingChanged: () => Promise<void>;
  /** The full-screen order page already shows number, stage and customer in its header. */
  inOrderPage?: boolean;
}) {
  const roles = actorRoles ?? [actorRole as StockFlowRole];
  const rateCheckEnabled = Boolean(order.tallyInvoiceNumber) && (RATE_CHECK_STATUSES as readonly string[]).includes(order.status) && hasAnyStockFlowRole(roles, [...RATE_CHECK_ROLES]);
  // OrderRow mounts only for the selected desktop order or the open mobile dialog.
  const rateCheck = useRateCheck(order.id, rateCheckEnabled);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [detailsLoaded, setDetailsLoaded] = useState(false);
  const pricing = useOrderPricing(order, hasAnyStockFlowRole(roles, ['administrator', 'management', 'accounts']));
  const [detailHistory, setDetailHistory] = useState<{ exceptions: DeliveryException[]; installations: EquipmentInstallation[] } | null>(null);
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'error'>('idle');
  const canReviewPricing = hasAnyStockFlowRole(roles, ['administrator', 'accounts', 'management']) && !['billed_in_tally','ready_for_dispatch','dispatched','delivered','cancelled'].includes(order.status);
  const total = Number(order.totalQuantity || 0);
  const canCancel = hasAnyStockFlowRole(roles, ['administrator']) && !['cancelled', 'delivered'].includes(order.status);
  const canRepeat = hasAnyStockFlowRole(roles, ['administrator', 'sales', 'operations', 'management']);
  const attention = orderAttentionReasons(order);
  const backOrderedQuantity = attention.includes('Partial fulfilment or back-order') ? orderBackOrderedQuantity(order) : 0;
  const invoiceMatch = tallyInvoiceReconciliationDetail(order, tallyInvoices, new Date(), tallySnapshotFetchedAt);
  const lineMatch = tallyInvoiceLineReconciliation(order, tallyInvoices, new Date(), tallySnapshotFetchedAt);
  const invoiceState = invoiceMatch.state;
  const deliveryReminder = orderDeliveryReminder(order);
  const followUpReminder = orderFollowUpReminder(order);
  const phoneHref = customerPhoneHref(order.customerPhone);
  const challanNumber = order?.challanNumber ?? null;
  const challanUnbilled = Boolean(challanNumber && !order.tallyInvoiceNumber && !(order?.challanBilledAt ?? null));
  const ageDays = openOrderDays(order);
  const mergeById = <T extends { id: string },>(history: T[], current: T[]) => [...new Map([...history, ...current].map((item) => [item.id, item])).values()];
  const detailedOrder = detailHistory ? {
    ...order,
    exceptions: mergeById(detailHistory.exceptions, order.exceptions || []),
    installations: mergeById(detailHistory.installations, order.installations || []),
  } : order;
  async function loadDetails() {
    if (detailState === 'loading' || detailHistory) return;
    setDetailState('loading');
    try {
      const response = await readResponse<{ exceptions: DeliveryException[]; installations: EquipmentInstallation[] }>(await fetch(`/api/orders?detailsFor=${encodeURIComponent(order.id)}`, { cache: 'no-store' }));
      setDetailHistory({ exceptions: response.exceptions || [], installations: response.installations || [] });
      setDetailState('idle');
    } catch {
      setDetailState('error');
    }
  }
  return (
    // content-visibility adds paint containment, which would trap the pinned next-step bar; the order page skips it.
    <article className={`${inOrderPage ? 'min-w-0 p-3 pb-36 [overflow-wrap:anywhere]' : 'min-w-0 [overflow-wrap:anywhere] [content-visibility:auto] [contain-intrinsic-size:auto_260px] p-3 sm:p-5'} ${order.priority === 'urgent' ? 'border-l-4 border-l-sf-danger bg-sf-danger-soft' : order.priority === 'high' ? 'border-l-4 border-l-sf-warning' : ''}`}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] lg:items-center">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {challanNumber ? <span className="rounded-full bg-sf-info-soft px-2.5 py-1 text-[11px] font-extrabold text-sf-info">On challan {challanNumber}</span> : null}
          {challanUnbilled ? <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${(order?.challanOverdue ?? false) ? 'bg-sf-danger-soft text-sf-danger' : 'bg-sf-warning-soft text-sf-warning'}`}>{(order?.challanOverdue ?? false) ? 'Challan not billed' : 'Bill at month end'}</span> : null}
          {ageDays >= 7 ? <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${ageDays >= 14 ? 'bg-sf-warning-soft text-sf-warning' : 'bg-sf-soft text-sf-muted'}`}>Open {ageDays} days</span> : null}
          {inOrderPage ? null : <><strong className="text-sf-ink">{order.orderNumber}</strong>
          <span className="rounded-full bg-sf-soft px-2.5 py-1 text-[11px] font-extrabold text-sf-label">{orderStage(order.status)}</span>
          <time dateTime={order.createdAt} className="text-xs font-semibold text-sf-subtle">Ordered {orderDateTime(order.createdAt)}</time></>}
          {order.priority && order.priority !== 'normal' ? <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${order.priority === 'urgent' ? 'bg-sf-danger-soft text-sf-danger' : 'bg-sf-warning-soft text-sf-warning'}`}>{order.priority === 'urgent' ? <Flame aria-hidden="true" className="shrink-0" size={12} /> : <ArrowUp aria-hidden="true" className="shrink-0" size={12} />}{order.priority === 'urgent' ? 'Urgent' : 'High priority'}</span> : null}
          {order.assignedToEmail ? <span title={`Assigned to ${order.assignedToEmail}`} className="inline-flex items-center gap-1 max-w-44 truncate rounded-full bg-sf-info-soft px-2.5 py-1 text-[11px] font-extrabold text-sf-info sm:max-w-none"><UserCheck aria-hidden="true" className="shrink-0" size={12} /><span className="truncate">Assigned: {order.assignedToEmail}</span></span> : null}
          {deliveryReminder ? <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${deliveryReminder === 'overdue' ? 'bg-sf-danger-soft text-sf-danger' : deliveryReminder === 'today' ? 'bg-sf-warning-soft text-sf-warning' : 'bg-sf-info-soft text-sf-info'}`}><Truck aria-hidden="true" className="shrink-0" size={12} />{deliveryReminder === 'overdue' ? 'Delivery overdue' : deliveryReminder === 'today' ? 'Delivery due today' : 'Delivery due soon'}</span> : null}
          {followUpReminder ? <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${followUpReminder === 'overdue' ? 'bg-sf-danger-soft text-sf-danger' : followUpReminder === 'today' ? 'bg-sf-warning-soft text-sf-warning' : 'bg-sf-info-soft text-sf-info'}`}><PhoneCall aria-hidden="true" className="shrink-0" size={12} />{followUpReminder === 'overdue' ? 'Follow-up overdue' : followUpReminder === 'today' ? 'Follow-up today' : `Follow-up ${order.followUpDate}`}</span> : null}
          {lineMatch.state === 'mismatch' ? <span className="inline-flex items-center gap-1 rounded-full bg-sf-danger-soft px-2.5 py-1 text-[11px] font-extrabold text-sf-danger"><ReceiptText aria-hidden="true" className="shrink-0" size={12} />Billing mismatch</span> : null}
          {rateCheckBadge(rateCheck.check) ? <span className="inline-flex items-center gap-1 rounded-full bg-sf-danger-soft px-2.5 py-1 text-[11px] font-extrabold text-sf-danger"><ReceiptText aria-hidden="true" className="shrink-0" size={12} />Rate differs</span> : null}
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${order.pricingState === 'approved' ? 'bg-sf-success-soft text-sf-success' : order.pricingState === 'approval_required' ? 'bg-sf-warning-soft text-sf-warning' : 'bg-sf-soft text-sf-muted'}`}>{order.pricingState === 'approved' ? <ShieldCheck aria-hidden="true" className="shrink-0" size={12} /> : order.pricingState === 'approval_required' ? <ShieldAlert aria-hidden="true" className="shrink-0" size={12} /> : <ShieldQuestionMark aria-hidden="true" className="shrink-0" size={12} />}Pricing: {order.pricingState === 'approved' ? 'verified' : order.pricingState === 'approval_required' ? 'approval required' : 'review required'}</span>
        </div>
        {inOrderPage ? null : <p className="mt-2 font-bold text-sf-strong">{order.customerName}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-sf-subtle"><span>{order.customerPhone || 'No phone recorded'} · {order.lineCount} line{order.lineCount === 1 ? '' : 's'}<span className="sm:hidden"> · {formatQuantity(total)} qty</span></span>{phoneHref ? <a href={phoneHref} aria-label={`Call ${order.customerName}`} className="rounded-lg border border-sf-line px-2 py-1 font-bold text-sf-body hover:bg-sf-soft">Call</a> : null}</p>
        {order.expectedDeliveryDate ? <p className="mt-1 text-xs font-bold text-sf-label">Promised delivery: {new Date(`${order.expectedDeliveryDate}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}</p> : null}
        {backOrderedQuantity > 0 ? <p className="mt-1 inline-flex items-center gap-1 text-xs font-extrabold text-sf-warning"><PackageX aria-hidden="true" className="shrink-0" size={14} />Short by {formatQuantity(backOrderedQuantity)}</p> : null}
        {attention.length ? <p className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-sf-warning"><TriangleAlert aria-hidden="true" className="shrink-0" size={14} />Needs attention: {attention.join(' · ')}</p> : null}
        <ul aria-label="Order product preview" className="mt-3 flex flex-wrap gap-1.5">{order.lines.slice(0, 4).map((line) => <li key={line.tallyKey} className="max-w-full truncate rounded-lg bg-sf-soft sm:max-w-72 px-2 py-1 text-[11px] font-bold text-sf-label" title={`${line.itemName} · ${formatQuantity(line.quantity)} ${line.baseUnit || ''}`}>{line.itemName} · {formatQuantity(line.quantity)} {line.baseUnit || ''}</li>)}{order.lines.length > 4 ? <li className="rounded-lg bg-sf-soft px-2 py-1 text-[11px] font-bold text-sf-muted">+{order.lines.length - 4} more</li> : null}</ul>
      </div>
      <div className="hidden sm:block">
        <p className="text-xs font-bold text-sf-subtle">Ordered quantity</p>
        <p className="mt-1 font-extrabold text-sf-strong">{formatQuantity(total)}</p>
      </div>
      <OrderNextStepBar order={order} roles={roles} pricing={pricing} inOrderPage={inOrderPage} onAdvance={onAdvance} onDelivery={onDelivery} onPricingChanged={onPricingChanged} onPack={onPack} />
      </div>
      {order.pricingState === 'approval_required' && pricing.workspace?.pricingState === 'approval_required' && pricing.workspace.orderVersion === order.version ? <PriceApprovalCard workspace={pricing.workspace} /> : null}
      {challanNumber && !order.tallyInvoiceNumber && canBillChallan(roles) ? <BillChallanPanel order={order} onChanged={onPricingChanged} /> : (BILLING_STATUSES as readonly string[]).includes(order.status) && hasAnyStockFlowRole(roles, [...BILLING_ROLES]) ? <BillingSheetPanel order={order} /> : null}
      <details className="mt-3 rounded-xl border border-sf-line-soft bg-sf-soft-0 text-sm">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-3 font-bold text-sf-label marker:hidden [&::-webkit-details-marker]:hidden">
          <span>More order controls</span>
          <span className="truncate text-right text-[11px] font-semibold text-sf-subtle">{order.assignedToEmail ? `Owner: ${order.assignedToEmail}` : `${({ normal: 'Normal', high: 'High', urgent: 'Urgent' } as Record<string, string>)[order.priority || 'normal'] ?? order.priority} priority`}</span>
        </summary>
        <div className="border-t border-sf-line-soft p-3">
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => onFindCustomer(order)} className="min-h-9 rounded-lg border border-sf-line px-3 text-xs font-bold text-sf-body hover:bg-sf-soft">Customer orders</button>{canRepeat ? <button type="button" onClick={() => onRepeat(order)} className="min-h-9 rounded-lg border border-sf-line px-3 text-xs font-bold text-sf-body hover:bg-sf-soft">Repeat as new order</button> : null}<OrderSummaryCopy order={order} /></div>
          {!['delivered', 'cancelled'].includes(order.status) && hasAnyStockFlowRole(roles, ['administrator', 'sales', 'operations', 'management']) ? <PriorityControl order={order} onSave={onSetPriority} /> : null}
          {!order.assignedToEmail && !['delivered', 'cancelled'].includes(order.status) && hasAnyStockFlowRole(roles, ['administrator', 'operations', 'management']) ? <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onSetAssignee(order, actorEmail); } finally { setBusy(false); } }} className="mt-3 min-h-9 rounded-lg border border-sf-accent-line bg-sf-accent-soft px-3 text-xs font-bold text-sf-accent disabled:opacity-50">{busy ? 'Taking…' : 'Take this order'}</button> : null}
          {!['delivered', 'cancelled'].includes(order.status) && hasAnyStockFlowRole(roles, ['administrator', 'operations', 'management']) ? <AssignmentControl order={order} onSave={onSetAssignee} /> : null}
          {!['delivered', 'cancelled'].includes(order.status) ? <OrderFollowUpPanel order={order} actorRole={actorRole} actorRoles={roles} onSave={onFollowUp} /> : null}
          {canCancel ? <button type="button" disabled={busy} onClick={() => setCancelling(true)} className="mt-3 min-h-9 rounded-lg px-3 text-xs font-bold text-sf-danger hover:bg-sf-danger-soft disabled:opacity-50">Cancel order</button> : null}
          {cancelling ? <div className="mt-3 rounded-xl border border-sf-danger-line bg-sf-danger-soft p-3"><label className="text-sm font-bold text-sf-danger">Why is this order being cancelled?<textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} rows={2} maxLength={500} className="mt-2 w-full rounded-xl border border-sf-danger-line bg-white p-3 font-normal text-sf-strong outline-none focus:border-sf-danger" placeholder="Cancellation reason is required" /></label><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => { setCancelling(false); setCancelReason(''); }} className="min-h-10 rounded-xl px-4 font-bold text-sf-label">Keep order</button><button type="button" disabled={busy || !cancelReason.trim()} onClick={async () => { setBusy(true); try { await onCancel(order, cancelReason); setCancelling(false); } finally { setBusy(false); } }} className="min-h-10 rounded-xl bg-sf-danger px-4 font-bold text-white disabled:opacity-50">{busy ? 'Cancelling…' : 'Confirm cancellation'}</button></div></div> : null}
        </div>
      </details>
      <details onToggle={(event) => { if (event.currentTarget.open) { setDetailsLoaded(true); void loadDetails(); } }} className="mt-4 rounded-xl bg-sf-soft px-4 py-3 text-sm">
        <summary className="cursor-pointer font-bold text-sf-label">View order details</summary>
        {detailsLoaded ? <>
        {canReviewPricing ? <PricingPanel order={order} actorRole={actorRole} actorRoles={roles} pricing={pricing} onChanged={onPricingChanged} /> : null}
        <div className="mt-3 grid gap-4 border-t border-sf-line-soft pt-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-sf-subtle">Products</p>
            <ul className="mt-2 space-y-2">{(order.lines || []).map((line) => <li key={line.tallyKey} className="flex justify-between gap-4"><span><strong className="block text-sf-strong">{line.itemName}</strong><small className="text-sf-subtle">{line.itemGroup || 'Tally stock item'}</small></span><span className="shrink-0 font-bold text-sf-strong">{formatQuantity(line.quantity)} {line.baseUnit || ''}</span></li>)}</ul>
          </div>
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] content-start gap-x-3 gap-y-2 text-xs">
            <dt className="font-bold text-sf-subtle">Internal status</dt><dd>{statusLabel(order.status)}</dd>
            <dt className="font-bold text-sf-subtle">Order date</dt><dd>{orderDateTime(order.createdAt)}</dd>
            <dt className="font-bold text-sf-subtle">Last updated</dt><dd>{new Date(order.updatedAt).toLocaleString('en-IN')}</dd>
            <dt className="font-bold text-sf-subtle">Source</dt><dd className="capitalize">{order.source.replaceAll('_', ' ')}</dd>
            <dt className="font-bold text-sf-subtle">Tally invoice</dt><dd>{order.tallyInvoiceNumber || 'Not billed yet'}{invoiceState === 'verified' ? <span title="Invoice number, financial year, and customer ledger matched" className="ml-2 rounded-full bg-sf-accent-soft px-2 py-0.5 font-bold text-sf-success">Invoice matched</span> : invoiceState === 'unmatched' ? <span className="ml-2 rounded-full bg-sf-warning-soft px-2 py-0.5 font-bold text-sf-warning">Invoice not found</span> : invoiceState === 'customer_mismatch' ? <span title="The invoice exists under a different Tally customer ledger" className="ml-2 rounded-full bg-sf-danger-soft px-2 py-0.5 font-bold text-sf-danger">Customer ledger differs</span> : invoiceState === 'ambiguous' ? <span title="More than one Tally voucher has this invoice identity" className="ml-2 rounded-full bg-sf-danger-soft px-2 py-0.5 font-bold text-sf-danger">Duplicate invoice match</span> : invoiceState === 'verification_stale' ? <span title="The latest Tally data is over 20 minutes old" className="ml-2 rounded-full bg-sf-warning-soft px-2 py-0.5 font-bold text-sf-warning">Match needs fresh sync</span> : invoiceState === 'awaiting_sync' ? <span className="ml-2 text-sf-subtle">Awaiting connector update</span> : null}</dd>
            {invoiceMatch.matchedVoucherNumber ? <><dt className="font-bold text-sf-subtle">Matched Tally voucher</dt><dd className="font-bold text-sf-success">{invoiceMatch.matchedVoucherNumber}</dd></> : null}
            {order.tallyInvoiceNumber ? <><dt className="font-bold text-sf-subtle">Product & quantity check</dt><dd>{lineMatch.state === 'matched' ? <span className="rounded-full bg-sf-accent-soft px-2 py-0.5 font-bold text-sf-success">Products and quantities matched</span> : lineMatch.state === 'mismatch' ? <span className="rounded-full bg-sf-danger-soft px-2 py-0.5 font-bold text-sf-danger">Mismatch found</span> : lineMatch.state === 'awaiting_detail' ? <span className="text-sf-subtle">Awaiting invoice details</span> : <span className="text-sf-subtle">Available after invoice identity is matched</span>}</dd></> : null}
            <dt className="font-bold text-sf-subtle">Notes</dt><dd>{order.notes || 'No notes'}</dd>
          </dl>
        </div>
          {lineMatch.state === 'mismatch' ? <div className="mt-3 rounded-xl border border-sf-danger-line bg-sf-danger-soft p-3"><p className="text-xs font-extrabold uppercase tracking-wide text-sf-danger">Tally invoice differences</p><ul className="mt-2 space-y-1 text-sm text-sf-danger">{lineMatch.differences.map((difference) => <li key={difference.itemName}>{difference.itemName}: {lineMatch.quantitySource === 'packed' ? 'packed' : 'ordered'} {formatQuantity(difference.expectedQuantity)}, invoiced {formatQuantity(difference.invoicedQuantity)}</li>)}</ul><BillingReviewPanel order={order} actorRole={actorRole} actorRoles={roles} onSave={onBillingReview} /></div> : null}
        {rateCheckEnabled ? <RateCheckPanel orderId={order.id} state={rateCheck} /> : null}
        {!['cancelled', 'delivered'].includes(order.status) && canRecordFulfilment(roles) ? <FulfilmentEditor order={order} onSave={onSaveFulfilment} /> : null}
        {['ready_for_dispatch', 'dispatched', 'delivered'].includes(order.status) ? <DispatchPanel key={order.status} order={order} actorRole={actorRole} actorRoles={roles} onSave={onDelivery} /> : null}
        {['phone_order_received','awaiting_confirmation','awaiting_approval','confirmed','partially_reserved','fully_reserved','ready_for_picking','picked','packed'].includes(order.status) && canEditOrders(roles) ? <OrderEditPanel order={order} onSave={onEdit} /> : null}
        {detailState === 'loading' ? <p className="mt-4 text-xs text-sf-subtle">Loading operational history…</p> : detailState === 'error' ? <button type="button" onClick={() => void loadDetails()} className="mt-4 text-xs font-bold text-sf-danger">Operational history could not load · Retry</button> : null}
        <DeliveryExceptionPanel order={detailedOrder} canManage={canManageDeliveryExceptions(roles)} onSave={onException} />
        <InstallationPanel order={detailedOrder} canManage={canManageInstallations(roles)} onSave={onInstallation} />
        {order.status === 'awaiting_tally_billing' ? <BillingHandoff order={order} /> : null}
        {canAddOrderNotes(roles) ? <OrderNotePanel order={order} onSave={onAddNote} /> : null}
        <OrderActivityLog key={`${order.id}-${order.version}`} orderId={order.id} initialEvents={order.events || []} />
        </> : null}
      </details>
    </article>
  );
}

function BillChallanPanel({ order, onChanged }: { order: OrderSummary; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [invoice, setInvoice] = useState('');
  const command = useChallanCommand(order, onChanged);
  const inputId = `challan-invoice-${order.id}`;
  return <section aria-label="Bill challan" className="mt-3 min-w-0 rounded-xl border border-sf-line bg-sf-info-soft p-3">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="min-h-11 rounded-lg px-3 text-sm font-bold text-sf-info">Bill challan</button>
    {open ? <>
      <BillingSheetPanel order={order} />
      <form className="mt-3 space-y-2" onSubmit={async (event) => { event.preventDefault(); if (await command.submit('bill_challan', invoice)) { setInvoice(''); setOpen(false); } }}>
        <label htmlFor={inputId} className="block text-sm font-bold text-sf-body">Tally invoice number</label>
        <input id={inputId} aria-label={`Tally invoice number for ${order.orderNumber}`} required maxLength={40} value={invoice} disabled={command.busy || command.pending} onChange={event => setInvoice(event.target.value)} className="min-h-11 w-full min-w-0 rounded-lg border border-sf-line bg-white px-3" />
        {command.error ? <p role="alert" className="text-sm text-sf-danger">{command.error}</p> : null}
        <button type="submit" disabled={command.busy || !invoice.trim()} className="min-h-11 rounded-xl bg-sf-ink px-4 font-bold text-white disabled:opacity-50">{command.busy ? 'Saving…' : 'Record invoice'}</button>
      </form>
    </> : null}
  </section>;
}

function BillingReviewPanel({ order, actorRole, actorRoles, onSave }: { order: OrderSummary; actorRole: string; actorRoles?: readonly StockFlowRole[]; onSave: (order: OrderSummary, command: Extract<OrderCommand, { action: 'record_billing_review' }>) => Promise<void> }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<'investigating' | 'accepted_difference' | 'tally_corrected'>('investigating'); const [note, setNote] = useState('');
  if (!hasAnyStockFlowRole(actorRoles ?? [actorRole as StockFlowRole], ['administrator', 'accounts', 'operations', 'management'])) return <p className="mt-3 text-xs text-sf-subtle">Accounts or operations must review this difference.</p>;
  return <div className="mt-3 border-t border-sf-danger-line pt-3"><button type="button" onClick={() => setOpen((value) => !value)} className="text-xs font-extrabold text-sf-danger">{open ? '− Hide review' : '+ Record review'}</button>{open ? <div className="mt-2 grid gap-2 sm:grid-cols-[180px_1fr_auto]"><select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)} className="min-h-10 rounded-lg border border-sf-danger-line bg-white px-2 text-xs"><option value="investigating">Investigating</option><option value="tally_corrected">Corrected in Tally</option><option value="accepted_difference">Accepted difference</option></select><input value={note} onChange={(event) => setNote(event.target.value)} minLength={3} maxLength={1000} placeholder="What was checked or corrected?" className="min-h-10 rounded-lg border border-sf-danger-line bg-white px-3 text-xs"/><button type="button" disabled={busy || note.trim().length < 3} onClick={async () => { setBusy(true); try { await onSave(order, { action: 'record_billing_review', payload: { orderId: order.id, expectedVersion: order.version, outcome, note: note.trim() } }); setNote(''); setOpen(false); } finally { setBusy(false); } }} className="min-h-10 rounded-lg bg-sf-danger px-3 text-xs font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save review'}</button></div> : null}</div>;
}

const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

/** Full pricing (cost, margin, history) for pricing roles only; billing and other roles never request it. */
function useOrderPricing(order: OrderSummary, enabled = true) {
  const readKey = `${order.id}:${order.pricingState}:${order.status}`;
  const readKeyRef = useRef(readKey);
  useLayoutEffect(() => { readKeyRef.current = readKey; }, [readKey]);
  const autoLoad = enabled && order.pricingState !== 'approved' && !['delivered', 'cancelled'].includes(order.status);
  const [result, setResult] = useState<{ key: string; workspace: OrderPricingWorkspace | null; state: 'idle' | 'loading' | 'error'; message: string }>(() => ({ key: readKey, workspace: null, state: autoLoad ? 'loading' : 'idle', message: '' }));
  const request = useRef<AbortController | null>(null);
  const automaticVersion = useRef<string | null>(null);
  const automaticReadKey = useRef<string | null>(null);
  const read = useCallback((controller: AbortController) => {
    return fetch(`/api/pricing?orderId=${encodeURIComponent(order.id)}`, { cache: 'no-store', signal: controller.signal }).then(readResponse<OrderPricingWorkspace>).then(workspace => {
      if (controller.signal.aborted) return;
      setResult({ key: readKeyRef.current, workspace, state: 'idle', message: '' });
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setResult(current => ({ ...current, key: readKeyRef.current, state: 'error', message: cause instanceof Error ? cause.message : 'Pricing could not load' }));
    }).finally(() => {
      if (request.current === controller) request.current = null;
    });
  }, [order.id]);
  const reload = useCallback(async () => {
    if (!enabled) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setResult(current => ({ ...current, key: readKeyRef.current, state: 'loading', message: '' }));
    await read(controller);
  }, [enabled, read]);
  useEffect(() => {
    return () => {
      if (request.current) {
        request.current.abort();
        request.current = null;
        automaticVersion.current = null;
        automaticReadKey.current = null;
      }
    };
  }, [enabled, read]);
  useEffect(() => {
    if (!enabled || ['delivered', 'cancelled'].includes(order.status)) return;
    const stale = result.workspace?.orderId === order.id && result.workspace.orderVersion !== order.version;
    const versionKey = `${order.id}:${order.version}`;
    if (stale) {
      if (order.pricingState !== 'approved') return;
      if (automaticVersion.current === versionKey) return;
      automaticVersion.current = versionKey;
    } else if (!autoLoad || automaticReadKey.current === readKey) return;
    automaticReadKey.current = readKey;
    void reload();
  }, [autoLoad, enabled, order.id, order.pricingState, order.status, order.version, readKey, reload, result.workspace]);
  return {
    workspace: result.workspace?.orderId === order.id ? result.workspace : null,
    reload,
    state: result.key === readKey ? result.state : autoLoad ? 'loading' as const : 'idle' as const,
    message: result.key === readKey ? result.message : '',
  };
}

type DeliveryCommand = Extract<OrderCommand, { action: 'save_dispatch' | 'confirm_delivery' }>;
function OrderNextStepBar({ order, roles, pricing, inOrderPage, onAdvance, onDelivery, onPricingChanged, onPack }: {
  order: OrderSummary; roles: readonly StockFlowRole[]; pricing: ReturnType<typeof useOrderPricing>; inOrderPage: boolean;
  onAdvance: (order: OrderSummary, invoice?: string) => Promise<void>;
  onDelivery: (order: OrderSummary, command: DeliveryCommand) => Promise<void>;
  onPricingChanged: () => Promise<void>;
  onPack: (order: OrderSummary, lines: Array<{ tallyKey: string; fulfilledQuantity: number }>) => Promise<void>;
}) {
  const step = nextStepFor(order, roles, pricing.workspace);
  const [sheet, setSheet] = useState('');
  const [challanNumber, setChallanNumber] = useState('');
  const challan = useChallanCommand(order, onPricingChanged);
  const canSendChallan = order.status === 'packed' && order.pricingState === 'approved' && canSendOnChallan(roles);
  const [stepBusy, setBusy] = useState(false);
  const busy = stepBusy || challan.busy;
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [reason, setReason] = useState('');
  const [changedRate, setChangedRate] = useState('');
  const saveKey = `${order.id}:${step.exception?.id ?? ''}:${step.exception?.version ?? ''}`;
  const [saveChoice, setSaveChoice] = useState<{ key: string; value: boolean } | null>(null);
  const saveAsCustomerPrice = saveChoice?.key === saveKey ? saveChoice.value : true;
  const [invoice, setInvoice] = useState(order.tallyInvoiceNumber || '');
  const governedRequest = useRef<{ version: number; idempotencyKey: string } | null>(null);
  const priceChangeRequest = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);
  useEffect(() => { if (sheet !== 'change') priceChangeRequest.current = null; }, [sheet]);
  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(''), 4000);
    return () => window.clearTimeout(timer);
  }, [success]);
  const stale = Boolean(pricing.workspace && pricing.workspace.orderVersion < order.version);
  const newRate = Number(changedRate);
  const validChangedRate = Number.isFinite(newRate) && newRate > 0 && newRate <= 100_000_000 && Math.abs(Math.round(newRate * 100) - newRate * 100) < 1e-6;
  const canChangePrice = hasAnyStockFlowRole(roles, [...PRICE_CHANGE_ROLES]);
  async function run(work: () => Promise<void>, message: string) {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); setSheet(''); setSuccess(message); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to complete the step'); }
    finally { setBusy(false); }
  }
  async function pricingCommand(action: 'apply_governed_order_pricing' | 'approve_price_exception' | 'reject_price_exception', changedRate?: number) {
    if (!pricing.workspace || stale || pricing.state === 'loading') return;
    let payload;
    if (action === 'apply_governed_order_pricing') {
      if (governedRequest.current?.version !== pricing.workspace.orderVersion) governedRequest.current = { version: pricing.workspace.orderVersion, idempotencyKey: crypto.randomUUID() };
      payload = { orderId: order.id, expectedVersion: pricing.workspace.orderVersion, idempotencyKey: governedRequest.current.idempotencyKey };
    } else {
      if (!step.exception) return;
      if (changedRate !== undefined) {
        if (action !== 'approve_price_exception' || !canChangePrice || !validChangedRate || reason.trim().length < 3 || reason.length > 1000) return;
        const fingerprint = JSON.stringify([step.exception.id, step.exception.version, changedRate, reason.trim(), saveAsCustomerPrice]);
        if (priceChangeRequest.current?.fingerprint !== fingerprint) priceChangeRequest.current = { fingerprint, idempotencyKey: crypto.randomUUID() };
        payload = { exceptionId: step.exception.id, expectedVersion: step.exception.version, changedRate, reason: reason.trim(), saveAsCustomerPrice, idempotencyKey: priceChangeRequest.current.idempotencyKey };
      } else {
        payload = { exceptionId: step.exception.id, expectedVersion: step.exception.version, reason: action === 'approve_price_exception' ? 'Price reviewed and approved' : reason.trim(), idempotencyKey: crypto.randomUUID(), ...(action === 'approve_price_exception' ? { saveAsCustomerPrice } : {}) };
      }
    }
    const response = await fetch('/api/pricing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, payload }) });
    if (changedRate !== undefined && response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) priceChangeRequest.current = null;
    await readResponse(response);
    if (changedRate !== undefined) priceChangeRequest.current = null;
    governedRequest.current = null;
    await onPricingChanged(); await pricing.reload();
  }
  const primary = 'min-h-12 w-full rounded-xl bg-sf-ink px-4 text-base font-bold text-white hover:bg-sf-ink-hover disabled:opacity-50';
  const exceptionLine = pricing.workspace?.lines.find(line => line.lineId === step.exception?.lineId);
  const savePriceCheckbox = <div>
    <label className="flex min-h-11 items-center gap-3 text-sm font-bold text-sf-body">
      <input type="checkbox" checked={saveAsCustomerPrice} disabled={busy || stale || pricing.state === 'loading'} onChange={event => setSaveChoice({ key: saveKey, value: event.target.checked })} className="size-4 shrink-0 accent-sf-accent" />
      {pricing.workspace?.exceptions.length === 1 ? `Save as ${pricing.workspace.customerName}'s price for ${exceptionLine?.itemName ?? 'this item'}` : "Save as this customer's price for these items"}
    </label>
    <p className="text-xs text-sf-muted">Next orders use this price without approval until purchase cost rises over 2%.</p>
  </div>;
  const informational = ['loading', 'waiting', 'pricing_waiting', 'done', 'none'].includes(step.kind);
  // Pricing staleness only matters while deciding a price, not when dispatching or delivering.
  const pricingStep = step.kind.startsWith('pricing_') || step.kind === 'loading' || ['price', 'reject', 'change'].includes(sheet);
  // One tap: delivered now, received by the customer. "Add receiver / POD…" records a named person or POD.
  const deliverNow = () => run(() => onDelivery(order, { action: 'confirm_delivery', payload: { orderId: order.id, expectedVersion: order.version, deliveredAt: new Date().toISOString(), receivedBy: defaultReceiver(order), podReference: '' } }), 'Moved to Delivered');
  const dispatchLocally = () => run(() => onDelivery(order, { action: 'save_dispatch', payload: { orderId: order.id, expectedVersion: order.version, ...LOCAL_DELIVERY, dispatchDate: istToday(), vehicleNumber: '' } }), 'Dispatched · local delivery');
  if (step.kind === 'none') return null;
  return <section aria-label="Order next step" className={inOrderPage ? 'fixed inset-x-0 bottom-0 z-50 flex max-h-[70vh] min-w-0 flex-col gap-2 overflow-y-auto border-t border-sf-line-soft bg-white/95 px-3 pt-3 backdrop-blur' : 'flex max-h-[70vh] min-w-0 w-full flex-col gap-2 overflow-y-auto lg:min-w-48'} style={inOrderPage ? { paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' } : undefined}>
    {success ? <output className={`flex items-center gap-2 text-sm font-bold ${/rejected/i.test(success) ? 'text-sf-label' : 'text-sf-success'}`}>{/rejected/i.test(success) ? <Info aria-hidden="true" size={16} /> : <CircleCheck aria-hidden="true" size={16} />}{success}</output> : null}
    {error || (pricingStep && pricing.message) ? <p role="alert" className="text-sm text-sf-danger">{error || pricing.message}</p> : null}
    {pricingStep && (stale || pricing.state === 'error') ? <button type="button" disabled={busy || pricing.state === 'loading'} onClick={() => void pricing.reload()} className="min-h-11 rounded-xl border border-sf-line px-3 text-sm font-bold text-sf-body">Reload pricing</button> : null}
    {pricingStep && stale ? <p className="text-sm text-sf-warning">This order changed. Reload pricing before submitting.</p> : null}
    {sheet ? <div className="min-w-0 space-y-3">
      {sheet === 'challan' && canSendChallan ? <form className="space-y-2" onSubmit={async event => { event.preventDefault(); if (await challan.submit('send_on_challan', challanNumber)) setSheet(''); }}>
        <label htmlFor={`send-challan-${order.id}`} className="block text-sm font-bold text-sf-body">Tally delivery challan number</label>
        <input id={`send-challan-${order.id}`} aria-label={`Tally delivery challan number for ${order.orderNumber}`} aria-describedby={`send-challan-hint-${order.id}`} required maxLength={40} value={challanNumber} disabled={challan.busy || challan.pending} onChange={event => setChallanNumber(event.target.value)} className="min-h-11 w-full min-w-0 rounded-lg border border-sf-line px-3" />
        <p id={`send-challan-hint-${order.id}`} className="text-xs text-sf-muted">Billing adds the Tally invoice at month end.</p>
        {challan.error ? <p role="alert" className="text-sm text-sf-danger">{challan.error}</p> : null}
        <button type="submit" disabled={challan.busy || !challanNumber.trim()} className={primary}>{challan.busy ? 'Saving…' : 'Send on challan'}</button>
      </form> : null}
      <button type="button" disabled={busy} onClick={() => { setSheet(''); setReason(''); setChangedRate(''); priceChangeRequest.current = null; }} className="min-h-11 rounded-lg border border-sf-line px-4 font-bold text-sf-body">Cancel</button>
      {sheet === 'price' ? <PricingPanel order={order} actorRole={roles[0]} actorRoles={roles} pricing={pricing} sheet onSavingChange={setBusy} onChanged={async () => { await onPricingChanged(); setSheet(''); }} /> : null}
      {sheet === 'reject' ? <><label className="block text-sm font-bold text-sf-body">Rejection reason<input required minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-sf-line px-3" /></label><button type="button" disabled={busy || stale || reason.trim().length < 3} onClick={() => void run(() => pricingCommand('reject_price_exception'), 'Price rejected')} className={primary}>Reject price</button></> : null}
      {sheet === 'change' ? <>
        <label className="block text-sm font-bold text-sf-body">New price per unit (₹)<input aria-label={`New price per unit (₹) for ${order.orderNumber}`} type="number" inputMode="decimal" min="0.01" max="100000000" step="0.01" required disabled={busy} value={changedRate} onChange={event => setChangedRate(event.target.value)} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-sf-line px-3" /></label>
        <label className="block text-sm font-bold text-sf-body">Reason for the change<input aria-label={`Reason for the change for ${order.orderNumber}`} required minLength={3} maxLength={1000} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-sf-line px-3" /></label>
        {savePriceCheckbox}
        <button type="button" disabled={busy || stale || pricing.state === 'loading' || step.kind !== 'pricing_approve' || !canChangePrice || !validChangedRate || reason.trim().length < 3} onClick={() => void run(() => pricingCommand('approve_price_exception', newRate), 'Price changed and approved')} className={primary}>{busy ? 'Saving…' : `Approve ₹${(Number.isFinite(newRate) ? newRate : 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}</button>
      </> : null}
      {sheet === 'pack' ? <PackQuantitiesForm order={order} busy={busy} onSave={(lines) => run(() => onPack(order, lines), 'Moved to Packed')} /> : null}
      {sheet === 'dispatch' ? <DispatchForm order={order} actorRoles={roles} initialMode="outstation" onSave={(current, command) => run(() => onDelivery(current, command), 'Moved to Dispatched')} /> : null}
      {sheet === 'deliver' ? <DeliveryForm order={order} actorRoles={roles} onSave={(current, command) => run(() => onDelivery(current, command), 'Moved to Delivered')} /> : null}
    </div> : <>
      {informational ? <p className={`flex items-center gap-2 py-2 text-sm font-bold ${step.kind === 'done' ? 'text-sf-success' : 'text-sf-muted'}`}>{step.kind === 'done' ? <CircleCheck aria-hidden="true" size={16} /> : <Clock aria-hidden="true" size={16} />}{step.label}</p> : <>
        {step.kind === 'advance' && order.status === 'awaiting_tally_billing' ? <label className="text-xs font-bold text-sf-muted">Tally invoice number(s)<input maxLength={160} value={invoice} onChange={event => setInvoice(event.target.value)} placeholder="Use commas for split invoices" className="mt-1 min-h-10 w-full rounded-lg border border-sf-line px-3 font-normal text-sf-strong" /></label> : null}
        {step.kind === 'pricing_approve' ? savePriceCheckbox : null}
        {step.kind === 'advance' && nextStatus[order.status]?.status === 'packed' ? <>
          <button type="button" className={primary} disabled={busy} onClick={() => void run(() => onPack(order, order.lines.map((line) => ({ tallyKey: line.tallyKey, fulfilledQuantity: Number(line.quantity) }))), 'Moved to Packed')}>{busy ? 'Saving…' : 'Packed · all items'}</button>
          <button type="button" disabled={busy} onClick={() => setSheet('pack')} className="min-h-11 rounded-xl border border-sf-line px-4 font-bold text-sf-body">Packed with shortage…</button>
        </> : step.kind === 'dispatch' ? <>
          <button type="button" className={primary} disabled={busy} onClick={() => void dispatchLocally()}>{busy ? 'Dispatching…' : 'Dispatch · Local delivery'}</button>
          <button type="button" disabled={busy} onClick={() => setSheet('dispatch')} className="min-h-11 rounded-xl border border-sf-line px-4 font-bold text-sf-body">Outstation courier…</button>
        </> : step.kind === 'deliver' ? <>
          <button type="button" className={primary} disabled={busy} onClick={() => void deliverNow()}>{busy ? 'Confirming…' : 'Confirm delivered'}</button>
          <button type="button" disabled={busy} onClick={() => setSheet('deliver')} className="min-h-11 rounded-xl border border-sf-line px-4 font-bold text-sf-body">Add receiver / POD…</button>
        </> : <button type="button" className={primary} disabled={busy || (step.kind.startsWith('pricing_') && (stale || pricing.state === 'loading')) || (step.kind === 'advance' && order.status === 'awaiting_tally_billing' && !invoice.trim())} onClick={() => {
          if (step.kind === 'advance') void run(() => onAdvance(order, invoice), `Moved to ${statusLabel(nextStatus[order.status].status)}`);
          else if (step.kind === 'pricing_apply') void run(() => pricingCommand('apply_governed_order_pricing'), 'Price approved');
          else if (step.kind === 'pricing_approve') void run(() => pricingCommand('approve_price_exception'), 'Price approved');
          else setSheet(step.kind === 'pricing_enter' ? 'price' : step.kind);
        }}>{busy ? 'Updating…' : step.label}</button>}
        {step.kind === 'pricing_approve' && canChangePrice ? <button type="button" disabled={busy || stale} onClick={() => { setChangedRate(String(step.exception!.enteredRate)); setReason(''); setError(''); setSheet('change'); }} className="min-h-11 rounded-xl border border-sf-line px-4 font-bold text-sf-body">Change price…</button> : null}
        {step.kind === 'pricing_approve' ? <button type="button" disabled={busy || stale} onClick={() => setSheet('reject')} className="min-h-11 rounded-xl border border-sf-danger-line px-4 font-bold text-sf-danger">Reject</button> : null}
      </>}
      {canSendChallan ? <button type="button" disabled={busy || challan.busy} onClick={() => setSheet('challan')} className="min-h-11 rounded-xl border border-sf-line bg-white px-4 font-bold text-sf-body">Send on challan</button> : null}
    </>}
  </section>;
}

function PricingPanel({ order, actorRole, actorRoles, onChanged, pricing, sheet = false, onSavingChange }: { order: OrderSummary; actorRole: string; actorRoles?: readonly StockFlowRole[]; onChanged: () => Promise<void>; pricing: ReturnType<typeof useOrderPricing>; sheet?: boolean; onSavingChange?: (saving: boolean) => void }) {
  const { workspace, reload: loadPricing } = pricing;
  const [draftWorkspace, setDraftWorkspace] = useState(workspace);
  const [entries, setEntries] = useState<Record<string, { rate: string; reason: string }>>(() => Object.fromEntries((workspace?.lines || []).map(line => [line.lineId, { rate: line.proposedRate == null ? '' : String(line.proposedRate), reason: '' }])));
  const [localState, setState] = useState<'idle' | 'loading' | 'saving' | 'error'>('idle');
  const state = pricing.state === 'loading' ? 'loading' : localState === 'idle' ? pricing.state : localState;
  const [message, setMessage] = useState('');
  const [manualReview, setManualReview] = useState(false);
  const governedRequest = useRef<{ orderId: string; version: number; idempotencyKey: string } | null>(null);
  const pricingIsStale = Boolean(workspace && workspace.orderVersion < order.version);
  if (workspace && workspace !== draftWorkspace) {
    setDraftWorkspace(workspace);
    setEntries(Object.fromEntries(workspace.lines.map(line => [line.lineId, { rate: line.proposedRate == null ? '' : String(line.proposedRate), reason: '' }])));
    setManualReview(false);
  }
  useEffect(() => {
    if (!workspace) return;
    governedRequest.current = null;
  }, [workspace]);
  async function submit() {
    if (!workspace || pricingIsStale || state === 'loading' || state === 'saving') return;
    onSavingChange?.(true);
    setState('saving'); setMessage('');
    try {
      const response = await readResponse<{ pricingState?: string }>(await fetch('/api/pricing', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          action: 'submit_order_pricing', payload: {
            orderId: order.id, expectedVersion: workspace.orderVersion, idempotencyKey: crypto.randomUUID(),
            lines: workspace.lines.map((line) => ({ lineId: line.lineId, evidenceHash: line.evidenceHash, enteredRate: Number(entries[line.lineId]?.rate), reason: entries[line.lineId]?.reason.trim() || undefined })),
          },
        }),
      }));
      setMessage(response.pricingState === 'approved' ? 'Pricing approved and billing snapshot created.' : 'Pricing exception sent for approval.');
      await onChanged(); await loadPricing();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Pricing could not be saved'); }
    finally { setState('idle'); onSavingChange?.(false); }
  }
  async function applyGoverned() {
    if (!workspace || pricingIsStale || state === 'loading' || state === 'saving') return;
    const request = governedRequest.current?.orderId === order.id && governedRequest.current.version === workspace.orderVersion
      ? governedRequest.current
      : { orderId: order.id, version: workspace.orderVersion, idempotencyKey: crypto.randomUUID() };
    governedRequest.current = request;
    setState('saving'); setMessage('');
    try {
      await readResponse(await fetch('/api/pricing', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          action: 'apply_governed_order_pricing', payload: { orderId: request.orderId, expectedVersion: request.version, idempotencyKey: request.idempotencyKey },
        }),
      }));
      governedRequest.current = null;
      setMessage('Governed customer prices applied and billing snapshot created.');
      await onChanged(); await loadPricing(); setState('idle');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Governed pricing could not be applied'); setState('error'); }
  }
  const governedReady = Boolean(workspace?.lines.length) && workspace!.lines.every((line) => line.governed && line.guardrail !== 'PRICE_REVIEW_REQUIRED' && Number(line.proposedRate) > 0);
  if (sheet) return <section aria-label="Enter price" className="min-w-0 space-y-3">
    <h4 className="font-bold text-sf-body">Enter price</h4>
    {message ? <p role="alert" className="text-sm text-sf-danger">{message}</p> : null}
    <fieldset disabled={pricingIsStale || state === 'loading' || state === 'saving'} className="min-w-0 space-y-3">
      {workspace?.lines.map(line => <PricingLineCard key={line.lineId} line={line} compact={Boolean(line.governed && line.guardrail !== 'PRICE_REVIEW_REQUIRED' && Number(line.proposedRate) > 0)} entry={entries[line.lineId] || { rate: '', reason: '' }} onChange={entry => setEntries(current => ({ ...current, [line.lineId]: entry }))} />)}
      <button type="button" disabled={!workspace?.lines.length || workspace.lines.some(line => !Number(entries[line.lineId]?.rate) || ((!line.governed || line.guardrail === 'PRICE_REVIEW_REQUIRED') && (entries[line.lineId]?.reason.trim().length || 0) < 3))} onClick={() => void submit()} className="min-h-12 w-full rounded-xl bg-sf-ink px-4 font-bold text-white hover:bg-sf-ink-hover disabled:opacity-50">{state === 'saving' ? 'Saving pricing…' : 'Submit for approval'}</button>
    </fieldset>
  </section>;
  return <section className="mt-5 border-t border-sf-line-soft pt-4" aria-label="Price review">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-xs font-extrabold uppercase tracking-wide text-sf-body">Price review</h4><span className={`rounded-full px-2 py-1 text-[11px] font-extrabold ${order.pricingState === 'approved' ? 'bg-sf-accent-soft text-sf-success' : order.pricingState === 'approval_required' ? 'bg-sf-warning-soft text-sf-warning' : 'bg-sf-soft text-sf-muted'}`}>{order.pricingState === 'approved' ? 'Verified' : order.pricingState === 'approval_required' ? 'Approval required' : 'Review required'}</span></div>
    {order.pricingState === 'approved' && !workspace ? <button type="button" onClick={() => void loadPricing()} className="mt-2 text-xs font-bold text-sf-body">View pricing details</button> : null}
    <button type="button" disabled={state === 'loading' || state === 'saving'} onClick={() => void loadPricing()} className="mt-2 min-h-10 rounded-lg border border-sf-line px-3 text-xs font-bold disabled:opacity-50">Reload pricing</button>
    {pricingIsStale ? <p role="alert" className="mt-2 rounded-lg bg-sf-warning-soft p-3 text-sm text-sf-warning">This order changed. Reload pricing before submitting. Reloading replaces unsaved rates and reasons.</p> : null}
    {state === 'loading' ? <p className="mt-3 text-xs text-sf-subtle">Loading governed pricing evidence…</p> : null}
    {message ? <output className={`mt-3 block rounded-lg px-3 py-2 text-xs font-bold ${state === 'error' ? 'bg-sf-danger-soft text-sf-danger' : 'bg-sf-accent-soft text-sf-body'}`}>{message}</output> : null}
    {workspace ? <fieldset disabled={pricingIsStale || state === 'loading' || state === 'saving'} className="mt-3 space-y-3">
      {workspace.exceptions.map((exception) => <PriceExceptionDecision key={exception.id} exception={exception} actorRole={actorRole} actorRoles={actorRoles} onChanged={async () => { await onChanged(); await loadPricing(); }} />)}
      {workspace.lines.map((line) => <PricingLineCard key={line.lineId} line={line} compact={governedReady && !manualReview} entry={entries[line.lineId] || { rate: '', reason: '' }} onChange={(entry) => setEntries((current) => ({ ...current, [line.lineId]: entry }))} />)}
      {workspace.exceptions.length === 0 && workspace.pricingState !== 'approved' && governedReady && !manualReview ? <div className="flex flex-wrap items-center gap-3">{order.status === 'awaiting_confirmation' || order.status === 'phone_order_received' ? <p className="text-xs font-bold text-sf-success">Governed prices will apply when this order is confirmed.</p> : <button type="button" disabled={state === 'saving'} onClick={() => void applyGoverned()} className="min-h-10 rounded-xl bg-sf-ink-hover px-4 text-sm font-bold text-white disabled:opacity-50">{state === 'saving' ? 'Applying prices…' : 'Apply governed prices'}</button>}<button type="button" disabled={state === 'saving'} onClick={() => setManualReview(true)} className="min-h-10 rounded-xl border border-sf-accent-line px-4 text-sm font-bold text-sf-body">Review price exception</button></div> : null}
      {workspace.exceptions.length === 0 && workspace.pricingState !== 'approved' && (!governedReady || manualReview) ? <button type="button" disabled={state === 'saving' || workspace.lines.some((line) => !Number(entries[line.lineId]?.rate) || (sheet && (entries[line.lineId]?.reason.trim().length || 0) < 3))} onClick={() => void submit()} className="min-h-10 rounded-xl bg-sf-ink-hover px-4 text-sm font-bold text-white disabled:opacity-50">{state === 'saving' ? 'Saving pricing…' : sheet ? 'Submit for approval' : governedReady ? 'Submit price override' : 'Submit price exception'}</button> : null}
      {sheet ? null : <PricingDecisionHistory history={workspace.history || []} />}
    </fieldset> : null}
  </section>;
}

function PricingDecisionHistory({ history }: { history: OrderPricingWorkspace['history'] }) {
  if (!history.length) return null;
  return <details className="rounded-xl border border-sf-line-soft bg-sf-soft-0 p-3"><summary className="cursor-pointer text-xs font-extrabold text-sf-body">Pricing history ({history.length})</summary><div className="mt-3 space-y-2">{history.map((entry) => <div key={entry.id} className="rounded-lg bg-white p-3 text-xs text-sf-muted"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sf-strong">v{entry.decisionVersion} · {entry.itemName}</strong><span className="font-extrabold uppercase">{entry.state.replaceAll('_', ' ')}</span></div><p className="mt-1">Entered {entry.approvedRate == null ? 'not approved' : currency.format(entry.approvedRate)} · reference {entry.proposedRate == null ? 'none' : currency.format(entry.proposedRate)} · {entry.sourceType.replaceAll('_', ' ')}</p><p className="mt-1">Requested by {entry.requestedBy} · {new Date(entry.requestedAt).toLocaleString('en-IN')}</p>{entry.approvedBy ? <p className="mt-1">Approved by {entry.approvedBy}{entry.approvedAt ? ` · ${new Date(entry.approvedAt).toLocaleString('en-IN')}` : ''}</p> : null}{entry.exceptionReason ? <p className="mt-1 text-sf-danger">Reason: {entry.exceptionReason}</p> : null}{entry.invalidationReason ? <p className="mt-1 font-bold text-sf-danger">Invalidated: {entry.invalidationReason}</p> : null}<p className="mt-1">Policy {entry.policyVersion} · {entry.guardrail.replaceAll('_', ' ')}</p></div>)}</div></details>;
}

function PricingLineCard({ line, entry, compact, onChange }: { line: PricingLineResolution; entry: { rate: string; reason: string }; compact: boolean; onChange: (value: { rate: string; reason: string }) => void }) {
  return <section className="rounded-xl border border-sf-line-soft bg-white p-3 text-xs text-sf-label">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><strong className="block text-sm text-sf-strong">{line.itemName}</strong><span>{formatQuantity(line.quantity)} ordered · {line.resolution.replaceAll('_', ' ')}</span></div><span className={`rounded-full px-2 py-1 font-extrabold ${line.guardrail === 'PRICE_OK' ? 'bg-sf-success-soft text-sf-success' : 'bg-sf-warning-soft text-sf-warning'}`}>{line.guardrail.replaceAll('_', ' ')}</span></div>
    {line.source.reference ? <p className="mt-2">Source: {line.source.reference} · {line.source.date}</p> : null}
    {line.warnings.length ? <p className="mt-2 font-extrabold text-sf-warning">{line.warnings.join(' · ').replaceAll('_', ' ')}</p> : null}
    {compact ? <p className="mt-2 flex items-center gap-1 rounded-lg bg-sf-success-soft p-3 font-bold text-sf-success"><CircleCheck aria-hidden="true" className="shrink-0" size={14} />Governed price: {line.proposedRate == null ? 'Unavailable' : currency.format(line.proposedRate)}</p> : <PricingOptions line={line} entry={entry} onChange={onChange}/>}
  </section>;
}

function PriceExceptionDecision({ exception, actorRole, actorRoles, onChanged }: { exception: OrderPricingWorkspace['exceptions'][number]; actorRole: string; actorRoles?: readonly StockFlowRole[]; onChanged: () => Promise<void> }) {
  const canApprove = hasAnyStockFlowRole(actorRoles ?? [actorRole as StockFlowRole], ['administrator', 'management']);
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  async function decide(action: 'approve_price_exception' | 'reject_price_exception') {
    setBusy(true); setMessage('');
    try {
      await readResponse(await fetch('/api/pricing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, payload: { exceptionId: exception.id, expectedVersion: exception.version, reason: reason.trim() || 'Price reviewed and approved', idempotencyKey: crypto.randomUUID() } }) }));
      await onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Decision could not be saved'); }
    finally { setBusy(false); }
  }
  return <section className="rounded-xl border border-sf-warning-line bg-sf-warning-soft p-3 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sf-warning">Approve price · {currency.format(exception.enteredRate)}</strong>{canApprove ? <button type="button" disabled={busy} onClick={() => void decide('approve_price_exception')} className="min-h-9 rounded-lg bg-sf-success px-4 font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Approve'}</button> : null}</div><p className="mt-1 text-sf-warning">{exception.reason}</p>{canApprove ? <><input aria-label="Price decision note" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} placeholder="Optional approval note · required to reject" className="mt-2 min-h-10 w-full rounded-lg border border-sf-warning-line bg-white px-3"/><button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void decide('reject_price_exception')} className="mt-2 min-h-9 rounded-lg border border-sf-danger-line px-3 font-bold text-sf-danger disabled:opacity-50">Reject</button></> : <p className="mt-2 font-bold text-sf-warning">Management approval pending.</p>}{message ? <p role="alert" className="mt-2 text-sf-danger">{message}</p> : null}</section>;
}

function OrderNotePanel({ order, onSave }: { order: OrderSummary; onSave: (order: OrderSummary, note: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return <div className="mt-5 border-t border-sf-line-soft pt-4"><button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="font-bold text-sf-body">{open ? '− Hide note' : '+ Add activity note'}</button>{open ? <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"><textarea value={note} onChange={(event) => setNote(event.target.value)} minLength={3} maxLength={1000} rows={2} placeholder="Call update or internal handoff note" className="rounded-xl border border-sf-line bg-white p-3 text-sm text-sf-strong outline-none focus:border-sf-mint"/><button type="button" disabled={busy || note.trim().length < 3} onClick={async () => { setBusy(true); try { await onSave(order, note.trim()); setNote(''); setOpen(false); } finally { setBusy(false); } }} className="min-h-10 self-end rounded-xl bg-sf-body px-4 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Add note'}</button></div> : null}</div>;
}

function OrderActivityLog({ orderId, initialEvents }: { orderId: string; initialEvents: OrderEvent[] }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState(() => initialEvents.map(activityEventForDisplay));
  const [loaded, setLoaded] = useState(initialEvents.length > 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function loadEvents() {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const result = await readResponse<{ events: OrderEvent[] }>(await fetch(`/api/orders?eventsFor=${encodeURIComponent(orderId)}`, { cache: 'no-store' }));
      setEvents((result.events || []).map(activityEventForDisplay));
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
  return <div className="mt-5 border-t border-sf-line-soft pt-4"><button type="button" onClick={toggle} aria-expanded={open} className="font-bold text-sf-body">{open ? '−' : '+'} Activity log</button>{open ? loading ? <p className="mt-2 text-xs text-sf-subtle">Loading activity…</p> : error ? <div className="mt-2 flex items-center gap-3"><p role="alert" className="text-xs text-sf-danger">{error}</p><button type="button" onClick={() => void loadEvents()} className="text-xs font-bold text-sf-body">Retry</button></div> : events.length ? <ol className="mt-3 space-y-3">{events.map((event) => <li key={event.id} className="grid grid-cols-[10px_1fr] gap-3"><span className="mt-1.5 size-2.5 rounded-full bg-sf-mint" /><div><p className="font-bold text-sf-strong">{orderEventDescription(event)}</p><p className="mt-0.5 text-xs text-sf-subtle">{event.actorEmail} ({event.actorRole}) · {new Date(event.createdAt).toLocaleString('en-IN')}</p>{event.reason ? <p className="mt-1 text-xs text-sf-danger">{event.eventType === 'order_note_added' ? 'Note' : 'Reason'}: {event.reason}</p> : null}</div></li>)}</ol> : <p className="mt-2 text-xs text-sf-subtle">No recorded activity yet.</p> : null}</div>;
}

function activityEventForDisplay(event: OrderEvent): OrderEvent {
  return ['order_assignment_changed', 'order_priority_changed'].includes(event.eventType)
    ? { ...event, eventType: orderEventDescription(event), toStatus: null }
    : event;
}

async function readOrderSubmission(response: Response) {
  const body = (await response.json().catch(() => ({}))) as CreatedOrderResult & { error?: string };
  if (!response.ok) throw orderSubmissionError(response.status, body?.error);
  const orderNumber = confirmedOrderNumber(body);
  if (!orderNumber) throw new OrderSubmissionError('Order acknowledgement is incomplete. Retry the saved submission.', 'retryable');
  return { ...body, orderNumber };
}

function InstallationPanel({ order, canManage, onSave }: { order: OrderSummary; canManage: boolean; onSave: (order: OrderSummary, command: Extract<OrderCommand, { action: 'schedule_installation' | 'complete_installation' }>) => Promise<void> }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [tallyKey, setTallyKey] = useState(order.lines[0]?.tallyKey || ''); const [scheduledDate, setScheduledDate] = useState('');
  const [siteContact, setSiteContact] = useState(''); const [engineerEmail, setEngineerEmail] = useState('');
  const [completion, setCompletion] = useState<Record<string, { serial: string; notes: string }>>({});
  const installations = order.installations || []; const scheduled = installations.filter((item) => item.status === 'scheduled').length;
  if (!canManage && !installations.length) return null;
  if (!canManage) return (
    <div className="mt-5 border-t border-sf-line-soft pt-4">
      <button type="button" onClick={() => setOpen(value => !value)} className="font-bold text-sf-body">{open ? '−' : '+'} Equipment installation{scheduled ? ` (${scheduled} scheduled)` : ''}</button>
      {open ? <div className="mt-3 space-y-3 rounded-xl bg-white p-4">{installations.map(item => (
        <div key={item.id} className="rounded-lg border border-sf-line-soft p-3">
          <div className="flex flex-wrap justify-between gap-2"><strong className="text-sf-strong">{item.itemName}</strong><span className="text-xs font-bold capitalize text-sf-muted">{item.status}</span></div>
          <p className="mt-1 text-xs text-sf-subtle">Scheduled {new Date(`${item.scheduledDate}T00:00:00`).toLocaleDateString('en-IN')}{item.engineerEmail ? ` · ${item.engineerEmail}` : ''}</p>
          {item.status === 'completed' ? <p className="mt-2 text-xs text-sf-success">Serial {item.serialNumber} · {item.commissioningNotes}</p> : null}
        </div>
      ))}</div> : null}
    </div>
  );
  return <div className="mt-5 border-t border-sf-line-soft pt-4"><button type="button" onClick={() => setOpen((value) => !value)} className="font-bold text-sf-body">{open ? '−' : '+'} Equipment installation{scheduled ? ` (${scheduled} scheduled)` : ''}</button>{open ? <div className="mt-3 space-y-3 rounded-xl bg-white p-4">{installations.map((item) => { const current = completion[item.id] || { serial: '', notes: '' }; return <div key={item.id} className="rounded-lg border border-sf-line-soft p-3"><div className="flex flex-wrap justify-between gap-2"><strong className="text-sf-strong">{item.itemName}</strong><span className="text-xs font-bold capitalize text-sf-muted">{item.status}</span></div><p className="mt-1 text-xs text-sf-subtle">Scheduled {new Date(`${item.scheduledDate}T00:00:00`).toLocaleDateString('en-IN')}{item.engineerEmail ? ` · ${item.engineerEmail}` : ''}</p>{item.status === 'completed' ? <p className="mt-2 text-xs text-sf-success">Serial {item.serialNumber} · {item.commissioningNotes}</p> : <div className="mt-3 grid gap-2 sm:grid-cols-[160px_1fr_auto]"><input value={current.serial} onChange={(event) => setCompletion((value) => ({ ...value, [item.id]: { ...current, serial: event.target.value } }))} placeholder="Serial number" maxLength={100} className="min-h-10 rounded-lg border px-3 text-xs" /><input value={current.notes} onChange={(event) => setCompletion((value) => ({ ...value, [item.id]: { ...current, notes: event.target.value } }))} placeholder="Commissioning checks / notes" maxLength={1000} className="min-h-10 rounded-lg border px-3 text-xs" /><button type="button" disabled={busy || current.serial.trim().length < 2 || current.notes.trim().length < 3} onClick={async () => { setBusy(true); try { await onSave(order, { action: 'complete_installation', payload: { orderId: order.id, expectedVersion: order.version, installationId: item.id, serialNumber: current.serial.trim(), commissioningNotes: current.notes.trim() } }); } finally { setBusy(false); } }} className="min-h-10 rounded-lg border border-sf-accent-line px-3 text-xs font-bold text-sf-success disabled:opacity-50">Complete</button></div>}</div>; })}<div className="grid gap-2 border-t border-sf-line-soft pt-3 sm:grid-cols-2"><select value={tallyKey} onChange={(event) => setTallyKey(event.target.value)} className="min-h-10 rounded-lg border px-2 text-xs">{order.lines.map((line) => <option key={line.tallyKey} value={line.tallyKey}>{line.itemName}</option>)}</select><input type="date" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} className="min-h-10 rounded-lg border px-3 text-xs" /><input value={siteContact} onChange={(event) => setSiteContact(event.target.value)} placeholder="Site contact (optional)" maxLength={200} className="min-h-10 rounded-lg border px-3 text-xs" /><input type="email" maxLength={254} value={engineerEmail} onChange={(event) => setEngineerEmail(event.target.value)} placeholder="Engineer email (optional)" className="min-h-10 rounded-lg border px-3 text-xs" /></div><div className="flex justify-end"><button type="button" disabled={busy || !tallyKey || !scheduledDate || order.status === 'cancelled'} onClick={async () => { setBusy(true); try { await onSave(order, { action: 'schedule_installation', payload: { orderId: order.id, expectedVersion: order.version, tallyKey, scheduledDate, siteContact: siteContact.trim(), engineerEmail: engineerEmail.trim() } }); } finally { setBusy(false); } }} className="min-h-10 rounded-lg bg-sf-ink px-4 text-xs font-bold text-white disabled:opacity-50">Schedule installation</button></div><p className="text-xs text-sf-subtle">Use this only for equipment lines. Reagents need no installation record.</p></div> : null}</div>;
}

function DeliveryExceptionPanel({ order, canManage, onSave }: { order: OrderSummary; canManage: boolean; onSave: (order: OrderSummary, command: Extract<OrderCommand, { action: 'create_exception' | 'resolve_exception' }>) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<'delayed' | 'failed_delivery' | 'damaged' | 'wrong_item' | 'other'>('delayed');
  const [summary, setSummary] = useState('');
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const exceptions = order.exceptions || [];
  const openCount = exceptions.filter((item) => item.status === 'open').length;
  if (!canManage && !exceptions.length) return null;
  if (!canManage) return (
    <div className="mt-5 border-t border-sf-line-soft pt-4">
      <button type="button" onClick={() => setOpen(value => !value)} className="font-bold text-sf-body">{open ? '−' : '+'} Delivery exceptions{openCount ? ` (${openCount} open)` : ''}</button>
      {open ? <div className="mt-3 space-y-3 rounded-xl bg-white p-4">{exceptions.map(item => (
        <div key={item.id} className="rounded-lg border border-sf-line-soft p-3">
          <div className="flex flex-wrap justify-between gap-2"><strong className="capitalize text-sf-strong">{item.category.replaceAll('_', ' ')}</strong><span className="text-xs font-bold text-sf-muted">{item.status}</span></div>
          <p className="mt-1 text-xs text-sf-muted">{item.summary}</p>
          {item.status === 'resolved' ? <p className="mt-2 text-xs text-sf-success">Resolution: {item.resolution}</p> : null}
        </div>
      ))}</div> : null}
    </div>
  );
  return <div className="mt-5 border-t border-sf-line-soft pt-4"><button type="button" onClick={() => setOpen((value) => !value)} className="font-bold text-sf-body">{open ? '−' : '+'} Delivery exceptions{openCount ? ` (${openCount} open)` : ''}</button>{open ? <div className="mt-3 space-y-3 rounded-xl bg-white p-4">{exceptions.map((item) => <div key={item.id} className="rounded-lg border border-sf-line-soft p-3"><div className="flex flex-wrap justify-between gap-2"><strong className="capitalize text-sf-strong">{item.category.replaceAll('_', ' ')}</strong><span className={`rounded-full px-2 py-1 text-[11px] font-bold ${item.status === 'open' ? 'bg-sf-warning-soft text-sf-warning' : 'bg-sf-accent-soft text-sf-success'}`}>{item.status}</span></div><p className="mt-1 text-xs text-sf-muted">{item.summary}</p>{item.status === 'resolved' ? <p className="mt-2 text-xs text-sf-success">Resolution: {item.resolution}</p> : <div className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={resolutions[item.id] || ''} onChange={(event) => setResolutions((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="How was it resolved?" maxLength={500} className="min-h-10 flex-1 rounded-lg border px-3 text-xs" /><button type="button" disabled={busy || (resolutions[item.id] || '').trim().length < 3} onClick={async () => { setBusy(true); try { await onSave(order, { action: 'resolve_exception', payload: { orderId: order.id, expectedVersion: order.version, exceptionId: item.id, resolution: resolutions[item.id].trim() } }); } finally { setBusy(false); } }} className="min-h-10 rounded-lg border border-sf-accent-line px-3 text-xs font-bold text-sf-success disabled:opacity-50">Resolve</button></div>}</div>)}<div className="grid gap-2 border-t border-sf-line-soft pt-3 sm:grid-cols-[170px_1fr_auto]"><select value={category} onChange={(event) => setCategory(event.target.value as typeof category)} className="min-h-10 rounded-lg border px-2 text-xs"><option value="delayed">Delayed</option><option value="failed_delivery">Failed delivery</option><option value="damaged">Damaged</option><option value="wrong_item">Wrong item</option><option value="other">Other</option></select><input value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={500} placeholder="What happened?" className="min-h-10 rounded-lg border px-3 text-xs" /><button type="button" disabled={busy || summary.trim().length < 3 || ['cancelled', 'delivered'].includes(order.status)} onClick={async () => { setBusy(true); try { await onSave(order, { action: 'create_exception', payload: { orderId: order.id, expectedVersion: order.version, category, summary: summary.trim() } }); setSummary(''); } finally { setBusy(false); } }} className="min-h-10 rounded-lg bg-sf-ink px-3 text-xs font-bold text-white disabled:opacity-50">Add exception</button></div>{['cancelled', 'delivered'].includes(order.status) ? <p className="text-xs text-sf-subtle">Closed orders cannot receive new exceptions.</p> : null}</div> : null}</div>;
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
  return <div className="mt-5 flex flex-col gap-2 border-t border-sf-line-soft pt-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold text-sf-body">Tally billing handoff</p><p className="text-xs text-sf-subtle">Copies the customer, products, quantities, delivery details, and notes.</p>{state === 'error' ? <p className="mt-1 text-xs font-bold text-sf-danger">Copy was blocked. Please allow clipboard access and try again.</p> : null}</div><button type="button" onClick={() => void copy()} className="min-h-10 shrink-0 rounded-xl border border-sf-accent-line bg-white px-4 text-sm font-bold text-sf-success hover:bg-sf-accent-soft">{state === 'copied' ? 'Copied' : 'Copy for Tally'}</button></div>;
}

function OrderDraftNotice({ changed, busy, onLoadLatest }: { changed: boolean; busy: boolean; onLoadLatest: () => void }) {
  if (!changed) return null;
  return <div className="col-span-full flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sf-warning-line bg-sf-warning-soft px-3 py-2 text-xs text-sf-warning"><span>This order changed since you started editing.</span><button type="button" disabled={busy} onClick={onLoadLatest} className="min-h-9 rounded-lg border border-sf-warning-line bg-white px-3 font-bold disabled:opacity-50">Load latest</button></div>;
}

function OrderEditPanel({ order, onSave }: { order: OrderSummary; onSave: (order: OrderSummary, payload: Extract<OrderCommand, { action: 'edit_order' }>['payload']) => Promise<void> }) {
  const [open,setOpen]=useState(false); const [busy,setBusy]=useState(false); const [customerName,setCustomerName]=useState(order.customerName); const [customerPhone,setCustomerPhone]=useState(order.customerPhone||''); const [notes,setNotes]=useState(order.notes||''); const [reason,setReason]=useState(''); const [lines,setLines]=useState(()=>order.lines.map(line=>({tallyKey:line.tallyKey,itemName:line.itemName,quantity:Math.max(1,Math.round(line.quantity)),fulfilled:Math.max(0,Math.round(Number(line.fulfilledQuantity||0)))})));
  const [baseVersion, setBaseVersion] = useState(order.version);
  function resetDrafts() {
    setCustomerName(order.customerName);
    setCustomerPhone(order.customerPhone || '');
    setNotes(order.notes || '');
    setReason('');
    setLines(order.lines.map((line) => ({ tallyKey: line.tallyKey, itemName: line.itemName, quantity: Math.max(1, Math.round(line.quantity)), fulfilled: Math.max(0, Math.round(Number(line.fulfilledQuantity || 0))) })));
    setBaseVersion(order.version);
  }
  const reasonRequired=!['phone_order_received','awaiting_confirmation','awaiting_approval'].includes(order.status);
  return <div className="mt-5 border-t border-sf-line-soft pt-4"><button type="button" onClick={() => { if (!open) resetDrafts(); setOpen((value) => !value); }} className="font-bold text-sf-body">{open?'−':'+'} Edit order</button>{open?<div className="mt-3 space-y-3 rounded-xl bg-white p-4"><OrderDraftNotice changed={order.version !== baseVersion} busy={busy} onLoadLatest={resetDrafts} /><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold">Customer name<input maxLength={200} value={customerName} onChange={e=>setCustomerName(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border px-3 font-normal" /></label><label className="text-xs font-bold">Phone<input maxLength={40} value={customerPhone} onChange={e=>setCustomerPhone(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border px-3 font-normal" /></label></div>{lines.map((line,index)=><label key={line.tallyKey} className="grid grid-cols-[1fr_110px] items-center gap-3 text-xs font-bold">{line.itemName}<input type="number" min={Math.max(line.fulfilled,1)} max="1000000" step="1" value={line.quantity} onChange={e=>setLines(current=>current.map((item,i)=>i===index?{...item,quantity:Number(e.target.value)}:item))} className="min-h-10 rounded-lg border px-2 text-right font-normal" /></label>)}<label className="text-xs font-bold">Notes<textarea maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border p-2 font-normal" /></label>{reasonRequired?<label className="text-xs font-bold text-sf-danger">Reason for change<textarea required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border p-2 font-normal" /></label>:null}<div className="flex justify-end"><button type="button" disabled={busy||customerName.trim().length<2||(reasonRequired&&!reason.trim())} onClick={async()=>{setBusy(true);try{await onSave(order,{orderId:order.id,expectedVersion:baseVersion,customerName:customerName.trim(),customerPhone:customerPhone.trim(),notes:notes.trim(),reason:reason.trim(),lines:lines.map(({tallyKey,quantity})=>({tallyKey,quantity}))});}finally{setBusy(false)}}} className="min-h-10 rounded-xl bg-sf-ink px-4 font-bold text-white disabled:opacity-50">{busy?'Saving…':'Save changes'}</button></div></div>:null}</div>;
}

function FulfilmentEditor({ order, onSave }: { order: OrderSummary; onSave: (order: OrderSummary, payload: Extract<OrderCommand, { action: 'save_fulfilment' }>['payload']) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState(order.deliveryAddress || '');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(order.expectedDeliveryDate || '');
  const [lines, setLines] = useState(() => order.lines.map((line) => ({ tallyKey: line.tallyKey, itemName: line.itemName, quantity: Math.max(1, Math.round(line.quantity)), fulfilledQuantity: Math.max(0, Math.round(Number(line.fulfilledQuantity || 0))) })));
  const [baseVersion, setBaseVersion] = useState(order.version);
  function resetDrafts() {
    setDeliveryAddress(order.deliveryAddress || '');
    setExpectedDeliveryDate(order.expectedDeliveryDate || '');
    setLines(order.lines.map((line) => ({ tallyKey: line.tallyKey, itemName: line.itemName, quantity: Math.max(1, Math.round(line.quantity)), fulfilledQuantity: Math.max(0, Math.round(Number(line.fulfilledQuantity || 0))) })));
    setBaseVersion(order.version);
  }
  const backOrdered = lines.reduce((sum, line) => sum + Math.max(line.quantity - line.fulfilledQuantity, 0), 0);
  return <div className="mt-5 border-t border-sf-line-soft pt-4"><button type="button" onClick={() => { if (!open) resetDrafts(); setOpen((value) => !value); }} className="font-bold text-sf-body">{open ? '−' : '+'} Fulfilment details</button>{open ? <div className="mt-3 space-y-4 rounded-xl bg-white p-4"><OrderDraftNotice changed={order.version !== baseVersion} busy={busy} onLoadLatest={resetDrafts} /><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-sf-muted">Expected delivery<input type="date" value={expectedDeliveryDate} onChange={(event) => setExpectedDeliveryDate(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-sf-line px-3 font-normal" /></label><label className="text-xs font-bold text-sf-muted">Delivery address<input maxLength={1000} value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-sf-line px-3 font-normal" /></label></div><div className="space-y-2">{lines.map((line, index) => <div key={line.tallyKey} className="grid gap-2 rounded-lg bg-sf-soft p-3 sm:grid-cols-[1fr_120px]"><strong className="text-sm text-sf-strong">{line.itemName}<small className="block font-normal text-sf-subtle">Ordered {formatQuantity(line.quantity)}</small></strong><label className="text-xs font-bold">Fulfilled<input type="number" min="0" max={line.quantity} step="1" value={line.fulfilledQuantity} onChange={(event) => setLines((current) => current.map((item, position) => position === index ? { ...item, fulfilledQuantity: Number(event.target.value) } : item))} className="mt-1 min-h-10 w-full rounded-lg border px-2 font-normal" /></label></div>)}</div><p className="text-xs text-sf-subtle">Batch, expiry and stock adjustments continue to be recorded only in Tally Prime.</p><div className="flex items-center justify-between gap-3"><p className={`text-xs font-bold ${backOrdered > 0 ? 'text-sf-warning' : 'text-sf-accent'}`}>{backOrdered > 0 ? `${formatQuantity(backOrdered)} back-ordered` : 'Fully fulfilled'}</p><button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onSave(order, { orderId: order.id, expectedVersion: baseVersion, deliveryAddress, expectedDeliveryDate: expectedDeliveryDate || undefined, lines: lines.map(({ tallyKey, fulfilledQuantity }) => ({ tallyKey, fulfilledQuantity })) }); } finally { setBusy(false); } }} className="min-h-10 rounded-xl bg-sf-ink px-4 font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save fulfilment'}</button></div></div> : null}</div>;
}

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

type FulfilmentFormProps = { order: OrderSummary; actorRole?: string; actorRoles?: readonly StockFlowRole[]; onSave: (order: OrderSummary, command: DeliveryCommand) => Promise<void> };
function useFulfilmentDraft(order: OrderSummary) {
  const [busy, setBusy] = useState(false);
  const [courierName, setCourierName] = useState(order.courierName || '');
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber || '');
  const [dispatchDate, setDispatchDate] = useState(order.dispatchDate || istToday());
  const [vehicleNumber, setVehicleNumber] = useState(order.vehicleNumber || '');
  const [deliveredAt, setDeliveredAt] = useState(order.deliveredAt ? localDateTimeValue(new Date(order.deliveredAt)) : localDateTimeValue());
  const [receivedBy, setReceivedBy] = useState(order.receivedBy || defaultReceiver(order));
  const [podReference, setPodReference] = useState(order.podReference || '');
  const [baseVersion, setBaseVersion] = useState(order.version);
  function resetDrafts() {
    setCourierName(order.courierName || '');
    setTrackingNumber(order.trackingNumber || '');
    setDispatchDate(order.dispatchDate || istToday());
    setVehicleNumber(order.vehicleNumber || '');
    setDeliveredAt(order.deliveredAt ? localDateTimeValue(new Date(order.deliveredAt)) : localDateTimeValue());
    setReceivedBy(order.receivedBy || defaultReceiver(order));
    setPodReference(order.podReference || '');
    setBaseVersion(order.version);
  }
  return { busy, setBusy, courierName, setCourierName, trackingNumber, setTrackingNumber, dispatchDate, setDispatchDate, vehicleNumber, setVehicleNumber, deliveredAt, setDeliveredAt, receivedBy, setReceivedBy, podReference, setPodReference, baseVersion, resetDrafts };
}
/** What was actually packed, per item: starts at the ordered quantity; lower it for a shortage. */
function PackQuantitiesForm({ order, busy, onSave }: { order: OrderSummary; busy: boolean; onSave: (lines: Array<{ tallyKey: string; fulfilledQuantity: number }>) => void }) {
  const [packed, setPacked] = useState<Record<string, string>>(() => Object.fromEntries(order.lines.map((line) => [line.tallyKey, String(Number(line.fulfilledQuantity) > 0 ? Number(line.fulfilledQuantity) : Number(line.quantity))])));
  const values = order.lines.map((line) => ({ line, value: Number(packed[line.tallyKey]) }));
  const valid = values.every(({ line, value }) => Number.isInteger(value) && value >= 0 && value <= Number(line.quantity));
  const short = values.reduce((sum, { line, value }) => sum + (Number.isFinite(value) ? Math.max(0, Number(line.quantity) - value) : 0), 0);
  return <div className="space-y-3 rounded-xl bg-white p-4">
    <p className="text-sm font-bold text-sf-body">Enter what was packed for each item.</p>
    <ul className="space-y-2">{values.map(({ line, value }) => <li key={line.tallyKey} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3 border-t border-sf-line-soft pt-2">
      <span className="min-w-0"><strong className="block truncate text-sm text-sf-strong">{line.itemName}</strong><span className="text-xs text-sf-subtle">Ordered {formatQuantity(Number(line.quantity))} {line.baseUnit || ''}</span></span>
      <label className="text-xs font-bold text-sf-muted">Packed<input type="number" inputMode="numeric" min={0} max={Number(line.quantity)} step={1} aria-label={`Packed quantity for ${line.itemName}`} value={packed[line.tallyKey] ?? ''} onChange={(event) => setPacked((current) => ({ ...current, [line.tallyKey]: event.target.value }))} className={`mt-1 min-h-11 w-full rounded-lg border px-3 text-right font-normal tabular-nums ${Number.isInteger(value) && value >= 0 && value <= Number(line.quantity) ? 'border-sf-line' : 'border-sf-danger'}`} /></label>
    </li>)}</ul>
    {short > 0 && valid ? <p className="text-xs font-bold text-sf-warning">Short by {formatQuantity(short)}. The rest stays as a back-order.</p> : null}
    {!valid ? <p className="text-xs font-bold text-sf-danger">Packed quantity must be a whole number between 0 and the ordered quantity.</p> : null}
    <button type="button" disabled={busy || !valid} onClick={() => onSave(values.map(({ line, value }) => ({ tallyKey: line.tallyKey, fulfilledQuantity: value })))} className="min-h-12 w-full rounded-xl bg-sf-ink px-4 text-base font-bold text-white hover:bg-sf-ink-hover disabled:opacity-50">{busy ? 'Saving…' : 'Save and mark packed'}</button>
  </div>;
}

function DispatchForm({ order, actorRole, actorRoles, onSave, initialMode }: FulfilmentFormProps & { initialMode?: DispatchMode }) {
  const { busy, setBusy, courierName, setCourierName, trackingNumber, setTrackingNumber, dispatchDate, setDispatchDate, vehicleNumber, setVehicleNumber, baseVersion, resetDrafts } = useFulfilmentDraft(order);
  const [error, setError] = useState('');
  const canUpdate = hasAnyStockFlowRole(actorRoles ?? [actorRole as StockFlowRole], ['administrator', 'operations']);
  const save = async (current: OrderSummary, command: DeliveryCommand) => {
    setError('');
    try { await onSave(current, command); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Delivery details could not be saved'); }
  };
  const [mode, setMode] = useState<DispatchMode>(() => initialMode ?? (!order.courierName || isLocalDelivery(order) ? 'local' : 'outstation'));
  const choices = courierChoices(order.courierName);
  const [typingOther, setTypingOther] = useState(() => Boolean(order.courierName) && !isLocalDelivery(order) && !choices.includes(order.courierName!));
  const local = mode === 'local';
  const courier = local ? LOCAL_DELIVERY.courierName : courierName.trim();
  const docket = local ? LOCAL_DELIVERY.trackingNumber : trackingNumber.trim();
  const field = 'mt-1 min-h-11 min-w-0 w-full rounded-lg border border-sf-line bg-white px-3 font-normal';
  return <div className="min-w-0">{error ? <p role="alert" className="text-sm text-sf-danger">{error}</p> : null}<div className="mt-3 grid gap-3 rounded-xl bg-white p-4 sm:grid-cols-2"><OrderDraftNotice changed={order.version !== baseVersion} busy={busy} onLoadLatest={resetDrafts} />
    <label className="text-sm font-bold sm:col-span-2">Delivery type<select aria-label="Delivery type" value={mode} onChange={(event) => setMode(event.target.value as DispatchMode)} className={field}><option value="local">Local delivery (our staff)</option><option value="outstation">Outstation courier</option></select></label>
    {local ? null : <><label className="text-sm font-bold">Courier<select aria-label="Courier" value={typingOther ? '__other' : choices.includes(courierName) ? courierName : ''} onChange={(event) => { if (event.target.value === '__other') { setTypingOther(true); setCourierName(''); } else { setTypingOther(false); setCourierName(event.target.value); } }} className={field}><option value="" disabled>Choose courier…</option>{choices.map((name) => <option key={name} value={name}>{name}</option>)}<option value="__other">Other…</option></select></label>
      {typingOther ? <label className="text-sm font-bold">Courier name<input maxLength={160} value={courierName} onChange={(event) => setCourierName(event.target.value)} className={field} /></label> : null}
      <label className="text-sm font-bold">Docket number<input maxLength={160} inputMode="text" value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} className={field} /></label></>}
    <label className="text-sm font-bold">Dispatch date<input type="date" value={dispatchDate} onChange={(event) => setDispatchDate(event.target.value)} className={field} /></label><label className="text-sm font-bold">{local ? 'Delivered by / vehicle' : 'Vehicle number'} <span className="font-normal text-sf-subtle">(optional)</span><input value={vehicleNumber} onChange={(event) => setVehicleNumber(event.target.value)} maxLength={40} className={field} /></label><div className="sm:col-span-2 flex justify-end"><button type="button" disabled={!canUpdate || busy || courier.length < 2 || docket.length < 2 || !dispatchDate} onClick={async () => { setBusy(true); try { await save(order, { action: 'save_dispatch', payload: { orderId: order.id, expectedVersion: baseVersion, courierName: courier, trackingNumber: docket, dispatchDate, vehicleNumber: vehicleNumber.trim() } }); } finally { setBusy(false); } }} className="min-h-11 w-full rounded-xl bg-sf-ink px-5 font-bold text-white disabled:opacity-50 sm:w-auto">{busy ? 'Saving…' : local ? 'Dispatch · local delivery' : 'Dispatch by courier'}</button></div></div></div>;
}
function DeliveryForm({ order, actorRole, actorRoles, onSave }: FulfilmentFormProps) {
  const { busy, setBusy, deliveredAt, setDeliveredAt, receivedBy, setReceivedBy, podReference, setPodReference, baseVersion, resetDrafts } = useFulfilmentDraft(order);
  const [error, setError] = useState('');
  const canUpdate = hasAnyStockFlowRole(actorRoles ?? [actorRole as StockFlowRole], ['administrator', 'operations']);
  const save = async (current: OrderSummary, command: DeliveryCommand) => {
    setError('');
    try { await onSave(current, command); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Delivery details could not be saved'); }
  };
  return <div className="min-w-0">{error ? <p role="alert" className="text-sm text-sf-danger">{error}</p> : null}<div className="mt-3 grid gap-3 rounded-xl bg-white p-4 sm:grid-cols-2"><OrderDraftNotice changed={order.version !== baseVersion} busy={busy} onLoadLatest={resetDrafts} /><p className="sm:col-span-2 text-sm text-sf-muted">{order.courierName} · {order.trackingNumber}{order.vehicleNumber ? ` · ${order.vehicleNumber}` : ''}</p><label className="text-sm font-bold">Delivered at<input type="datetime-local" value={deliveredAt} onChange={(event) => setDeliveredAt(event.target.value)} className="mt-1 min-h-11 min-w-0 w-full rounded-lg border border-sf-line px-3 font-normal" /></label><label className="text-sm font-bold">Received by<input required value={receivedBy} onChange={(event) => setReceivedBy(event.target.value)} maxLength={160} className="mt-1 min-h-11 min-w-0 w-full rounded-lg border border-sf-line px-3 font-normal" /></label><label className="text-sm font-bold sm:col-span-2">Proof of delivery reference <span className="font-normal text-sf-subtle">(optional)</span><input value={podReference} onChange={(event) => setPodReference(event.target.value)} maxLength={160} className="mt-1 min-h-11 min-w-0 w-full rounded-lg border border-sf-line px-3 font-normal" /></label><div className="sm:col-span-2 flex justify-end"><button type="button" disabled={!canUpdate || busy || receivedBy.trim().length < 2 || !deliveredAt} onClick={async () => { setBusy(true); try { await save(order, { action: 'confirm_delivery', payload: { orderId: order.id, expectedVersion: baseVersion, deliveredAt: new Date(deliveredAt).toISOString(), receivedBy: receivedBy.trim(), podReference: podReference.trim() } }); } finally { setBusy(false); } }} className="min-h-11 rounded-xl bg-sf-ink px-5 font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Confirm delivery'}</button></div></div></div>;
}
function DispatchPanel(props: FulfilmentFormProps) {
  const { order } = props;
  if (order.status === 'delivered') return <div className="mt-5 border-t border-sf-line-soft pt-4"><p className="font-bold text-sf-body">Delivery confirmation</p><p className="mt-2 text-sm text-sf-muted">Received by {order.receivedBy} on {order.deliveredAt ? new Date(order.deliveredAt).toLocaleString('en-IN') : '—'}{order.podReference ? ` · POD ${order.podReference}` : ''}</p></div>;
  return <div className="mt-5 border-t border-sf-line-soft pt-4"><p className="font-bold text-sf-body">{order.status === 'ready_for_dispatch' ? 'Dispatch details' : 'Delivery confirmation'}</p>{order.status === 'ready_for_dispatch' ? <DispatchForm {...props} /> : <DeliveryForm {...props} />}</div>;
}

function NewOrderPanel({ data, templateOrder, onClose, onCreated, onViewCustomer }: { data: OrderBootstrap; templateOrder: OrderSummary | null; onClose: () => void; onCreated: (number: string, command?: CreatedOrderCommand, result?: CreatedOrderResult) => void; onViewCustomer: (customerName: string) => void }) {
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!hydrated) return null;
  return <HydratedNewOrderPanel data={data} templateOrder={templateOrder} onClose={onClose} onCreated={onCreated} onViewCustomer={onViewCustomer} />;
}

function OrderFollowUpPanel({ order, actorRole, actorRoles, onSave }: { order: OrderSummary; actorRole: string; actorRoles?: readonly StockFlowRole[]; onSave: (order: OrderSummary, command: Extract<OrderCommand, { action: 'set_order_follow_up' | 'complete_order_follow_up' }>) => Promise<void> }) {
  const canManage = hasAnyStockFlowRole(actorRoles ?? [actorRole as StockFlowRole], ['administrator', 'sales', 'operations', 'accounts', 'management']);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [followUpDate, setFollowUpDate] = useState(order.followUpDate || '');
  const [followUpNote, setFollowUpNote] = useState(order.followUpNote || '');
  const [baseVersion, setBaseVersion] = useState(order.version);
  function resetDrafts() {
    setFollowUpDate(order.followUpDate || '');
    setFollowUpNote(order.followUpNote || '');
    setBaseVersion(order.version);
  }
  if (!canManage) return null;
  return <div className="mt-3 rounded-xl border border-sf-line-soft bg-sf-soft-0 p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="text-sf-body">Customer follow-up</strong>{order.followUpDate ? <p className="mt-1 text-xs text-sf-subtle">{order.followUpDate} · {order.followUpNote}</p> : <p className="mt-1 text-xs text-sf-subtle">No follow-up scheduled</p>}</div><div className="flex gap-2">{order.followUpDate ? <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onSave(order, { action: 'complete_order_follow_up', payload: { orderId: order.id, expectedVersion: baseVersion } }); setFollowUpDate(''); setFollowUpNote(''); setBaseVersion(order.version); } finally { setBusy(false); } }} className="min-h-9 rounded-lg border border-sf-accent-line bg-white px-3 text-xs font-bold text-sf-accent disabled:opacity-50">{busy ? 'Saving…' : 'Done'}</button> : null}<button type="button" onClick={() => { if (!open) resetDrafts(); setOpen((value) => !value); }} aria-expanded={open} className="min-h-9 rounded-lg border border-sf-line bg-white px-3 text-xs font-bold text-sf-body">{open ? 'Close' : order.followUpDate ? 'Change' : 'Schedule'}</button></div></div>
    {open ? <div className="mt-3 grid gap-2 border-t border-sf-line-soft pt-3 sm:grid-cols-[160px_1fr_auto]"><OrderDraftNotice changed={order.version !== baseVersion} busy={busy} onLoadLatest={resetDrafts} /><label className="text-xs font-bold text-sf-muted">Follow-up date<input type="date" min={new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })} value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-sf-line bg-white px-2 font-normal" /></label><label className="text-xs font-bold text-sf-muted">Purpose<input maxLength={500} value={followUpNote} onChange={(event) => setFollowUpNote(event.target.value)} placeholder="Confirm quantities, call customer…" className="mt-1 min-h-10 w-full rounded-lg border border-sf-line bg-white px-3 font-normal" /></label><button type="button" disabled={busy || !followUpDate || followUpNote.trim().length < 3} onClick={async () => { setBusy(true); try { await onSave(order, { action: 'set_order_follow_up', payload: { orderId: order.id, expectedVersion: baseVersion, followUpDate, followUpNote: followUpNote.trim() } }); setOpen(false); } finally { setBusy(false); } }} className="min-h-10 self-end rounded-lg bg-sf-body px-4 text-xs font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save follow-up'}</button></div> : null}
  </div>;
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
  return <div className="mt-3 flex items-center gap-3"><button type="button" onClick={() => void copy()} className="min-h-10 rounded-xl border border-sf-line px-4 text-sm font-bold text-sf-body hover:bg-sf-soft">{state === 'copied' ? 'Summary copied' : 'Copy order summary'}</button>{state === 'error' ? <span className="text-xs font-bold text-sf-danger">Clipboard access was blocked.</span> : null}</div>;
}

function PriorityControl({ order, onSave }: { order: OrderSummary; onSave: (order: OrderSummary, priority: 'normal' | 'high' | 'urgent') => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return <label className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-sf-muted">Priority<select value={order.priority || 'normal'} disabled={busy} onChange={async (event) => { setBusy(true); try { await onSave(order, event.target.value as 'normal' | 'high' | 'urgent'); } finally { setBusy(false); } }} className="min-h-10 rounded-xl border border-sf-line bg-white px-3 text-sm font-normal text-sf-strong"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>;
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
  return <details onToggle={(event) => { if (event.currentTarget.open) void loadUsers(); }} className="mt-3 max-w-xl rounded-xl border border-sf-line-soft bg-sf-soft-0 px-3 py-2 text-xs"><summary className="cursor-pointer font-bold text-sf-muted">{order.assignedToEmail ? 'Change owner' : 'Assign owner'}</summary><div className="mt-2 flex flex-col gap-2 sm:flex-row"><label className="flex-1 font-bold text-sf-muted">Approved user<select value={value} disabled={loadState !== 'loaded'} onChange={(event) => setValue(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-sf-line bg-white px-3 font-normal text-sf-strong"><option value="">Unassigned</option>{order.assignedToEmail && !users.some((user) => user.email === order.assignedToEmail) ? <option value={order.assignedToEmail}>{order.assignedToEmail}</option> : null}{users.map((user) => <option key={user.email} value={user.email}>{user.email} · {user.role}</option>)}</select></label><div className="flex items-end"><button type="button" disabled={busy || loadState !== 'loaded' || value === (order.assignedToEmail || '')} onClick={async () => { setBusy(true); try { await onSave(order, value || undefined); } finally { setBusy(false); } }} className="min-h-10 rounded-lg bg-sf-ink px-4 font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button></div></div>{loadState === 'loading' ? <p className="mt-2 text-sf-subtle">Loading approved users…</p> : loadState === 'error' ? <button type="button" onClick={() => { setLoadState('idle'); void loadUsers(); }} className="mt-2 font-bold text-sf-danger">Could not load users · Retry</button> : <p className="mt-2 text-sf-subtle">Only active StockFlow users are shown.</p>}</details>;
}

export function HydratedNewOrderPanel({ data, templateOrder, onClose, onCreated, onViewCustomer }: { data: OrderBootstrap; templateOrder: OrderSummary | null; onClose: () => void; onCreated: (number: string, command?: CreatedOrderCommand, result?: CreatedOrderResult) => void; onViewCustomer: (customerName: string) => void }) {
  const [initialDraft] = useState(() => readOfflineOrderDraft(localStorage, data.actor.email));
  const initialPayload = initialDraft?.command.payload;
  const templatePayload = templateOrder ? repeatOrderTemplate(templateOrder) : undefined;
  const [customerName, setCustomerName] = useState(initialPayload?.customerName || templatePayload?.customerName || '');
  const [customerPhone, setCustomerPhone] = useState(initialPayload?.customerPhone || templatePayload?.customerPhone || '');
  const [customerCity, setCustomerCity] = useState(initialPayload?.customerCity || '');
  const [deliveryAddress, setDeliveryAddress] = useState(initialPayload?.deliveryAddress || '');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | undefined>(initialPayload?.customerId);
  const selectedCustomerKey = selectedCustomerId ? `${data.actor.email.trim().toLocaleLowerCase('en-IN')}:${selectedCustomerId}` : '';
  const [customerSuggestionsOpen, setCustomerSuggestionsOpen] = useState(false);
  const customerBlurTimerRef = useRef<number | null>(null);
  const [activeCustomerIndex, setActiveCustomerIndex] = useState(0);
  const [customerHistory, setCustomerHistory] = useState<{ ownerKey: string; orders: OrderSummary[]; rankingOrders: OrderSummary[]; total: number } | null>(null);
  const [customerHistoryState, setCustomerHistoryState] = useState<'idle' | 'loading' | 'error'>('idle');
  const customerHistoryCacheRef = useRef(new Map<string, { ownerKey: string; orders: OrderSummary[]; rankingOrders: OrderSummary[]; total: number }>());
  const currentCustomerKeyRef = useRef(selectedCustomerKey);
  const [tallyRecent, setTallyRecent] = useState<{ key: string; value: TallyRecentProducts } | null>(null);
  const [tallyRecentError, setTallyRecentError] = useState('');
  const [tallyRecentRetry, setTallyRecentRetry] = useState(0);
  const tallyRecentCache = useRef(new Map<string, { value: TallyRecentProducts; expiresAt: number }>());
  const [notes, setNotes] = useState(initialPayload?.notes || '');
  const [source, setSource] = useState<'phone' | 'email' | 'whatsapp' | 'walk_in'>(initialPayload?.source || 'phone');
  const [priority, setPriority] = useState<'normal' | 'high' | 'urgent'>(initialPayload?.priority || 'normal');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(initialPayload?.expectedDeliveryDate || '');
  const [productQuery, setProductQuery] = useState('');
  const [recentQuantities, setRecentQuantities] = useState<Record<string, string>>({});
  const [expandedRepeatOrderId, setExpandedRepeatOrderId] = useState<string | null>(null);
  const customerSelectedAtRef = useRef<number | null>(null);
  const [activeProductIndex, setActiveProductIndex] = useState(0);
  const focusQuantityKey = useRef<string | null>(null);
  const productInputRef = useRef<HTMLInputElement>(null);
  const [restoredLines] = useState(() => restoreOfflineDraftLines(data.snapshot.catalog, initialPayload?.lines || templatePayload?.lines || []));
  const [lines, setLines] = useState<DraftLine[]>(restoredLines);
  const [submitting, setSubmitting] = useState(false);
  const submissionInFlightRef = useRef(false);
  const pendingSubmissionRef = useRef<Extract<OrderCommand, { action: 'create_order' }> | null>(initialDraft?.state === 'pending' ? initialDraft.command : null);
  const [pendingSubmissionLocked, setPendingSubmissionLocked] = useState(initialDraft?.state === 'pending');
  const [error, setError] = useState(() => offlineDraftRecoveryError(initialDraft, restoredLines.some((line) => !line.item)));
  const [idempotencyKey] = useState(() => initialPayload?.idempotencyKey || crypto.randomUUID());
  const [draftState, setDraftState] = useState<OfflineDraftState>(initialDraft?.state || 'draft');
  const [pinProtectedDevice] = useState(() => pinProtectedOfflineDevice(localStorage));
  const [saveOnDevice, setSaveOnDevice] = useState(() => !pinProtectedOfflineDevice(localStorage) && (Boolean(initialDraft) || readOfflineDraftConsent(localStorage, data.actor.email)));
  const [entryPriceResult, setEntryPriceResult] = useState<{ key: string; prices: Record<string, OrderEntryPrice>; failed: boolean } | null>(null);
  const canViewPrices = hasAnyStockFlowRole(data.actor.roles ?? data.actor.role, ['administrator', 'accounts', 'management']);
  const pricingKeys = lines.map((line) => line.tallyKey).sort().join('\u001f');
  const entryPriceKey = `${selectedCustomerId || ''}\u001e${pricingKeys}`;
  const entryPrices = entryPriceResult?.key === entryPriceKey ? entryPriceResult.prices : {};
  const entryPriceState = entryPriceResult?.key === entryPriceKey ? entryPriceResult.failed ? 'error' : 'idle' : 'loading';

  useEffect(() => () => {
    if (customerBlurTimerRef.current !== null) window.clearTimeout(customerBlurTimerRef.current);
  }, []);

  useEffect(() => {
    if (!focusQuantityKey.current) return;
    document.getElementById(`qty-${focusQuantityKey.current}`)?.focus();
    focusQuantityKey.current = null;
  }, [lines]);

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
        command: { action: 'create_order', payload: { idempotencyKey, customerId: selectedCustomerId, customerName: customerName.trim(), customerPhone: customerPhone.trim(), customerCity: customerCity.trim(), deliveryAddress: deliveryAddress.trim(), source, priority, expectedDeliveryDate: expectedDeliveryDate || undefined, notes: notes.trim(), lines: lines.map((line) => ({ tallyKey: line.tallyKey, quantity: line.quantity })) } },
      });
      if (!saved) setError('This browser could not save the draft. Free device storage or turn off device saving.');
    }, 400);
    return () => window.clearTimeout(timer);
  }, [customerCity, customerName, customerPhone, data.actor.email, deliveryAddress, draftState, expectedDeliveryDate, idempotencyKey, lines, notes, priority, saveOnDevice, selectedCustomerId, source]);

  const notifyRetryCreated = useEffectEvent((number: string) => onCreated(number));
  useEffect(() => {
    let active = true;
    async function retryPending() {
      const saved = readOfflineOrderDraft(localStorage, data.actor.email);
      if (!saved || saved.state !== 'pending' || !navigator.onLine || submissionInFlightRef.current) return;
      submissionInFlightRef.current = true;
      pendingSubmissionRef.current = saved.command;
      setPendingSubmissionLocked(true);
      setSubmitting(true);
      try {
        const response = await fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(saved.command), signal: AbortSignal.timeout(orderSubmissionTimeoutMs) });
        const result = await readOrderSubmission(response);
        removeOfflineOrderDraft(localStorage, data.actor.email);
        if (active) notifyRetryCreated(result.orderNumber);
      } catch (cause) {
        if (cause instanceof OrderSubmissionError && cause.kind === 'conflict') {
          const accepted = await recoverAcceptedOrder(saved.command.payload.idempotencyKey);
          if (accepted) {
            removeOfflineOrderDraft(localStorage, data.actor.email);
            if (active) notifyRetryCreated(accepted);
            return;
          }
        }
        if (!retryableOrderSubmissionFailure(cause) && navigator.onLine) {
          pendingSubmissionRef.current = null;
          if (active) setPendingSubmissionLocked(false);
          const message = cause instanceof Error ? cause.message : 'Unable to create order';
          updateOfflineDraftState(localStorage, data.actor.email, 'error', message);
          if (active) { setDraftState('error'); setError(message); }
        }
      } finally {
        submissionInFlightRef.current = false;
        if (active) setSubmitting(false);
      }
    }
    window.addEventListener('online', retryPending);
    const initialRetry = window.setTimeout(retryPending, 0);
    return () => { active = false; window.clearTimeout(initialRetry); window.removeEventListener('online', retryPending); };
  }, [data.actor.email]);

  const matches = useMemo(() => {
    const selected = new Set(lines.map((line) => line.tallyKey));
    return lines.length >= 50 ? [] : searchCatalog(data.snapshot.catalog, productQuery, selected);
  }, [data.snapshot.catalog, lines, productQuery]);

  const customerMatches = useMemo(
    () => searchCustomers(data.customers, customerName),
    [customerName, data.customers],
  );
  const selectedCustomer = data.customers.find((customer) => customer.id === selectedCustomerId);
  const possibleRepeat = findPossibleRepeat(
    selectedCustomer && customerHistory?.ownerKey === selectedCustomerKey ? lines : null,
    customerHistory?.rankingOrders ?? [],
    new Date(),
  );
  const repeatExpanded = !!possibleRepeat && expandedRepeatOrderId === possibleRepeat.order.id;
  const recentProducts = useMemo(() => {
    if (!selectedCustomerId || tallyRecent?.key !== selectedCustomerKey || lines.length >= 50) return [];
    const catalogByKey = new Map(data.snapshot.catalog.filter((item) => item.active).map((item) => [item.tallyKey, item]));
    const seen = new Set(lines.map((line) => line.tallyKey));
    return tallyRecent.value.products.flatMap((entry) => {
      const item = catalogByKey.get(entry.tallyKey);
      return item && !seen.has(entry.tallyKey) ? [{ ...entry, item }] : [];
    }).slice(0, 8);
  }, [tallyRecent, data.snapshot.catalog, lines, selectedCustomerId, selectedCustomerKey]);

  useEffect(() => {
    if (!selectedCustomerId) return;
    const controller = new AbortController();
    const cacheKey = `${selectedCustomerKey}:${selectedCustomer?.tallyKey ?? ''}:${data.snapshot.catalogVersion ?? ''}:${data.snapshot.fetchedAt}`;
    const cached = tallyRecentCache.current.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && !tallyRecentRetry) {
      setTallyRecent({ key: selectedCustomerKey, value: cached.value });
      setTallyRecentError('');
      return;
    }
    setTallyRecent(null);
    setTallyRecentError('');
    fetch(`/api/orders?recentProductsFor=${encodeURIComponent(selectedCustomerId)}`, { cache: 'no-store', signal: controller.signal })
      .then(response => readResponse<TallyRecentProducts>(response))
      .then(value => {
        if (controller.signal.aborted || currentCustomerKeyRef.current !== selectedCustomerKey) return;
        if (value.customerId !== selectedCustomerId || !Array.isArray(value.products)) throw new Error('Invalid Tally history response');
        tallyRecentCache.current.delete(cacheKey);
        tallyRecentCache.current.set(cacheKey, { value, expiresAt: Date.now() + 30000 });
        if (tallyRecentCache.current.size > 20) tallyRecentCache.current.delete(tallyRecentCache.current.keys().next().value!);
        setTallyRecent({ key: selectedCustomerKey, value });
      })
      .catch(() => {
        if (!controller.signal.aborted && currentCustomerKeyRef.current === selectedCustomerKey) setTallyRecentError(selectedCustomerKey);
      });
    return () => controller.abort();
  }, [selectedCustomerId, selectedCustomerKey, selectedCustomer?.tallyKey, data.snapshot.catalogVersion, data.snapshot.fetchedAt, tallyRecentRetry]);

  useEffect(() => {
    if (!selectedCustomer) return;
    currentCustomerKeyRef.current = selectedCustomerKey;
    const cached = customerHistoryCacheRef.current.get(selectedCustomerKey);
    if (cached) {
      setCustomerHistory(cached);
      setCustomerHistoryState('idle');
      return;
    }
    const controller = new AbortController();
    fetch(orderListUrl({ page: 1, query: `customer:${selectedCustomer.name}`, status: 'all', captureDate: '' }), { cache: 'no-store', signal: controller.signal })
      .then((response) => readResponse<OrderBootstrap>(response))
      .then((result) => {
        if (controller.signal.aborted || currentCustomerKeyRef.current !== selectedCustomerKey) return;
        const history = { ownerKey: selectedCustomerKey, orders: result.orders.slice(0, 5), rankingOrders: result.orders.filter(o => o.status !== 'cancelled').slice(0, 20), total: result.pagination?.total || result.orders.length };
        customerHistoryCacheRef.current.set(selectedCustomerKey, history);
        setCustomerHistory(history);
        setCustomerHistoryState('idle');
      })
      .catch((cause) => {
        if (controller.signal.aborted || currentCustomerKeyRef.current !== selectedCustomerKey || cause instanceof DOMException && cause.name === 'AbortError') return;
        setCustomerHistory(null);
        setCustomerHistoryState('error');
      });
    return () => controller.abort();
  }, [selectedCustomer, selectedCustomerKey]);

  useEffect(() => {
    if (!canViewPrices || !selectedCustomerId || !pricingKeys) return;
    const controller = new AbortController();
    fetch('/api/pricing', {
      method: 'POST',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'preview_customer_prices', payload: { customerId: selectedCustomerId, tallyKeys: pricingKeys.split('\u001f') } }),
    })
      .then((response) => readResponse<{ prices: OrderEntryPrice[] }>(response))
      .then((result) => { if (!controller.signal.aborted) setEntryPriceResult({ key: entryPriceKey, prices: Object.fromEntries(result.prices.map((price) => [price.tallyKey, price])), failed: false }); })
      .catch((cause) => { if (!(cause instanceof DOMException && cause.name === 'AbortError') && !controller.signal.aborted) setEntryPriceResult({ key: entryPriceKey, prices: {}, failed: true }); });
    return () => controller.abort();
  }, [canViewPrices, entryPriceKey, pricingKeys, selectedCustomerId]);

  function chooseCustomer(customer: CustomerDirectoryEntry) {
    customerSelectedAtRef.current = performance.now();
    setRecentQuantities({});
    const customerKey = `${data.actor.email.trim().toLocaleLowerCase('en-IN')}:${customer.id}`;
    currentCustomerKeyRef.current = customerKey;
    setSelectedCustomerId(customer.id);
    setCustomerName(customer.name);
    setCustomerPhone(customer.phone || '');
    setCustomerCity(customer.city || '');
    setCustomerSuggestionsOpen(false);
    const cached = customerHistoryCacheRef.current.get(customerKey);
    setCustomerHistory(cached || null);
    setCustomerHistoryState(cached ? 'idle' : 'loading');
    productInputRef.current?.focus();
  }

  function addProduct(item: CatalogItem, quantity = 1) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000000) return;
    setLines((current) => current.length >= 50 || current.some((line) => line.tallyKey === item.tallyKey) ? current : [...current, { tallyKey: item.tallyKey, item, quantity }]);
    setProductQuery('');
    setActiveProductIndex(0);
    focusQuantityKey.current = item.tallyKey;
  }

  function usePreviousOrder(order: OrderSummary) {
    if (lines.length > 0 && !window.confirm(`Replace the products currently entered with products from ${order.orderNumber}?`)) return;
    const reusedLines = restoreOfflineDraftLines(data.snapshot.catalog, repeatOrderTemplate(order).lines);
    setLines(reusedLines);
    setProductQuery('');
    setError(offlineDraftRecoveryError(null, reusedLines.some((line) => !line.item)));
  }

  function usePreviousAddress(address: string) {
    if (deliveryAddress.trim() && deliveryAddress.trim() !== address && !window.confirm('Replace the delivery address currently entered?')) return;
    setDeliveryAddress(address);
  }

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInFlightRef.current) return;
    if (customerName.trim().length < 2 || lines.length === 0) {
      setError('Add a customer and at least one product.');
      return;
    }
    if (lines.some((line) => !line.item)) {
      setError('Remove unavailable products and select their current Tally catalogue replacements before saving.');
      return;
    }
    const startedAt = performance.now();
    submissionInFlightRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      const existing = data.customers.find(
        (item) => item.id === selectedCustomerId || item.name === customerName.trim(),
      );
      const body: Extract<OrderCommand, { action: 'create_order' }> = pendingSubmissionRef.current ?? {
        action: 'create_order',
        payload: {
          idempotencyKey,
          customerId: existing?.id,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          customerCity: customerCity.trim(),
          deliveryAddress: deliveryAddress.trim(),
          source,
          priority,
          expectedDeliveryDate: expectedDeliveryDate || undefined,
          notes: notes.trim(),
          lines: lines.map((line) => ({ tallyKey: line.tallyKey, quantity: line.quantity })),
        },
      };
      if (saveOnDevice && !writeOfflineOrderDraft(localStorage, { schemaVersion: 1, actorEmail: data.actor.email, state: 'pending', command: body, updatedAt: new Date().toISOString() })) throw new Error('This browser could not save the pending order. Free device storage and retry.');
      pendingSubmissionRef.current = body;
      setPendingSubmissionLocked(true);
      setDraftState('pending');
      const response = await fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(orderSubmissionTimeoutMs) });
      const result = await readOrderSubmission(response);
      removeOfflineOrderDraft(localStorage, data.actor.email);
      recordOrderClientTiming('order_save_ms', startedAt);
      if (customerSelectedAtRef.current !== null) recordOrderClientTiming('order_capture_ms', customerSelectedAtRef.current);
      onCreated(result.orderNumber || 'Order', body, result);
    } catch (cause) {
      if (cause instanceof OrderSubmissionError && cause.kind === 'conflict') {
        const accepted = await recoverAcceptedOrder(idempotencyKey);
        if (accepted) {
          removeOfflineOrderDraft(localStorage, data.actor.email);
          recordOrderClientTiming('order_save_ms', startedAt);
          if (customerSelectedAtRef.current !== null) recordOrderClientTiming('order_capture_ms', customerSelectedAtRef.current);
          onCreated(accepted);
          return;
        }
      }
      const message = cause instanceof Error ? cause.message : 'Unable to create order';
      const waiting = !navigator.onLine || retryableOrderSubmissionFailure(cause);
      if (!waiting) { pendingSubmissionRef.current = null; setPendingSubmissionLocked(false); }
      const savedForRetry = waiting && saveOnDevice && Boolean(updateOfflineDraftState(localStorage, data.actor.email, 'pending'));
      if (!waiting && saveOnDevice) updateOfflineDraftState(localStorage, data.actor.email, 'error', message);
      setDraftState(savedForRetry ? 'pending' : 'error');
      setError(savedForRetry ? 'Order saved on this device. Retry when the connection returns.' : waiting ? 'Connection lost. This order was not stored because device saving is off.' : message);
    } finally {
      submissionInFlightRef.current = false;
      setSubmitting(false);
    }
  }

  const orderDetailSummary = [
    source === 'phone' ? '' : source === 'walk_in' ? 'Walk-in' : source === 'whatsapp' ? 'WhatsApp' : 'Email',
    priority === 'normal' ? '' : priority === 'urgent' ? 'Urgent' : 'High priority',
    expectedDeliveryDate ? `Promised delivery ${expectedDeliveryDate}` : '',
    notes.trim() ? 'Notes added' : '',
  ].filter(Boolean).join(' · ') || '(optional)';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-sf-ink/45 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <dialog open aria-labelledby="new-order-title" className="ml-auto mr-0 h-full max-h-none w-full max-w-2xl overflow-y-auto bg-sf-page p-0 shadow-2xl">
        <form onSubmit={submit}>
          <header className="sticky top-0 z-10 flex items-center justify-between border-b border-sf-line-soft bg-white/95 px-5 py-4 backdrop-blur">
            <div><p className="text-xs font-extrabold uppercase tracking-[0.12em] text-sf-accent">Order</p><h2 id="new-order-title" className="mt-1 text-xl font-black text-sf-ink">{templateOrder ? 'Repeat order' : 'New order'}</h2>{templateOrder ? <p className="mt-1 text-xs text-sf-subtle">Based on {templateOrder.orderNumber}; saved as a separate new order.</p> : null}</div>
            <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-sf-line px-3 font-bold text-sf-label">Close</button>
          </header>
          <div className="space-y-5 p-5 sm:p-7">
            <fieldset disabled={submitting || pendingSubmissionLocked} className="contents">
            <fieldset className="rounded-2xl border border-sf-line-soft bg-white p-5">
              <legend className="px-2 text-sm font-extrabold text-sf-strong">Customer</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="relative sm:col-span-2 text-sm font-bold text-sf-label">
                  <label htmlFor="customer-name">Name</label>
                  <input
                    id="customer-name"
                    required
                    maxLength={200}
                    value={customerName}
                    onChange={(event) => {
                      currentCustomerKeyRef.current = '';
                      setCustomerName(event.target.value);
                      setSelectedCustomerId(undefined);
                      setCustomerHistory(null);
                      setCustomerHistoryState('idle');
                      setCustomerSuggestionsOpen(true);
                      setActiveCustomerIndex(0);
                    }}
                    onFocus={() => {
                      if (customerBlurTimerRef.current !== null) window.clearTimeout(customerBlurTimerRef.current);
                      customerBlurTimerRef.current = null;
                      setCustomerSuggestionsOpen(true);
                    }}
                    onBlur={() => {
                      if (customerBlurTimerRef.current !== null) window.clearTimeout(customerBlurTimerRef.current);
                      customerBlurTimerRef.current = window.setTimeout(() => {
                        customerBlurTimerRef.current = null;
                        setCustomerSuggestionsOpen(false);
                      }, 120);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && selectedCustomerId) {
                        event.preventDefault();
                        productInputRef.current?.focus();
                        return;
                      }
                      if (!customerSuggestionsOpen || customerMatches.length === 0) {
                        if (event.key === 'Enter') event.preventDefault();
                        return;
                      }
                      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        setActiveCustomerIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + customerMatches.length) % customerMatches.length);
                      } else if (event.key === 'Enter') {
                        event.preventDefault();
                        chooseCustomer(customerMatches[Math.min(activeCustomerIndex, customerMatches.length - 1)]);
                      } else if (event.key === 'Escape') {
                        setCustomerSuggestionsOpen(false);
                      }
                    }}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={customerSuggestionsOpen && customerMatches.length > 0}
                    aria-controls="customer-suggestions"
                    autoComplete="off"
                    className="mt-2 min-h-11 w-full rounded-xl border border-sf-line px-3 font-normal outline-none focus:border-sf-mint"
                    placeholder="Type a Tally ledger name"
                  />
                  {customerSuggestionsOpen && customerMatches.length > 0 ? (
                    <ul id="customer-suggestions" aria-label="Matching Tally customer ledgers" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-sf-line bg-white py-1 shadow-xl">
                      {customerMatches.map((customer, index) => (
                        <li key={customer.id}>
                          <button
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => chooseCustomer(customer)}
                            className={`block min-h-12 w-full px-3 py-2 text-left font-normal hover:bg-sf-accent-soft focus:bg-sf-accent-soft focus:outline-none ${index === activeCustomerIndex ? 'bg-sf-accent-soft' : ''}`}
                          >
                            <strong className="block text-sm text-sf-strong">{customer.name}</strong>
                            <small className="block text-sf-subtle">{[customer.city, customer.phone].filter(Boolean).join(' · ') || 'Tally customer ledger'}{customer.tallyBalance !== undefined && customer.tallyBalance !== null ? ` · Tally balance ₹${customer.tallyBalance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : ''}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {selectedCustomer ? <CustomerAccountPreview customer={selectedCustomer} history={customerHistory?.ownerKey === selectedCustomerKey ? customerHistory : null} state={customerHistoryState} onShowCustomerOrders={() => onViewCustomer(selectedCustomer.name)} onUseOrder={usePreviousOrder} onUseAddress={usePreviousAddress} /> : null}
                </div>
                <details className="sm:col-span-2 rounded-xl bg-sf-soft px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-bold text-sf-label">Contact details <span className="font-normal text-sf-subtle">(optional)</span></summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold text-sf-label">Phone<input maxLength={40} value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-sf-line bg-white px-3 font-normal outline-none focus:border-sf-mint" inputMode="tel" /></label>
                    <label className="text-sm font-bold text-sf-label">City<input maxLength={120} value={customerCity} onChange={(event) => setCustomerCity(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-sf-line bg-white px-3 font-normal outline-none focus:border-sf-mint" /></label>
                    <label className="text-sm font-bold text-sf-label sm:col-span-2">Delivery address<textarea maxLength={1000} rows={2} value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} className="mt-2 w-full rounded-xl border border-sf-line bg-white p-3 font-normal outline-none focus:border-sf-mint" /></label>
                  </div>
                </details>
              </div>
            </fieldset>

            <fieldset className="rounded-2xl border border-sf-line-soft bg-white p-5">
              <legend className="px-2 text-sm font-extrabold text-sf-strong">Products</legend>
              {recentProducts.length ? <section aria-label="Recently ordered products" className="mb-4">
                <p className="mb-2 text-xs font-bold text-sf-muted">Recent Tally purchases · enter quantity and press Enter</p>
                <div className="grid gap-2 sm:grid-cols-2">{recentProducts.map((entry) => {
                  const item = entry.item;
                  const quantity = recentQuantities[item.tallyKey] ?? String(Number.isInteger(entry.lastQuantity) ? entry.lastQuantity : 1);
                  const valid = Number.isInteger(Number(quantity)) && Number(quantity) >= 1 && Number(quantity) <= 1000000;
                  return <div key={item.tallyKey} className="flex min-w-0 items-center gap-2 rounded-lg border border-sf-line bg-sf-accent-soft p-2">
                    <div className="min-w-0 flex-1">
                      <div title={item.item} className="truncate text-sm font-bold text-sf-body">{item.item}</div>
                      <div className="text-xs text-sf-muted">{`${entry.billCount} of last ${tallyRecent?.value.billCount} imported Tally bills · last ${new Date(entry.lastBilledAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}`}</div>
                    </div>
                    <input type="number" form="recent-product-quantities" aria-label={`Recent quantity for ${item.item}`} min="1" max="1000000" step="1" value={quantity} onChange={(event) => setRecentQuantities((current) => ({ ...current, [item.tallyKey]: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (valid) addProduct(item, Number(quantity)); } }} className="min-h-10 w-20 rounded-lg border border-sf-line bg-white px-2 text-right" />
                    <button type="button" aria-label={`Add ${item.item}`} disabled={!valid} onClick={() => addProduct(item, Number(quantity))} className="min-h-10 rounded-lg px-2 text-sm font-bold text-sf-body disabled:opacity-50">Add</button>
                  </div>;
                })}</div>
              </section> : null}
              {selectedCustomerId && tallyRecent?.key !== selectedCustomerKey ? <p className="mb-3 text-xs text-sf-muted">{tallyRecentError === selectedCustomerKey ? <>Tally purchases could not load. <button type="button" className="min-h-10 underline" onClick={() => setTallyRecentRetry(value => value + 1)}>Retry Tally purchases</button></> : 'Loading recent Tally purchases…'}</p> : null}
              {tallyRecent?.key === selectedCustomerKey && !tallyRecent.value.products.length ? <p className="mb-3 text-xs text-sf-muted">{tallyRecent.value.linked ? 'No recent Tally purchases in the imported billing history. Search products below.' : 'No linked Tally ledger yet. Search products below to create this order.'}</p> : null}
              <label className="text-sm font-bold text-sf-label">Find product<input ref={productInputRef} maxLength={200} value={productQuery} onChange={(event) => { setProductQuery(event.target.value); setActiveProductIndex(0); }} onKeyDown={(event) => {
                if (event.key === 'Enter') event.preventDefault();
                if (matches.length === 0) return;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActiveProductIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  addProduct(matches[Math.min(activeProductIndex, matches.length - 1)]);
                }
              }} role="combobox" aria-autocomplete="list" aria-expanded={matches.length > 0} aria-controls="product-suggestions" className="mt-2 min-h-11 w-full rounded-xl border border-sf-line px-3 font-normal outline-none focus:border-sf-mint" placeholder="Type a product name" /></label>
              {matches.length ? <div id="product-suggestions" aria-label="Matching Tally products" className="mt-2 overflow-hidden rounded-xl border border-sf-line-soft">{matches.map((item, index) => <button key={item.tallyKey} type="button" onClick={() => addProduct(item)} className={`flex min-h-12 w-full items-center justify-between gap-4 border-b border-sf-soft-2 px-3 text-left last:border-0 hover:bg-sf-accent-soft ${index === activeProductIndex ? 'bg-sf-accent-soft' : ''}`}><span><strong className="block text-sm text-sf-strong">{item.item}</strong><small className="text-sf-subtle">{item.group}</small></span><span className="shrink-0 text-xs font-bold text-sf-accent">Available {formatQuantity(item.closing)} {item.baseUnit}</span></button>)}</div> : null}
              {productQuery.trim() && matches.length === 0 ? <p className="mt-2 rounded-xl bg-sf-warning-soft px-3 py-2 text-sm text-sf-warning">No Tally products match “{productQuery.trim()}”.</p> : null}
              <div className="mt-4 space-y-2">{lines.map((line) => { const price = entryPrices[line.tallyKey]; const unit = line.item?.baseUnit?.trim() || 'units'; return <div key={line.tallyKey} className={`grid grid-cols-[minmax(0,1fr)_44px] sm:grid-cols-[minmax(0,1fr)_140px_44px] items-center gap-3 rounded-xl p-3 ${line.item ? 'bg-sf-soft' : 'border border-sf-danger-line bg-sf-danger-soft'}`}><div className="col-span-2 min-w-0 sm:col-span-1"><strong className="block [overflow-wrap:anywhere] text-sm text-sf-strong">{line.item?.item || `Unavailable Tally item (${line.tallyKey})`}</strong><small className={line.item ? 'text-sf-subtle' : 'font-bold text-sf-danger'}>{line.item ? `Closing ${formatQuantity(line.item.closing)} ${line.item.baseUnit}` : 'Remove and select its current catalogue replacement'}</small>{line.item && !line.item.baseUnit?.trim() ? <small className="mt-1 block text-sf-subtle">Unit not set in Tally</small> : null}{canViewPrices ? <small className={`mt-1 block font-bold ${price?.riskStatus === 'RED' ? 'text-sf-danger' : price?.riskStatus === 'AMBER' ? 'text-sf-warning' : 'text-sf-success'}`}>{price ? `Current price ${price.currentPrice == null ? 'review required' : currency.format(price.currentPrice)} · ${price.riskStatus}` : entryPriceState === 'loading' ? 'Resolving customer price…' : 'Customer price unavailable · review required'}</small> : <small className="mt-1 block text-sf-subtle">Pricing is checked at confirmation.</small>}</div><label className="sr-only" htmlFor={`qty-${line.tallyKey}`}>Quantity for {line.item?.item || line.tallyKey} in {unit}</label><div className="flex min-w-0 items-center gap-2"><input id={`qty-${line.tallyKey}`} type="number" min="1" max="1000000" step="1" required value={line.quantity} onChange={(event) => setLines((current) => current.map((entry) => entry.tallyKey === line.tallyKey ? { ...entry, quantity: Number(event.target.value) } : entry))} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); productInputRef.current?.focus(); } }} className="min-h-11 min-w-0 w-full rounded-lg border border-sf-line px-2 text-right" /><span className="max-w-20 shrink-0 break-words text-sm text-sf-subtle">{unit}</span></div><button type="button" onClick={() => setLines((current) => current.filter((entry) => entry.tallyKey !== line.tallyKey))} aria-label={`Remove ${line.item?.item || line.tallyKey}`} className="size-11 rounded-lg text-xl text-sf-danger hover:bg-sf-danger-soft">×</button></div>; })}</div>
              {hasAnyStockFlowRole(data.actor.roles ?? data.actor.role, ['administrator', 'management', 'operations', 'sales']) ? <ProductRequest key={data.actor.email} actorEmail={data.actor.email} productName={productQuery} customerId={selectedCustomerId} visible={productQuery.trim().length >= 2 && matches.length === 0 && lines.length < 50 && !data.snapshot.catalog.some((item) => item.item.toLocaleLowerCase('en-IN') === productQuery.trim().toLocaleLowerCase('en-IN'))} /> : null}
              {lines.length >= 50 ? <p className="mt-2 text-xs font-bold text-sf-warning">Maximum 50 products per order.</p> : null}
              {lines.length === 0 ? <p className="mt-4 rounded-xl bg-sf-soft p-4 text-center text-sm text-sf-subtle">Search and add the products requested on the call.</p> : null}
            </fieldset>

            <details className="rounded-2xl border border-sf-line-soft bg-white p-4">
              <summary className="cursor-pointer text-sm font-bold text-sf-label">Order details <span className="font-normal text-sf-subtle">{orderDetailSummary}</span></summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className="text-sm font-bold text-sf-label">Received via<select value={source} onChange={(event) => setSource(event.target.value as 'phone' | 'email' | 'whatsapp' | 'walk_in')} className="mt-2 min-h-11 w-full rounded-xl border border-sf-line bg-white px-3 font-normal text-sf-strong"><option value="phone">Phone</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="walk_in">Walk-in</option></select></label>
                <label className="text-sm font-bold text-sf-label">Order priority<select value={priority} onChange={(event) => setPriority(event.target.value as 'normal' | 'high' | 'urgent')} className="mt-2 min-h-11 w-full rounded-xl border border-sf-line bg-white px-3 font-normal text-sf-strong"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
                <label className="text-sm font-bold text-sf-label">Promised delivery <span className="font-normal text-sf-subtle">(optional)</span><input type="date" value={expectedDeliveryDate} onChange={(event) => setExpectedDeliveryDate(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-sf-line bg-white px-3 font-normal text-sf-strong" /></label>
                <label htmlFor="order-notes" className="text-sm font-bold text-sf-label sm:col-span-3">Order notes <span className="font-normal text-sf-subtle">(optional)</span></label>
                <textarea id="order-notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} rows={3} className="w-full rounded-xl border border-sf-line p-3 font-normal outline-none focus:border-sf-mint sm:col-span-3" placeholder="Delivery instructions, contact person, or urgency" />
              </div>
            </details>
            </fieldset>
            {pendingSubmissionLocked ? <p className="text-sm font-semibold text-sf-warning">Submission outcome is not confirmed. Retry sends the original details unchanged.</p> : null}
            {pinProtectedDevice ? <p className="rounded-xl border p-3 text-sm">This device uses PIN-protected offline orders. Use Offline in the main menu for saved drafts. This online form is not saved locally.</p> : <div className="rounded-2xl border border-sf-line-soft bg-white px-4 py-3 text-sm text-sf-label">
              <div className="flex min-h-10 items-center gap-3"><input id="save-device-draft" type="checkbox" checked={saveOnDevice} disabled={draftState === 'pending'} onChange={(event) => changeTrustedDevice(event.target.checked)} className="size-4 accent-sf-accent" /><div><label htmlFor="save-device-draft" className="block font-bold text-sf-strong">Save draft on this device</label><small className="text-sf-subtle">{saveOnDevice ? 'On · recover after restart · trusted device only' : 'Off · enable only on a trusted device'}</small></div></div>
              <details className="mt-1 text-xs text-sf-subtle"><summary className="cursor-pointer">About device drafts</summary><p className="mt-2">Use this only on a trusted device.</p><p>Unsubmitted drafts expire after seven days.</p><p>Pending orders and orders needing attention stay saved until sent or discarded. Product and customer search is also retained for restart recovery.</p></details>
            </div>}
            {customerName.trim() || lines.length > 0 ? <p aria-live="polite" className={`rounded-xl px-4 py-3 text-sm font-semibold ${draftState === 'error' ? 'bg-sf-danger-soft text-sf-danger' : draftState === 'pending' ? 'bg-sf-warning-soft text-sf-warning' : 'bg-sf-accent-soft text-sf-label'}`}>{draftState === 'pending' ? 'Waiting to send. Your order is safe on this device.' : draftState === 'error' ? 'Draft needs attention before it can be sent.' : saveOnDevice ? 'Draft saved on this device.' : 'Draft is kept only while this form remains open.'}</p> : null}
            {initialDraft ? <button type="button" onClick={discardSavedOrder} className="min-h-10 rounded-xl px-4 text-sm font-bold text-sf-danger hover:bg-sf-danger-soft">Discard saved order</button> : null}
            {error ? <p role="alert" className="rounded-xl border border-sf-danger-line bg-sf-danger-soft px-4 py-3 text-sm text-sf-danger">{error}</p> : null}
          </div>
          {possibleRepeat ? <section aria-label="Possible repeat order" className="mx-5 mb-3 rounded-xl border border-sf-warning-line bg-sf-warning-soft p-3 text-sm text-sf-warning">
            <output aria-live="polite" className="block">Possible repeat: order {possibleRepeat.order.orderNumber} from {new Date(possibleRepeat.order.createdAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })} already has {possibleRepeat.items.length} of these items ({possibleRepeat.items.slice(0, 2).map((item) => item.itemName).join(', ')}{possibleRepeat.items.length > 2 ? ', …' : ''}).</output>
            <button type="button" aria-expanded={repeatExpanded} onClick={() => setExpandedRepeatOrderId(repeatExpanded ? null : possibleRepeat.order.id)} className="mt-1 min-h-11 text-left font-bold underline">{repeatExpanded ? 'Hide order' : 'Show order'} {possibleRepeat.order.orderNumber}</button>
            {repeatExpanded ? <div className="mt-1">
              <p>{statusLabel(possibleRepeat.order.status)} · <time dateTime={possibleRepeat.order.createdAt}>{new Date(possibleRepeat.order.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}</time></p>
              <ul className="mt-2 space-y-1">{possibleRepeat.items.map((item) => <li key={item.tallyKey}>{item.itemName} — {formatQuantity(item.quantity)}{item.baseUnit?.trim() ? ` ${item.baseUnit.trim()}` : ''}</li>)}</ul>
            </div> : null}
          </section> : null}
          <footer className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-sf-line-soft bg-white/95 px-5 py-4 backdrop-blur"><p className="min-w-0 text-xs text-sf-subtle">{lines.length} product{lines.length === 1 ? '' : 's'} · {lines.some((line) => !line.item) ? 'product needs replacement' : draftState === 'pending' ? 'waiting to send' : saveOnDevice ? 'draft protected' : 'ready to save'}</p><button type="submit" disabled={submitting || lines.length === 0 || lines.some((line) => !line.item)} className="min-h-12 shrink-0 rounded-xl bg-sf-ink px-6 font-extrabold text-white hover:bg-sf-ink-hover disabled:opacity-50">{submitting ? 'Saving…' : draftState === 'pending' || draftState === 'error' ? 'Retry order' : 'Save order'}</button></footer>
        </form>
      </dialog>
    </div>
  );
}

function CustomerAccountPreview({ customer, history, state, onShowCustomerOrders, onUseOrder, onUseAddress }: { customer: CustomerDirectoryEntry; history: { orders: OrderSummary[]; total: number } | null; state: 'idle' | 'loading' | 'error'; onShowCustomerOrders: () => void; onUseOrder: (order: OrderSummary) => void; onUseAddress: (address: string) => void }) {
  const phoneHref = customerPhoneHref(customer.phone);
  const addresses = customerDeliveryAddresses(history?.orders || []);
  const balanceFreshness = customerBalanceFreshness(customer);
  return <section aria-label="Customer account" className="mt-2 rounded-xl border border-sf-line-soft bg-sf-soft-0 p-3 text-xs font-normal">
    <div className="flex items-start justify-between gap-3"><div><strong className="block text-sm text-sf-strong">Customer account</strong><span className="mt-1 block text-sf-subtle">{[customer.city, customer.phone].filter(Boolean).join(' · ') || 'Contact details unavailable in Tally'}</span></div><div className="flex shrink-0 flex-wrap justify-end gap-2">{phoneHref ? <a href={phoneHref} aria-label={`Call ${customer.name}`} className="inline-flex min-h-9 items-center rounded-lg border border-sf-line bg-white px-3 font-bold text-sf-body">Call</a> : null}{history ? <button type="button" onClick={onShowCustomerOrders} className="min-h-9 rounded-lg border border-sf-line bg-white px-3 font-bold text-sf-body">View all orders</button> : null}</div></div>
    {balanceFreshness !== 'unavailable' ? <div className={`mt-2 rounded-lg px-3 py-2 ${balanceFreshness === 'stale' ? 'border border-sf-warning-line bg-sf-warning-soft text-sf-warning' : 'bg-sf-soft text-sf-label'}`}><p>Read-only Tally ledger balance: <strong>₹{customer.tallyBalance?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong>{customer.balanceAsOf ? ` · as of ${new Date(customer.balanceAsOf).toLocaleString('en-IN')}` : ''}</p>{balanceFreshness === 'stale' ? <output className="mt-1 block font-bold">Balance may be outdated. Check Tally before confirming credit terms.</output> : <p className="mt-1 text-sf-subtle">For reference only; StockFlow does not approve or block credit.</p>}</div> : null}
    {state === 'loading' ? <p className="mt-2 text-sf-subtle">Loading this customer’s order history…</p> : null}
    {state === 'error' ? <p className="mt-2 rounded-lg bg-sf-warning-soft px-3 py-2 text-sf-warning">Order history is unavailable right now. You can still save this order.</p> : null}
    {addresses.length ? <div className="mt-2"><strong className="text-sf-label">Recent delivery addresses</strong><div className="mt-1 flex flex-wrap gap-2">{addresses.map((address) => <button key={address.toLocaleLowerCase('en-IN')} type="button" onClick={() => onUseAddress(address)} title={address} className="min-h-9 max-w-full truncate rounded-lg border border-sf-line bg-white px-3 text-left font-bold text-sf-body">Use {address}</button>)}</div></div> : null}
    {history ? <details className="mt-2"><summary className="cursor-pointer font-bold text-sf-label">Previous orders ({history.total})</summary>{history.orders.length ? <ul className="mt-2 divide-y divide-sf-line-soft">{history.orders.map((order) => <li key={order.id} className="flex items-center justify-between gap-3 py-2"><span><strong className="block text-sf-strong">{order.orderNumber}</strong><small className="text-sf-subtle">{new Date(order.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} · {orderStage(order.status)} · {formatQuantity(order.totalQuantity)} qty</small><small className="mt-0.5 block max-w-sm truncate text-sf-subtle">{order.lines.map((line) => line.itemName).join(', ')}</small></span><button type="button" onClick={() => onUseOrder(order)} className="min-h-9 shrink-0 rounded-lg border border-sf-line bg-white px-3 font-bold text-sf-body">Use items</button></li>)}</ul> : <p className="mt-2 text-sf-subtle">No previous orders found.</p>}{history.total > history.orders.length ? <p className="mt-2 text-sf-subtle">Showing the latest {history.orders.length} orders.</p> : null}</details> : null}
  </section>;
}

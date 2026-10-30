import type { OrderSummary } from './order-types';
import { hasAnyStockFlowRole } from './user-types';

// Role-to-role work hand-offs (contract: docs/ORDER-NOTIFICATIONS.md). The bell shows each person's *current* work;
// stage completion removes it for everyone, and seeing it never completes or hides it.
//   new order → confirmers · confirmed → warehouse (pick & pack) · packed → accounts (Tally billing) · billed → operations (dispatch)
// Plus orders assigned to the signed-in person. Server access rules decide which orders each person can see.
// Foreground only, on existing endpoints. Codex's persisted task feed replaces the data source later; the UI stays.

export type WorkQueue = { id: string; label: string; statuses: readonly string[]; message: string };
export type WorkItem = {
  orderId: string; orderNumber: string; customerName: string; status: string;
  queueId: string; message: string; isNew: boolean; assignedToMe: boolean;
  /** Last change to the order: how long this work has been waiting. */
  waitingSince: string;
};
export type WorkQueueState = WorkQueue & { total: number; newCount: number };
export type WorkReminder = { id: string; label: string; count: number; status: string };
export type WorkNotificationState = {
  connection: 'checking' | 'live' | 'offline' | 'unavailable' | 'signed-out' | 'forbidden';
  /** Distinct current actionable orders for this person, new first, then longest waiting. */
  work: WorkItem[];
  /** Distinct actionable orders returned by the lists. */
  workTotal: number;
  workMore: boolean;
  queues: WorkQueueState[];
  /** Orders that arrived (handed off or assigned) since the bell was last closed. */
  fresh: WorkItem[];
  reminders: WorkReminder[];
  checkedAt: string | null;
};

/** New work should show within ~15 s; each check reads only the small summary. */
export const WORK_CHECK_INTERVAL = 15_000;
export const WORK_LIST_REFRESH = 5 * 60_000;
const FAILURE_BACKOFF = 60_000;

const queues = {
  confirm: { id: 'confirm', label: 'Confirm', statuses: ['phone_order_received', 'awaiting_confirmation', 'awaiting_approval'], message: 'New order to confirm' },
  pack: { id: 'pack', label: 'Pick & pack', statuses: ['picking'], message: 'Ready to pick & pack' },
  // A packed order already belongs to Accounts (its next step is "Send to Tally billing").
  bill: { id: 'bill', label: 'Tally billing', statuses: ['packed', 'awaiting_tally_billing'], message: 'Packed · ready for Tally billing' },
  // Billing staff hear only about orders that are packed AND priced (awaiting_tally_billing).
  billReady: { id: 'bill-ready', label: 'Ready to bill', statuses: ['awaiting_tally_billing'], message: 'Packed and priced · ready to bill' },
  // A billed order already belongs to Operations.
  dispatch: { id: 'dispatch', label: 'Dispatch', statuses: ['dispatch_ready'], message: 'Billed · ready for dispatch' },
} satisfies Record<string, WorkQueue>;

/** The hand-off queues a person works on, by role (combined roles get the union). */
export function workQueuesForRoles(roles: unknown): WorkQueue[] {
  const result: WorkQueue[] = [];
  if (hasAnyStockFlowRole(roles, ['administrator', 'management', 'sales', 'operations'])) result.push(queues.confirm);
  if (hasAnyStockFlowRole(roles, ['warehouse', 'operations'])) result.push(queues.pack);
  if (hasAnyStockFlowRole(roles, ['accounts'])) result.push(queues.bill);
  else if (hasAnyStockFlowRole(roles, ['billing'])) result.push(queues.billReady);
  if (hasAnyStockFlowRole(roles, ['operations'])) result.push(queues.dispatch);
  return result;
}

/** The Orders list filter that shows a queue (the largest part when a queue spans two filters). */
export function queueOrdersFilter(queue: WorkQueueState | WorkQueue, totals: Record<string, number> = {}) {
  if (queue.id === 'confirm') return 'awaiting_confirmation';
  if (queue.id === 'bill-ready') return 'billing';
  if (queue.id === 'bill') return (totals.packed ?? 0) > (totals.awaiting_tally_billing ?? 0) ? 'packed' : 'billing';
  return queue.statuses[0];
}

/** Count-only reminders that are not hand-offs (follow-ups, delivery problems). */
export function workReminders(operations: Record<string, unknown>, roles: unknown): WorkReminder[] {
  const count = (key: string) => {
    const value = operations[key];
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
  };
  const list: WorkReminder[] = [];
  if (hasAnyStockFlowRole(roles, ['accounts', 'billing', 'administrator', 'management'])) list.push({ id: 'challans', label: 'Challans to bill', count: count('challanUnbilled'), status: 'challan_unbilled' });
  if (hasAnyStockFlowRole(roles, ['administrator', 'management', 'sales', 'operations'])) list.push({ id: 'follow-ups', label: 'Customer follow-ups due', count: count('followUpsDue'), status: 'follow_up_due' });
  if (hasAnyStockFlowRole(roles, ['administrator', 'management', 'operations'])) list.push({ id: 'delivery', label: 'Deliveries needing attention', count: count('deliveryAttention'), status: 'delivery_attention' });
  return list.filter((item) => item.count > 0);
}

function myActionsOverdueCount(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid my actions response');
  const count = (value as { overdueCount?: unknown }).overdueCount;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid my actions count');
  return count;
}

/** Server list filter for one queue status: exact status names use themselves, grouped names map as in Orders. */
function listFilter(status: string) {
  return status === 'awaiting_tally_billing' ? 'billing' : status;
}

type ListPage = { orders?: OrderSummary[]; pagination?: { total?: number } };

function listOrders(value: unknown): { orders: OrderSummary[]; total: number } {
  if (!value || typeof value !== 'object' || !Array.isArray((value as ListPage).orders)) throw new Error('Invalid order list');
  const page = value as ListPage;
  const orders = (page.orders || []).filter((order) => order && typeof order.id === 'string' && typeof order.orderNumber === 'string');
  const total = Number(page.pagination?.total ?? orders.length);
  return { orders, total: Number.isFinite(total) && total >= 0 ? total : orders.length };
}

export function workListUrl(status: string, query = '') {
  const parameters = new URLSearchParams({ list: '1', page: '1', status });
  if (query) parameters.set('query', query);
  return `/api/orders?${parameters.toString()}`;
}

class HttpStatusError extends Error {
  constructor(readonly status: number) { super(`HTTP ${status}`); }
}

function byUrgency(left: WorkItem, right: WorkItem) {
  if (left.isNew !== right.isNew) return left.isNew ? -1 : 1;
  return left.waitingSince.localeCompare(right.waitingSince);
}

/**
 * One foreground checker per signed-in session, single request at a time. Every 15 s while visible and online it reads
 * the small summary; it re-reads the assignee and queue lists (heavier: they carry the Tally invoice snapshot) only on
 * the first check, when a summary count moves, after `reconcile()`, or every five minutes. 15 s timeout; 1/2/4/5-minute
 * backoff on failures; stops on 401/403. The first check is the baseline: work already waiting shows as waiting, not new.
 */
export function startWorkNotifications(options: {
  actorEmail: string;
  roles: unknown;
  fetchJson: (url: string, signal: AbortSignal) => Promise<Response>;
  active: () => boolean;
  online: () => boolean;
  onState: (state: WorkNotificationState) => void;
  onFresh?: (items: WorkItem[]) => void;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const workQueues = workQueuesForRoles(options.roles);
  const assigneeQuery = `assignee:${options.actorEmail.toLocaleLowerCase('en-IN')}`;
  let state: WorkNotificationState = { connection: 'checking', work: [], workTotal: 0, workMore: false, queues: workQueues.map((queue) => ({ ...queue, total: 0, newCount: 0 })), fresh: [], reminders: [], checkedAt: null };
  let known: Set<string> | null = null; // `${queueId}:${orderId}` (assigned uses queueId 'assigned')
  let fresh = new Map<string, WorkItem>(); // keyed by orderId
  let stopped = false;
  let denied = false;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let nextCheck = 0;
  let lastSignature = '';
  let listsReadAt = 0;
  let statusTotals: Record<string, number> = {};
  let overdueActions: number | null = null;

  const emit = (patch: Partial<WorkNotificationState>) => { state = { ...state, ...patch }; options.onState(state); };
  const clearTimer = () => { if (timer) clearTimeout(timer); timer = undefined; };

  async function getJson(url: string, signal: AbortSignal) {
    const response = await options.fetchJson(url, signal);
    if (response.status === 401 || response.status === 403) throw new HttpStatusError(response.status);
    if (!response.ok) throw new Error('Work check unavailable');
    return response.json() as Promise<unknown>;
  }

  async function readLists(signal: AbortSignal) {
    const statuses = [...new Set(workQueues.flatMap((queue) => queue.statuses))];
    const [assignedPage, ...pages] = await Promise.all([
      getJson(workListUrl('open', assigneeQuery), signal).then(listOrders),
      ...statuses.map((status) => getJson(workListUrl(listFilter(status)), signal).then(listOrders)),
    ]);
    return { assignedPage, byStatus: new Map(statuses.map((status, index) => [status, pages[index]])) };
  }

  async function refresh(force = false) {
    if (stopped || denied || controller) return;
    clearTimer();
    if (!options.online()) { emit({ connection: 'offline' }); return; }
    if (!options.active()) return;
    const delay = nextCheck - now();
    if (!force && delay > 0) { timer = setTimeout(() => void refresh(), delay); return; }
    const request = new AbortController();
    controller = request;
    const timeout = setTimeout(() => request.abort(), 15_000);
    try {
      const summary = await getJson('/api/orders?summary=1', request.signal);
      if (stopped || controller !== request) return;
      const rawOperations = summary && typeof summary === 'object' ? (summary as { operations?: unknown }).operations : undefined;
      const operations = rawOperations && typeof rawOperations === 'object' ? rawOperations as Record<string, unknown> : {};
      const revision = summary && typeof summary === 'object' ? (summary as { orderRevision?: unknown }).orderRevision : undefined;
      const signature = JSON.stringify([operations, typeof revision === 'string' ? revision : null]);
      const arrivals: WorkItem[] = [];
      let listPatch: Partial<WorkNotificationState> = {};
      if (known === null || signature !== lastSignature || now() - listsReadAt >= WORK_LIST_REFRESH) {
        if (hasAnyStockFlowRole(options.roles, ['administrator', 'management', 'sales', 'operations'])) {
          try { overdueActions = myActionsOverdueCount(await getJson('/api/my-actions?action=get_my_actions&page=1', request.signal)); }
          catch { /* This optional reminder must not affect bell connectivity or its cached count. */ }
        }
        const { assignedPage, byStatus } = await readLists(request.signal);
        if (stopped || controller !== request) return;
        const firstCheck = known === null;
        const seen = known ?? new Set<string>();
        const prune = (queueId: string, pages: { orders: OrderSummary[]; total: number }[]) => {
          if (!pages.every((page) => page.orders.length === page.total)) return;
          const present = new Set(pages.flatMap((page) => page.orders.map((order) => `${queueId}:${order.id}`)));
          for (const key of seen) if (key.startsWith(`${queueId}:`) && !present.has(key)) seen.delete(key);
        };
        for (const queue of workQueues) prune(queue.id, queue.statuses.map((status) => byStatus.get(status)!));
        prune('assigned', [assignedPage]);
        const items = new Map<string, WorkItem>();
        const arrive = (order: OrderSummary, queueId: string, message: string, assignedToMe: boolean) => {
          const key = `${queueId}:${order.id}`;
          const isNew = !firstCheck && !seen.has(key);
          seen.add(key);
          const existing = items.get(order.id);
          const item: WorkItem = existing
            ? { ...existing, assignedToMe: existing.assignedToMe || assignedToMe, isNew: existing.isNew || isNew }
            : { orderId: order.id, orderNumber: order.orderNumber, customerName: order.customerName, status: order.status, queueId, message, isNew: isNew || fresh.has(order.id), assignedToMe, waitingSince: order.updatedAt || order.createdAt || '' };
          items.set(order.id, item);
          if (isNew) { fresh.set(order.id, item); if (!arrivals.some((arrival) => arrival.orderId === order.id)) arrivals.push(item); }
        };
        for (const queue of workQueues) for (const status of queue.statuses) for (const order of byStatus.get(status)?.orders ?? []) arrive(order, queue.id, queue.message, false);
        for (const order of assignedPage.orders) arrive(order, 'assigned', 'Assigned to you', true);
        // Work that left every queue was completed (by anyone): it stops being new and leaves the bell.
        fresh = new Map([...fresh].filter(([orderId]) => items.has(orderId)));
        for (const [orderId, item] of items) if (fresh.has(orderId)) items.set(orderId, { ...item, isNew: true });
        statusTotals = Object.fromEntries([...byStatus].map(([status, page]) => [status, page.total]));
        const queueStates = workQueues.map((queue) => ({
          ...queue,
          total: queue.statuses.reduce((sum, status) => sum + (byStatus.get(status)?.total ?? 0), 0),
          newCount: [...items.values()].filter((item) => item.isNew && item.queueId === queue.id).length,
        }));
        const workMore = [...byStatus.values(), assignedPage].some((page) => page.orders.length < page.total);
        known = seen;
        lastSignature = signature;
        listsReadAt = now();
        listPatch = { work: [...items.values()].sort(byUrgency), workTotal: items.size, workMore, queues: queueStates, fresh: [...fresh.values()] };
      }
      failures = 0;
      nextCheck = now() + WORK_CHECK_INTERVAL;
      const reminders = workReminders(operations, options.roles);
      if (overdueActions !== null && overdueActions > 0) reminders.push({ id: 'my-actions', label: 'My actions overdue', count: overdueActions, status: 'my_actions' });
      emit({ ...listPatch, connection: 'live', reminders, checkedAt: new Date(now()).toISOString() });
      if (arrivals.length) options.onFresh?.(arrivals);
    } catch (cause) {
      if (stopped || controller !== request) return;
      if (cause instanceof HttpStatusError) {
        denied = true;
        fresh = new Map();
        emit({ connection: cause.status === 401 ? 'signed-out' : 'forbidden', work: [], workTotal: 0, workMore: false, fresh: [], reminders: [], queues: state.queues.map((queue) => ({ ...queue, total: 0, newCount: 0 })) });
        return;
      }
      failures += 1;
      nextCheck = now() + Math.min(5 * FAILURE_BACKOFF, FAILURE_BACKOFF * 2 ** (failures - 1));
      emit({ connection: options.online() ? 'unavailable' : 'offline' });
    } finally {
      clearTimeout(timeout);
      if (controller === request) controller = undefined;
      if (!stopped && !denied && options.active() && options.online()) timer = setTimeout(() => void refresh(), Math.max(0, nextCheck - now()));
    }
  }

  function wake() {
    if (!options.active() || !options.online()) {
      clearTimer();
      const request = controller;
      controller = undefined;
      request?.abort();
      if (!options.online()) emit({ connection: 'offline' });
      return;
    }
    void refresh();
  }

  emit({});
  void refresh();
  return {
    wake,
    retry: () => { void refresh(true); },
    /** This person just changed an order: re-read the lists at once so finished work leaves and next-role work arrives. */
    reconcile: () => {
      lastSignature = '';
      nextCheck = 0;
      void refresh(true);
    },
    /** The bell was closed: nothing shown is "new" any more. The work itself stays until its stage is done. */
    markSeen: () => {
      fresh = new Map();
      emit({ fresh: [], work: state.work.map((item) => ({ ...item, isNew: false })).sort(byUrgency), queues: state.queues.map((queue) => ({ ...queue, newCount: 0 })) });
    },
    ordersFilterFor: (queue: WorkQueueState) => queueOrdersFilter(queue, statusTotals),
    stop: () => { stopped = true; clearTimer(); controller?.abort(); controller = undefined; },
  };
}

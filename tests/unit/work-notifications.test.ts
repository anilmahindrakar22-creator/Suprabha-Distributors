import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queueOrdersFilter, startWorkNotifications, workQueuesForRoles, workReminders, type WorkNotificationState } from '@/lib/work-notifications';

const order = (id: string, status: string, updatedAt = '2026-10-11T09:00:00Z') => ({ id, orderNumber: `SF-${id}`, customerName: `Lab ${id}`, status, updatedAt, createdAt: updatedAt });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('who owns each stage', () => {
  it('gives billing-only staff exactly the ready-to-bill queue and viewers none', () => {
    expect(workQueuesForRoles(['billing'])).toEqual([{
      id: 'bill-ready', label: 'Ready to bill', statuses: ['awaiting_tally_billing'],
      message: 'Packed and priced · ready to bill',
    }]);
    expect(workQueuesForRoles(['viewer'])).toEqual([]);
  });

  it('routes each stage to the next role; packed belongs to Accounts, billed to Operations', () => {
    expect(workQueuesForRoles(['accounts']).map((queue) => [queue.id, queue.statuses])).toEqual([['bill', ['packed', 'awaiting_tally_billing']]]);
    expect(workQueuesForRoles(['operations']).map((queue) => queue.id)).toEqual(['confirm', 'pack', 'dispatch']);
    expect(workQueuesForRoles(['warehouse']).map((queue) => queue.id)).toEqual(['pack']);
    expect(workQueuesForRoles(['management']).map((queue) => queue.id)).toEqual(['confirm']);
    expect(workQueuesForRoles(['sales', 'accounts']).map((queue) => queue.id)).toEqual(['confirm', 'bill']);
    expect(workQueuesForRoles(['viewer'])).toEqual([]);
    expect(workQueuesForRoles(['administrator', 'unknown'])).toEqual([]);
  });

  it('opens the largest part of a queue in Orders', () => {
    const bill = { ...workQueuesForRoles(['accounts'])[0], total: 0, newCount: 0 };
    expect(queueOrdersFilter(bill, { packed: 3, awaiting_tally_billing: 1 })).toBe('packed');
    expect(queueOrdersFilter(bill, { packed: 0, awaiting_tally_billing: 1 })).toBe('billing');
    expect(queueOrdersFilter({ ...workQueuesForRoles(['management'])[0], total: 0, newCount: 0 })).toBe('awaiting_confirmation');
  });

  it('keeps count-only reminders to the roles that act on them', () => {
    expect(workReminders({ followUpsDue: 2, deliveryAttention: 1 }, ['accounts'])).toEqual([]);
    expect(workReminders({ followUpsDue: 2, deliveryAttention: 0 }, ['sales']).map((item) => item.id)).toEqual(['follow-ups']);
    expect(workReminders({ followUpsDue: -1, deliveryAttention: 'x' }, ['operations'])).toEqual([]);
  });
});

describe('foreground work checker', () => {
  let lists: Record<string, ReturnType<typeof order>[]>;
  let assigned: ReturnType<typeof order>[];
  let totals: Record<string, number>;
  let assignedTotal: number | undefined;
  let summaryStatus: number;
  let moves: number;
  let states: WorkNotificationState[];
  let arrivals: string[][];
  const fetchJson = vi.fn(async (url: string) => {
    if (url.includes('summary=1')) return json({ operations: { moves } }, summaryStatus);
    const parameters = new URL(url, 'https://x.test').searchParams;
    if ((parameters.get('query') || '').startsWith('assignee:')) return json({ orders: assigned, pagination: { total: assignedTotal ?? assigned.length } });
    const rows = lists[parameters.get('status') || ''] ?? [];
    return json({ orders: rows, pagination: { total: totals[parameters.get('status') || ''] ?? rows.length } });
  });
  const start = (roles: string[] = ['accounts']) => startWorkNotifications({
    actorEmail: 'Accounts@Example.test', roles, fetchJson, active: () => true, online: () => true,
    onState: (state) => states.push(state), onFresh: (items) => arrivals.push(items.map((item) => item.orderNumber)),
  });
  const last = () => states[states.length - 1];
  const listCalls = () => fetchJson.mock.calls.filter(([url]) => String(url).includes('list=1')).length;

  beforeEach(() => {
    vi.useFakeTimers();
    lists = { packed: [], billing: [order('1', 'awaiting_tally_billing', '2026-10-11T08:00:00Z')] };
    assigned = [];
    totals = {};
    assignedTotal = undefined;
    summaryStatus = 200;
    moves = 0;
    states = [];
    arrivals = [];
    fetchJson.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('counts an order in two queues and the assignee list once', async () => {
    const shared = order('1', 'packed');
    lists = { picking: [shared], packed: [shared], billing: [] };
    assigned = [shared];
    const service = start(['warehouse', 'accounts']);
    await vi.advanceTimersByTimeAsync(0);
    expect(last()).toMatchObject({ workTotal: 1, workMore: false });
    expect(last().work).toHaveLength(1);
    expect(last().work[0].assignedToMe).toBe(true);
    service.stop();
  });

  it.each(['queue', 'assigned'])('flags truncated %s pages without adding unseen totals', async (source) => {
    if (source === 'queue') totals.billing = 20;
    else { assigned = [order('1', 'awaiting_tally_billing')]; assignedTotal = 20; }
    const service = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(last()).toMatchObject({ workTotal: 1, workMore: true });
    totals = {};
    assignedTotal = undefined;
    service.reconcile();
    await vi.advanceTimersByTimeAsync(0);
    expect(last().workMore).toBe(false);
    service.stop();
  });

  it.each(['queue', 'assigned'])('announces work that leaves a complete %s list and re-enters', async (source) => {
    lists = { packed: [], billing: [] };
    const returning = order('1', 'awaiting_tally_billing');
    if (source === 'queue') lists.billing = [returning];
    else assigned = [returning];
    const service = start();
    await vi.advanceTimersByTimeAsync(0);
    lists.billing = [];
    assigned = [];
    service.reconcile();
    await vi.advanceTimersByTimeAsync(0);
    expect(last().workTotal).toBe(0);
    if (source === 'queue') lists.billing = [returning];
    else assigned = [returning];
    service.reconcile();
    await vi.advanceTimersByTimeAsync(0);
    expect(arrivals).toEqual([['SF-1']]);
    expect(last().work[0].isNew).toBe(true);
    service.stop();
  });

  it.each(['queue', 'assigned'])('does not reannounce known work beyond a truncated %s page', async (source) => {
    lists = { packed: [], billing: [] };
    const returning = order('1', 'awaiting_tally_billing');
    const other = order('2', 'awaiting_tally_billing');
    if (source === 'queue') lists.billing = [returning, other];
    else assigned = [returning, other];
    const service = start();
    await vi.advanceTimersByTimeAsync(0);
    if (source === 'queue') { lists.billing = [other]; totals.billing = 2; }
    else { assigned = [other]; assignedTotal = 2; }
    service.reconcile();
    await vi.advanceTimersByTimeAsync(0);
    if (source === 'queue') lists.billing = [returning];
    else assigned = [returning];
    service.reconcile();
    await vi.advanceTimersByTimeAsync(0);
    expect(last()).toMatchObject({ workTotal: 1, workMore: true, fresh: [] });
    expect(last().work[0].isNew).toBe(false);
    expect(arrivals).toEqual([]);
    service.stop();
  });

  it('keeps a handoff known when it moves between statuses in the same queue', async () => {
    const service = start();
    await vi.advanceTimersByTimeAsync(0);
    lists = { packed: [order('1', 'packed')], billing: [] };
    service.reconcile();
    await vi.advanceTimersByTimeAsync(0);
    expect(arrivals).toEqual([]);
    expect(last().work[0].isNew).toBe(false);
    service.stop();
  });

  it('treats waiting work as waiting, then announces each packed order within one check', async () => {
    const service = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(last()).toMatchObject({ connection: 'live', workTotal: 1, fresh: [] });
    expect(last().queues[0]).toMatchObject({ id: 'bill', total: 1, newCount: 0 });
    expect(fetchJson.mock.calls.some(([url]) => String(url).includes('query=assignee%3Aaccounts%40example.test'))).toBe(true);

    // Order 1 is billed (leaves) while order 2 is packed in: same count, still one new hand-off.
    lists = { packed: [order('2', 'packed', '2026-10-11T09:30:00Z')], billing: [] };
    moves += 1;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(arrivals).toEqual([['SF-2']]);
    expect(last().work.map((item) => [item.orderNumber, item.isNew, item.message])).toEqual([['SF-2', true, 'Packed · ready for Tally billing']]);
    expect(last().queues[0]).toMatchObject({ total: 1, newCount: 1 });
    service.stop();
  });

  it('seeing work never completes it; finishing the stage removes it', async () => {
    const service = start();
    await vi.advanceTimersByTimeAsync(0);
    lists = { packed: [order('2', 'packed')], billing: lists.billing };
    moves += 1;
    await vi.advanceTimersByTimeAsync(15_000);
    service.markSeen();
    expect(last().fresh).toEqual([]);
    expect(last().work.map((item) => [item.orderNumber, item.isNew])).toEqual([['SF-1', false], ['SF-2', false]]);
    lists = { packed: [], billing: [] };
    moves += 1;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(last().work).toEqual([]);
    expect(last().workTotal).toBe(0);
    service.stop();
  });

  it('gives a combined-role person their own next-role task (no blanket self-suppression)', async () => {
    lists = { picking: [order('5', 'picked')], packed: [], billing: [] };
    const service = start(['warehouse', 'accounts']);
    await vi.advanceTimersByTimeAsync(0);
    expect(last().work.map((item) => item.queueId)).toEqual(['pack']);
    // They mark it packed themselves; Orders asks for an immediate reconcile.
    lists = { picking: [], packed: [order('5', 'packed')], billing: [] };
    service.reconcile();
    await vi.advanceTimersByTimeAsync(0);
    expect(last().work.map((item) => [item.queueId, item.isNew])).toEqual([['bill', true]]);
    service.stop();
  });

  it('reads the heavy lists only when a count moves or on reconcile, and merges an assignment into one item', async () => {
    const service = start();
    await vi.advanceTimersByTimeAsync(0);
    const afterFirst = listCalls();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(listCalls()).toBe(afterFirst);
    assigned = [order('1', 'awaiting_tally_billing')];
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(listCalls()).toBeGreaterThan(afterFirst);
    expect(last().work).toHaveLength(1);
    expect(last().work[0]).toMatchObject({ orderNumber: 'SF-1', assignedToMe: true });
    service.stop();
  });

  it('backs off on server errors, and stops on sign-in loss or missing access', async () => {
    summaryStatus = 500;
    const service = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(last().connection).toBe('unavailable');
    const calls = fetchJson.mock.calls.length;
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetchJson.mock.calls.length).toBe(calls);
    summaryStatus = 401;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(last().connection).toBe('signed-out');
    const afterDenied = fetchJson.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchJson.mock.calls.length).toBe(afterDenied);
    service.stop();

    summaryStatus = 403;
    const forbidden = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(last().connection).toBe('forbidden');
    forbidden.stop();
  });
});

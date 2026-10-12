import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const workspace = read('../../components/order-workspace.tsx');
const list = read('../../components/order-list.tsx');
const frame = read('../../components/stockflow-frame.tsx');

describe('order-list density (list-first redesign)', () => {
  it('pins one compact header with search, stage chips and a Filters panel', () => {
    expect(workspace).toContain('sticky top-0 z-20');
    expect(workspace).toContain('<OrderStageChips filters={stageFilters} active={status} onSelect={showQueue} />');
    for (const chip of ["label: 'Active'", "label: 'Confirm'", "label: 'Pack'", "label: 'Bill'", "label: 'Dispatch'", "label: 'Issues'"]) expect(workspace).toContain(chip);
    expect(workspace).toContain('aria-expanded={mobileFiltersOpen}');
    expect(workspace).toContain('aria-controls="mobile-order-filters"');
    expect(workspace).toContain('id="order-status"');
    expect(workspace).toContain('>Old orders</button>');
    expect(workspace).toContain("awaiting_confirmation: 'Orders awaiting confirmation'");
    expect(workspace).toContain('{queueNames[status] || statusLabel(status)}');
    expect(workspace).not.toContain('aria-label="Order handoff queues"');
  });

  it('keeps Product requests and Customer demand off the Orders list', () => {
    expect(workspace).not.toContain('<ProductRequestInbox');
    expect(workspace).not.toContain('<ProcurementRequirements');
    expect(frame).toContain("'requests'");
    expect(frame).toContain('<RequestsWorkspace roles={roles} />');
  });

  it('shows compact grouped rows on mobile and opens one order full screen', () => {
    expect(workspace).toContain('groupOrdersForList(visibleOrders, showsDeliveredToday ? deliveredToday : [])');
    expect(workspace).toContain("status: 'history'");
    expect(workspace).toContain('<CompactOrderRow key={order.id} order={order} onOpen={openOrderDetail} isNew={newOrderIds?.has(order.id)} />');
    expect(workspace).not.toContain('aria-label="Order notifications"');
    expect(frame).toContain('<NotificationBell state={work}');
    expect(workspace).toContain('aria-label="Back to orders"');
    expect(workspace).toContain('<OrderProgress status={openOrder.status} />');
    expect(list).toContain('min-h-15');
    expect(list).toContain("confirm: { bar: 'bg-sf-stage-confirm'");
    expect(list).toContain("'bg-sf-danger-soft text-sf-danger'");
  });

  it('keeps the next workflow action visible while collapsing secondary order controls', () => {
    expect(workspace).toContain('[content-visibility:auto]');
    expect(workspace).toContain('<span>More order controls</span>');
    expect(workspace).toContain('Customer orders');
    expect(workspace).toContain('Repeat as new order');
    expect(workspace).toContain('<OrderSummaryCopy order={order} />');
    expect(workspace.indexOf('More order controls')).toBeLessThan(workspace.indexOf('Customer orders'));
    expect(workspace.indexOf('More order controls')).toBeLessThan(workspace.indexOf('Cancel order'));
    expect(workspace).toContain('setNoticeOrderNumber(acknowledgedOrder?.orderNumber');
    expect(workspace).toContain('Review order</button>');
    expect(workspace).toContain('setNoticeOrderNumber(result.orderNumber)');
    expect(workspace).toContain('setNoticeOrderNumber(number)');
  });

  it('uses a single selected order workspace in the desktop control center', () => {
    expect(workspace).toContain("const desktopControlCenterQuery = '(min-width: 1024px)'");
    expect(workspace).toContain('aria-label="Desktop order queue"');
    expect(workspace).toContain('aria-label="Selected order workspace"');
    expect(workspace).toContain('lg:h-[calc(100dvh-9.5rem)] lg:min-h-96');
    expect(workspace).toContain('h-full min-w-0 overflow-y-auto overscroll-contain');
    expect(workspace).toContain("aria-current={selected ? 'true' : undefined}");
    expect(workspace).toContain('desktopControlCenter ? (');
    expect(workspace).toContain('aria-label="Previous order"');
    expect(workspace).toContain('aria-label="Next order"');
    expect(workspace).toContain('moveDesktopSelectionAfter(order.id)');
    expect(workspace).toContain('`desktop-order-${nextOrder.id}`)?.focus()');
    expect(workspace).toContain('<span aria-live="polite"');
    expect(workspace).toContain('const remainingOrders = filterOrders(patched.orders, query, status)');
    expect(workspace).toContain('total: Math.max(0, patched.pagination.total - removedFromQueue)');
    expect(workspace).toContain('removedFromQueue && remainingOrders.length === 0');
    expect(workspace).toContain("['ArrowUp', 'ArrowDown', 'Home', 'End']");
    expect(workspace).toContain('↑ ↓ to navigate');
    expect(workspace).toContain('compactOrderAge(order.createdAt)');
    expect(workspace).toContain("order.assignedToEmail ? `Owner: ${order.assignedToEmail}` : 'Unassigned'");
    expect(workspace).toContain('<OrderProgress status={selectedOrder.status} />');
    expect(workspace).toContain('aria-label="Order product preview"');
    expect(workspace).toContain('order.lines.slice(0, 4)');
  });
});

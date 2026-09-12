import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workspace = readFileSync(
  fileURLToPath(new URL('../../components/order-workspace.tsx', import.meta.url)),
  'utf8',
);

describe('mobile order-list density', () => {
  it('keeps the search controls visible and collapses secondary filters on small screens', () => {
    expect(workspace).toContain('sticky top-0 z-20');
    expect(workspace).toContain('More filters');
    expect(workspace).toContain('aria-expanded={mobileFiltersOpen}');
    expect(workspace).toContain('aria-controls="mobile-order-filters"');
    expect(workspace).toContain('sm:min-h-11 sm:px-4">My work</button>');
    expect(workspace).toContain('sm:hidden');
    expect(workspace).toContain('sm:contents');
    expect(workspace).toContain("awaiting_confirmation: 'Orders awaiting confirmation'");
    expect(workspace).toContain("billing: 'Tally billing queue'");
    expect(workspace).toContain('{queueNames[status] || statusLabel(status)}');
  });

  it('uses a compact horizontal summary and defers off-screen order rendering', () => {
    expect(workspace).toContain('aria-label="Order handoff queues"');
    for (const queue of ['Confirm orders', 'Pick & pack', 'Tally billing', 'Ready to dispatch', 'Delivery attention']) {
      expect(workspace).toContain(`label="${queue}"`);
    }
    expect(workspace).toContain("{value == null ? '›' : Number(value).toLocaleString('en-IN')}");
    expect(workspace).toContain('Your queue');
    expect(workspace).toContain('flex snap-x gap-1.5 overflow-x-auto');
    expect(workspace).toContain('min-h-14 min-w-36 flex-1 shrink-0 snap-start');
    expect(workspace).toContain('[content-visibility:auto]');
    expect(workspace).toContain('[contain-intrinsic-size:auto_260px]');
    expect(workspace).toContain('<span className="sm:hidden"> · {formatQuantity(total)} qty</span>');
    expect(workspace).toContain('<div className="hidden sm:block">');
  });

  it('keeps the next workflow action visible while collapsing secondary order controls', () => {
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
    expect(workspace).toContain('lg:h-[calc(100dvh-20rem)] lg:min-h-96');
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
    expect(workspace).toContain("deliveryState === 'overdue' ? 'Delivery overdue'");
    expect(workspace).toContain('compactOrderAge(order.createdAt)');
    expect(workspace).toContain("order.assignedToEmail ? `Owner: ${order.assignedToEmail}` : 'Unassigned'");
    expect(workspace).toContain("{attentionCount} alert{attentionCount === 1 ? '' : 's'}");
    expect(workspace).toContain('aria-label="Order product preview"');
    expect(workspace).toContain('order.lines.slice(0, 4)');
    expect(workspace).toContain('mt-3 hidden flex-wrap gap-1.5 lg:flex');
  });
});

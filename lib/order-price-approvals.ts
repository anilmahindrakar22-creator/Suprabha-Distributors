import { readJsonResponse } from '@/lib/http-json';
import type { OrderSummary } from '@/lib/order-types';
import type { OrderPricingWorkspace } from '@/lib/pricing-types';

export type OrderPriceApproval = { orderId: string; orderNumber: string; customerName: string; createdAt: string; workspace: OrderPricingWorkspace };

const MAX_PAGES = 10;
const PRICING_CONCURRENCY = 4;

/**
 * Active orders whose price waits for a decision, each with its pricing workspace.
 * There is no server list of pending order prices, so this pages the light active-order
 * list (at most 10 pages) and loads pricing only for the orders that need approval.
 */
export async function loadOrderPriceApprovals(fetchFn: typeof fetch): Promise<{ items: OrderPriceApproval[]; truncated: boolean }> {
  const waiting: OrderSummary[] = [];
  let pageCount = 1;
  for (let page = 1; page <= Math.min(pageCount, MAX_PAGES); page += 1) {
    const result = await readJsonResponse<{ orders: OrderSummary[]; pagination?: { pageCount?: number } }>(
      await fetchFn(`/api/orders?list=1&status=open&page=${page}`, { cache: 'no-store' }), 'Active orders could not be loaded');
    waiting.push(...result.orders.filter((order) => order.pricingState === 'approval_required'));
    pageCount = Math.max(1, result.pagination?.pageCount ?? 1);
  }
  const items: OrderPriceApproval[] = [];
  for (let start = 0; start < waiting.length; start += PRICING_CONCURRENCY) {
    const batch = await Promise.all(waiting.slice(start, start + PRICING_CONCURRENCY).map(async (order) => {
      const workspace = await readJsonResponse<OrderPricingWorkspace>(
        await fetchFn(`/api/pricing?orderId=${encodeURIComponent(order.id)}`, { cache: 'no-store' }), 'Order pricing could not be loaded');
      return { orderId: order.id, orderNumber: order.orderNumber, customerName: order.customerName, createdAt: order.createdAt, workspace };
    }));
    items.push(...batch.filter((item) => item.workspace.exceptions.length > 0));
  }
  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { items, truncated: pageCount > MAX_PAGES };
}

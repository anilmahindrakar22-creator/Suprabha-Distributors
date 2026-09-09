import { getChatGPTUser } from '@/app/chatgpt-auth';
import { callOrderGateway, OrderGatewayError } from '@/lib/order-gateway';
import type { CatalogItem, CustomerDirectoryEntry, OrderBootstrap, OrderEvent } from '@/lib/order-types';
import { isOrderDeliveryOverdue, orderNeedsBillingAttention, ordersCsv, validateOrderCommand } from '@/lib/order-types';
import { measuredJsonResponse } from '@/lib/measured-json-response';
import { matchingOrderList, parseOrderListQuery, queryBillingAttentionList, queryOrderList } from '@/lib/order-list-query';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';

const privateHeaders = { 'cache-control': 'private, no-store' };

function failure(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: privateHeaders });
}

async function authorizedUser() {
  const user = await getChatGPTUser();
  if (!user) throw new OrderGatewayError('Sign in required', 401);
  return user;
}

const invoicedStatuses = ['billed_in_tally', 'ready_for_dispatch', 'dispatched', 'delivered', 'cancelled'];

async function billingAttentionOrders(userEmail: string, query: string, captureDate: string) {
  async function loadStatus(status: string) {
    const first = await callOrderGateway<OrderBootstrap>(userEmail, 'list_orders', { page: 1, pageSize: 200, query, status, date: captureDate });
    const orders = [...first.orders];
    for (let page = 2; page <= (first.pagination?.pageCount || 1); page += 1) {
      const next = await callOrderGateway<OrderBootstrap>(userEmail, 'list_orders', { page, pageSize: 200, query, status, date: captureDate });
      orders.push(...next.orders);
    }
    return { first, orders };
  }

  const [groups, invoiceSnapshot] = await Promise.all([
    Promise.all(invoicedStatuses.map(loadStatus)),
    callOrderGateway<OrderBootstrap>(userEmail, 'bootstrap'),
  ]);
  const template = groups[0].first;
  const orders = groups.flatMap((group) => group.orders).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const invoices = invoiceSnapshot.snapshot.tallyInvoices || [];
  return {
    template,
    invoices,
    orders,
  };
}

export async function GET(request: Request) {
  const startedAt = performance.now();
  try {
    const user = await authorizedUser();
    const parameters = new URL(request.url).searchParams;
    const eventsFor = parameters.get('eventsFor');
    if (eventsFor) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventsFor)) return failure('Valid order ID is required', 400);
      return measuredJsonResponse(
        await callOrderGateway<{ events: OrderEvent[] }>(user.email, 'get_order_events', { orderId: eventsFor }),
        startedAt,
      );
    }
    if (parameters.get('catalog') === '1') {
      return measuredJsonResponse(
        await callOrderGateway<{ catalogVersion: string; catalog: CatalogItem[] }>(user.email, 'get_catalog'),
        startedAt,
      );
    }
    if (parameters.get('customers') === '1') {
      return measuredJsonResponse(
        await callOrderGateway<{ customerVersion: string; customers: CustomerDirectoryEntry[] }>(user.email, 'get_customers'),
        startedAt,
      );
    }
    if (parameters.get('list') === '1' || parameters.get('export') === '1') {
      const listQuery = parseOrderListQuery(parameters);
      if (!listQuery) return failure('Invalid order list filters', 400);
      const exporting = parameters.get('export') === '1';
      const pageSize = exporting ? 200 : 20;
      try {
        if (listQuery.status === 'billing_attention') {
          const attention = await billingAttentionOrders(user.email, listQuery.query, listQuery.captureDate);
          if (exporting) {
            const matching = attention.orders.filter((order) => orderNeedsBillingAttention(order, attention.invoices, new Date(), attention.template.snapshot.fetchedAt));
            return new Response(`\uFEFF${ordersCsv(matching, { invoices: attention.invoices, fetchedAt: attention.template.snapshot.fetchedAt })}`, {
              headers: { ...privateHeaders, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="stockflow-billing-attention-${new Date().toISOString().slice(0, 10)}.csv"` },
            });
          }
          const page = queryBillingAttentionList(attention.orders, attention.invoices, attention.template.snapshot.fetchedAt, listQuery.page);
          return measuredJsonResponse({
            ...attention.template,
            snapshot: { ...attention.template.snapshot, tallyInvoices: attention.invoices },
            orders: page.orders,
            pagination: page.pagination,
          }, startedAt);
        }
        if (['delivery_due_today', 'delivery_due_soon', 'back_ordered'].includes(listQuery.status)) {
          const first = await callOrderGateway<OrderBootstrap>(user.email, 'list_orders', {
            page: 1, pageSize: 200, query: listQuery.query, status: 'open', date: listQuery.captureDate,
          });
          const orders = [...first.orders];
          for (let page = 2; page <= (first.pagination?.pageCount || 1); page += 1) {
            const next = await callOrderGateway<OrderBootstrap>(user.email, 'list_orders', {
              page, pageSize: 200, query: listQuery.query, status: 'open', date: listQuery.captureDate,
            });
            orders.push(...next.orders);
          }
          if (exporting) {
            return new Response(`\uFEFF${ordersCsv(matchingOrderList(orders, listQuery), { invoices: first.snapshot.tallyInvoices, fetchedAt: first.snapshot.fetchedAt })}`, {
              headers: { ...privateHeaders, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="stockflow-deliveries-${new Date().toISOString().slice(0, 10)}.csv"` },
            });
          }
          return measuredJsonResponse({ ...first, ...queryOrderList(orders, listQuery) }, startedAt);
        }
        const first = await callOrderGateway<OrderBootstrap>(user.email, 'list_orders', {
          page: exporting ? 1 : listQuery.page,
          pageSize,
          query: listQuery.query,
          status: listQuery.status,
          date: listQuery.captureDate,
        });
        if (!exporting) return measuredJsonResponse(first, startedAt);
        const orders = [...first.orders];
        const pageCount = first.pagination?.pageCount || 1;
        for (let page = 2; page <= pageCount; page += 1) {
          const next = await callOrderGateway<OrderBootstrap>(user.email, 'list_orders', {
            page, pageSize, query: listQuery.query, status: listQuery.status, date: listQuery.captureDate,
          });
          orders.push(...next.orders);
        }
        return new Response(`\uFEFF${ordersCsv(orders, { invoices: first.snapshot.tallyInvoices, fetchedAt: first.snapshot.fetchedAt })}`, {
          headers: { ...privateHeaders, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="stockflow-orders-${new Date().toISOString().slice(0, 10)}.csv"` },
        });
      } catch (error) {
        if (['billing_attention', 'delivery_due_today', 'delivery_due_soon', 'back_ordered'].includes(listQuery.status)) throw error;
        if (!(error instanceof OrderGatewayError) || ![400, 502].includes(error.status)) throw error;
        // Compatibility path while the database migration and edge function roll out.
      }
    }
    const result = await callOrderGateway<OrderBootstrap>(user.email, 'bootstrap');
    const delayedFailedDeliveries = result.orders.filter((order) =>
      isOrderDeliveryOverdue(order) ||
      (order.exceptions || []).some((item) => item.status === 'open' && ['delayed', 'failed_delivery'].includes(item.category)),
    ).length;
    const enriched = { ...result, operations: { ...result.operations, delayedFailedDeliveries } };
    if (parameters.get('list') === '1' || parameters.get('export') === '1') {
      const listQuery = parseOrderListQuery(parameters);
      if (!listQuery) return failure('Invalid order list filters', 400);
      if (parameters.get('export') === '1') {
        return new Response(`\uFEFF${ordersCsv(matchingOrderList(result.orders, listQuery), { invoices: result.snapshot.tallyInvoices, fetchedAt: result.snapshot.fetchedAt })}`, {
          headers: { ...privateHeaders, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="stockflow-orders-${new Date().toISOString().slice(0, 10)}.csv"` },
        });
      }
      return measuredJsonResponse({ ...enriched, ...queryOrderList(result.orders, listQuery) }, startedAt);
    }
    return measuredJsonResponse(enriched, startedAt);
  } catch (error) {
    if (error instanceof OrderGatewayError) {
      return failure(error.message, error.status);
    }
    return failure('Order service is temporarily unavailable', 502);
  }
}

export async function POST(request: Request) {
  try {
    const user = await authorizedUser();
    const command = validateOrderCommand(await readBoundedJsonRequest(request));
    if (!command) return failure('Invalid order request', 400);

    const result = await callOrderGateway<Record<string, unknown>>(
      user.email,
      command.action,
      command.payload,
    );
    return Response.json(result, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof BoundedJsonRequestError) return failure(error.message, error.status);
    if (error instanceof OrderGatewayError) {
      return failure(error.message, error.status);
    }
    return failure('Order service is temporarily unavailable', 502);
  }
}

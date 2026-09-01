'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CatalogItem,
  CustomerDirectoryEntry,
  OrderBootstrap,
  OrderCommand,
  OrderSummary,
} from '@/lib/order-types';
import { filterOrders, orderStage, searchCatalog, searchCustomers } from '@/lib/order-types';

type DraftLine = { item: CatalogItem; quantity: number };

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
  ready_for_dispatch: { label: 'Mark dispatched', status: 'dispatched' },
  dispatched: { label: 'Mark delivered', status: 'delivered' },
};

function formatQuantity(value: number) {
  return Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

function statusLabel(status: string) {
  return statusNames[status] || status.replaceAll('_', ' ');
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Unable to complete the request');
  return body;
}

export function OrderWorkspace() {
  const [data, setData] = useState<OrderBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('open');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await readResponse<OrderBootstrap>(await fetch('/api/orders', { cache: 'no-store' })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load orders');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/orders', { cache: 'no-store' })
      .then((response) => readResponse<OrderBootstrap>(response))
      .then((result) => {
        if (active) setData(result);
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
  }, []);

  const visibleOrders = useMemo(() => {
    return filterOrders(data?.orders || [], query, status);
  }, [data?.orders, query, status]);

  async function runCommand(command: OrderCommand, success: string) {
    setError('');
    setNotice('');
    try {
      await readResponse(
        await fetch('/api/orders', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(command),
        }),
      );
      setNotice(success);
      await load();
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
          orderId: order.id,
          expectedVersion: order.version,
          toStatus: action.status,
          tallyInvoiceNumber: tallyInvoiceNumber?.trim() || undefined,
        },
      },
      `${order.orderNumber} moved to ${statusLabel(action.status)}.`,
    );
  }

  const operations = data?.operations || {};
  const staleText = data?.snapshot.fetchedAt || 'No Tally snapshot';

  return (
    <div className="h-full overflow-y-auto bg-[#f7f6f1]">
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
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={!data}
            className="min-h-12 rounded-xl bg-[#092f36] px-5 font-bold text-white shadow-sm transition hover:bg-[#0d4549] disabled:opacity-50"
          >
            + Order
          </button>
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
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Customer, product, invoice, phone, or order"
              className="min-h-11 w-full rounded-xl border border-[#cedfdd] px-4 pr-16 outline-none focus:border-[#64d4ad] focus:ring-3 focus:ring-[#64d4ad]/20"
            />
            {query ? <button type="button" onClick={() => setQuery('')} className="absolute bottom-1 right-1 min-h-9 rounded-lg px-3 text-xs font-bold text-[#456367] hover:bg-[#edf3f1]">Clear</button> : null}
          </div>
          <label className="sr-only" htmlFor="order-status">Filter by status</label>
          <select
            id="order-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="min-h-11 rounded-xl border border-[#cedfdd] bg-white px-3 outline-none focus:border-[#64d4ad]"
          >
            <option value="open">Active orders</option>
            <option value="history">Old orders</option>
            <option value="all">All orders</option>
            <option value="awaiting_confirmation">Awaiting confirmation</option>
            <option value="confirmed">Confirmed</option>
            <option value="awaiting_tally_billing">Awaiting Tally billing</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button type="button" onClick={() => void load()} className="min-h-11 rounded-xl border border-[#cedfdd] px-4 font-bold text-[#31585d] hover:bg-[#f1f6f4]">
            Refresh
          </button>
        </div>

        {notice ? <p className="mt-4 rounded-xl border border-[#bfe5d8] bg-[#eaf8f1] px-4 py-3 text-sm font-semibold text-[#176246]">{notice}</p> : null}
        {error ? <p role="alert" className="mt-4 rounded-xl border border-[#efbbb6] bg-[#fff0ef] px-4 py-3 text-sm text-[#8d3a34]">{error}</p> : null}

        <section className="mt-4 overflow-hidden rounded-2xl border border-[#dce7e5] bg-white shadow-[0_8px_24px_rgba(9,47,54,0.05)]">
          <div className="flex items-center justify-between border-b border-[#e3ecea] px-5 py-4">
            <div>
              <h2 className="font-extrabold text-[#173239]">{status === 'history' ? 'Old orders' : 'Order inbox'}</h2>
              <p className="mt-1 text-xs text-[#6b7e81]">Tally stock snapshot: {staleText}</p>
            </div>
            <span className="rounded-full bg-[#e2f8ef] px-3 py-1 text-xs font-extrabold text-[#136146]">{visibleOrders.length} orders</span>
          </div>

          {loading ? (
            <div className="p-10 text-center text-sm text-[#6b7e81]">Loading orders…</div>
          ) : visibleOrders.length === 0 ? (
            <div className="p-10 text-center">
              <p className="font-bold text-[#31585d]">No matching orders</p>
              <p className="mt-2 text-sm text-[#708386]">{query ? `No orders match “${query}”. Clear the search to see the full list.` : status === 'history' ? 'Completed and cancelled orders will remain available here.' : 'New orders will appear here immediately.'}</p>
            </div>
          ) : (
            <div className="divide-y divide-[#e8efed]">
              {visibleOrders.map((order) => (
                <OrderRow key={order.id} order={order} onAdvance={advance} />
              ))}
            </div>
          )}
        </section>
      </div>

      {creating && data ? (
        <NewOrderPanel
          data={data}
          onClose={() => setCreating(false)}
          onCreated={async (number) => {
            setCreating(false);
            setNotice(`${number} captured successfully.`);
            await load();
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

function OrderRow({ order, onAdvance }: { order: OrderSummary; onAdvance: (order: OrderSummary, tallyInvoiceNumber?: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState(order.tallyInvoiceNumber || '');
  const action = nextStatus[order.status];
  const total = Number(order.totalQuantity || 0);
  const requiresInvoice = order.status === 'awaiting_tally_billing';
  return (
    <article className="p-5">
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr_auto] lg:items-center">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-[#092f36]">{order.orderNumber}</strong>
          <span className="rounded-full bg-[#edf3f1] px-2.5 py-1 text-[11px] font-extrabold text-[#46686c]">{orderStage(order.status)}</span>
        </div>
        <p className="mt-2 font-bold text-[#274b50]">{order.customerName}</p>
        <p className="mt-1 text-xs text-[#718487]">{order.customerPhone || 'No phone recorded'} · {order.lineCount} line{order.lineCount === 1 ? '' : 's'}</p>
      </div>
      <div>
        <p className="text-xs font-bold text-[#708386]">Ordered quantity</p>
        <p className="mt-1 font-extrabold text-[#274b50]">{formatQuantity(total)}</p>
      </div>
      {action ? (
        <div className="flex min-w-48 flex-col gap-2">
          {requiresInvoice ? <label className="text-xs font-bold text-[#587275]">Tally invoice number<input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="Required" className="mt-1 min-h-10 w-full rounded-lg border border-[#cedfdd] px-3 font-normal text-[#173239] outline-none focus:border-[#64d4ad]" /></label> : null}
          <button
          type="button"
          disabled={busy || (requiresInvoice && !invoiceNumber.trim())}
          onClick={async () => { setBusy(true); try { await onAdvance(order, invoiceNumber); } finally { setBusy(false); } }}
          className="min-h-11 rounded-xl border border-[#badfd4] bg-[#effbf6] px-4 text-sm font-extrabold text-[#126044] hover:bg-[#e2f8ef] disabled:opacity-50"
        >
          {busy ? 'Updating…' : action.label}
        </button>
        </div>
      ) : <span className="text-xs font-bold text-[#7d8f91]">No action due</span>}
      </div>
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
            <dt className="font-bold text-[#708386]">Tally invoice</dt><dd>{order.tallyInvoiceNumber || 'Not billed yet'}</dd>
            <dt className="font-bold text-[#708386]">Notes</dt><dd>{order.notes || 'No notes'}</dd>
          </dl>
        </div>
      </details>
    </article>
  );
}

function NewOrderPanel({ data, onClose, onCreated }: { data: OrderBootstrap; onClose: () => void; onCreated: (number: string) => Promise<void> }) {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerCity, setCustomerCity] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>();
  const [customerSuggestionsOpen, setCustomerSuggestionsOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const matches = useMemo(() => {
    const selected = new Set(lines.map((line) => line.item.tallyKey));
    return searchCatalog(data.snapshot.catalog, productQuery, selected);
  }, [data.snapshot.catalog, lines, productQuery]);

  const customerMatches = useMemo(
    () => searchCustomers(data.customers, customerName),
    [customerName, data.customers],
  );

  function chooseCustomer(customer: CustomerDirectoryEntry) {
    setSelectedCustomerId(customer.id);
    setCustomerName(customer.name);
    setCustomerPhone(customer.phone || '');
    setCustomerCity(customer.city || '');
    setCustomerSuggestionsOpen(false);
  }

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (customerName.trim().length < 2 || lines.length === 0) {
      setError('Add a customer and at least one product.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const existing = data.customers.find(
        (item) => item.id === selectedCustomerId || item.name === customerName.trim(),
      );
      const body: OrderCommand = {
        action: 'create_order',
        payload: {
          idempotencyKey,
          customerId: existing?.id,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          customerCity: customerCity.trim(),
          source: 'phone',
          notes: notes.trim(),
          lines: lines.map((line) => ({ tallyKey: line.item.tallyKey, quantity: line.quantity })),
        },
      };
      const result = await readResponse<{ orderNumber?: string }>(await fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
      await onCreated(result.orderNumber || 'Order');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create order');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#092f36]/45 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <dialog open aria-labelledby="new-order-title" className="ml-auto mr-0 h-full max-h-none w-full max-w-2xl overflow-y-auto bg-[#f7f6f1] p-0 shadow-2xl">
        <form onSubmit={submit}>
          <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#dce7e5] bg-white/95 px-5 py-4 backdrop-blur">
            <div><p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#277b69]">Order</p><h2 id="new-order-title" className="mt-1 text-xl font-black text-[#092f36]">New order</h2></div>
            <button type="button" onClick={onClose} className="min-h-10 rounded-xl border border-[#d1dfdd] px-3 font-bold text-[#557174]">Close</button>
          </header>
          <div className="space-y-5 p-5 sm:p-7">
            <fieldset className="rounded-2xl border border-[#dce7e5] bg-white p-5">
              <legend className="px-2 text-sm font-extrabold text-[#274b50]">Customer</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="relative sm:col-span-2 text-sm font-bold text-[#456367]">Name
                  <input
                    required
                    value={customerName}
                    onChange={(event) => {
                      setCustomerName(event.target.value);
                      setSelectedCustomerId(undefined);
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
                            <small className="block text-[#718487]">{[customer.city, customer.phone].filter(Boolean).join(' · ') || 'Tally customer ledger'}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </label>
                <details className="sm:col-span-2 rounded-xl bg-[#f6f8f7] px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-bold text-[#456367]">Contact details <span className="font-normal text-[#718487]">(optional)</span></summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold text-[#456367]">Phone<input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] bg-white px-3 font-normal outline-none focus:border-[#64d4ad]" inputMode="tel" /></label>
                    <label className="text-sm font-bold text-[#456367]">City<input value={customerCity} onChange={(event) => setCustomerCity(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] bg-white px-3 font-normal outline-none focus:border-[#64d4ad]" /></label>
                  </div>
                </details>
              </div>
            </fieldset>

            <fieldset className="rounded-2xl border border-[#dce7e5] bg-white p-5">
              <legend className="px-2 text-sm font-extrabold text-[#274b50]">Products</legend>
              <label className="text-sm font-bold text-[#456367]">Find product<input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] px-3 font-normal outline-none focus:border-[#64d4ad]" placeholder="Type a product name" /></label>
              {matches.length ? <div className="mt-2 overflow-hidden rounded-xl border border-[#dce7e5]">{matches.map((item) => <button key={item.tallyKey} type="button" onClick={() => { setLines((current) => [...current, { item, quantity: 1 }]); setProductQuery(''); }} className="flex min-h-12 w-full items-center justify-between gap-4 border-b border-[#edf2f0] px-3 text-left last:border-0 hover:bg-[#f2faf7]"><span><strong className="block text-sm text-[#173239]">{item.item}</strong><small className="text-[#718487]">{item.group}</small></span><span className="shrink-0 text-xs font-bold text-[#277b69]">Available {formatQuantity(item.closing)} {item.baseUnit}</span></button>)}</div> : null}
              {productQuery.trim() && matches.length === 0 ? <p className="mt-2 rounded-xl bg-[#fff7e8] px-3 py-2 text-sm text-[#805b20]">No Tally products match “{productQuery.trim()}”.</p> : null}
              <div className="mt-4 space-y-2">{lines.map((line) => <div key={line.item.tallyKey} className="grid grid-cols-[1fr_90px_auto] items-center gap-3 rounded-xl bg-[#f2f7f5] p-3"><div className="min-w-0"><strong className="block truncate text-sm text-[#173239]">{line.item.item}</strong><small className="text-[#718487]">Closing {formatQuantity(line.item.closing)} {line.item.baseUnit}</small></div><label className="sr-only" htmlFor={`qty-${line.item.tallyKey}`}>Quantity for {line.item.item}</label><input id={`qty-${line.item.tallyKey}`} type="number" min="0.001" step="0.001" required value={line.quantity} onChange={(event) => setLines((current) => current.map((entry) => entry.item.tallyKey === line.item.tallyKey ? { ...entry, quantity: Number(event.target.value) } : entry))} className="min-h-10 rounded-lg border border-[#cedfdd] px-2 text-right" /><button type="button" onClick={() => setLines((current) => current.filter((entry) => entry.item.tallyKey !== line.item.tallyKey))} aria-label={`Remove ${line.item.item}`} className="size-10 rounded-lg text-xl text-[#9a4e47] hover:bg-[#ffeae8]">×</button></div>)}</div>
              {lines.length === 0 ? <p className="mt-4 rounded-xl bg-[#f6f8f7] p-4 text-center text-sm text-[#718487]">Search and add the products requested on the call.</p> : null}
            </fieldset>

            <details className="rounded-2xl border border-[#dce7e5] bg-white p-4">
              <summary className="cursor-pointer text-sm font-bold text-[#456367]">Add order notes <span className="font-normal text-[#718487]">(optional)</span></summary>
              <label className="sr-only" htmlFor="order-notes">Order notes</label>
              <textarea id="order-notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} rows={3} className="mt-3 w-full rounded-xl border border-[#cedfdd] p-3 font-normal outline-none focus:border-[#64d4ad]" placeholder="Delivery instructions, contact person, or urgency" />
            </details>
            {error ? <p role="alert" className="rounded-xl border border-[#efbbb6] bg-[#fff0ef] px-4 py-3 text-sm text-[#8d3a34]">{error}</p> : null}
          </div>
          <footer className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-[#dce7e5] bg-white/95 px-5 py-4 backdrop-blur"><p className="text-xs text-[#718487]">{lines.length} product{lines.length === 1 ? '' : 's'} · saved together</p><button type="submit" disabled={submitting || lines.length === 0} className="min-h-12 rounded-xl bg-[#092f36] px-6 font-extrabold text-white hover:bg-[#0d4549] disabled:opacity-50">{submitting ? 'Saving…' : 'Save order'}</button></footer>
        </form>
      </dialog>
    </div>
  );
}

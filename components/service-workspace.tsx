'use client';

import { PageHeader, SummaryStrip, pageActionClass } from './page-header';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { searchServiceWorkspace, type ServiceWorkspaceData } from '@/lib/service-types';
import { readJsonBody } from '@/lib/http-json';

const emptyData: ServiceWorkspaceData = { assets: [], tickets: [] };
const labels: Record<string, string> = { breakdown: 'Breakdown', preventive_maintenance: 'Preventive maintenance', calibration: 'Calibration', training: 'Training', other: 'Other' };
const priorityBadge: Record<string, { label: string; className: string }> = {
  urgent: { label: 'Urgent', className: 'bg-sf-danger-soft text-sf-danger' },
  high: { label: 'High', className: 'bg-sf-warning-soft text-sf-warning' },
  normal: { label: 'Normal', className: 'bg-sf-soft-2 text-sf-label' },
};
const statusBadge: Record<string, { label: string; className: string }> = {
  open: { label: 'Open', className: 'bg-sf-warning-soft text-sf-warning' },
  resolved: { label: 'Resolved', className: 'bg-sf-success-soft text-sf-success' },
};
type FormSubmission = { preventDefault(): void; currentTarget: HTMLFormElement };

export function ServiceWorkspace() {
  const [data, setData] = useState<ServiceWorkspaceData | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/service', { cache: 'no-store', signal });
      const body = await readJsonBody<ServiceWorkspaceData & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || 'Unable to load service workspace');
      setData(body); setError('');
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'Unable to load service workspace');
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);

  const workspace = data || emptyData;
  const visible = useMemo(() => searchServiceWorkspace(workspace, query), [workspace, query]);
  const openTickets = workspace.tickets.filter((ticket) => ticket.status === 'open');
  const urgentCount = openTickets.filter(item => item.priority === 'urgent').length;
  const customers = new Set(workspace.assets.map((asset) => asset.customerName.toLocaleLowerCase('en-IN'))).size;

  async function send(command: Record<string, unknown>, key: string): Promise<boolean> {
    setBusy(key); setError('');
    try {
      const response = await fetch('/api/service', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command) });
      const body = await readJsonBody<{ error?: string }>(response);
      if (!response.ok) throw new Error(body.error || 'Unable to save service update');
      await load();
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save service update'); return false; }
    finally { setBusy(''); }
  }

  async function createTicket(event: FormSubmission, installationId: string) {
    event.preventDefault(); const target = event.currentTarget; const form = new FormData(target);
    const saved = await send({ action: 'create_service_ticket', payload: { installationId, category: form.get('category'), priority: form.get('priority'), summary: form.get('summary'), idempotencyKey: crypto.randomUUID() } }, `asset-${installationId}`);
    if (saved) target.reset();
  }
  async function resolveTicket(event: FormSubmission, ticketId: string, expectedVersion: number) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await send({ action: 'resolve_service_ticket', payload: { ticketId, expectedVersion, resolution: form.get('resolution'), idempotencyKey: crypto.randomUUID() } }, `ticket-${ticketId}`);
  }

  return <div className="h-full overflow-y-auto bg-sf-page"><div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
    <PageHeader eyebrow="After-sales service" title="Equipment & service" description="Installed equipment and its service history in one simple view." actions={<Link href="/instruments" className={pageActionClass}>Instrument portfolio →</Link>} />
    <SummaryStrip label="Service overview" items={[
      { label: 'Installed', value: data ? workspace.assets.length : undefined },
      { label: 'Customer sites', value: data ? customers : undefined },
      { label: 'Open tickets', value: data ? openTickets.length : undefined, tone: openTickets.length ? 'attention' : 'normal' },
      { label: 'Urgent', value: data ? urgentCount : undefined, tone: urgentCount ? 'alert' : 'normal' },
    ]} />
    <label className="block rounded-2xl border border-sf-line-soft bg-white p-3 text-sm font-bold text-sf-body">Find equipment or ticket<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Customer, instrument, serial, ticket, or issue" className="mt-2 min-h-11 w-full rounded-xl border border-sf-line px-4 font-normal outline-none focus:border-sf-mint" /></label>
    {error ? <p role="alert" className="rounded-xl bg-sf-danger-soft p-4 text-sm font-bold text-sf-danger">{error}</p> : null}
    {!data && !error ? <p className="rounded-2xl border border-sf-line-soft bg-white p-5 text-sm text-sf-muted">Loading service workspace…</p> : null}

    {visible.tickets.length ? <section className="space-y-3" aria-label="Service tickets"><h2 className="text-lg font-extrabold text-sf-ink">Service tickets</h2>{visible.tickets.map((ticket) => {
      const asset = workspace.assets.find((item) => item.installationId === ticket.installationId);
      const priority = priorityBadge[ticket.priority] ?? { label: ticket.priority, className: 'bg-sf-soft-2 text-sf-label' };
      const status = statusBadge[ticket.status] ?? { label: ticket.status, className: 'bg-sf-soft-2 text-sf-label' };
      return <article key={ticket.id} className="rounded-2xl border border-sf-line-soft bg-white p-5"><div className="flex flex-wrap justify-between gap-2"><div><p className="text-xs font-extrabold text-sf-accent">{ticket.ticketNumber}</p><h3 className="mt-1 font-extrabold text-sf-ink">{ticket.summary}</h3><p className="mt-1 text-sm text-sf-muted">{asset?.customerName} · {asset?.itemName} · {asset?.serialNumber}</p></div><div className="flex gap-2"><span className={`rounded-full px-3 py-1 text-xs font-extrabold ${priority.className}`}>{priority.label}</span><span className={`rounded-full px-3 py-1 text-xs font-extrabold ${status.className}`}>{status.label}</span></div></div>
        <p className="mt-3 text-xs text-sf-subtle">{labels[ticket.category]} · Opened by {ticket.createdBy} on {new Date(ticket.createdAt).toLocaleString('en-IN')}</p>{ticket.resolution ? <p className="mt-3 rounded-xl bg-sf-soft p-3 text-sm text-sf-strong"><strong>Resolution:</strong> {ticket.resolution}</p> : null}
        {ticket.status === 'open' ? <details className="mt-4"><summary className="cursor-pointer font-bold text-sf-brand">Resolve ticket</summary><form onSubmit={(event) => void resolveTicket(event, ticket.id, ticket.version)} className="mt-3 flex flex-col gap-2 sm:flex-row"><input aria-label="Resolution" name="resolution" required minLength={3} maxLength={1000} placeholder="Work completed and outcome" className="min-h-11 flex-1 rounded-xl border border-sf-line px-3"/><button disabled={Boolean(busy)} className="min-h-11 rounded-xl bg-sf-ink-hover px-5 font-bold text-white disabled:opacity-50">{busy === `ticket-${ticket.id}` ? 'Saving…' : 'Mark resolved'}</button></form></details> : null}
      </article>;
    })}</section> : null}

    <section className="space-y-3" aria-label="Installed equipment register"><h2 className="text-lg font-extrabold text-sf-ink">Installed equipment</h2>{data && visible.assets.length === 0 ? <p className="rounded-2xl border border-sf-line-soft bg-white p-5 text-sm text-sf-muted">{workspace.assets.length ? 'No equipment or tickets match this search.' : 'Completed equipment installations will appear here automatically.'}</p> : null}{visible.assets.map((asset) => {
      const count = workspace.tickets.filter((ticket) => ticket.installationId === asset.installationId && ticket.status === 'open').length;
      return <article key={asset.installationId} className="rounded-2xl border border-sf-line-soft bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-extrabold text-sf-ink">{asset.itemName}</h3><p className="mt-1 text-sm text-sf-muted">{asset.customerName}</p></div><span className={count > 0 ? "rounded-full px-3 py-1 text-xs font-extrabold bg-sf-warning-soft text-sf-warning" : "rounded-full px-3 py-1 text-xs font-extrabold bg-sf-success-soft text-sf-success"}>{count ? `${count} open` : 'No open issues'}</span></div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="font-bold text-sf-subtle">Serial number</dt><dd>{asset.serialNumber}</dd></div><div><dt className="font-bold text-sf-subtle">Installed</dt><dd>{new Date(asset.installedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</dd></div><div><dt className="font-bold text-sf-subtle">Order</dt><dd>{asset.orderNumber}</dd></div></dl>
        <details className="mt-4"><summary className="cursor-pointer font-bold text-sf-brand">Log service issue</summary><form onSubmit={(event) => void createTicket(event, asset.installationId)} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]"><select aria-label="Issue category" name="category" className="min-h-11 rounded-xl border border-sf-line px-3">{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Priority" name="priority" className="min-h-11 rounded-xl border border-sf-line px-3"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select><input aria-label="Issue description" name="summary" required minLength={3} maxLength={500} placeholder="Describe the issue" className="min-h-11 rounded-xl border border-sf-line px-3"/><button disabled={Boolean(busy)} className="min-h-11 rounded-xl bg-sf-ink-hover px-5 font-bold text-white disabled:opacity-50">{busy === `asset-${asset.installationId}` ? 'Saving…' : 'Create ticket'}</button></form></details>
      </article>;
    })}</section>
  </div></div>;
}

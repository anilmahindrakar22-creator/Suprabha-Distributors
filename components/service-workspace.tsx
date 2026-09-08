'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { searchServiceWorkspace, type ServiceWorkspaceData } from '@/lib/service-types';

const emptyData: ServiceWorkspaceData = { assets: [], tickets: [] };
const labels: Record<string, string> = { breakdown: 'Breakdown', preventive_maintenance: 'Preventive maintenance', calibration: 'Calibration', training: 'Training', other: 'Other' };
type FormSubmission = { preventDefault(): void; currentTarget: HTMLFormElement };

export function ServiceWorkspace() {
  const [data, setData] = useState<ServiceWorkspaceData | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/service', { cache: 'no-store', signal });
      const body = await response.json() as ServiceWorkspaceData & { error?: string };
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
  const customers = new Set(workspace.assets.map((asset) => asset.customerName.toLocaleLowerCase('en-IN'))).size;

  async function send(command: Record<string, unknown>, key: string) {
    setBusy(key); setError('');
    try {
      const response = await fetch('/api/service', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Unable to save service update');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save service update'); }
    finally { setBusy(''); }
  }

  async function createTicket(event: FormSubmission, installationId: string) {
    event.preventDefault(); const target = event.currentTarget; const form = new FormData(target);
    await send({ action: 'create_service_ticket', payload: { installationId, category: form.get('category'), priority: form.get('priority'), summary: form.get('summary'), idempotencyKey: crypto.randomUUID() } }, `asset-${installationId}`);
    target.reset();
  }
  async function resolveTicket(event: FormSubmission, ticketId: string, expectedVersion: number) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await send({ action: 'resolve_service_ticket', payload: { ticketId, expectedVersion, resolution: form.get('resolution'), idempotencyKey: crypto.randomUUID() } }, `ticket-${ticketId}`);
  }

  return <div className="h-full overflow-y-auto"><div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
    <header><p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[#217b69]">After-sales service</p><h1 className="mt-1 text-3xl font-black text-[#092f36]">Equipment & service</h1><p className="mt-1 text-sm text-[#61777a]">Installed equipment and its service history in one simple view.</p></header>
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[['Installed', workspace.assets.length], ['Customer sites', customers], ['Open tickets', openTickets.length], ['Urgent', openTickets.filter((item) => item.priority === 'urgent').length]].map(([label, value]) => <article key={label} className="rounded-2xl border border-[#d7e4e2] bg-white p-4"><p className="text-sm font-bold text-[#61777a]">{label}</p><strong className="mt-2 block text-3xl text-[#092f36]">{value}</strong></article>)}</section>
    <label className="block rounded-2xl border border-[#d7e4e2] bg-white p-3 text-sm font-bold text-[#31585d]">Find equipment or ticket<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Customer, instrument, serial, ticket, or issue" className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] px-4 font-normal outline-none focus:border-[#64d4ad]" /></label>
    {error ? <p role="alert" className="rounded-xl bg-[#fff0ef] p-4 text-sm font-bold text-[#93463f]">{error}</p> : null}
    {!data && !error ? <p className="rounded-2xl border border-[#d7e4e2] bg-white p-5 text-sm text-[#61777a]">Loading service workspace…</p> : null}

    {visible.tickets.length ? <section className="space-y-3" aria-label="Service tickets"><h2 className="text-xl font-black text-[#092f36]">Service tickets</h2>{visible.tickets.map((ticket) => {
      const asset = workspace.assets.find((item) => item.installationId === ticket.installationId);
      return <article key={ticket.id} className="rounded-2xl border border-[#d7e4e2] bg-white p-5"><div className="flex flex-wrap justify-between gap-2"><div><p className="text-xs font-extrabold text-[#217b69]">{ticket.ticketNumber}</p><h3 className="mt-1 font-extrabold text-[#092f36]">{ticket.summary}</h3><p className="mt-1 text-sm text-[#61777a]">{asset?.customerName} · {asset?.itemName} · {asset?.serialNumber}</p></div><div className="flex gap-2"><span className="rounded-full bg-[#fff4db] px-3 py-1 text-xs font-extrabold text-[#805800]">{ticket.priority}</span><span className="rounded-full bg-[#eaf8f1] px-3 py-1 text-xs font-extrabold text-[#176246]">{ticket.status}</span></div></div>
        <p className="mt-3 text-xs text-[#708386]">{labels[ticket.category]} · Opened by {ticket.createdBy} on {new Date(ticket.createdAt).toLocaleString('en-IN')}</p>{ticket.resolution ? <p className="mt-3 rounded-xl bg-[#f2f7f6] p-3 text-sm text-[#274b50]"><strong>Resolution:</strong> {ticket.resolution}</p> : null}
        {ticket.status === 'open' ? <details className="mt-4"><summary className="cursor-pointer font-bold text-[#145e62]">Resolve ticket</summary><form onSubmit={(event) => void resolveTicket(event, ticket.id, ticket.version)} className="mt-3 flex flex-col gap-2 sm:flex-row"><input name="resolution" required minLength={3} maxLength={1000} placeholder="Work completed and outcome" className="min-h-11 flex-1 rounded-xl border border-[#cedfdd] px-3"/><button disabled={Boolean(busy)} className="min-h-11 rounded-xl bg-[#073e46] px-5 font-bold text-white disabled:opacity-50">{busy === `ticket-${ticket.id}` ? 'Saving…' : 'Mark resolved'}</button></form></details> : null}
      </article>;
    })}</section> : null}

    <section className="space-y-3" aria-label="Installed equipment register"><h2 className="text-xl font-black text-[#092f36]">Installed equipment</h2>{data && visible.assets.length === 0 ? <p className="rounded-2xl border border-[#d7e4e2] bg-white p-5 text-sm text-[#61777a]">{workspace.assets.length ? 'No equipment or tickets match this search.' : 'Completed equipment installations will appear here automatically.'}</p> : null}{visible.assets.map((asset) => {
      const count = workspace.tickets.filter((ticket) => ticket.installationId === asset.installationId && ticket.status === 'open').length;
      return <article key={asset.installationId} className="rounded-2xl border border-[#d7e4e2] bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-extrabold text-[#092f36]">{asset.itemName}</h3><p className="mt-1 text-sm text-[#61777a]">{asset.customerName}</p></div><span className="rounded-full bg-[#eaf8f1] px-3 py-1 text-xs font-extrabold text-[#176246]">{count ? `${count} open` : 'No open issues'}</span></div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="font-bold text-[#708386]">Serial number</dt><dd>{asset.serialNumber}</dd></div><div><dt className="font-bold text-[#708386]">Installed</dt><dd>{new Date(asset.installedAt).toLocaleDateString('en-IN')}</dd></div><div><dt className="font-bold text-[#708386]">Source order</dt><dd>{asset.orderNumber}</dd></div></dl>
        <details className="mt-4"><summary className="cursor-pointer font-bold text-[#145e62]">Log service issue</summary><form onSubmit={(event) => void createTicket(event, asset.installationId)} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]"><select name="category" className="min-h-11 rounded-xl border border-[#cedfdd] px-3">{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select name="priority" className="min-h-11 rounded-xl border border-[#cedfdd] px-3"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select><input name="summary" required minLength={3} maxLength={500} placeholder="Describe the issue" className="min-h-11 rounded-xl border border-[#cedfdd] px-3"/><button disabled={Boolean(busy)} className="min-h-11 rounded-xl bg-[#073e46] px-5 font-bold text-white disabled:opacity-50">{busy === `asset-${asset.installationId}` ? 'Saving…' : 'Create ticket'}</button></form></details>
      </article>;
    })}</section>
  </div></div>;
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import type { OrderBootstrap } from '@/lib/order-types';
import { installedAssetsFromOrders, searchInstalledAssets } from '@/lib/service-types';

export function ServiceWorkspace() {
  const [data, setData] = useState<OrderBootstrap | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/orders', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as OrderBootstrap & { error?: string };
        if (!response.ok) throw new Error(body.error || 'Unable to load installed equipment');
        setData(body);
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : 'Unable to load installed equipment');
      });
    return () => controller.abort();
  }, []);

  const assets = useMemo(() => installedAssetsFromOrders(data?.orders || []), [data]);
  const visibleAssets = useMemo(() => searchInstalledAssets(assets, query), [assets, query]);
  const customerCount = new Set(assets.map((asset) => asset.customerName.toLocaleLowerCase('en-IN'))).size;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
        <header>
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[#217b69]">After-sales foundation</p>
          <h1 className="mt-1 text-3xl font-black text-[#092f36]">Installed equipment</h1>
          <p className="mt-1 text-sm text-[#61777a]">A lightweight register built automatically from completed order installations.</p>
        </header>

        <section className="grid gap-3 sm:grid-cols-2">
          <article className="rounded-2xl border border-[#d7e4e2] bg-white p-5"><p className="text-sm font-bold text-[#61777a]">Installed instruments</p><strong className="mt-2 block text-3xl text-[#092f36]">{assets.length}</strong></article>
          <article className="rounded-2xl border border-[#d7e4e2] bg-white p-5"><p className="text-sm font-bold text-[#61777a]">Customer sites</p><strong className="mt-2 block text-3xl text-[#092f36]">{customerCount}</strong></article>
        </section>

        <label className="block rounded-2xl border border-[#d7e4e2] bg-white p-3 text-sm font-bold text-[#31585d]">
          Find equipment
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Customer, instrument, serial number, or order" className="mt-2 min-h-11 w-full rounded-xl border border-[#cedfdd] px-4 font-normal outline-none focus:border-[#64d4ad]" />
        </label>

        {error ? <p role="alert" className="rounded-xl bg-[#fff0ef] p-4 text-sm font-bold text-[#93463f]">{error}</p> : null}
        {!data && !error ? <p className="rounded-2xl border border-[#d7e4e2] bg-white p-5 text-sm text-[#61777a]">Loading installed equipment…</p> : null}
        {data && visibleAssets.length === 0 ? <p className="rounded-2xl border border-[#d7e4e2] bg-white p-5 text-sm text-[#61777a]">{assets.length ? 'No equipment matches this search.' : 'Completed equipment installations will appear here automatically.'}</p> : null}

        <section className="space-y-3" aria-label="Installed equipment register">
          {visibleAssets.map((asset) => (
            <article key={asset.installationId} className="rounded-2xl border border-[#d7e4e2] bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="font-extrabold text-[#092f36]">{asset.itemName}</h2><p className="mt-1 text-sm text-[#61777a]">{asset.customerName}</p></div>
                <span className="rounded-full bg-[#eaf8f1] px-3 py-1 text-xs font-extrabold text-[#176246]">Installed</span>
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <div><dt className="font-bold text-[#708386]">Serial number</dt><dd className="mt-1 text-[#274b50]">{asset.serialNumber}</dd></div>
                <div><dt className="font-bold text-[#708386]">Installed</dt><dd className="mt-1 text-[#274b50]">{new Date(asset.installedAt).toLocaleDateString('en-IN')}</dd></div>
                <div><dt className="font-bold text-[#708386]">Source order</dt><dd className="mt-1 text-[#274b50]">{asset.orderNumber}</dd></div>
                {asset.siteContact ? <div><dt className="font-bold text-[#708386]">Site contact</dt><dd className="mt-1 text-[#274b50]">{asset.siteContact}</dd></div> : null}
                {asset.engineerEmail ? <div><dt className="font-bold text-[#708386]">Engineer</dt><dd className="mt-1 break-all text-[#274b50]">{asset.engineerEmail}</dd></div> : null}
              </dl>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}

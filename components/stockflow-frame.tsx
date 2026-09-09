'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { OrderWorkspace } from './order-workspace';
import { ServiceWorkspace } from './service-workspace';
import { UserManagement } from './user-management';
import { readOrderDashboardMessage } from '@/lib/stockflow-navigation';
import { clearOrderBootstrapCache, loadOrderBootstrap } from '@/lib/order-bootstrap-cache';
import { prepareDeviceForAccount } from '@/lib/device-account-privacy';

export function StockFlowFrame({ actorEmail, actorRole }: { actorEmail: string; actorRole: string }) {
  const [surface, setSurface] = useState<'stock' | 'orders' | 'service' | 'users'>('stock');
  const [orderFilter, setOrderFilter] = useState('open');
  const [deviceNotice, setDeviceNotice] = useState('');

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const account = prepareDeviceForAccount(localStorage, sessionStorage, actorEmail);
    let noticeTimer: number | undefined;
    if (account.switched) {
      clearOrderBootstrapCache();
      if (account.retainedPreviousDraft) noticeTimer = window.setTimeout(() => setDeviceNotice('A saved order for the previous account remains on this device. Sign back into that account to send or discard it.'), 0);
    }
    void loadOrderBootstrap(actorEmail).catch(() => undefined);
    return () => { if (noticeTimer !== undefined) window.clearTimeout(noticeTimer); };
  }, [actorEmail]);

  useEffect(() => {
    function receiveDashboardNavigation(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const message = readOrderDashboardMessage(event.data);
      if (!message) return;
      setOrderFilter(message.status);
      setSurface('orders');
    }
    window.addEventListener('message', receiveDashboardNavigation);
    return () => window.removeEventListener('message', receiveDashboardNavigation);
  }, []);

  function openSurface(item: 'stock' | 'orders' | 'service' | 'users') {
    if (item === 'orders') setOrderFilter('open');
    setSurface(item);
  }

  return (
    <main className="flex h-dvh w-full flex-col overflow-hidden bg-[#f7f6f1] text-[#173239]">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#dce7e5] bg-white px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Image src="/suprabha-logo.png" alt="" width={36} height={36} priority className="size-9 shrink-0 object-contain" />
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold text-[#092f36]">StockFlow</p>
            <p className="hidden text-xs text-[#6b7e81] sm:block">Suprabha Distributors</p>
          </div>
        </div>
        <nav aria-label="Application sections" className="flex rounded-xl bg-[#edf3f1] p-1">
          {(['stock', 'orders', ...(['administrator', 'operations', 'sales', 'management'].includes(actorRole) ? ['service' as const] : []), ...(actorRole === 'administrator' ? ['users' as const] : [])] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => openSurface(item)}
              aria-pressed={surface === item}
              className={`min-h-10 rounded-lg px-4 text-sm font-bold capitalize transition ${
                surface === item
                  ? 'bg-white text-[#092f36] shadow-sm'
                  : 'text-[#61777a] hover:text-[#092f36]'
              }`}
            >
              {item}
            </button>
          ))}
        </nav>
      </header>
      {deviceNotice ? <output className="flex shrink-0 items-center justify-between gap-3 border-b border-[#f0d7a5] bg-[#fff7e8] px-4 py-2 text-xs font-semibold text-[#805b20] sm:px-6"><span>{deviceNotice}</span><button type="button" onClick={() => setDeviceNotice('')} className="min-h-8 shrink-0 rounded-lg px-3 font-bold hover:bg-[#f7e8c8]">Dismiss</button></output> : null}
      <section className="min-h-0 flex-1">
        {surface === 'stock' ? (
          <iframe
            title="Suprabha stock dashboard"
            src="/stockflow.html"
            className="h-full w-full border-0"
            allow="clipboard-write"
          />
        ) : surface === 'orders' ? (
          <OrderWorkspace key={orderFilter} actorEmail={actorEmail} initialStatus={orderFilter} />
        ) : surface === 'service' ? (
          <ServiceWorkspace />
        ) : <UserManagement />}
      </section>
    </main>
  );
}

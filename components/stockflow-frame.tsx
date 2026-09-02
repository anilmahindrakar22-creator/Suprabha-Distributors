'use client';

import { useEffect, useState } from 'react';
import { OrderWorkspace } from './order-workspace';
import { UserManagement } from './user-management';
import { InventoryWorkspace } from './inventory-workspace';
import { readOrderDashboardMessage } from '@/lib/stockflow-navigation';

export function StockFlowFrame({ actorRole }: { actorRole: string }) {
  const [surface, setSurface] = useState<'stock' | 'orders' | 'inventory' | 'users'>('stock');
  const [orderFilter, setOrderFilter] = useState('open');

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

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

  function openSurface(item: 'stock' | 'orders' | 'inventory' | 'users') {
    if (item === 'orders') setOrderFilter('open');
    setSurface(item);
  }

  return (
    <main className="flex h-dvh w-full flex-col overflow-hidden bg-[#f7f6f1] text-[#173239]">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#dce7e5] bg-white px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#64d4ad] font-black text-[#092f36]">
            S
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold text-[#092f36]">StockFlow</p>
            <p className="hidden text-xs text-[#6b7e81] sm:block">Suprabha Distributors</p>
          </div>
        </div>
        <nav aria-label="Application sections" className="flex rounded-xl bg-[#edf3f1] p-1">
          {(['stock', 'orders', ...(['administrator','operations','warehouse','management'].includes(actorRole) ? ['inventory' as const] : []), ...(actorRole === 'administrator' ? ['users' as const] : [])] as const).map((item) => (
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
      <section className="min-h-0 flex-1">
        {surface === 'stock' ? (
          <iframe
            title="Suprabha stock dashboard"
            src="/stockflow.html"
            className="h-full w-full border-0"
            allow="clipboard-write"
          />
        ) : surface === 'orders' ? (
          <OrderWorkspace key={orderFilter} initialStatus={orderFilter} />
        ) : surface === 'inventory' ? (
          <InventoryWorkspace actorRole={actorRole} />
        ) : <UserManagement />}
      </section>
    </main>
  );
}

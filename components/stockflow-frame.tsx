'use client';

import { useEffect, useState } from 'react';
import { OrderWorkspace } from './order-workspace';
import { UserManagement } from './user-management';

export function StockFlowFrame({ actorRole }: { actorRole: string }) {
  const [surface, setSurface] = useState<'stock' | 'orders' | 'users'>('stock');

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

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
          {(['stock', 'orders', ...(actorRole === 'administrator' ? ['users' as const] : [])] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setSurface(item)}
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
          <OrderWorkspace />
        ) : <UserManagement />}
      </section>
    </main>
  );
}

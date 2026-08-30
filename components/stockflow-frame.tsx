'use client';

import { useEffect } from 'react';

export function StockFlowFrame() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  return (
    <main className="h-dvh w-full overflow-hidden bg-[#f7f6f1]">
      <iframe
        title="Suprabha StockFlow"
        src="/stockflow.html"
        className="h-full w-full border-0"
        allow="clipboard-write"
      />
    </main>
  );
}

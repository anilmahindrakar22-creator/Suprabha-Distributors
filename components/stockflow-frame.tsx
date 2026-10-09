'use client';

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { defaultOrderFilterForRole, readOrderDashboardMessage } from '@/lib/stockflow-navigation';
import { prepareDeviceForAccount } from '@/lib/device-account-privacy';
import { hasAnyStockFlowRole, type StockFlowRole } from '@/lib/user-types';
import { revokeOfflineVault } from '@/lib/offline-vault-storage';
import { checkStaffSession, withStaffSessionLock } from '@/lib/staff-session-client';

const loadOrderWorkspace = () => import('./order-workspace').then((module) => ({ default: module.OrderWorkspace }));
const OrderWorkspace = lazy(loadOrderWorkspace);
const ServiceWorkspace = lazy(() => import('./service-workspace').then((module) => ({ default: module.ServiceWorkspace })));
const UserManagement = lazy(() => import('./user-management').then((module) => ({ default: module.UserManagement })));
const PricingWorkspace = lazy(() => import('./pricing-workspace').then((module) => ({ default: module.PricingWorkspace })));

type Surface = 'stock' | 'orders' | 'pricing' | 'service' | 'users';

async function warmOrderData(actorEmail: string) {
  const { loadOrderBootstrap } = await import('@/lib/order-bootstrap-cache');
  await loadOrderBootstrap(actorEmail);
}

function SectionLoading() {
  return <div className="grid h-full place-items-center text-sm font-semibold text-[#61777a]">Opening section…</div>;
}

export function StockFlowFrame({ actorEmail, actorRole, actorRoles, staffAuth = false, staffEmailActionsEnabled = false }: { actorEmail: string; actorRole: string; actorRoles?: StockFlowRole[]; staffAuth?: boolean; staffEmailActionsEnabled?: boolean }) {
  const roles = actorRoles ?? [actorRole as StockFlowRole];
  const [surface, setSurface] = useState<Surface>('stock');
  const [orderFilter, setOrderFilter] = useState('open');
  const [deviceNotice, setDeviceNotice] = useState('');
  const [readyEmail, setReadyEmail] = useState('');
  const signOutInFlight = useRef(false);
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    if (!staffAuth) return;
    let stopped = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastCheck = 0;
    async function check(renew = false) {
      if (stopped || running || document.visibilityState === 'hidden' || !navigator.onLine) return;
      running = true;
      lastCheck = Date.now();
      if (timer) clearTimeout(timer);
      try {
        const delay = await checkStaffSession(renew);
        if (stopped) return;
        if (delay === null) { window.location.assign('/staff-signin'); return; }
        timer = setTimeout(() => { void check(true); }, delay * 1000);
      } catch {
        if (!stopped) setDeviceNotice('Sign-in connection interrupted. Reconnect to verify your session; saved drafts remain unchanged.');
        // No automatic retry loop. A foreground/reconnection event can retry.
      } finally { running = false; }
    }
    const wake = () => { if (Date.now() - lastCheck >= 30000) void check(); };
    void check();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, [staffAuth]);
  async function staffSignOut() {
    if (signOutInFlight.current) return;
    signOutInFlight.current = true;
    setSigningOut(true);
    try {
      await revokeOfflineVault(localStorage);
      const response = await withStaffSessionLock(() => fetch('/api/staff-auth', { method: 'DELETE', cache: 'no-store', signal: AbortSignal.timeout(15000) }));
      if (response.ok) window.location.assign('/staff-signin');
      else setDeviceNotice('Sign-out failed. Please retry before sharing this device.');
    } catch { setDeviceNotice('Sign-out failed. Please retry before sharing this device.'); }
    finally { signOutInFlight.current = false; setSigningOut(false); }
  }

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const account = prepareDeviceForAccount(localStorage, sessionStorage, actorEmail);
    const readyTimer = window.setTimeout(() => setReadyEmail(actorEmail), 0);
    let noticeTimer: number | undefined;
    if (account.switched) {
      void revokeOfflineVault(localStorage).catch(() => setDeviceNotice('Offline device lock failed. Do not share this device; retry sign-out.'));
      void Promise.all([
        import('@/lib/order-bootstrap-cache').then((module) => module.clearOrderBootstrapCache()),
        import('@/lib/order-capture-masters').then((module) => module.clearOrderCaptureMasterCache()),
      ]);
      if (account.retainedPreviousDraft) noticeTimer = window.setTimeout(() => setDeviceNotice('A saved order for the previous account remains on this device. Sign back into that account to send or discard it.'), 0);
    }
    // Download only the small Orders code chunk while idle. Data waits for a clear
    // user signal so it cannot compete with the initial Stock request on mobile.
    const warmOrderWorkspace = () => { void loadOrderWorkspace(); };
    const idleId = 'requestIdleCallback' in window
      ? window.requestIdleCallback(warmOrderWorkspace, { timeout: 2_000 })
      : undefined;
    const preloadTimer = idleId === undefined
      ? window.setTimeout(warmOrderWorkspace, 1_500)
      : undefined;
    return () => {
      window.clearTimeout(readyTimer);
      if (noticeTimer !== undefined) window.clearTimeout(noticeTimer);
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      if (preloadTimer !== undefined) window.clearTimeout(preloadTimer);
    };
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

  function openSurface(item: Surface) {
    if (item === 'orders' && surface !== 'orders') setOrderFilter(defaultOrderFilterForRole(actorRole));
    setSurface(item);
  }

  function warmOrders() {
    void loadOrderWorkspace();
    void warmOrderData(actorEmail).catch(() => undefined);
  }

  return (
    <main className="flex h-dvh w-full flex-col overflow-hidden bg-[#f7f6f1] text-[#173239]">
      <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-[#dce7e5] bg-white px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Image src="/suprabha-logo.png" alt="" width={36} height={36} priority className="size-9 shrink-0 object-contain" />
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold text-[#092f36]">StockFlow</p>
            <p className="hidden text-xs text-[#6b7e81] sm:block">Suprabha Distributors</p>
          </div>
        </div>
        <nav aria-label="Application sections" className="flex min-w-0 overflow-x-auto rounded-xl bg-[#edf3f1] p-1">
          {(['stock', 'orders', ...(hasAnyStockFlowRole(roles, ['administrator', 'management', 'accounts']) ? ['pricing' as const] : []), ...(hasAnyStockFlowRole(roles, ['administrator', 'operations', 'sales', 'management']) ? ['service' as const] : []), ...(hasAnyStockFlowRole(roles, ['administrator']) ? ['users' as const] : [])] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => openSurface(item)}
              onFocus={item === 'orders' ? warmOrders : undefined}
              onPointerEnter={item === 'orders' ? warmOrders : undefined}
              onPointerDown={item === 'orders' ? warmOrders : undefined}
              aria-pressed={surface === item}
              className={`min-h-10 shrink-0 rounded-lg px-3 text-sm font-bold capitalize transition sm:px-4 ${
                surface === item
                  ? 'bg-white text-[#092f36] shadow-sm'
                  : 'text-[#61777a] hover:text-[#092f36]'
              }`}
            >
              {item}
            </button>
          ))}
          {/* Full navigation re-verifies the staff session before local preparation. */}
          {/* oxlint-disable-next-line next/no-html-link-for-pages */}
          {staffAuth && hasAnyStockFlowRole(roles, ['administrator', 'management', 'sales', 'operations']) ? <a href="/offline-preparation" className="min-h-10 shrink-0 rounded-lg px-3 py-2 text-sm font-bold text-[#61777a]">Offline</a> : null}
        </nav>
        {/* Sites owns the session cookie: use a full navigation, not a client router link. */}
        {/* oxlint-disable-next-line next/no-html-link-for-pages */}
        {staffAuth ? <button type="button" disabled={signingOut} onClick={() => void staffSignOut()} aria-label={`Sign out ${actorEmail}`} className="min-h-11 rounded-lg border px-3 text-sm font-bold disabled:opacity-50">{signingOut ? 'Signing out…' : 'Sign out'}</button> : <a href="/signout-with-chatgpt?return_to=/" target="_top" aria-label={`Sign out ${actorEmail}`} title={`Signed in as ${actorEmail}`} className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-[#dce7e5] px-2 text-xs font-bold text-[#173239] hover:bg-[#edf3f1] sm:px-3 sm:text-sm">Sign out</a>}
      </header>
      {deviceNotice ? <output className="flex shrink-0 items-center justify-between gap-3 border-b border-[#f0d7a5] bg-[#fff7e8] px-4 py-2 text-xs font-semibold text-[#805b20] sm:px-6"><span>{deviceNotice}</span><button type="button" onClick={() => setDeviceNotice('')} className="min-h-8 shrink-0 rounded-lg px-3 font-bold hover:bg-[#f7e8c8]">Dismiss</button></output> : null}
      <section className="min-h-0 flex-1">
        {readyEmail !== actorEmail ? <SectionLoading /> : surface === 'stock' ? (
          <iframe
            title="Suprabha stock dashboard"
            src="/stockflow.html"
            className="h-full w-full border-0"
            allow="clipboard-write"
            onLoad={(event) => event.currentTarget.contentWindow?.postMessage({ type: 'stockflow-cache-account', email: actorEmail }, window.location.origin)}
          />
        ) : surface === 'orders' ? (
          <Suspense fallback={<SectionLoading />}><OrderWorkspace key={orderFilter} actorEmail={actorEmail} initialStatus={orderFilter} /></Suspense>
        ) : surface === 'pricing' ? (
          <Suspense fallback={<SectionLoading />}><PricingWorkspace actorEmail={actorEmail} actorRole={actorRole} actorRoles={roles} /></Suspense>
        ) : surface === 'service' ? (
          <Suspense fallback={<SectionLoading />}><ServiceWorkspace /></Suspense>
        ) : <Suspense fallback={<SectionLoading />}><UserManagement staffAuth={staffAuth} emailActionsEnabled={staffEmailActionsEnabled} /></Suspense>}
      </section>
    </main>
  );
}

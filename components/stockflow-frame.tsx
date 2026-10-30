'use client';

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { desktopPopupState, disableDesktopPopups, enableDesktopPopups, showWorkPopup, type DesktopPopupState } from '@/lib/desktop-popups';
import { Boxes, Building2, CloudDownload, Ellipsis, Inbox, ShoppingCart, Tags, TrendingUp, TriangleAlert, Users, Wrench } from 'lucide-react';
import { NotificationBell } from './notification-bell';
import { BellIcon } from './order-list';
import { startWorkNotifications, workQueuesForRoles, type WorkItem, type WorkNotificationState } from '@/lib/work-notifications';
import { currentPushState, disablePush, disablePushBeforeSignOut, enablePush, loadPushConfig, readOpenOrderLink, readOpenOrderMessage, retryPendingPushRemoval, type PushConfig, type PushState } from '@/lib/push-subscription';
import Image from 'next/image';
import { readOrderDashboardMessage, readRequestsDashboardMessage } from '@/lib/stockflow-navigation';
import { prepareDeviceForAccount } from '@/lib/device-account-privacy';
import { hasAnyStockFlowRole, type StockFlowRole } from '@/lib/user-types';
import { revokeOfflineVault } from '@/lib/offline-vault-storage';
import { checkStaffSession, withStaffSessionLock } from '@/lib/staff-session-client';
import { hasUnsavedInput, sameRoles } from '@/lib/role-refresh';

const loadOrderWorkspace = () => import('./order-workspace').then((module) => ({ default: module.OrderWorkspace }));
const OrderWorkspace = lazy(loadOrderWorkspace);
const ServiceWorkspace = lazy(() => import('./service-workspace').then((module) => ({ default: module.ServiceWorkspace })));
const InstrumentEconomicsWorkspace = lazy(() => import('./instrument-economics-workspace').then((module) => ({ default: module.InstrumentEconomicsWorkspace })));
const UserManagement = lazy(() => import('./user-management').then((module) => ({ default: module.UserManagement })));
const PricingWorkspace = lazy(() => import('./pricing-workspace').then((module) => ({ default: module.PricingWorkspace })));
const RequestsWorkspace = lazy(() => import('./requests-workspace').then((module) => ({ default: module.RequestsWorkspace })));
const AccountsWorkspace = lazy(() => import('./accounts-workspace').then((module) => ({ default: module.AccountsWorkspace })));

type Surface = 'stock' | 'orders' | 'requests' | 'accounts' | 'pricing' | 'economics' | 'service' | 'users';
const surfaceIcons = { stock: Boxes, orders: ShoppingCart, requests: Inbox, accounts: Building2, pricing: Tags, economics: TrendingUp, service: Wrench, users: Users };
function SurfaceIcon({ surface, size }: { surface: Surface; size: number }) {
  const Icon = surfaceIcons[surface];
  return <Icon size={size} aria-hidden="true" className="shrink-0" />;
}
const initialWork: WorkNotificationState = { connection: 'checking', work: [], workTotal: 0, workMore: false, queues: [], fresh: [], reminders: [], checkedAt: null };

async function warmOrderData(actorEmail: string) {
  const { loadOrderBootstrap } = await import('@/lib/order-bootstrap-cache');
  await loadOrderBootstrap(actorEmail);
}

function SectionLoading() {
  return <div className="grid h-full place-items-center text-sm font-semibold text-sf-muted">Opening section…</div>;
}

export function StockFlowFrame({ actorEmail, actorRole, actorRoles, staffAuth = false, staffEmailActionsEnabled = false }: { actorEmail: string; actorRole: string; actorRoles?: StockFlowRole[]; staffAuth?: boolean; staffEmailActionsEnabled?: boolean }) {
  const roles = actorRoles ?? [actorRole as StockFlowRole];
  const rolesKey = roles.join(',');
  const [surface, setSurface] = useState<Surface>('stock');
  // Billing-only staff open Orders on the Bill queue; everyone else on Active.
  const homeOrderFilter = hasAnyStockFlowRole(roles, ['billing']) && !hasAnyStockFlowRole(roles, ['administrator', 'management', 'operations', 'sales', 'warehouse', 'accounts']) ? 'billing' : 'open';
  const [orderFilter, setOrderFilter] = useState(homeOrderFilter);
  const [deviceNotice, setDeviceNotice] = useState('');
  const [roleChangeMessage, setRoleChangeMessage] = useState('');
  const [readyEmail, setReadyEmail] = useState('');
  const signOutInFlight = useRef(false);
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    let stopped = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastCheck = 0;
    let roleCheckAt = 0;
    let consecutiveRoleDenials = 0;
    async function checkRoles() {
      if (document.hidden) return;
      if (Date.now() - roleCheckAt < 30000) return;
      roleCheckAt = Date.now();
      try {
        const response = await fetch('/api/me', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (stopped) return;
        if (response.status === 403) {
          consecutiveRoleDenials += 1;
          if (consecutiveRoleDenials >= 2 && (document.hidden || !hasUnsavedInput(document))) window.location.reload();
          else setRoleChangeMessage('Your access has changed. Reload to continue.');
          return;
        }
        consecutiveRoleDenials = 0;
        if (!response.ok) return;
        const current = await response.json() as { roles?: unknown };
        if (!Array.isArray(current.roles) || !current.roles.every((role): role is string => typeof role === 'string') || sameRoles(current.roles, rolesKey.split(','))) return;
        if (document.hidden && !hasUnsavedInput(document)) window.location.reload();
        else setRoleChangeMessage('Your access has changed. Reload to update.');
      } catch { /* Session role checks do not sign users out or interrupt work. */ }
    }
    async function check(renew = false) {
      if (stopped || running || document.visibilityState === 'hidden' || !navigator.onLine) return;
      running = true;
      lastCheck = Date.now();
      if (timer) clearTimeout(timer);
      try {
        const delay = staffAuth ? await checkStaffSession(renew) : null;
        if (stopped) return;
        if (staffAuth && delay === null) { window.location.assign('/staff-signin'); return; }
        await checkRoles();
        timer = setTimeout(() => { void check(staffAuth); }, staffAuth ? delay! * 1000 : 300000);
      } catch {
        if (staffAuth && !stopped) setDeviceNotice('Sign-in connection interrupted. Reconnect to verify your session; saved drafts remain unchanged.');
        // No automatic retry loop. A foreground/reconnection event can retry.
      } finally { running = false; }
    }
    const wake = () => { if (document.visibilityState === 'visible' && Date.now() - lastCheck >= 30000) void check(); };
    void check();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, [staffAuth, rolesKey]);
  async function staffSignOut() {
    if (signOutInFlight.current) return;
    signOutInFlight.current = true;
    setSigningOut(true);
    try {
      await disablePushBeforeSignOut(actorEmail);
      await revokeOfflineVault(localStorage);
      const response = await withStaffSessionLock(() => fetch('/api/staff-auth', { method: 'DELETE', cache: 'no-store', signal: AbortSignal.timeout(15000) }));
      if (response.ok) window.location.assign('/staff-signin');
      else setDeviceNotice('Sign-out failed. Please retry before sharing this device.');
    } catch { setDeviceNotice('Sign-out failed. Please retry before sharing this device.'); }
    finally { signOutInFlight.current = false; setSigningOut(false); }
  }

  async function chatGPTSignOut() {
    if (signOutInFlight.current) return;
    signOutInFlight.current = true;
    setSigningOut(true);
    await disablePushBeforeSignOut(actorEmail);
    window.top!.location.href = '/signout-with-chatgpt?return_to=/';
  }

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    let previousEmail = '';
    try { previousEmail = localStorage.getItem('stockflow:active-account:v1') || ''; } catch { /* Storage may be disabled. */ }
    const account = prepareDeviceForAccount(localStorage, sessionStorage, actorEmail);
    let active = true;
    const readyTimer = window.setTimeout(() => {
      void (async () => {
        if (account.switched) await disablePushBeforeSignOut(previousEmail);
        await retryPendingPushRemoval();
        if (active) setReadyEmail(actorEmail);
      })();
    }, 0);
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
      active = false;
      window.clearTimeout(readyTimer);
      if (noticeTimer !== undefined) window.clearTimeout(noticeTimer);
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      if (preloadTimer !== undefined) window.clearTimeout(preloadTimer);
    };
  }, [actorEmail]);

  useEffect(() => {
    function receiveDashboardNavigation(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (readRequestsDashboardMessage(event.data)) {
        setSurface('requests');
        return;
      }
      const message = readOrderDashboardMessage(event.data);
      if (!message) return;
      setOrderFilter(message.status);
      setSurface('orders');
    }
    window.addEventListener('message', receiveDashboardNavigation);
    return () => window.removeEventListener('message', receiveDashboardNavigation);
  }, []);

  // Work notifications: one foreground checker per session. Starts a few seconds after load so it never competes
  // with the first Stock request on a phone.
  const [work, setWork] = useState<WorkNotificationState>(initialWork);
  const [arrivals, setArrivals] = useState<WorkItem[]>([]);
  const [desktopPopups, setDesktopPopups] = useState<DesktopPopupState>(() => desktopPopupState());
  // Latest order opener for pop-up clicks (the work service callback is created once).
  const openFromPopup = useRef<(item: { orderId: string; orderNumber: string }) => void>(() => undefined);
  const workService = useRef<ReturnType<typeof startWorkNotifications> | null>(null);
  const [orderView, setOrderView] = useState<{ query: string; focus?: { orderId: string; orderNumber: string }; nonce: number }>({ query: '', nonce: 0 });
  const [moreOpen, setMoreOpen] = useState(false);
  // Viewers have no hand-offs; they get no checker and no bell.
  const notifiable = workQueuesForRoles(roles).length > 0;
  useEffect(() => {
    if (readyEmail !== actorEmail || !notifiable) return;
    let service: ReturnType<typeof startWorkNotifications> | null = null;
    const wake = () => service?.wake();
    const startTimer = window.setTimeout(() => {
      service = startWorkNotifications({
        actorEmail,
        roles: rolesKey.split(','),
        fetchJson: (url, signal) => fetch(url, { cache: 'no-store', signal }),
        active: () => document.visibilityState !== 'hidden',
        online: () => navigator.onLine,
        onState: setWork,
        onFresh: (items) => { setArrivals(items); showWorkPopup(items, (item) => openFromPopup.current(item)); },
      });
      workService.current = service;
    }, 4_000);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('offline', wake);
    return () => {
      window.clearTimeout(startTimer);
      service?.stop();
      workService.current = null;
      setWork(initialWork);
      setArrivals([]);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('offline', wake);
    };
  }, [actorEmail, readyEmail, rolesKey, notifiable]);
  const freshCount = work.fresh.length;
  const baseTitle = useRef('');
  useEffect(() => {
    // Keep the app's own title and only prefix the new-work count.
    if (!baseTitle.current) baseTitle.current = document.title.replace(/^\(\d+\+?\) /, '') || 'StockFlow';
    document.title = freshCount ? `(${freshCount}) ${baseTitle.current}` : baseTitle.current;
  }, [freshCount]);
  const newOrderIds = useMemo(() => new Set(work.fresh.map((item) => item.orderId)), [work.fresh]);

  function markWorkSeen() {
    workService.current?.markSeen();
    setArrivals([]);
  }
  openFromPopup.current = (item) => { setSurface('orders'); openOrder(item); };
  function openOrder(item: { orderId: string; orderNumber: string }) {
    markWorkSeen();
    setOrderFilter('all');
    setOrderView((current) => ({ query: item.orderNumber, focus: { orderId: item.orderId, orderNumber: item.orderNumber }, nonce: current.nonce + 1 }));
    setSurface('orders');
  }
  function openQueue(status: string, query = '') {
    setOrderFilter(status);
    setOrderView((current) => ({ query: query === 'mine' ? `assignee:${actorEmail.toLocaleLowerCase('en-IN')}` : query, nonce: current.nonce + 1 }));
    setSurface('orders');
  }

  function openSurface(item: Surface) {
    setMoreOpen(false);
    if (item === 'orders' && surface !== 'orders') {
      setOrderFilter(homeOrderFilter);
      setOrderView((current) => ({ query: '', nonce: current.nonce + 1 }));
    }
    setSurface(item);
  }
  const surfaces: Surface[] = ['stock', 'orders', 'requests', ...(hasAnyStockFlowRole(roles, ['administrator', 'management', 'sales', 'operations']) ? ['accounts' as const] : []), ...(hasAnyStockFlowRole(roles, ['administrator', 'management', 'accounts']) ? ['pricing' as const, 'economics' as const] : []), ...(hasAnyStockFlowRole(roles, ['administrator', 'operations', 'sales', 'management']) ? ['service' as const] : []), ...(hasAnyStockFlowRole(roles, ['administrator']) ? ['users' as const] : [])];
  const phoneMain: Surface[] = ['stock', 'orders', 'requests'];
  const phoneMore = surfaces.filter((item) => !phoneMain.includes(item));
  // Phone push: dormant until the server reports it is enabled (docs/PUSH-NOTIFICATIONS.md).
  const [pushConfig, setPushConfig] = useState<PushConfig>({ enabled: false, publicKey: '' });
  const [pushState, setPushState] = useState<PushState>('hidden');
  useEffect(() => {
    if (readyEmail !== actorEmail || !notifiable) return;
    let active = true;
    void loadPushConfig().then(async (config) => {
      if (!active) return;
      setPushConfig(config);
      const state = await currentPushState(config).catch((): PushState => 'hidden');
      if (active) setPushState(state);
    });
    return () => { active = false; };
  }, [actorEmail, readyEmail, notifiable]);
  async function changePush(enable: boolean) {
    setPushState('working');
    try {
      setPushState(enable ? await enablePush(pushConfig, fetch, actorEmail) : await disablePush(fetch, actorEmail) ? 'off' : 'error');
    } catch {
      setPushState('error');
    }
  }
  // A tapped phone notification opens the exact order: by deep link when StockFlow was closed, by message when open.
  const openOrderRef = useRef(openOrder);
  useEffect(() => { openOrderRef.current = openOrder; });
  useEffect(() => {
    if (readyEmail !== actorEmail) return;
    const link = readOpenOrderLink(window.location.search);
    if (link) {
      const cleaned = new URL(window.location.href);
      cleaned.searchParams.delete('openOrder');
      cleaned.searchParams.delete('n');
      window.history.replaceState(null, '', `${cleaned.pathname}${cleaned.search}${cleaned.hash}`);
      openOrderRef.current(link);
    }
    if (!('serviceWorker' in navigator)) return;
    const receive = (event: MessageEvent) => {
      const order = readOpenOrderMessage(event.data);
      if (order) {
        openOrderRef.current(order);
        event.ports[0]?.postMessage('ack');
      }
    };
    navigator.serviceWorker.addEventListener('message', receive);
    return () => navigator.serviceWorker.removeEventListener('message', receive);
  }, [actorEmail, readyEmail]);

  const offlineLink = staffAuth && hasAnyStockFlowRole(roles, ['administrator', 'management', 'sales', 'operations']);
  // Orders tab badge: orders waiting for you; red while any of them is new.
  const waitingCount = work.workTotal;
  const badgeText = waitingCount > 99 ? '99+' : `${waitingCount}${work.workMore ? '+' : ''}`;
  const badgeTone = freshCount ? 'bg-sf-danger' : 'bg-sf-accent';
  const ordersBadge = waitingCount ? <span id="orders-new-work" className={`ml-1.5 inline-grid min-w-5 place-items-center rounded-full px-1 text-[11px] font-black leading-5 text-white tabular-nums ${badgeTone}`}>{badgeText}<span className="sr-only"> waiting{freshCount ? `, ${freshCount} new` : ''}</span></span> : null;
  function arrivalsFilter(item: WorkItem) {
    const queue = work.queues.find((candidate) => candidate.id === item.queueId);
    return queue ? workService.current?.ordersFilterFor(queue) ?? queue.statuses[0] : 'open';
  }

  function warmOrders() {
    void loadOrderWorkspace();
    void warmOrderData(actorEmail).catch(() => undefined);
  }

  return (
    <main className="fixed inset-0 flex w-full flex-col overflow-hidden bg-sf-page text-sf-strong" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-sf-line-soft bg-white px-4 py-2 sm:h-16 sm:flex-nowrap sm:px-6 sm:py-0">
        <div className="flex min-w-0 items-center gap-3">
          <Image src="/suprabha-logo.png" alt="" width={36} height={36} priority className="size-9 shrink-0 object-contain" />
          <div className="min-w-0 sm:hidden xl:block">
            <p className="truncate text-sm font-extrabold text-sf-ink">StockFlow</p>
            <p className="hidden text-xs text-sf-subtle sm:block">Suprabha Distributors</p>
          </div>
        </div>
        <nav aria-label="Application sections" className="hidden min-w-0 overflow-x-auto rounded-xl bg-sf-soft p-1 [scrollbar-width:none] sm:flex">
          {surfaces.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => openSurface(item)}
              onFocus={item === 'orders' ? warmOrders : undefined}
              onPointerEnter={item === 'orders' ? warmOrders : undefined}
              onPointerDown={item === 'orders' ? warmOrders : undefined}
              aria-pressed={surface === item}
              aria-describedby={item === 'orders' && waitingCount ? 'orders-new-work' : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-bold capitalize transition 2xl:px-4 ${
                surface === item
                  ? 'bg-white text-sf-brand shadow-sm'
                  : 'text-sf-muted hover:text-sf-ink'
              }`}
            >
              <SurfaceIcon surface={item} size={18} />{item}{item === 'orders' ? ordersBadge : null}
            </button>
          ))}
          {/* Full navigation re-verifies the staff session before local preparation. */}
          {/* oxlint-disable-next-line next/no-html-link-for-pages */}
          {offlineLink ? <a href="/offline-preparation" className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-bold text-sf-muted hover:text-sf-ink 2xl:px-4"><CloudDownload aria-hidden="true" size={18} />Offline</a> : null}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
        {notifiable ? <NotificationBell state={work} desktop={{ state: desktopPopups, onEnable: () => void enableDesktopPopups().then(setDesktopPopups), onDisable: () => setDesktopPopups(disableDesktopPopups()) }} ordersFilterFor={(queue) => workService.current?.ordersFilterFor(queue) ?? queue.statuses[0]} phone={pushState === 'hidden' ? undefined : { state: pushState, onEnable: () => void changePush(true), onDisable: () => void changePush(false) }} onSeen={markWorkSeen} onOpenOrder={openOrder} onOpenQueue={openQueue} onRetry={() => workService.current?.retry()} /> : null}
        {/* Sites owns the session cookie: use a full navigation, not a client router link. */}
        {/* oxlint-disable-next-line next/no-html-link-for-pages */}
          {staffAuth ? <button type="button" disabled={signingOut} onClick={() => void staffSignOut()} aria-label={`Sign out ${actorEmail}`} className="min-h-11 rounded-lg border px-3 text-sm font-bold disabled:opacity-50">{signingOut ? 'Signing out…' : 'Sign out'}</button> : <a href="/signout-with-chatgpt?return_to=/" target="_top" onClick={(event) => { event.preventDefault(); void chatGPTSignOut(); }} aria-disabled={signingOut} aria-label={`Sign out ${actorEmail}`} title={`Signed in as ${actorEmail}`} className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-sf-line-soft px-2 text-xs font-bold text-sf-strong hover:bg-sf-soft sm:px-3 sm:text-sm">{signingOut ? 'Signing out…' : 'Sign out'}</a>}
        </div>
      </header>
      {deviceNotice ? <output className="flex shrink-0 items-center justify-between gap-3 border-b border-sf-warning-line bg-sf-warning-soft px-4 py-2 text-xs font-semibold text-sf-warning sm:px-6"><span className="inline-flex items-center gap-1"><TriangleAlert size={16} aria-hidden="true" className="shrink-0" />{deviceNotice}</span><button type="button" onClick={() => setDeviceNotice('')} className="min-h-8 shrink-0 rounded-lg px-3 font-bold hover:bg-sf-warning-line">Dismiss</button></output> : null}
      {roleChangeMessage ? <output aria-live="polite" className="fixed inset-x-0 top-0 z-50 flex min-h-14 max-w-full items-center justify-between gap-2 border-b border-sf-warning-line bg-white px-3 py-1 text-sm shadow sm:px-6"><span className="min-w-0 flex-1">{roleChangeMessage}</span><button type="button" onClick={() => window.location.reload()} className="min-h-11 shrink-0 rounded-lg bg-sf-ink px-4 font-bold text-white">Reload</button><button type="button" onClick={() => setRoleChangeMessage('')} className="min-h-11 shrink-0 rounded-lg px-2 text-sf-muted">Later</button></output> : null}
      <section className="min-h-0 flex-1 overflow-hidden">
        {readyEmail !== actorEmail ? <SectionLoading /> : surface === 'stock' ? (
          <iframe
            title="Suprabha stock dashboard"
            src="/stockflow.html"
            className="block h-full w-full border-0"
            allow="clipboard-write"
            onLoad={(event) => event.currentTarget.contentWindow?.postMessage({ type: 'stockflow-cache-account', email: actorEmail }, window.location.origin)}
          />
        ) : surface === 'orders' ? (
          <Suspense fallback={<SectionLoading />}><OrderWorkspace key={`${orderFilter}:${orderView.nonce}`} actorEmail={actorEmail} initialStatus={orderFilter} initialQuery={orderView.query} focusOrder={orderView.focus} newOrderIds={newOrderIds} onOrderActed={() => workService.current?.reconcile()} /></Suspense>
        ) : surface === 'requests' ? (
          <Suspense fallback={<SectionLoading />}><RequestsWorkspace roles={roles} onOpenOrder={(orderId, orderNumber) => openOrder({ orderId, orderNumber })} /></Suspense>
        ) : surface === 'accounts' && hasAnyStockFlowRole(roles, ['administrator', 'management', 'sales', 'operations']) ? (
          <Suspense fallback={<SectionLoading />}><AccountsWorkspace defaultMode={hasAnyStockFlowRole(roles, ['administrator', 'management']) ? 'all' : 'mine'} /></Suspense>
        ) : surface === 'pricing' ? (
          <Suspense fallback={<SectionLoading />}><PricingWorkspace actorEmail={actorEmail} actorRole={actorRole} actorRoles={roles} /></Suspense>
        ) : surface === 'economics' ? (
          <Suspense fallback={<SectionLoading />}><InstrumentEconomicsWorkspace embedded /></Suspense>
        ) : surface === 'service' ? (
          <Suspense fallback={<SectionLoading />}><ServiceWorkspace /></Suspense>
        ) : <Suspense fallback={<SectionLoading />}><UserManagement staffAuth={staffAuth} emailActionsEnabled={staffEmailActionsEnabled} /></Suspense>}
      </section>
      {arrivals.length ? (
        <output aria-live="polite" className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex items-center gap-3 rounded-2xl border border-sf-line bg-white p-3 shadow-[0_12px_32px_rgba(9,47,54,0.18)] sm:inset-x-auto sm:bottom-auto sm:right-6 sm:top-20 sm:w-[24rem]">
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-sf-accent-soft text-sf-accent"><BellIcon className="size-4" /></span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-sm text-sf-ink">{arrivals.length === 1 ? arrivals[0].message : `${arrivals.length} new orders for you`}</strong>
            <span className="block truncate text-xs text-sf-muted">{arrivals.length === 1 ? `${arrivals[0].customerName} · ${arrivals[0].orderNumber}` : arrivals.slice(0, 3).map((item) => item.customerName).join(', ')}</span>
          </span>
          <button type="button" onClick={() => arrivals.length === 1 ? openOrder(arrivals[0]) : (markWorkSeen(), openQueue(arrivalsFilter(arrivals[0]), arrivals[0].queueId === 'assigned' ? 'mine' : ''))} className="min-h-11 shrink-0 rounded-xl bg-sf-ink px-4 text-sm font-bold text-white">{arrivals.length === 1 ? 'Open' : 'View'}</button>
          <button type="button" aria-label="Dismiss" onClick={() => setArrivals([])} className="grid min-h-11 min-w-9 shrink-0 place-items-center rounded-lg text-lg text-sf-muted hover:bg-sf-soft">×</button>
        </output>
      ) : null}
      <nav aria-label="Application sections" className="relative flex shrink-0 border-t border-sf-line-soft bg-white sm:hidden">
        {phoneMain.map((item) => (
          <button key={item} type="button" aria-label={item} onClick={() => openSurface(item)} onPointerDown={item === 'orders' ? warmOrders : undefined} aria-pressed={surface === item} aria-describedby={item === 'orders' && waitingCount ? 'orders-new-work-phone' : undefined} className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-bold capitalize ${surface === item ? 'text-sf-brand' : 'text-sf-muted'}`}>
            <span className="relative">
              <span aria-hidden="true" className={`block h-1 w-6 rounded-full ${surface === item ? 'bg-sf-ink' : 'bg-transparent'}`} />
              {item === 'orders' && waitingCount ? <span id="orders-new-work-phone" className={`absolute -right-5 -top-2 min-w-5 rounded-full px-1 text-center text-[11px] font-black leading-5 text-white ${badgeTone}`}>{badgeText}<span className="sr-only"> waiting{freshCount ? `, ${freshCount} new` : ''}</span></span> : null}
            </span>
            <SurfaceIcon surface={item} size={22} />
            <span className="text-xs">{item}</span>
          </button>
        ))}
        {phoneMore.length || offlineLink ? <button type="button" aria-expanded={moreOpen} aria-controls="more-sections" onClick={() => setMoreOpen(!moreOpen)} className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-bold ${phoneMore.includes(surface) || moreOpen ? 'text-sf-brand' : 'text-sf-muted'}`}><span aria-hidden="true" className={`block h-1 w-6 rounded-full ${phoneMore.includes(surface) ? 'bg-sf-ink' : 'bg-transparent'}`} /><Ellipsis size={22} aria-hidden="true" className="shrink-0" /><span className="text-xs">More</span></button> : null}
        {moreOpen ? <div id="more-sections" className="absolute inset-x-2 bottom-[calc(100%+0.5rem)] z-40 grid gap-1 rounded-2xl border border-sf-line-soft bg-white p-2 shadow-xl">
          {phoneMore.map((item) => <button key={item} type="button" onClick={() => openSurface(item)} aria-pressed={surface === item} className="flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-left text-sm font-bold capitalize text-sf-muted hover:bg-sf-soft aria-pressed:bg-sf-soft aria-pressed:text-sf-brand"><SurfaceIcon surface={item} size={18} />{item}</button>)}
          {/* oxlint-disable-next-line next/no-html-link-for-pages */}
          {offlineLink ? <a href="/offline-preparation" className="flex min-h-11 items-center rounded-xl px-3 text-sm font-bold text-sf-body hover:bg-sf-soft">Offline</a> : null}
        </div> : null}
      </nav>
    </main>
  );
}

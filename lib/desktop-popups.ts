/**
 * Desktop pop-ups while StockFlow is open in a background tab or window. They use the
 * browser's Notification API directly, so they need no push server; when the tab is
 * closed there is no pop-up (the in-app bell still shows the work on return).
 */
export type DesktopPopupState = 'unsupported' | 'off' | 'on' | 'blocked';
export type PopupItem = { orderId: string; orderNumber: string; customerName: string; message: string };

const PREFERENCE_KEY = 'stockflow-desktop-popups';

type PopupScope = {
  Notification?: { permission: NotificationPermission; requestPermission: () => Promise<NotificationPermission> } & (new (title: string, options?: NotificationOptions) => Notification);
  localStorage?: Storage;
  navigator?: { userAgent: string; maxTouchPoints?: number };
  document?: { hidden: boolean; hasFocus: () => boolean };
};

function scopeOf(scope?: PopupScope): PopupScope {
  return scope ?? (typeof window === 'undefined' ? {} : (window as unknown as PopupScope));
}

function preferred(scope: PopupScope) {
  try { return scope.localStorage?.getItem(PREFERENCE_KEY) === 'on'; } catch { return false; }
}

function setPreferred(scope: PopupScope, on: boolean) {
  try { if (on) scope.localStorage?.setItem(PREFERENCE_KEY, 'on'); else scope.localStorage?.removeItem(PREFERENCE_KEY); } catch { /* per-viewer convenience only */ }
}

/** Phones and iPads use the home-screen app; pop-ups here are for desktop browsers. */
export function desktopPopupState(input?: PopupScope): DesktopPopupState {
  const scope = scopeOf(input);
  const agent = scope.navigator?.userAgent ?? '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(agent) || (/Macintosh/i.test(agent) && (scope.navigator?.maxTouchPoints ?? 0) > 1);
  if (!scope.Notification || mobile) return 'unsupported';
  if (scope.Notification.permission === 'denied') return 'blocked';
  return scope.Notification.permission === 'granted' && preferred(scope) ? 'on' : 'off';
}

/** Must run from a tap: asks the browser for permission and remembers the choice on this computer. */
export async function enableDesktopPopups(input?: PopupScope): Promise<DesktopPopupState> {
  const scope = scopeOf(input);
  if (!scope.Notification) return 'unsupported';
  const permission = scope.Notification.permission === 'granted' ? 'granted' : await scope.Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  setPreferred(scope, true);
  return 'on';
}

export function disableDesktopPopups(input?: PopupScope): DesktopPopupState {
  setPreferred(scopeOf(input), false);
  return desktopPopupState(input);
}

/** Show one pop-up for new work, only when StockFlow is not the window in front. */
export function showWorkPopup(items: PopupItem[], onOpen: (item: PopupItem) => void, input?: PopupScope): boolean {
  const scope = scopeOf(input);
  if (!items.length || desktopPopupState(scope) !== 'on' || !scope.Notification) return false;
  if (scope.document && !scope.document.hidden && scope.document.hasFocus()) return false;
  const first = items[0];
  const popup = new scope.Notification(items.length === 1 ? first.message : `${items.length} new orders for you`, {
    body: items.length === 1 ? `${first.customerName} · ${first.orderNumber}` : items.slice(0, 3).map((item) => item.customerName).join(', '),
    tag: items.length === 1 ? `stockflow-work-${first.orderId}` : 'stockflow-work',
  });
  popup.onclick = () => {
    try { (globalThis as { focus?: () => void }).focus?.(); } catch { /* best effort */ }
    onOpen(first);
    popup.close();
  };
  return true;
}

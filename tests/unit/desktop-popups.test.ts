import { describe, expect, it, vi } from 'vitest';
import { desktopPopupState, disableDesktopPopups, enableDesktopPopups, showWorkPopup } from '@/lib/desktop-popups';

function scope(permission: NotificationPermission, options: { agent?: string; hidden?: boolean; focus?: boolean; stored?: string } = {}) {
  const store = new Map<string, string>(options.stored ? [['stockflow-desktop-popups', options.stored]] : []);
  const shown: Array<{ title: string; options?: NotificationOptions; close: () => void; onclick: null | (() => void) }> = [];
  class FakeNotification {
    static permission = permission;
    static requestPermission = vi.fn(async () => { FakeNotification.permission = 'granted'; return 'granted' as NotificationPermission; });
    onclick: null | (() => void) = null;
    close = vi.fn();
    constructor(public title: string, public options?: NotificationOptions) { shown.push(this as never); }
  }
  return {
    shown,
    value: {
      Notification: FakeNotification as never,
      localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) } as Storage,
      navigator: { userAgent: options.agent ?? 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', maxTouchPoints: 0 },
      document: { hidden: options.hidden ?? true, hasFocus: () => options.focus ?? false },
    },
  };
}
const item = { orderId: 'o1', orderNumber: 'SO/26-27/0061', customerName: 'Vaatsalya Life Hospital', message: 'Packed and priced · ready to bill' };

describe('desktop pop-ups', () => {
  it('is for desktop browsers only, and starts off', () => {
    expect(desktopPopupState(scope('default').value)).toBe('off');
    expect(desktopPopupState(scope('granted', { agent: 'Mozilla/5.0 (Linux; Android 14) Mobile' }).value)).toBe('unsupported');
    expect(desktopPopupState(scope('denied').value)).toBe('blocked');
  });
  it('asks permission on enable, remembers it, and can be turned off', async () => {
    const s = scope('default');
    expect(await enableDesktopPopups(s.value)).toBe('on');
    expect(desktopPopupState(s.value)).toBe('on');
    expect(disableDesktopPopups(s.value)).toBe('off');
  });
  it('pops up only when StockFlow is in the background, and opens the order on click', () => {
    const background = scope('granted', { stored: 'on', hidden: true });
    const opened = vi.fn();
    expect(showWorkPopup([item], opened, background.value)).toBe(true);
    expect(background.shown[0]).toMatchObject({ title: 'Packed and priced · ready to bill', options: { body: 'Vaatsalya Life Hospital · SO/26-27/0061', tag: 'stockflow-work-o1' } });
    background.shown[0].onclick?.();
    expect(opened).toHaveBeenCalledWith(item);
    const front = scope('granted', { stored: 'on', hidden: false, focus: true });
    expect(showWorkPopup([item], opened, front.value)).toBe(false);
    expect(showWorkPopup([item], opened, scope('granted').value)).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), frame: vi.fn(), redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user, chatGPTSignInPath: () => '/signin-with-chatgpt?return_to=%2F' }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('@/components/stockflow-frame', () => ({ StockFlowFrame: (props: unknown) => { mocks.frame(props); return <div>Authenticated workspace</div>; } }));
vi.mock('next/image', () => ({ default: () => <span>Suprabha Distributors</span> }));
import Home from '@/app/page';
import StaffSignInPage from '@/app/staff-signin/page';
import { StaffSessionUnavailableError } from '@/lib/staff-auth';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('STOCKFLOW_AUTH_MODE', 'sites');
  vi.stubEnv('STOCKFLOW_PUBLIC_STAFF_ORIGIN', '');
  vi.stubEnv('STOCKFLOW_PUBLIC_CHATGPT_ORIGIN', '');
  mocks.user.mockResolvedValue(null);
  mocks.redirect.mockImplementation(() => { throw new Error('REDIRECT'); });
});
afterEach(() => vi.unstubAllEnvs());

describe('public sign-in choice rendering', () => {
  it('offers connection retry instead of a password form during a verification outage', async () => {
    vi.stubEnv('STOCKFLOW_AUTH_MODE', 'supabase');
    mocks.user.mockRejectedValue(new StaffSessionUnavailableError());
    for (const page of [await Home(), await StaffSignInPage()]) {
      const html = renderToStaticMarkup(page);
      expect(html).toContain('Retry connection');
      expect(html).not.toContain('type="password"');
    }
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it('keeps ChatGPT sign-in when staff hosting is not configured', async () => {
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain('Sign in with ChatGPT');
    expect(html).toContain('/signin-with-chatgpt?return_to=%2F');
    expect(html).not.toContain('Staff email / password');
  });
  it('offers both choices without forwarding identity or credentials', async () => {
    vi.stubEnv('STOCKFLOW_PUBLIC_STAFF_ORIGIN', 'https://staff.example.test');
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain('Sign in with ChatGPT');
    expect(html).toContain('Staff email / password');
    expect(html).toContain('href="https://staff.example.test/staff-signin" target="_top"');
    expect(html).not.toContain('access_token');
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it('an invalid alternate origin cannot remove ChatGPT sign-in', async () => {
    vi.stubEnv('STOCKFLOW_PUBLIC_STAFF_ORIGIN', 'javascript:alert(1)');
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain('Sign in with ChatGPT');
    expect(html).not.toContain('javascript:');
  });
  it('offers the configured ChatGPT peer from both staff entry routes', async () => {
    vi.stubEnv('STOCKFLOW_AUTH_MODE', 'supabase');
    vi.stubEnv('STOCKFLOW_PUBLIC_CHATGPT_ORIGIN', 'https://stockflow.chatgpt.site');
    for (const page of [await Home(), await StaffSignInPage()]) {
      const html = renderToStaticMarkup(page);
      expect(html).toContain('Staff sign in');
      expect(html).toContain('Sign in with ChatGPT');
      expect(html).toContain('https://stockflow.chatgpt.site/signin-with-chatgpt?return_to=%2F');
      expect(html.toLowerCase()).toContain('autocomplete="current-password"');
    }
  });
  it('returns a verified staff session to the workspace instead of requesting another login', async () => {
    vi.stubEnv('STOCKFLOW_AUTH_MODE', 'supabase');
    mocks.user.mockResolvedValue({ userId: 'staff-1', email: 'staff@example.test' });
    await expect(Promise.resolve().then(() => StaffSignInPage())).rejects.toThrow('REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith('/');
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it('does not check staff identity or redirect when staff authentication is disabled', async () => {
    const html = renderToStaticMarkup(await StaffSignInPage());
    expect(html).toContain('Staff sign-in is not enabled');
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it('keeps approved authenticated users in their existing workspace', async () => {
    mocks.user.mockResolvedValue({ email: 'staff@example.test' });
    mocks.session.mockResolvedValue({ email: 'staff@example.test', role: 'accounts' });
    expect(renderToStaticMarkup(await Home())).toContain('Authenticated workspace');
    expect(mocks.frame).toHaveBeenCalledWith(expect.objectContaining({ actorEmail: 'staff@example.test', actorRole: 'accounts', staffAuth: false }));
  });
});

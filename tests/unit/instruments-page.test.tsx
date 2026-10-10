import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), redirect: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/components/instrument-workspace', () => ({ InstrumentWorkspace: () => null }));
import Page from '@/app/instruments/page';
beforeEach(() => {
  vi.clearAllMocks(); mocks.redirect.mockImplementation(() => { throw new Error('redirect'); });
  mocks.user.mockResolvedValue({ email: 'staff@example.com' });
  mocks.session.mockResolvedValue({ email: 'staff@example.com', roles: ['sales'] });
});
describe('instrument page authorization', () => {
  it('redirects unsigned visitors before accessing membership', async () => {
    mocks.user.mockResolvedValue(null); await expect(Page()).rejects.toThrow('redirect'); expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each([null, { roles: ['viewer'] }])('rejects unapproved membership', async session => {
    mocks.session.mockResolvedValue(session); await expect(Page()).rejects.toThrow('redirect');
  });
  it('allows the verified sales role without exposing server credentials', async () => {
    const page = await Page(); expect(page.props).toEqual({}); expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

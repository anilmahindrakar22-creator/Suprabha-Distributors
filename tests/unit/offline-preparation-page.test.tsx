import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), redirect: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/components/offline-order-preparation', () => ({ OfflineOrderPreparation: () => null }));
import Page from '@/app/offline-preparation/page';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation(() => { throw new Error('redirect'); });
  mocks.user.mockResolvedValue({ email: 'staff@example.com' });
  mocks.session.mockResolvedValue({ email: 'staff@example.com', roles: ['sales'] });
});
describe('offline preparation entry authorization', () => {
  it('redirects unauthenticated visitors without membership lookup', async () => {
    mocks.user.mockResolvedValue(null);
    await expect(Page()).rejects.toThrow('redirect');
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each([null, { roles: ['viewer'] }, { roles: ['sales', 'invalid'] }])('rejects unavailable or unauthorized membership', async (session) => {
    mocks.session.mockResolvedValue(session);
    await expect(Page()).rejects.toThrow('redirect');
  });
  it('passes only the verified account to preparation', async () => {
    const page = await Page();
    expect(page.props).toEqual({ actorEmail: 'staff@example.com' });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), redirect: vi.fn() }));
vi.mock('@/app/chatgpt-auth', () => ({ getChatGPTUser: mocks.user }));
vi.mock('@/lib/stockflow-session', () => ({ getStockFlowSession: mocks.session }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/components/instrument-economics-workspace', () => ({ InstrumentEconomicsWorkspace: () => null }));
import Page from '@/app/instrument-economics/page';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation(() => { throw new Error('redirect'); });
  mocks.user.mockResolvedValue({ email: 'staff@example.com' });
  mocks.session.mockResolvedValue({ email: 'staff@example.com', roles: ['accounts'] });
});

describe('instrument economics page authorization', () => {
  it('redirects unsigned visitors before checking membership', async () => {
    mocks.user.mockResolvedValue(null);
    await expect(Page()).rejects.toThrow('redirect');
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it.each([null, { roles: ['sales'] }, { roles: ['viewer'] }])('redirects memberships without economics read access', async session => {
    mocks.session.mockResolvedValue(session);
    await expect(Page()).rejects.toThrow('redirect');
  });

  it.each(['accounts', 'management'])('allows the %s role to render the workspace', async role => {
    mocks.session.mockResolvedValue({ email: 'staff@example.com', roles: [role] });
    const page = await Page();
    expect(page.props).toEqual({});
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

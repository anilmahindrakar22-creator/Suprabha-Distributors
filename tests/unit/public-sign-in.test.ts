import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicChatGPTSignInUrl, publicStaffSignInUrl } from '@/lib/staff-auth';

afterEach(() => vi.unstubAllEnvs());

describe('public staff sign-in URL', () => {
  it('returns null when no public staff origin is configured', () => {
    vi.stubEnv('STOCKFLOW_PUBLIC_STAFF_ORIGIN', '');
    expect(publicStaffSignInUrl()).toBeNull();
  });

  it('uses the explicitly configured HTTPS origin and trims surrounding whitespace', () => {
    vi.stubEnv('STOCKFLOW_PUBLIC_STAFF_ORIGIN', '  https://staff.example.test  ');
    expect(publicStaffSignInUrl()).toBe('https://staff.example.test/staff-signin');
  });

  it.each([
    'http://staff.example.test',
    'https://user:password@staff.example.test',
    'https://staff.example.test/path',
    'https://staff.example.test?next=/private',
    'https://staff.example.test#fragment',
    'https://staff.example.test:8443',
    'https://localhost',
    'https://127.0.0.1',
    'https://10.0.0.1',
    'https://192.168.1.10',
    'https://chatgpt.site',
    'https://staff.chatgpt.site',
  ])('returns null for invalid origin %s', origin => {
    vi.stubEnv('STOCKFLOW_PUBLIC_STAFF_ORIGIN', origin);
    expect(publicStaffSignInUrl()).toBeNull();
  });

  it('does not infer a public link from the private staff origin', () => {
    vi.stubEnv('STOCKFLOW_PUBLIC_STAFF_ORIGIN', '');
    vi.stubEnv('STOCKFLOW_STAFF_ORIGIN', 'https://staff.example.test');
    expect(publicStaffSignInUrl()).toBeNull();
  });

  it('does not expose an auth key in the URL', () => {
    const key = 'sb_secret_sensitive-value';
    vi.stubEnv('STOCKFLOW_AUTH_ADMIN_KEY', key);
    vi.stubEnv('STOCKFLOW_PUBLIC_STAFF_ORIGIN', 'https://staff.example.test');
    const url = publicStaffSignInUrl();
    expect(url).toBe('https://staff.example.test/staff-signin');
    expect(url).not.toContain(key);
  });
});

describe('public ChatGPT sign-in URL', () => {
  it('returns null when no public ChatGPT origin is configured', () => {
    vi.stubEnv('STOCKFLOW_PUBLIC_CHATGPT_ORIGIN', '');
    expect(publicChatGPTSignInUrl()).toBeNull();
  });

  it('uses the configured ChatGPT site subdomain and trims whitespace', () => {
    vi.stubEnv('STOCKFLOW_PUBLIC_CHATGPT_ORIGIN', '  https://stockflow.chatgpt.site  ');
    expect(publicChatGPTSignInUrl()).toBe('https://stockflow.chatgpt.site/signin-with-chatgpt?return_to=%2F');
  });

  it.each([
    'http://stockflow.chatgpt.site',
    'https://user:password@stockflow.chatgpt.site',
    'https://stockflow.chatgpt.site/path',
    'https://stockflow.chatgpt.site?next=/private',
    'https://stockflow.chatgpt.site#fragment',
    'https://stockflow.chatgpt.site:8443',
    'https://chatgpt.site',
    'https://example.test',
    'https://example.chatgpt.site.evil.test',
  ])('returns null for invalid origin %s', origin => {
    vi.stubEnv('STOCKFLOW_PUBLIC_CHATGPT_ORIGIN', origin);
    expect(publicChatGPTSignInUrl()).toBeNull();
  });

  it('does not expose an auth key in the URL', () => {
    const key = 'sb_secret_sensitive-value';
    vi.stubEnv('STOCKFLOW_AUTH_ADMIN_KEY', key);
    vi.stubEnv('STOCKFLOW_PUBLIC_CHATGPT_ORIGIN', 'https://stockflow.chatgpt.site');
    const url = publicChatGPTSignInUrl();
    expect(url).toBe('https://stockflow.chatgpt.site/signin-with-chatgpt?return_to=%2F');
    expect(url).not.toContain(key);
  });
});

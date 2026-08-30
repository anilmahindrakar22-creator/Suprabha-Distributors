import { describe, expect, it } from 'vitest';
import {
  chatGPTSignInPath,
  hasAllowedEmail,
  normalizeEmail,
} from '../../lib/access-control.mjs';

describe('access control', () => {
  it('normalizes and allows approved email addresses', () => {
    expect(normalizeEmail('  Anil.Mahindrakar22@GMAIL.COM ')).toBe(
      'anil.mahindrakar22@gmail.com',
    );
    expect(hasAllowedEmail('NIKITESH.AM@GMAIL.COM')).toBe(true);
  });

  it('rejects missing and unapproved email addresses', () => {
    expect(hasAllowedEmail(null)).toBe(false);
    expect(hasAllowedEmail('visitor@example.com')).toBe(false);
  });

  it('prevents external return URLs in the sign-in flow', () => {
    expect(chatGPTSignInPath('/orders?view=open')).toBe(
      '/signin-with-chatgpt?return_to=%2Forders%3Fview%3Dopen',
    );
    expect(chatGPTSignInPath('//malicious.example')).toBe(
      '/signin-with-chatgpt?return_to=%2F',
    );
    expect(chatGPTSignInPath('https://malicious.example')).toBe(
      '/signin-with-chatgpt?return_to=%2F',
    );
  });
});

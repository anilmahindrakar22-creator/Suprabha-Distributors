import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chatGPTSignInPath,
  hasAllowedEmail,
  normalizeEmail,
} from '../lib/access-control.mjs';

test('normalizes approved email addresses', () => {
  assert.equal(
    normalizeEmail('  Anil.Mahindrakar22@GMAIL.COM '),
    'anil.mahindrakar22@gmail.com',
  );
  assert.equal(hasAllowedEmail('NIKITESH.AM@GMAIL.COM'), true);
});

test('rejects missing and unapproved email addresses', () => {
  assert.equal(hasAllowedEmail(null), false);
  assert.equal(hasAllowedEmail('visitor@example.com'), false);
});

test('prevents external return URLs in the sign-in flow', () => {
  assert.equal(
    chatGPTSignInPath('/orders?view=open'),
    '/signin-with-chatgpt?return_to=%2Forders%3Fview%3Dopen',
  );
  assert.equal(
    chatGPTSignInPath('//malicious.example'),
    '/signin-with-chatgpt?return_to=%2F',
  );
  assert.equal(
    chatGPTSignInPath('https://malicious.example'),
    '/signin-with-chatgpt?return_to=%2F',
  );
});

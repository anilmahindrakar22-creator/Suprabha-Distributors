const allowedEmails = new Set([
  'anil.mahindrakar22@gmail.com',
  'nikitesh.am@gmail.com',
]);

export function normalizeEmail(value) {
  return value?.trim().toLowerCase() || null;
}

export function hasAllowedEmail(value) {
  const email = normalizeEmail(value);
  return email !== null && allowedEmails.has(email);
}

export function chatGPTSignInPath(returnTo = '/') {
  const safeReturnTo =
    returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
  return `/signin-with-chatgpt?return_to=${encodeURIComponent(safeReturnTo)}`;
}
